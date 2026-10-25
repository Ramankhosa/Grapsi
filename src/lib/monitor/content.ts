import * as cheerio from 'cheerio'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import type { MonitorResource, MonitorSite } from '@/lib/prisma-generated'
import { parseLocal, documentKindOf, DOC_PARSER_VERSION } from './docParse'
import type { EvidenceSegment } from './evidence'
import { meaningfulHash, sha256 } from './hashing'
import { completeTaskInTx, withFence, type Lease } from './queue'
import { decodeBody, type SafeFetch } from './safeFetch'
import { siteScope, tlsExceptionHosts } from './sites'
import { identifyUrl } from './urlIdentity'
import { revisitDays } from './revisit'
import { assertContentCapacity, MonitorCapacityError } from './capacity'

export interface ContentResult { segments: EvidenceSegment[]; links: Array<{ url: string; title: string }>; changed: boolean }
function rememberedLinks(version:{text:string|null;page_statuses:unknown}):ContentResult['links']{
  const stored=Array.isArray(version.page_statuses)?(version.page_statuses as Array<{links?:ContentResult['links']}>)[0]?.links??[]:[]
  const links=new Map(stored.map(l=>[l.url,l]))
  // Older versions retained observed anchor URLs in text while scope-filtering
  // their link list. Recover them for approval without fetching new hosts.
  const text=version.text??''
  for(const match of [...text.matchAll(/\[(https?:\/\/[^\]\s]+)\]/g)].slice(0,500)){const id=identifyUrl(match[1]);if(id&&!links.has(id.canonical))links.set(id.canonical,{url:id.canonical,title:text.slice(Math.max(0,match.index!-200),match.index).split('\n').pop()?.trim()??''})}
  return [...links.values()]
}
/** Fetch each selected resource once; parsing is local and has no OCR side effects. */
export async function readResource(resource: MonitorResource, site: MonitorSite, lease: Lease, fetch: SafeFetch, signal?: AbortSignal): Promise<ContentResult> {
  if (!resource.canonical_url) throw new Error('Resource has no fetchable URL')
  const previous = resource.current_version_id ? await prisma.monitorResourceVersion.findUnique({ where: { id: resource.current_version_id } }) : null
  const headers: Record<string, string> = {}
  if (previous && !previous.truncated) {
    if (resource.etag) headers['if-none-match'] = resource.etag
    if (resource.last_modified) headers['if-modified-since'] = resource.last_modified
  }
  let result
  try { result = await fetch(resource.canonical_url, { headers, inScope: siteScope(site), tlsInsecureHosts: tlsExceptionHosts(site), minDelayMs: site.min_delay_ms, maxBytes: 12 * 1024 * 1024, signal }) }
  catch (error) {
    await withFence(lease, tx => tx.monitorResource.update({ where: { id: resource.id }, data: { last_validated_at: new Date(), last_validation_status: 'UNREACHABLE' } }))
    throw error
  }
  if (result.notModified && previous) {
    await withFence(lease, tx => tx.monitorResource.update({ where: { id: resource.id }, data: { last_validated_at: new Date(), last_validation_status: previous.truncated ? 'TRUNCATED' : 'NOT_MODIFIED' } }))
    return { segments: segmentsFromVersion(resource, previous), links: rememberedLinks(previous), changed: false }
  }
  const rawHash = sha256(result.body)
  if (previous?.raw_hash === rawHash) {
    await withFence(lease, tx => tx.monitorResource.update({ where: { id: resource.id }, data: { last_validated_at: new Date(), last_validation_status: previous.truncated ? 'TRUNCATED' : 'OK' } }))
    return { segments: segmentsFromVersion(resource, previous), links: rememberedLinks(previous), changed: false }
  }
  let pages: Array<{ page: number | null; text: string; status: string }> = []
  let links: ContentResult['links'] = []
  let partial = result.truncated
  const kind = documentKindOf(result.contentKind, result.finalUrl)
  let storedPath: string | null = null
  if (kind) {
    const usage = await prisma.monitorResourceVersion.aggregate({ where: { resource: { site_id: site.id }, file_path: { not: null } }, _sum: { byte_length: true } })
    const quota = site.storage_quota_bytes ?? 250_000_000n
    if (BigInt((usage._sum.byte_length ?? 0) + result.byteLength) > quota) throw new MonitorCapacityError('Site document storage quota reached; evidence fetch deferred for review')
    const directory = path.resolve(process.env.MONITOR_STORAGE_ROOT ?? path.join(process.cwd(), 'storage', 'source-watch'))
    await fs.mkdir(directory, { recursive: true })
    storedPath = path.join(directory, `${rawHash}.${kind}`)
    const parsed = await parseLocal(result.body, kind, { maxPages: 40, signal })
    pages = parsed.pages.map(p => ({ page: p.page, text: p.text, status: p.status }))
    // Parsing coverage is per page. Unreadable or unselected pages do not
    // invalidate complete text on another page, and never imply a truncated fetch.
  } else if (result.contentKind === 'html' || result.contentKind === 'text') {
    const $ = cheerio.load(decodeBody(result))
    $('script,style,noscript,nav,header,footer,svg').remove()
    const main = $('main,article,[role="main"]').first()
    const scope = main.length ? main : $('body')
    scope.find('a[href]').each((_, el) => {
      const id = identifyUrl($(el).attr('href') ?? '', result.finalUrl)
      if (id) links.push({ url: id.canonical, title: $(el).text().trim().slice(0, 250) })
      if (id) $(el).append(` [${id.canonical}]`)
    })
    // Preserve paragraph boundaries, including table rows.
    scope.find('p,div,li,tr,h1,h2,h3,br').append('\n')
    const text = scope.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
    partial ||= text.length > 120_000 || text.length < 40
    pages = [{ page: null, text: text.slice(0, 120_000), status: text.length >= 40 ? 'OK' : 'PARSE_FAILED' }]
  } else throw new Error(`Unsupported evidence content: ${result.contentKind}`)
  const text = pages.map(p => p.text).join('\n')
  const hash = meaningfulHash(text)
  const version = await withFence(lease, async tx => {
    // Count raw document bytes plus a conservative allowance for parsed text
    // and JSON copies. Unchanged versions have already returned above.
    const storedBytes = result.byteLength + Buffer.byteLength(text) * 3
    await assertContentCapacity(tx, site.id, storedBytes, site.storage_quota_bytes)
    if (storedPath) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${storedPath}, 0))`
      await fs.writeFile(storedPath, result.body, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    }
    const v = await tx.monitorResourceVersion.upsert({
      where: { resource_id_raw_hash: { resource_id: resource.id, raw_hash: rawHash } },
      create: { resource_id: resource.id, raw_hash: rawHash, meaningful_hash: hash, text, final_url: result.finalUrl,
        mime_type: result.contentType, http_status: result.status, byte_length: storedBytes, truncated: partial,
        parser_version: kind ? DOC_PARSER_VERSION : 'html-1', page_count: pages.length,
        file_path: storedPath,
        page_statuses: pages.map((p, i) => ({ page: p.page, status: p.status, text: p.text, ...(i === 0 ? { links } : {}) })), tls_exception_used: result.tlsExceptionUsed },
      update: {},
    })
    await tx.monitorResource.update({ where: { id: resource.id }, data: { current_version_id: v.id, final_url: result.finalUrl,
      mime_type: result.contentType, etag: partial ? null : result.headers.etag ?? null,
      last_modified: partial ? null : result.headers['last-modified'] ?? null, last_validated_at: new Date(),
      last_validation_status: partial ? 'TRUNCATED' : previous?.meaningful_hash === hash ? 'OK' : 'CHANGED' } })
    return v
  })
  return { segments: segmentsFromVersion(resource, version), links, changed: previous?.meaningful_hash !== hash }
}

export function segmentsFromVersion(resource: Pick<MonitorResource, 'id' | 'canonical_url' | 'role'>, version: { id: string; text: string | null; truncated: boolean; page_statuses: unknown; final_url?: string | null }): EvidenceSegment[] {
  const pages = Array.isArray(version.page_statuses) ? version.page_statuses as Array<{ page: number | null; text?: string; status: string }> : []
  const parts = pages.some(p => typeof p.text === 'string') ? pages : [{ page: null, text: version.text ?? '', status: 'OK' }]
  const role = resource.role === 'GUIDELINES' ? 'GUIDELINES' : resource.role === 'CORRIGENDUM' ? 'CORRIGENDUM' : 'CALL_NOTICE'
  return parts.filter(p => p.text?.trim()).map((p, i) => ({ id: `s:${sha256(`${resource.id}:${p.page ?? i}:${meaningfulHash(p.text ?? '')}`).slice(0, 40)}`, resourceId: resource.id, versionId: version.id,
    url: version.final_url ?? resource.canonical_url ?? '', role, page: p.page, text: p.text ?? '', complete: !version.truncated && p.status === 'OK' }))
}

/** A revisit is a recurring fetch, never a cached decision pretending to be a fetch. */
export async function revisitResource(lease: Lease, fetch: SafeFetch, signal?: AbortSignal) {
  const resource = await prisma.monitorResource.findUniqueOrThrow({ where: { id: lease.resourceId ?? String(lease.payload.resourceId) }, include: { site: true, opportunities: { orderBy: { created_at: 'desc' }, take: 1 }, evidence: { include: { opportunity: true }, take: 1 } } })
  const opportunity = resource.opportunities[0] ?? resource.evidence[0]?.opportunity
  const closeDate = (opportunity?.field_evidence as { payload?: { fields?: { close_date?: { value?: string } } } } | null)?.payload?.fields?.close_date?.value
  const days = revisitDays({ lifecycle: opportunity?.lifecycle ?? 'UNKNOWN', deadline: closeDate, firstSeen: resource.first_seen_at })
  const result = await readResource(resource, resource.site, lease, fetch, signal)
  await withFence(lease, async tx => {
    await tx.monitorResource.update({ where: { id: resource.id }, data: { next_revisit_at: new Date(Date.now() + days * 86400_000) } })
    if (result.changed) {
      const { queueCandidates } = await import('./candidates')
      const impacted = await tx.monitorOpportunity.findMany({ where: { OR: [{ primary_resource_id: resource.id }, { evidence: { some: { resource_id: resource.id } } }] }, select: { id: true, primary_resource_id: true } })
      await tx.monitorOpportunity.updateMany({ where: { id: { in: impacted.map(o => o.id) } }, data: { stale_evidence: true, review_revision: { increment: 1 } } })
      const primaries = [...new Set(impacted.map(o => o.primary_resource_id).filter((id): id is string => Boolean(id)))]
      await queueCandidates(tx, resource.site_id, primaries.length ? primaries : [resource.id], false, `revisit:${lease.operationKey}`)
    }
    await completeTaskInTx(tx, lease, { changed: result.changed })
  })
}
