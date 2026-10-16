/**
 * The import review category: list, summarise and resolve review items.
 *
 * Hard rule: a resolution may change only IMPORTED calls (import_run_id set).
 * "Same as an existing call" sets the imported copy aside and attaches its
 * source record to the existing call as a LINKED source — a new row pointing
 * at the existing call, never a write to it.
 */
import type { Prisma, PrismaClient } from '@/lib/prisma-generated'

import { REVIEW_RESOLUTIONS, type ReviewResolution } from './constants'
import { refreshReviewStatus } from './service'

export interface ReviewFilter {
  reason?: string | null
  tier?: string | null
  /** open = pending or deferred; resolved = anything else; all */
  state?: 'open' | 'resolved' | 'all'
  /** only = listing-variant pairs; exclude = everything but */
  variant?: 'only' | 'exclude' | null
  runId?: string | null
  q?: string | null
}

const CALL_SUMMARY = {
  id: true,
  title: true,
  scheme_title: true,
  agency_name: true,
  catalog_status: true,
  visibility: true,
  import_run_id: true,
  close_date: true,
  open_date: true,
  is_rolling: true,
  amount_text: true,
  amount_min: true,
  amount_max: true,
  currency: true,
  source_url: true,
  description: true,
  eligibility_text: true,
  opportunity_status: true,
  review_status: true,
  createdAt: true,
} as const

export function reviewWhere(filter: ReviewFilter): Prisma.FundingImportCandidateWhereInput {
  const and: Prisma.FundingImportCandidateWhereInput[] = []
  if (filter.reason) and.push({ reason: filter.reason })
  if (filter.tier) and.push({ tier: filter.tier })
  if (filter.runId) and.push({ run_id: filter.runId })
  const state = filter.state || 'open'
  if (state === 'open') and.push({ resolution: { in: ['pending', 'deferred'] } })
  if (state === 'resolved') and.push({ resolution: { notIn: ['pending', 'deferred'] } })
  if (filter.variant === 'only') and.push({ signals: { path: ['listingVariant'], equals: true } })
  if (filter.variant === 'exclude') and.push({ NOT: { signals: { path: ['listingVariant'], equals: true } } })
  if (filter.q) {
    const q = filter.q.trim()
    and.push({
      OR: [
        { subject_call: { scheme_title: { contains: q, mode: 'insensitive' } } },
        { subject_call: { agency_name: { contains: q, mode: 'insensitive' } } },
        { candidate_call: { scheme_title: { contains: q, mode: 'insensitive' } } },
      ],
    })
  }
  return and.length > 0 ? { AND: and } : {}
}

export async function listReviewItems(db: PrismaClient, filter: ReviewFilter, page = 1, pageSize = 25) {
  const where = reviewWhere(filter)
  const [total, items] = await Promise.all([
    db.fundingImportCandidate.count({ where }),
    db.fundingImportCandidate.findMany({
      where,
      orderBy: [{ blocks_release: 'desc' }, { score: 'desc' }, { created_at: 'asc' }],
      skip: (Math.max(1, page) - 1) * pageSize,
      take: pageSize,
      include: { subject_call: { select: CALL_SUMMARY }, candidate_call: { select: CALL_SUMMARY } },
    }),
  ])
  return { total, page, pageSize, items }
}

export async function reviewSummary(db: PrismaClient) {
  const grouped = await db.fundingImportCandidate.groupBy({
    by: ['reason', 'tier', 'resolution', 'blocks_release'],
    _count: { _all: true },
  })
  const variants = await db.fundingImportCandidate.count({
    where: { resolution: { in: ['pending', 'deferred'] }, signals: { path: ['listingVariant'], equals: true } },
  })
  const staged = await db.fundingCall.groupBy({
    by: ['catalog_status', 'review_status'],
    where: { import_run_id: { not: null } },
    _count: { _all: true },
  })
  const runs = await db.fundingImportRun.findMany({
    orderBy: { started_at: 'desc' },
    take: 10,
    select: { id: true, source_key: true, mode: true, status: true, started_at: true, finished_at: true, counts: true },
  })
  return {
    items: grouped.map((g) => ({ reason: g.reason, tier: g.tier, resolution: g.resolution, blocksRelease: g.blocks_release, count: g._count._all })),
    openListingVariants: variants,
    importedCalls: staged.map((s) => ({ catalogStatus: s.catalog_status, reviewStatus: s.review_status, count: s._count._all })),
    runs,
  }
}

export interface ResolveInput {
  ids?: string[]
  filter?: ReviewFilter
  resolution: ReviewResolution
  /** For a pair of two imported calls resolved as duplicates: which one survives. */
  keep?: 'subject' | 'candidate'
  note?: string | null
  actorUserId: string
}

const MAX_BULK = 2000

/** Sets an imported call aside. Refuses anything that is not an import. */
async function setAside(tx: Prisma.TransactionClient, callId: string, survivorId: string | null) {
  const call = await tx.fundingCall.findUnique({ where: { id: callId }, select: { id: true, import_run_id: true } })
  if (!call?.import_run_id) throw new Error(`Refusing to set aside ${callId}: it is not an imported call.`)
  await tx.fundingCall.update({
    where: { id: callId },
    data: { catalog_status: 'REJECTED', status: 'ARCHIVED', is_active: false, review_status: 'CLEAR', archivedAt: new Date() },
  })
  if (survivorId) {
    // Provenance follows the opportunity: the survivor gains a LINKED source.
    // The survivor row itself is not written.
    await tx.externalSourceRecord.updateMany({
      where: { funding_call_id: callId, entity_type: 'CALL' },
      data: { funding_call_id: survivorId, link_role: 'LINKED' },
    })
  }
  // Other open items about the set-aside call are moot.
  await tx.fundingImportCandidate.updateMany({
    where: { resolution: { in: ['pending', 'deferred'] }, OR: [{ subject_call_id: callId }, { candidate_call_id: callId }] },
    data: { resolution: 'ignored', resolution_note: 'Call set aside by another review decision', resolved_at: new Date() },
  })
}

export async function resolveReviewItems(db: PrismaClient, input: ResolveInput) {
  if (!REVIEW_RESOLUTIONS.includes(input.resolution)) throw new Error(`Unknown resolution ${input.resolution}`)
  const items = input.ids && input.ids.length > 0
    ? await db.fundingImportCandidate.findMany({ where: { id: { in: input.ids.slice(0, MAX_BULK) } } })
    : input.filter
      ? await db.fundingImportCandidate.findMany({ where: reviewWhere(input.filter), take: MAX_BULK, orderBy: { created_at: 'asc' } })
      : []
  const touched = new Set<string>()
  let resolved = 0
  const skipped: Array<{ id: string; reason: string }> = []
  for (const item of items) {
    if (!['pending', 'deferred'].includes(item.resolution) && input.resolution !== 'pending') {
      skipped.push({ id: item.id, reason: 'already resolved' })
      continue
    }
    try {
      await db.$transaction(async (tx) => {
        const fresh = await tx.fundingImportCandidate.findUnique({ where: { id: item.id } })
        if (!fresh || !['pending', 'deferred'].includes(fresh.resolution)) return
        const subjectImported = fresh.subject_call_id
          ? Boolean((await tx.fundingCall.findUnique({ where: { id: fresh.subject_call_id }, select: { import_run_id: true } }))?.import_run_id)
          : false
        const candidateImported = fresh.candidate_call_id
          ? Boolean((await tx.fundingCall.findUnique({ where: { id: fresh.candidate_call_id }, select: { import_run_id: true } }))?.import_run_id)
          : false

        if (fresh.reason === 'EXISTING_DUPLICATE' && !['reviewed', 'ignored', 'deferred'].includes(input.resolution)) {
          throw new Error('Pairs of existing calls are report-only: mark them reviewed.')
        }
        if (input.resolution === 'merged_to_existing') {
          if (fresh.reason !== 'POSSIBLE_DUPLICATE' || !fresh.subject_call_id || !fresh.candidate_call_id) {
            throw new Error('Only a duplicate pair can be merged.')
          }
          let discard = fresh.subject_call_id
          let survivor = fresh.candidate_call_id
          if (candidateImported && subjectImported && input.keep === 'candidate') {
            discard = fresh.subject_call_id
            survivor = fresh.candidate_call_id
          } else if (candidateImported && subjectImported) {
            discard = fresh.candidate_call_id
            survivor = fresh.subject_call_id
          }
          if (!subjectImported && !candidateImported) throw new Error('Neither call is imported; nothing to set aside.')
          await setAside(tx, discard, survivor)
          touched.add(survivor)
          touched.add(discard)
        } else if (input.resolution === 'rejected') {
          if (!fresh.subject_call_id || !subjectImported) throw new Error('Only an imported call can be rejected here.')
          await setAside(tx, fresh.subject_call_id, null)
          touched.add(fresh.subject_call_id)
        }
        await tx.fundingImportCandidate.update({
          where: { id: fresh.id },
          data: {
            resolution: input.resolution,
            resolution_note: input.note || null,
            resolved_by_user_id: input.actorUserId,
            resolved_at: input.resolution === 'deferred' ? null : new Date(),
          },
        })
        if (fresh.subject_call_id && subjectImported) touched.add(fresh.subject_call_id)
        if (fresh.candidate_call_id && candidateImported) touched.add(fresh.candidate_call_id)
      })
      resolved++
    } catch (error) {
      skipped.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  await refreshReviewStatus(db, null, Array.from(touched))
  return { matched: items.length, resolved, skipped }
}
