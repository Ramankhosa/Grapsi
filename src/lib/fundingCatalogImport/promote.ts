/**
 * Promoting an imported catalogue call into the funding department (DSR), and
 * taking it back out.
 *
 * Imported calls are GLOBAL_CATALOG: researchers find them, but every DSR
 * query reads GLOBAL_PUBLISHED, so queues, census, pendency and reminders
 * ignore them. A curator promotes one call at a time: it becomes
 * GLOBAL_PUBLISHED, which is exactly what makes it the department's business,
 * and is mapped to the schools it concerns. Nothing else about DSR changes.
 *
 * Rules (previewPromotion):
 *  - only a released, review-clear, open imported call;
 *  - no likely duplicate among the curated calls already in DSR (one entered
 *    through intake after the import ran is checked now);
 *  - for every tenant with an active funding department, the call must not
 *    rule out a researcher who lives, works and holds citizenship in that
 *    tenant's country ("Check eligibility" only warns).
 *
 * Promotion (promoteToDsr):
 *  - publishedAt becomes now: DSR dates calls by it, and a call must not
 *    arrive in a queue already weeks old (pendency would escalate at once);
 *  - the notification policy follows the curator's ticks: SUPPRESSED (none),
 *    OFFICERS_ONLY (covering officers' notice) or NORMAL (also researcher
 *    alerts, through the alert dispatch the hourly sweep can heal);
 *  - official guidelines are fetched for that one call (enrich.ts), so
 *    faculty writing for it work from the funder's rules.
 * Every changed column is logged under a PROMOTE run. withdrawFromDsr undoes
 * it while no department or faculty work is attached.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { eligibilityVerdictForRow, type EligibilityVerdict } from '@/lib/funding/eligibility'
import { countryNameFor } from '@/lib/geo/countries'
import type { IntakeOperator } from '@/lib/fundingIntake/types'

import { acronymOf, normalizeFunderName } from './adapters/scientify'
import { NOTIFICATION_POLICY_SUPPRESSED, REVIEW_STATUS } from './constants'
import { descriptionHash, findDuplicatePairs, urlKeys, type DedupCall } from './duplicates'
import { liveOpportunityStatus } from './lifecycle'
import { isoDate } from './normalize/text'
import { referencingColumns } from './safety'

export const PROMOTION_SOURCE_KEY = 'dsr-promotion'
export const WITHDRAW_REASON = 'Withdrawn from the funding department'
/** India unless a tenant set its country: the platform's default. */
const DEFAULT_COUNTRY = 'IN'
const STALE_SOURCE_DAYS = 30

export type NotificationPolicy = 'SUPPRESSED' | 'OFFICERS_ONLY' | 'NORMAL'

export function policyForTicks(ticks: { notifyOfficers: boolean; alertResearchers: boolean }): NotificationPolicy {
  if (ticks.alertResearchers) return 'NORMAL'
  if (ticks.notifyOfficers) return 'OFFICERS_ONLY'
  return 'SUPPRESSED'
}

/**
 * Rows a withdraw does not count as work: routing, matching and alert
 * bookkeeping, and catalogue content (crosswalk areas, documents and
 * guidelines enrichment fetched). Every other table that references a call
 * (assignments, follow-ups, triage, shortlists, proposals, Grant Prep and
 * grant sessions, and any table added later) blocks a withdraw.
 */
export const DERIVED_TABLES = new Set([
  'dsr_call_school_mappings',
  'dsr_call_match_state',
  'dsr_match_score_cache',
  'dsr_matching_runs',
  'dsr_opportunity_observations',
  'funding_call_alerts',
  'funding_opportunity_matches',
  'funding_call_research_area_taxonomies',
  'funding_call_documents',
  'funding_call_document_chunks',
  'funding_call_document_events',
  'funding_call_document_pages',
  'funding_call_document_sections',
  'funding_call_guideline_runs',
  'funding_call_guidelines',
  'funding_call_templates',
  'funding_call_template_runs',
  'funding_call_template_assets',
])

export class PromotionError extends Error {
  constructor(message: string, public status = 409) {
    super(message)
  }
}

export interface PromotionTenant {
  tenantId: string
  name: string
  countryCode: string
  countryName: string
  countryAssumed: boolean
  verdict: EligibilityVerdict
  schools: Array<{ id: string; name: string }>
}

export interface PromotionPreview {
  callId: string
  title: string
  promoted: { at: string; by: string; notify: { officers: boolean; researchers: boolean } } | null
  promotable: boolean
  blockers: string[]
  warnings: string[]
  tenants: PromotionTenant[]
  lifecycle: string
  enrichmentLevel: string | null
  sourceCheckedAt: string | null
  sourceAvailability: string | null
  attribution: string | null
  defaults: { notifyOfficers: boolean; alertResearchers: boolean }
}

type CallRow = NonNullable<Awaited<ReturnType<typeof prisma.fundingCall.findUnique>>>

export function promotionOf(call: { visibility: unknown; metadata: unknown }) {
  const promotion = (call.metadata as Record<string, any> | null)?.dsr_promotion
  return String(call.visibility) === 'GLOBAL_PUBLISHED' && promotion ? (promotion as PromotionPreview['promoted'] & { run_id: string; previous_published_at: string | null }) : null
}

/** Tenants with an active funding department, as callSchoolMapping routes a global call. */
async function dsrTenants() {
  const members = await prisma.fundingDeptMember.findMany({ where: { is_active: true }, distinct: ['tenant_id'], select: { tenant_id: true } })
  if (members.length === 0) return []
  return prisma.tenant.findMany({ where: { id: { in: members.map((m) => m.tenant_id) } }, select: { id: true, name: true, country_code: true }, orderBy: { name: 'asc' } })
}

/** The call as a typical researcher of each DSR tenant sees it: living, working and a citizen there. */
export function tenantVerdicts(call: Record<string, unknown>, tenants: Array<{ id: string; name: string; country_code: string | null }>) {
  return tenants.map((tenant) => {
    const code = (tenant.country_code || DEFAULT_COUNTRY).toUpperCase()
    return {
      tenantId: tenant.id,
      name: tenant.name,
      countryCode: code,
      countryName: countryNameFor(code),
      countryAssumed: !tenant.country_code,
      verdict: eligibilityVerdictForRow(call, { residence: [code], citizenship: [code], host: [code] }),
    }
  })
}

function dedupCall(row: Pick<CallRow, 'id' | 'scheme_title' | 'title' | 'agency_name' | 'agencyName' | 'source_url' | 'sourceUrl' | 'official_urls' | 'close_date' | 'deadlineAt' | 'description' | 'createdAt'>, kind: DedupCall['kind']): DedupCall {
  const agency = row.agency_name || row.agencyName || ''
  const acronym = acronymOf(agency)
  const close = isoDate(row.close_date || row.deadlineAt)
  return {
    id: row.id,
    kind,
    title: row.scheme_title || row.title || '',
    funderKeys: [normalizeFunderName(agency), acronym ? `acr:${acronym.toLowerCase()}` : ''].filter(Boolean),
    urlKeys: urlKeys([row.source_url, row.sourceUrl, ...(row.official_urls || [])]),
    finalDeadline: close,
    year: close ? Number(close.slice(0, 4)) : row.createdAt.getUTCFullYear(),
    descriptionHash: descriptionHash(row.description),
    seriesKey: null,
  }
}

/** Curated platform calls already in DSR that look like this imported one. */
async function curatedTwins(call: CallRow) {
  const curated = await prisma.fundingCall.findMany({
    where: { tenantId: null, visibility: 'GLOBAL_PUBLISHED', import_run_id: null, NOT: { catalog_status: 'ARCHIVED' } },
    select: { id: true, scheme_title: true, title: true, agency_name: true, agencyName: true, source_url: true, sourceUrl: true, official_urls: true, close_date: true, deadlineAt: true, description: true, createdAt: true },
  })
  const pairs = findDuplicatePairs([dedupCall(call, 'imported')], curated.map((row) => dedupCall(row, 'existing')))
  const titleOf = new Map(curated.map((row) => [row.id, row.scheme_title || row.title || row.id]))
  return pairs.filter((pair) => pair.tier !== 'RELATED').map((pair) => ({ tier: pair.tier, title: titleOf.get(pair.candidateId) || pair.candidateId }))
}

async function loadCall(callId: string) {
  const call = await prisma.fundingCall.findUnique({ where: { id: callId } })
  if (!call) throw new PromotionError('Funding call not found.', 404)
  return call
}

export async function previewPromotion(callId: string): Promise<PromotionPreview> {
  const call = await loadCall(callId)
  const blockers: string[] = []
  const warnings: string[] = []
  const promoted = promotionOf(call)
  const title = call.scheme_title || call.title || call.id
  const lifecycle = liveOpportunityStatus(call)
  const source = await prisma.externalSourceRecord.findFirst({
    where: { funding_call_id: call.id, entity_type: 'CALL', link_role: 'PRIMARY' },
    select: { source_checked_at: true, availability: true, source_key: true },
  })

  if (!call.import_run_id) blockers.push('Only imported catalogue calls are promoted here; curated calls are in the funding department already.')
  else if (!promoted && String(call.visibility) !== 'GLOBAL_CATALOG') blockers.push('This call is not in the global catalogue.')
  if (!promoted) {
    if (String(call.catalog_status) !== 'PUBLISHED') blockers.push('Release the call from the import review first.')
    if (call.review_status !== REVIEW_STATUS.CLEAR) blockers.push('Resolve the call’s review items first.')
    if (lifecycle === 'CLOSED') blockers.push('The call is closed.')
  }

  const tenants = await dsrTenants()
  if (tenants.length === 0 && !promoted) blockers.push('No institution has a funding department yet.')
  const verdicts = tenantVerdicts(call as unknown as Record<string, unknown>, tenants)
  for (const tenant of verdicts) {
    if (tenant.verdict === 'INELIGIBLE') blockers.push(`Not open to researchers in ${tenant.countryName} (${tenant.name}).`)
    else if (tenant.verdict === 'NEEDS_CHECK') warnings.push(`Eligibility for ${tenant.countryName} (${tenant.name}) needs checking on the funder's page.`)
    if (tenant.countryAssumed) warnings.push(`${tenant.name} has no country set; India is assumed.`)
  }

  if (call.import_run_id && !promoted) {
    for (const twin of await curatedTwins(call)) {
      if (twin.tier === 'LIKELY_DUPLICATE') blockers.push(`A curated copy is already in the funding department: “${twin.title}”.`)
      else warnings.push(`Possibly the same call as the curated “${twin.title}”.`)
    }
  }

  const checkedAt = source?.source_checked_at || null
  if (!checkedAt) warnings.push('When the source last listed this call is not known.')
  else if (Date.now() - checkedAt.getTime() > STALE_SOURCE_DAYS * 864e5) {
    warnings.push(`The source was last checked on ${checkedAt.toISOString().slice(0, 10)}; dates may have changed since.`)
  }
  if (source?.availability === 'NOT_SEEN_IN_SNAPSHOT') warnings.push('The source no longer lists this call.')

  // The schools reached: those whose stored mapping the call would get, and
  // those whose covering officer the new-call notice reaches (subject
  // relevance, which the queues also use). Both, so the dialog promises
  // exactly what happens.
  const schoolsByTenant = new Map<string, Array<{ id: string; name: string }>>()
  if (!blockers.length || promoted) {
    const { planTenantMappings } = await import('@/lib/fundingDept/callSchoolMapping')
    const { coveredSchoolsForCall } = await import('@/lib/fundingDept/newCallNoticeService')
    const eligible = verdicts.filter((tenant) => tenant.verdict !== 'INELIGIBLE')
    const covered = await coveredSchoolsForCall(call.id, eligible.map((tenant) => tenant.tenantId))
    for (const tenant of eligible) {
      const planned = await planTenantMappings(tenant.tenantId, [call.id], { ignoreVisibility: true })
      const ids = new Set([...planned.map((row) => row.schoolId), ...covered.filter((row) => row.tenant_id === tenant.tenantId).map((row) => row.org_unit_id)])
      const units = ids.size ? await prisma.tenantOrgUnit.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : []
      schoolsByTenant.set(tenant.tenantId, units.sort((a, b) => a.name.localeCompare(b.name)))
    }
  }

  const attribution = ((call.metadata as Record<string, any> | null)?.catalog_import?.attribution?.source as string | undefined) || null
  return {
    callId: call.id,
    title,
    promoted: promoted ? { at: promoted.at, by: promoted.by, notify: promoted.notify } : null,
    promotable: !promoted && blockers.length === 0,
    blockers: promoted ? [] : blockers,
    warnings,
    tenants: verdicts.map((tenant) => ({ ...tenant, schools: schoolsByTenant.get(tenant.tenantId) || [] })),
    lifecycle,
    enrichmentLevel: call.enrichment_level || null,
    sourceCheckedAt: checkedAt ? checkedAt.toISOString() : null,
    sourceAvailability: source?.availability || null,
    attribution,
    defaults: { notifyOfficers: true, alertResearchers: false },
  }
}

async function platformOperator(operator: IntakeOperator): Promise<IntakeOperator> {
  const platform = await prisma.tenant.findFirst({ where: { atiId: 'PLATFORM' }, select: { id: true } })
  return { ...operator, role: 'ADMIN', tenantId: platform?.id ?? operator.tenantId ?? null }
}

/**
 * Fetch the official guidelines for one promoted call, then re-embed it if
 * the description changed. Background: a fetch takes up to a minute (one
 * request per funder site every few seconds) and must not hold the request.
 */
export async function enrichPromotedCall(callId: string, operator: IntakeOperator) {
  const { ENRICH_SOURCE_KEY, ENRICH_VERSION, enrichImportedCall } = await import('./enrich')
  const runOperator = await platformOperator(operator)
  const database = (await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`SELECT current_database() AS name`))[0]?.name || null
  const run = await prisma.fundingImportRun.create({
    data: { source_key: ENRICH_SOURCE_KEY, mode: 'ENRICH', status: 'RUNNING', importer_version: ENRICH_VERSION, operator_email: runOperator.email, target_database: database },
  })
  try {
    const outcome = await enrichImportedCall({ db: prisma as never, callId, operator: runOperator, runId: run.id })
    await prisma.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', finished_at: new Date(), counts: { [outcome.status.toLowerCase()]: 1 } as never, report: { promoted: true, outcome } as never },
    })
    if (outcome.status === 'ENRICHED') {
      const { embedImportedCalls } = await import('./embed')
      await embedImportedCalls([callId]).catch((error) =>
        console.warn(`[DSR PROMOTION] Re-embedding ${callId} failed:`, error instanceof Error ? error.message : String(error))
      )
    }
    return outcome
  } catch (error) {
    await prisma.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finished_at: new Date(), error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }
}

export interface PromotionResult {
  runId: string
  policy: NotificationPolicy
  schoolsMapped: number
  schoolsReinstated: number
  officersNotified: number
  researcherAlerts: 'queued' | 'off'
  guidelines: 'fetching' | 'already_enriched' | 'not_requested'
}

export async function promoteToDsr(
  callId: string,
  operator: IntakeOperator,
  ticks: { notifyOfficers: boolean; alertResearchers: boolean },
  options: { runEnrichment?: boolean } = {}
): Promise<PromotionResult> {
  const preview = await previewPromotion(callId)
  if (preview.promoted) throw new PromotionError('This call is in the funding department already.')
  if (preview.blockers.length > 0) throw new PromotionError(preview.blockers.join(' '))
  const policy = policyForTicks(ticks)

  const run = await prisma.fundingImportRun.create({
    data: { source_key: PROMOTION_SOURCE_KEY, mode: 'PROMOTE', status: 'RUNNING', importer_version: 'promote-1', operator_email: operator.email },
  })
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ visibility: string; notification_policy: string | null; notification_policy_reason: string | null; published_at: Date | null; metadata: Record<string, any> | null }>>(Prisma.sql`
      SELECT visibility::text AS visibility, notification_policy, notification_policy_reason, "publishedAt" AS published_at, metadata
        FROM funding_calls WHERE id = ${callId} AND import_run_id IS NOT NULL FOR UPDATE`)
    if (!row || row.visibility !== 'GLOBAL_CATALOG') throw new PromotionError('The call changed meanwhile; reload and try again.')
    const metadata: Record<string, any> = { ...(row.metadata || {}) }
    const previousStamp = metadata.alerts_dispatched_at ?? null
    metadata.dsr_promotion = {
      at: now.toISOString(),
      by: operator.email,
      run_id: run.id,
      notify: { officers: ticks.notifyOfficers, researchers: ticks.alertResearchers },
      previous_published_at: row.published_at ? row.published_at.toISOString() : null,
    }
    // The import stamped the call as dispatched so the sweep would skip it;
    // with researcher alerts on, clearing the stamp lets the sweep finish a
    // dispatch that fails part-way.
    if (ticks.alertResearchers) delete metadata.alerts_dispatched_at
    await tx.fundingCall.update({
      where: { id: callId },
      data: {
        visibility: 'GLOBAL_PUBLISHED',
        notification_policy: policy,
        notification_policy_reason: `promoted:${run.id}`,
        publishedAt: now,
        metadata: metadata as never,
      },
    })
    const changes: Array<[string, unknown, unknown]> = [
      ['visibility', 'GLOBAL_CATALOG', 'GLOBAL_PUBLISHED'],
      ['notification_policy', row.notification_policy, policy],
      ['notification_policy_reason', row.notification_policy_reason, `promoted:${run.id}`],
      ['publishedAt', row.published_at ? row.published_at.toISOString() : null, now.toISOString()],
      ['metadata.alerts_dispatched_at', previousStamp, ticks.alertResearchers ? null : previousStamp],
    ]
    await tx.fundingImportChange.createMany({
      data: changes.map(([field, before, after]) => ({
        run_id: run.id, entity_table: 'funding_calls', entity_id: callId, operation: 'UPDATE', field, before_value: before as never, after_value: after as never,
      })),
    })
  })

  const { mapCallToSchools, reinstateEndedMappings } = await import('@/lib/fundingDept/callSchoolMapping')
  const reinstated = await reinstateEndedMappings(callId, WITHDRAW_REASON, operator.userId)
  const mapped = await mapCallToSchools(callId, { actorId: operator.userId })
  let officersNotified = 0
  if (ticks.notifyOfficers) {
    const { notifyCoveringOfficers } = await import('@/lib/fundingDept/newCallNoticeService')
    officersNotified = (await notifyCoveringOfficers(callId).catch(() => ({ notified: 0 }))).notified
  }
  if (ticks.alertResearchers) {
    const { dispatchFundingAlertsQuietly } = await import('@/lib/services/fundingAlertService')
    dispatchFundingAlertsQuietly(callId)
  }
  const fetchGuidelines = preview.enrichmentLevel !== 'ENRICHED' && options.runEnrichment !== false
  if (fetchGuidelines) {
    void enrichPromotedCall(callId, operator).catch((error) =>
      console.warn(`[DSR PROMOTION] Guideline fetch for ${callId} failed:`, error instanceof Error ? error.message : String(error))
    )
  }
  const result: PromotionResult = {
    runId: run.id,
    policy,
    schoolsMapped: mapped.length,
    schoolsReinstated: reinstated.length,
    officersNotified,
    researcherAlerts: ticks.alertResearchers ? 'queued' : 'off',
    guidelines: fetchGuidelines ? 'fetching' : preview.enrichmentLevel === 'ENRICHED' ? 'already_enriched' : 'not_requested',
  }
  await prisma.fundingImportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: result as never } })
  return result
}

/** Work attached to a call that a withdraw must not orphan: table → rows. */
export async function attachedWork(callId: string): Promise<Array<{ table: string; rows: number }>> {
  const found: Array<{ table: string; rows: number }> = []
  for (const { table, column } of await referencingColumns(prisma as never)) {
    if (DERIVED_TABLES.has(table)) continue
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}" WHERE "${column}" = $1`, callId)
    if (n > 0) found.push({ table, rows: n })
  }
  return found
}

const WORK_LABELS: Record<string, string> = {
  call_assignments: 'assignments',
  assignment_follow_ups: 'follow-ups',
  call_school_triage: 'school triage decisions',
  call_candidates: 'shortlisted researchers',
  dsr_actions: 'department actions',
  dsr_opportunity_dispositions: 'dispositions',
  dsr_responsibility_transfers: 'responsibility transfers',
  dsr_origin_overrides: 'origin overrides',
  grant_prep_sessions: 'Grant Prep sessions',
  grant_sessions: 'grant sessions',
  grant_proposals: 'proposals',
  grant_blueprints: 'grant blueprints',
}

export async function withdrawFromDsr(callId: string, operator: IntakeOperator): Promise<{ runId: string; mappingsEnded: number }> {
  const call = await loadCall(callId)
  const promotion = promotionOf(call)
  if (!call.import_run_id || !promotion) throw new PromotionError('Only a catalogue call promoted to the funding department can be withdrawn.')
  const work = await attachedWork(callId)
  if (work.length > 0) {
    const list = work.map((item) => `${item.rows} ${WORK_LABELS[item.table] || item.table.replace(/_/g, ' ')}`).join(', ')
    throw new PromotionError(`Withdraw is blocked while work is attached: ${list}. Close or move that work first.`)
  }

  const run = await prisma.fundingImportRun.create({
    data: { source_key: PROMOTION_SOURCE_KEY, mode: 'WITHDRAW', status: 'RUNNING', importer_version: 'promote-1', operator_email: operator.email },
  })
  // Mappings first: if the flip below then fails, the call is still promoted
  // and a re-promotion reinstates them.
  const { endCallSchoolMapping } = await import('@/lib/fundingDept/callSchoolMapping')
  const active = await prisma.$queryRaw<Array<{ tenant_id: string; school_id: string }>>(Prisma.sql`
    SELECT tenant_id, school_id FROM dsr_call_school_mappings WHERE call_id = ${callId} AND is_active`)
  for (const mapping of active) {
    await endCallSchoolMapping(mapping.tenant_id, callId, mapping.school_id, operator.userId, WITHDRAW_REASON)
  }

  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ visibility: string; notification_policy: string | null; notification_policy_reason: string | null; published_at: Date | null; metadata: Record<string, any> | null }>>(Prisma.sql`
      SELECT visibility::text AS visibility, notification_policy, notification_policy_reason, "publishedAt" AS published_at, metadata
        FROM funding_calls WHERE id = ${callId} AND import_run_id IS NOT NULL FOR UPDATE`)
    if (!row || row.visibility !== 'GLOBAL_PUBLISHED') throw new PromotionError('The call changed meanwhile; reload and try again.')
    const metadata: Record<string, any> = { ...(row.metadata || {}) }
    const history = Array.isArray(metadata.dsr_promotion_history) ? metadata.dsr_promotion_history : []
    metadata.dsr_promotion_history = [...history, { ...metadata.dsr_promotion, withdrawn_at: new Date().toISOString(), withdrawn_by: operator.email, withdraw_run_id: run.id }]
    delete metadata.dsr_promotion
    if (!metadata.alerts_dispatched_at) metadata.alerts_dispatched_at = new Date().toISOString()
    const restoredPublishedAt = promotion.previous_published_at ? new Date(promotion.previous_published_at) : row.published_at
    await tx.fundingCall.update({
      where: { id: callId },
      data: {
        visibility: 'GLOBAL_CATALOG',
        notification_policy: NOTIFICATION_POLICY_SUPPRESSED,
        notification_policy_reason: `withdrawn:${run.id}`,
        publishedAt: restoredPublishedAt,
        metadata: metadata as never,
      },
    })
    const changes: Array<[string, unknown, unknown]> = [
      ['visibility', 'GLOBAL_PUBLISHED', 'GLOBAL_CATALOG'],
      ['notification_policy', row.notification_policy, NOTIFICATION_POLICY_SUPPRESSED],
      ['notification_policy_reason', row.notification_policy_reason, `withdrawn:${run.id}`],
      ['publishedAt', row.published_at ? row.published_at.toISOString() : null, restoredPublishedAt ? restoredPublishedAt.toISOString() : null],
    ]
    await tx.fundingImportChange.createMany({
      data: changes.map(([field, before, after]) => ({
        run_id: run.id, entity_table: 'funding_calls', entity_id: callId, operation: 'UPDATE', field, before_value: before as never, after_value: after as never,
      })),
    })
  })
  await prisma.fundingImportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: { mappingsEnded: active.length } as never } })
  return { runId: run.id, mappingsEnded: active.length }
}

export interface PromotedCall {
  callId: string
  title: string
  agency: string | null
  closeDate: string | null
  promotedAt: string
  promotedBy: string
  activeMappings: number
  work: Array<{ table: string; rows: number }>
  enrichmentLevel: string | null
  /** Re-checked now: a DSR tenant added later, or one that changed country. */
  ineligibleFor: string[]
  sourceAvailability: string | null
}

export async function listPromotedCalls(): Promise<PromotedCall[]> {
  const calls = await prisma.fundingCall.findMany({
    where: { import_run_id: { not: null }, visibility: 'GLOBAL_PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
  })
  const tenants = await dsrTenants()
  const out: PromotedCall[] = []
  for (const call of calls) {
    const promotion = promotionOf(call)
    if (!promotion) continue
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n FROM dsr_call_school_mappings WHERE call_id = ${call.id} AND is_active`)
    const source = await prisma.externalSourceRecord.findFirst({
      where: { funding_call_id: call.id, entity_type: 'CALL', link_role: 'PRIMARY' },
      select: { availability: true },
    })
    out.push({
      callId: call.id,
      title: call.scheme_title || call.title || call.id,
      agency: call.agency_name || call.agencyName || null,
      closeDate: call.close_date ? call.close_date.toISOString() : null,
      promotedAt: promotion.at,
      promotedBy: promotion.by,
      activeMappings: n,
      work: await attachedWork(call.id),
      enrichmentLevel: call.enrichment_level || null,
      ineligibleFor: tenantVerdicts(call as unknown as Record<string, unknown>, tenants)
        .filter((tenant) => tenant.verdict === 'INELIGIBLE')
        .map((tenant) => `${tenant.name} (${tenant.countryName})`),
      sourceAvailability: source?.availability || null,
    })
  }
  return out
}
