/**
 * Curated call ↔ imported catalogue overlap, checked when a curated call is
 * published.
 *
 * Intake deliberately does not offer imported calls as merge targets, so a
 * curator can publish a call the catalogue already holds. This check raises a
 * review item (imported call = subject, curated call = candidate) so the
 * imported copy can be set aside. It never writes to the curated call and
 * never blocks the publish; it runs in the background and swallows errors.
 */
import prisma from '@/lib/prisma'

import { acronymOf, normalizeFunderName } from './adapters/scientify'
import { descriptionHash, findDuplicatePairs, tierBlocksRelease, urlKeys, type DedupCall } from './duplicates'
import { isoDate } from './normalize/text'
import { refreshReviewStatus } from './service'

export async function checkCatalogOverlapForCall(callId: string): Promise<{ items: number }> {
  const curated = await prisma.fundingCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      import_run_id: true,
      visibility: true,
      tenantId: true,
      scheme_title: true,
      title: true,
      agency_name: true,
      agencyName: true,
      source_url: true,
      sourceUrl: true,
      official_urls: true,
      close_date: true,
      deadlineAt: true,
      description: true,
      createdAt: true,
    },
  })
  if (!curated || curated.import_run_id || curated.visibility !== 'GLOBAL_PUBLISHED' || curated.tenantId) return { items: 0 }

  const agency = curated.agency_name || curated.agencyName || ''
  const acronym = acronymOf(agency)
  const close = isoDate(curated.close_date || curated.deadlineAt)
  const existing: DedupCall = {
    id: curated.id,
    kind: 'existing',
    title: curated.scheme_title || curated.title || '',
    funderKeys: [normalizeFunderName(agency), acronym ? `acr:${acronym.toLowerCase()}` : ''].filter(Boolean),
    urlKeys: urlKeys([curated.source_url, curated.sourceUrl, ...(curated.official_urls || [])]),
    finalDeadline: close,
    year: close ? Number(close.slice(0, 4)) : curated.createdAt.getUTCFullYear(),
    descriptionHash: descriptionHash(curated.description),
    seriesKey: null,
  }

  const imported = await prisma.fundingCall.findMany({
    where: { import_run_id: { not: null }, NOT: { catalog_status: 'REJECTED' } },
    select: { id: true, scheme_title: true, title: true, agency_name: true, source_url: true, official_urls: true, close_date: true, description: true, createdAt: true, funder_id: true },
  })
  const candidates: DedupCall[] = imported.map((call) => {
    const name = call.agency_name || ''
    const acr = acronymOf(name)
    const due = isoDate(call.close_date)
    return {
      id: call.id,
      kind: 'imported',
      title: call.scheme_title || call.title || '',
      funderKeys: [normalizeFunderName(name), acr ? `acr:${acr.toLowerCase()}` : ''].filter(Boolean),
      urlKeys: urlKeys([call.source_url, ...(call.official_urls || [])]),
      finalDeadline: due,
      year: due ? Number(due.slice(0, 4)) : call.createdAt.getUTCFullYear(),
      descriptionHash: descriptionHash(call.description),
      seriesKey: null,
    }
  })
  const pairs = findDuplicatePairs(candidates, [existing]).filter((pair) => pair.candidateId === curated.id && pair.tier !== 'RELATED')
  if (pairs.length === 0) return { items: 0 }

  const run = await prisma.fundingImportRun.create({
    data: { source_key: 'catalog-overlap', mode: 'OVERLAP_CHECK', status: 'COMPLETED', importer_version: 'overlap-1', finished_at: new Date(), counts: { pairs: pairs.length } as any },
  })
  for (const pair of pairs) {
    const dedupeKey = `overlap:${pair.subjectId}:${curated.id}`
    const existingItem = await prisma.fundingImportCandidate.findUnique({ where: { dedupe_key: dedupeKey }, select: { id: true } })
    if (existingItem) continue
    await prisma.fundingImportCandidate.create({
      data: {
        run_id: run.id,
        dedupe_key: dedupeKey,
        reason: 'POSSIBLE_DUPLICATE',
        tier: pair.tier,
        subject_call_id: pair.subjectId,
        candidate_call_id: curated.id,
        score: pair.score,
        signals: { ...pair.signals, candidateKind: 'existing', raisedBy: 'curated_publish' } as any,
        blocks_release: tierBlocksRelease(pair.tier),
      },
    })
  }
  await refreshReviewStatus(prisma as any, null, pairs.map((pair) => pair.subjectId))
  return { items: pairs.length }
}
