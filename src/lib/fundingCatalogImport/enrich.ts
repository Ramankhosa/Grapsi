/**
 * Enrichment: fetch an imported catalogue call's official page and its
 * documents, and turn a LITE call into an ENRICHED one with guidelines from
 * the funder's own text.
 *
 * Per call:
 *  1. robots.txt and a per-host pause (never more than one request every few
 *     seconds to the same funder site);
 *  2. the official page as text, and up to four same-site PDF/DOCX documents
 *     it links to, registered and processed one at a time;
 *  3. a description from the page (provenance official_page, so a re-import
 *     never overwrites it) and guidelines extracted from the documents.
 * A quality gate decides the outcome. Pass: enrichment_level ENRICHED, with
 * the guidelines as guideline extraction saved them (approved when it is
 * confident, as for curated intake). Fail: the attempt's documents and
 * guidelines are deleted, an ENRICHMENT_REVIEW item records the page and the
 * reasons, and the call stays LITE. A generic funder home page fails on the title
 * check, a script-rendered portal on page length.
 *
 * Never calls intake jobs, persistDraft, publish or classification, and only
 * writes calls that are imported, released, GLOBAL_CATALOG and LITE. Every
 * inserted row and changed column is logged under an ENRICH run so
 * rollbackEnrichmentRun removes them. LLM cost is logged against the operator
 * (the PLATFORM tenant), never a customer tenant.
 */
import * as cheerio from 'cheerio'

import { Prisma, type PrismaClient } from '@/lib/prisma-generated'
import { fundingDocumentService } from '@/lib/fundingDocuments/service'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'
import { ingestFundingDocumentFromUrl } from '@/lib/fundingIntake/documentUrlIngestion'
import { extractFundingOpportunity } from '@/lib/fundingIntake/extractor'
import type { IntakeOperator } from '@/lib/fundingIntake/types'
import { assertSafePublicHttpsUrl, fetchReadableUrlContent } from '@/lib/fundingIntake/utils'
import { isAllowedByRobots } from '@/lib/monitor/fetcher'

import { stampFields } from './provenance'

export const ENRICH_SOURCE_KEY = 'catalog-enrichment'
export const ENRICH_VERSION = 'enrich-2026-10-16'
const HOST_SPACING_MS = 6_000
const MAX_DOCUMENTS = 4
const MIN_PAGE_CHARS = 1_500
const MIN_GUIDELINE_ITEMS = 5
const MIN_TITLE_OVERLAP = 0.5
const MIN_DESCRIPTION_CHARS = 300
/** Page text kept: a few pages render megabytes of script/JSON as "text". */
const MAX_PAGE_CHARS = 100_000

export type EnrichmentStatus = 'ENRICHED' | 'NEEDS_REVIEW' | 'SKIPPED' | 'FAILED'

export interface EnrichmentOutcome {
  callId: string
  title: string
  status: EnrichmentStatus
  reasons: string[]
  pageUrl: string | null
  pageChars: number
  documents: number
  guidelineItems: number
  descriptionUpdated: boolean
}

/* --------------------------------------------------------------- politeness */

const lastFetchByHost = new Map<string, number>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** robots.txt, then wait until this host has not been asked for HOST_SPACING_MS. */
async function politeFetchGate(url: string): Promise<boolean> {
  if (!(await isAllowedByRobots(url))) return false
  const host = new URL(url).host
  const wait = (lastFetchByHost.get(host) || 0) + HOST_SPACING_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastFetchByHost.set(host, Date.now())
  return true
}

const registrableHost = (host: string) => host.replace(/^www\./, '').split('.').slice(-2).join('.')

async function fetchHtml(url: string): Promise<string | null> {
  const safe = await assertSafePublicHttpsUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(safe.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'GrantMentor Funding Intake/1.0', Accept: 'text/html' },
    })
    if (!response.ok || !String(response.headers.get('content-type') || '').includes('html')) return null
    const text = await response.text()
    return text.slice(0, 5_000_000)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Site furniture, not call material: legal pages, corporate reports, policies. */
const IRRELEVANT_DOCUMENT = /(privacy|cookie|terms[-_ ]?of[-_ ]?(use|service)|legal|imprint|impressum|disclaimer|transparency|supply[-_ ]?chain|modern[-_ ]?slavery|annual[-_ ]?report|financial[-_ ]?statement|press|media[-_ ]?kit|brochure|accessibility|code[-_ ]?of[-_ ]?conduct|\bmsa\b|attestation|sustainability[-_ ]?report)/i
/** What call documents are called, in the languages the catalogue carries. */
const CALL_DOCUMENT = /(guideline|guidance|call|application|apply|applicant|programme|program|rules|regulation|terms[-_ ]?of[-_ ]?reference|\btor\b|handbook|manual|faq|form|template|eligib|instruction|announcement|criteria|ausschreibung|richtlinie|bekanntmachung|leitfaden|merkblatt|appel|reglement|r[eè]glement|convocatoria|bases|edital|chamada|regulamento|utlysning|oproep)/i

/**
 * Up to MAX_DOCUMENTS PDF/DOCX links on the same site as the page that look
 * like this call's material: never footer/navigation links or legal and
 * corporate documents, and only links whose text or address reads like call
 * documents (or names the call). A funder site's footer PDFs ("Transparency
 * in Supply Chains Act") would otherwise become the call's "guidelines".
 */
export function findDocumentLinks(html: string, pageUrl: string, title = ''): string[] {
  const page = new URL(pageUrl)
  const $ = cheerio.load(html)
  const titleWords = new Set(words(title.replace(/\([^)]*\)/g, ' ')))
  const links: string[] = []
  $('a[href]').each((_, element) => {
    if (links.length >= MAX_DOCUMENTS) return
    if ($(element).closest('footer, nav, header, [role="contentinfo"], [role="navigation"], [role="banner"]').length > 0) return
    const label = `${$(element).text()} ${$(element).attr('title') || ''} ${$(element).attr('aria-label') || ''}`
    const href = String($(element).attr('href') || '').trim()
    const describes = `${label} ${decodeURIComponent(href.split('?')[0] || '')}`
    if (IRRELEVANT_DOCUMENT.test(describes)) return
    const namesCall = words(describes).some((word) => titleWords.has(word))
    if (!CALL_DOCUMENT.test(describes) && !namesCall) return
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return
    let target: URL
    try {
      target = new URL(href, page)
    } catch {
      return
    }
    if (target.protocol !== 'https:') return
    if (registrableHost(target.host) !== registrableHost(page.host)) return
    if (!/\.(pdf|docx)(\?|$)/i.test(target.pathname + target.search)) return
    const clean = target.toString().split('#')[0]
    if (!links.includes(clean)) links.push(clean)
  })
  return links
}

/* ------------------------------------------------------------------- checks */

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'call', 'grant', 'grants', 'programme', 'program', 'award', 'awards', 'fund', 'funding', 'research', 'worldwide'])
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word.length >= 4 && !STOP.has(word))

/** Share of the call title's meaningful words that the page mentions. */
export function titleOverlap(title: string, pageText: string): number {
  const titleWords = Array.from(new Set(words(title.replace(/\([^)]*\)/g, ' '))))
  if (titleWords.length === 0) return 1
  const page = new Set(words(pageText))
  return titleWords.filter((word) => page.has(word)).length / titleWords.length
}

/** Rules found in a guideline pack: the entries of its top-level rule lists. */
export function guidelineItemCount(pack: unknown): number {
  // Rules are the entries of the pack's top-level lists. Each rule carries
  // lists of its own (sourceAnchors, appliesTo, draftingStage), which are not
  // rules, and the top-level sourceAnchors list is citations.
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return 0
  let count = 0
  for (const [key, value] of Object.entries(pack as Record<string, unknown>)) {
    if (key === 'sourceAnchors' || !Array.isArray(value)) continue
    for (const item of value) {
      if (typeof item === 'string' ? item.trim().length > 0 : typeof item === 'object' && item !== null) count += 1
    }
  }
  return count
}

/** Pure: the gate, from what the run found. */
export function enrichmentGate(input: {
  title: string
  pageText: string
  pageHost: string
  officialHost: string
  documents: number
  guidelineItems: number
}): string[] {
  const reasons: string[] = []
  if (registrableHost(input.pageHost) !== registrableHost(input.officialHost)) reasons.push('page redirected to another site')
  if (input.pageText.length < MIN_PAGE_CHARS && input.documents === 0) reasons.push(`page text too short (${input.pageText.length} chars) and no documents`)
  const overlap = titleOverlap(input.title, input.pageText)
  if (overlap < MIN_TITLE_OVERLAP) reasons.push(`page does not look like this call (title overlap ${Math.round(overlap * 100)}%)`)
  if (input.guidelineItems < MIN_GUIDELINE_ITEMS) reasons.push(`too few guideline rules (${input.guidelineItems})`)
  return reasons
}

/* -------------------------------------------------------------------- write */

const ENRICH_CALL_COLUMNS = ['description', 'description_source', 'enrichment_level', 'field_provenance', 'guideline_status', 'active_guideline_id'] as const

async function mergeEnrichmentMetadata(db: PrismaClient, callId: string, patch: Record<string, unknown>) {
  await db.$executeRaw(Prisma.sql`
    UPDATE funding_calls
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('enrichment', COALESCE(metadata->'enrichment', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
    WHERE id = ${callId} AND import_run_id IS NOT NULL
  `)
}

export async function enrichImportedCall(input: {
  db: PrismaClient
  callId: string
  operator: IntakeOperator
  runId: string
  log?: (message: string) => void
}): Promise<EnrichmentOutcome> {
  const { db, callId, operator, runId } = input
  const log = input.log || (() => {})
  const call = await db.fundingCall.findUnique({ where: { id: callId } })
  const outcome: EnrichmentOutcome = {
    callId,
    title: call?.scheme_title || call?.title || callId,
    status: 'SKIPPED',
    reasons: [],
    pageUrl: null,
    pageChars: 0,
    documents: 0,
    guidelineItems: 0,
    descriptionUpdated: false,
  }
  if (!call) return { ...outcome, reasons: ['call not found'] }
  if (!call.import_run_id || String(call.visibility) !== 'GLOBAL_CATALOG' || String(call.catalog_status) !== 'PUBLISHED') {
    return { ...outcome, reasons: ['not a released catalogue call'] }
  }
  if (call.enrichment_level && call.enrichment_level !== 'LITE') return { ...outcome, reasons: [`already ${call.enrichment_level}`] }
  const pageUrl = (call.official_urls || [])[0] || call.source_url || null
  outcome.pageUrl = pageUrl
  if (!pageUrl) return { ...outcome, reasons: ['no official URL'] }

  const before = Object.fromEntries(ENRICH_CALL_COLUMNS.map((column) => [column, (call as Record<string, unknown>)[column] ?? null]))
  const inserted = async (table: string, id: string) =>
    db.fundingImportChange.create({ data: { run_id: runId, entity_table: table, entity_id: id, operation: 'INSERT' } })
  const created = { documents: [] as string[], guidelines: [] as string[], guidelineRuns: [] as string[] }
  // A failed attempt keeps nothing: the page may be about another call, so
  // its documents must not answer chat questions and its guidelines must not
  // read as approved. The review item keeps the page and the reasons.
  const discardAttempt = async () => {
    await db.fundingCall.update({
      where: { id: callId },
      data: { guideline_status: before.guideline_status as never, active_guideline_id: before.active_guideline_id as never },
    })
    await db.fundingCallGuidelineRun.deleteMany({ where: { id: { in: created.guidelineRuns } } })
    await db.fundingCallGuideline.deleteMany({ where: { id: { in: created.guidelines } } })
    await db.fundingCallDocument.deleteMany({ where: { id: { in: created.documents } } })
    const ids = [...created.guidelineRuns, ...created.guidelines, ...created.documents]
    if (ids.length > 0) await db.fundingImportChange.deleteMany({ where: { run_id: runId, entity_id: { in: ids } } })
    await db.fundingImportChange.deleteMany({ where: { run_id: runId, entity_id: callId, field: { in: ['guideline_status', 'active_guideline_id'] } } })
  }

  try {
    if (!(await politeFetchGate(pageUrl))) {
      await mergeEnrichmentMetadata(db, callId, { status: 'robots_disallowed', at: new Date().toISOString(), run_id: runId })
      return { ...outcome, reasons: ['robots.txt disallows the official page'] }
    }
    const page = await fetchReadableUrlContent(pageUrl)
    const pageText = (page.normalizedText || '').slice(0, MAX_PAGE_CHARS)
    const finalUrl = String((page.fetchMetadata as Record<string, unknown>)?.fetchedUrl || pageUrl)
    outcome.pageChars = pageText.length

    const documentIds: string[] = []
    let linkedDocuments = 0
    if (pageText.length >= 200) {
      const pageDoc = await fundingDocumentService.createDocumentFromText({
        fundingCallId: callId,
        text: pageText,
        fileNameHint: 'official-page',
        sourceUrl: finalUrl,
        documentKind: 'call_document',
        deferProcessing: true,
        operator: { userId: operator.userId, email: operator.email, tenantId: operator.tenantId ?? null },
      })
      if (!pageDoc.duplicate) {
        await inserted('funding_call_documents', pageDoc.document.id)
        created.documents.push(pageDoc.document.id)
      }
      documentIds.push(pageDoc.document.id)
    }
    const html = await fetchHtml(finalUrl)
    for (const link of html ? findDocumentLinks(html, finalUrl, outcome.title) : []) {
      try {
        if (!(await politeFetchGate(link))) continue
        const document = await ingestFundingDocumentFromUrl(callId, link, operator, { documentKind: 'guideline_document', deferProcessing: true })
        if (!document.duplicate) {
          await inserted('funding_call_documents', document.documentId)
          created.documents.push(document.documentId)
        }
        documentIds.push(document.documentId)
        linkedDocuments += 1
      } catch (error) {
        log(`    document skipped (${link}): ${error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(-240) : error}`)
      }
    }
    for (const documentId of documentIds) {
      // One at a time: processing parses, sectionizes (with an LLM for
      // ambiguous sections) and embeds chunks.
      await fundingDocumentService.processDocument(documentId, operator).catch((error) => log(`    processing failed: ${String(error).slice(0, 120)}`))
      await fundingDocumentService.embedDocumentChunks(documentId).catch(() => undefined)
    }
    outcome.documents = documentIds.length

    // Nothing to read (a script-rendered portal, a login wall): the gate would
    // fail anyway, so spend no LLM calls on it.
    if (pageText.length < 200 && linkedDocuments === 0) {
      outcome.reasons = [`page text too short (${pageText.length} chars) and no documents`]
      await db.fundingImportCandidate.upsert({
        where: { dedupe_key: `enrich:${callId}` },
        update: { run_id: runId, signals: { reasons: outcome.reasons, page: finalUrl } as never, resolution: 'pending' },
        create: { run_id: runId, dedupe_key: `enrich:${callId}`, reason: 'ENRICHMENT_REVIEW', tier: 'INFO', subject_call_id: callId, signals: { reasons: outcome.reasons, page: finalUrl } as never, blocks_release: false },
      })
      await mergeEnrichmentMetadata(db, callId, { status: 'needs_review', at: new Date().toISOString(), run_id: runId, reasons: outcome.reasons })
      return { ...outcome, status: 'NEEDS_REVIEW' }
    }

    const llmContext = { tenantId: operator.tenantId ?? null, userId: operator.userId }
    let description: string | null = null
    if (pageText.length >= MIN_DESCRIPTION_CHARS) {
      const extraction = await extractFundingOpportunity(pageText, llmContext).catch(() => null)
      const field = (extraction?.payload.fields as Record<string, { value?: unknown; confidence?: number }> | undefined)?.description
      const value = typeof field?.value === 'string' ? field.value.trim() : ''
      if (value.length >= MIN_DESCRIPTION_CHARS && (field?.confidence ?? 0) >= 0.5) description = value
    }

    const guidelinesBefore = await db.fundingCallGuideline.findMany({ where: { fundingCallId: callId }, select: { id: true } })
    // "No usable rules" is an answer, not a fault: it goes to the gate (and
    // so to review) rather than being retried.
    const run = await fundingGuidelineService
      .createExtractionRunFromFundingCall(callId, operator, { sourceMode: 'documents', fallbackText: pageText })
      .catch((error) => {
        if (/no usable rules/i.test(String(error))) return null
        throw error
      })
    const latestRun = run ? null : await db.fundingCallGuidelineRun.findFirst({ where: { funding_call_id: callId }, orderBy: { created_at: 'desc' } })
    const runRow = run
      ? await db.fundingCallGuidelineRun.findUnique({ where: { id: (run as { id: string }).id } }).catch(() => null)
      : latestRun && latestRun.created_at >= new Date(Date.now() - 30 * 60_000) ? latestRun : null
    if (runRow) {
      await inserted('funding_call_guideline_runs', runRow.id)
      created.guidelineRuns.push(runRow.id)
    }
    for (const guideline of await db.fundingCallGuideline.findMany({ where: { fundingCallId: callId }, select: { id: true } })) {
      if (!guidelinesBefore.some((existing) => existing.id === guideline.id)) {
        await inserted('funding_call_guidelines', guideline.id)
        created.guidelines.push(guideline.id)
      }
    }
    outcome.guidelineItems = guidelineItemCount(runRow?.guideline_pack_json)

    outcome.reasons = enrichmentGate({
      title: outcome.title,
      pageText,
      pageHost: new URL(finalUrl).host,
      officialHost: new URL(pageUrl).host,
      documents: linkedDocuments,
      guidelineItems: outcome.guidelineItems,
    })

    const current = await db.fundingCall.findUnique({ where: { id: callId } })
    if (!current || !current.import_run_id || String(current.visibility) !== 'GLOBAL_CATALOG' || (current.enrichment_level && current.enrichment_level !== 'LITE')) {
      return { ...outcome, status: 'SKIPPED', reasons: ['call changed during enrichment'] }
    }

    // Columns guideline extraction itself moved (guideline_status, active id).
    for (const column of ['guideline_status', 'active_guideline_id'] as const) {
      const now = (current as Record<string, unknown>)[column] ?? null
      if (JSON.stringify(now) !== JSON.stringify(before[column])) {
        await db.fundingImportChange.create({
          data: { run_id: runId, entity_table: 'funding_calls', entity_id: callId, operation: 'UPDATE', field: column, before_value: before[column] as never, after_value: now as never },
        })
      }
    }

    if (outcome.reasons.length > 0) {
      await discardAttempt()
      await db.fundingImportCandidate.upsert({
        where: { dedupe_key: `enrich:${callId}` },
        update: { run_id: runId, signals: { reasons: outcome.reasons, page: finalUrl, documents: outcome.documents, guidelineItems: outcome.guidelineItems } as never, resolution: 'pending' },
        create: {
          run_id: runId,
          dedupe_key: `enrich:${callId}`,
          reason: 'ENRICHMENT_REVIEW',
          tier: 'INFO',
          subject_call_id: callId,
          signals: { reasons: outcome.reasons, page: finalUrl, documents: outcome.documents, guidelineItems: outcome.guidelineItems } as never,
          blocks_release: false,
        },
      })
      await mergeEnrichmentMetadata(db, callId, { status: 'needs_review', at: new Date().toISOString(), run_id: runId, reasons: outcome.reasons })
      return { ...outcome, status: 'NEEDS_REVIEW' }
    }

    const owner = { source: 'official_page', run_id: runId, by: operator.email }
    const data: Record<string, unknown> = {
      enrichment_level: 'ENRICHED',
      field_provenance: stampFields(current.field_provenance, description ? ['description', 'description_source'] : ['enrichment_level'], owner),
    }
    if (description) {
      data.description = description
      data.description_source = 'official_page'
    }
    for (const [field, value] of Object.entries(data)) {
      await db.fundingImportChange.create({
        data: {
          run_id: runId,
          entity_table: 'funding_calls',
          entity_id: callId,
          operation: 'UPDATE',
          field,
          before_value: ((current as Record<string, unknown>)[field] ?? null) as never,
          after_value: (value ?? null) as never,
        },
      })
    }
    await db.fundingCall.update({ where: { id: callId }, data: data as never })
    await mergeEnrichmentMetadata(db, callId, { status: 'enriched', at: new Date().toISOString(), run_id: runId, page: finalUrl, documents: outcome.documents })
    return { ...outcome, status: 'ENRICHED', descriptionUpdated: Boolean(description) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await discardAttempt().catch((cleanupError) => log(`    cleanup failed: ${String(cleanupError).slice(0, 120)}`))
    // The site refuses automated access: retrying will not change that.
    if (/status code (401|403)/.test(message)) {
      const reasons = [`official site refused automated access (${message.match(/40[13]/)?.[0]})`]
      await db.fundingImportCandidate
        .upsert({
          where: { dedupe_key: `enrich:${callId}` },
          update: { run_id: runId, signals: { reasons, page: pageUrl } as never, resolution: 'pending' },
          create: { run_id: runId, dedupe_key: `enrich:${callId}`, reason: 'ENRICHMENT_REVIEW', tier: 'INFO', subject_call_id: callId, signals: { reasons, page: pageUrl } as never, blocks_release: false },
        })
        .catch(() => undefined)
      await mergeEnrichmentMetadata(db, callId, { status: 'needs_review', at: new Date().toISOString(), run_id: runId, reasons }).catch(() => undefined)
      return { ...outcome, status: 'NEEDS_REVIEW', reasons }
    }
    const attempts = Number(((call.metadata as Record<string, any>)?.enrichment?.attempts) || 0) + 1
    await mergeEnrichmentMetadata(db, callId, { status: 'failed', at: new Date().toISOString(), run_id: runId, attempts, error: message.slice(0, 300) }).catch(() => undefined)
    return { ...outcome, status: 'FAILED', reasons: [message.slice(0, 200)] }
  }
}

/**
 * Reverses an ENRICH run: deletes the documents, guideline runs and
 * guidelines it inserted, restores every call column it changed (unless
 * changed since), and withdraws its review items.
 */
export async function rollbackEnrichmentRun(db: PrismaClient, runId: string) {
  const changes = await db.fundingImportChange.findMany({ where: { run_id: runId }, orderBy: { created_at: 'desc' } })
  let restored = 0
  for (const change of changes.filter((c) => c.entity_table === 'funding_calls' && c.operation === 'UPDATE' && c.field)) {
    const call = await db.fundingCall.findFirst({ where: { id: change.entity_id, import_run_id: { not: null } } })
    if (!call) continue
    const now = (call as Record<string, unknown>)[change.field!]
    if (JSON.stringify(now ?? null) !== JSON.stringify(change.after_value ?? null)) continue
    await db.fundingCall.update({ where: { id: call.id }, data: { [change.field!]: change.before_value as never } })
    restored++
  }
  const ids = (table: string) => changes.filter((c) => c.entity_table === table && c.operation === 'INSERT').map((c) => c.entity_id)
  const runs = await db.fundingCallGuidelineRun.deleteMany({ where: { id: { in: ids('funding_call_guideline_runs') } } })
  const guidelines = await db.fundingCallGuideline.deleteMany({ where: { id: { in: ids('funding_call_guidelines') } } })
  const documents = await db.fundingCallDocument.deleteMany({ where: { id: { in: ids('funding_call_documents') } } })
  const reviews = await db.fundingImportCandidate.deleteMany({ where: { run_id: runId, reason: 'ENRICHMENT_REVIEW' } })
  await db.fundingImportRun.update({ where: { id: runId }, data: { status: 'ROLLED_BACK', finished_at: new Date() } })
  return { restored, guidelineRuns: runs.count, guidelines: guidelines.count, documents: documents.count, reviews: reviews.count }
}
