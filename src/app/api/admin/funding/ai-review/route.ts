import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireFundingActor } from '@/lib/funding/access'
import { aiFilterSchema, approveDistinct, createAiBatch, estimateReview, runAiReviewStep, selectAiReviewItems, selectionHash, snapshotItem } from '@/lib/fundingCatalogImport/aiReview'
import { canApproveDistinct, recommendationSchema } from '@/lib/fundingCatalogImport/aiReviewPolicy'

export const runtime = 'nodejs'
export const maxDuration = 90
const schema = z.object({
  action: z.enum(['preview', 'start', 'step', 'pause', 'resume', 'cancel', 'retry', 'approve']),
  filter: aiFilterSchema.default({}), ids: z.array(z.string().min(1).max(100)).max(10000).optional(),
  expectedHash: z.string().max(100).optional(), batchId: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(10000).default(100),
  page: z.number().int().min(1).max(1000).default(1),
})
async function auth(request: NextRequest) {
  const result = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in result) return result
  if (!result.actor.isSuperAdminWriter) return { response: NextResponse.json({ message: 'Superadmin write access required' }, { status: 403 }) }
  return result
}
export async function GET(request: NextRequest) {
  const access = await auth(request)
  if ('response' in access) return access.response
  try {
    const id = request.nextUrl.searchParams.get('batchId')
    const batches = await prisma.catalogAiReviewBatch.findMany({ orderBy: { created_at: 'desc' }, take: 30, include: { _count: { select: { items: true } } } })
    if (!id) return NextResponse.json({ batches, configured: Boolean(process.env.GOOGLE_AI_API_KEY), model: 'gemini-2.5-flash' })
    const batch = await prisma.catalogAiReviewBatch.findUnique({ where: { id } })
    if (!batch) return NextResponse.json({ message: 'Batch not found' }, { status: 404 })
    const state = request.nextUrl.searchParams.get('status')
    const decision = request.nextUrl.searchParams.get('decision')
    const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page')) || 1))
    const where = { batch_id: id, ...(state ? { status: state } : {}), ...(decision ? { result: { path: ['decision'], equals: decision } } : {}) }
    const [counts, total, items] = await Promise.all([
      prisma.catalogAiReviewItem.groupBy({ by: ['status'], where: { batch_id: id }, _count: { _all: true } }),
      prisma.catalogAiReviewItem.count({ where }),
      prisma.catalogAiReviewItem.findMany({ where, orderBy: { id: 'asc' }, take: 25, skip: (page - 1) * 25 }),
    ])
    return NextResponse.json({ batches, batch, counts, total, page, items: items.map(item => ({ ...item,
      approvable: item.status === 'DONE' && !item.approved_at && recommendationSchema.safeParse(item.result).success && canApproveDistinct(item.result as any, item.snapshot),
    })) })
  } catch { return NextResponse.json({ message: 'Could not load AI reviews. Ensure the review migration has been applied.' }, { status: 500 }) }
}
export async function POST(request: NextRequest) {
  const access = await auth(request)
  if ('response' in access) return access.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid review request' }, { status: 400 })
  const body = parsed.data
  try {
    if (body.action === 'preview') {
      const rows = await selectAiReviewItems(prisma, body.filter, body.ids)
      return NextResponse.json({ ...estimateReview(rows), selectionHash: selectionHash(rows),
        page: body.page, items: rows.slice((body.page - 1) * 100, body.page * 100).map(r => ({ id: r.id, score: r.score, ...snapshotItem(r) })) })
    }
    if (body.action === 'start') {
      if (!body.expectedHash) throw new Error('Preview the selection first')
      const batch = await createAiBatch(prisma, access.actor.id, body.filter, body.ids, body.expectedHash, body.limit)
      return NextResponse.json({ batch })
    }
    if (!body.batchId) throw new Error('Select a batch')
    const batch = await prisma.catalogAiReviewBatch.findUnique({ where: { id: body.batchId } })
    if (!batch) return NextResponse.json({ message: 'Batch not found' }, { status: 404 })
    if (body.action === 'step') await runAiReviewStep(prisma, batch.id)
    if (body.action === 'pause' || body.action === 'cancel') {
      await prisma.catalogAiReviewBatch.updateMany({ where: { id: batch.id, status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } }, data: { status: body.action === 'pause' ? 'PAUSED' : 'CANCELLED' } })
    }
    if (body.action === 'resume' || body.action === 'retry') {
      if (batch.status === 'CANCELLED') throw new Error('Cancelled batches cannot be resumed; create a new selection')
      if (body.action === 'retry') await prisma.catalogAiReviewItem.updateMany({ where: { batch_id: batch.id, status: 'FAILED', attempts: { lt: 3 } }, data: { status: 'QUEUED', error: null } })
      await prisma.catalogAiReviewBatch.updateMany({ where: { id: batch.id, status: { not: 'CANCELLED' } }, data: { status: 'QUEUED' } })
    }
    if (body.action === 'approve') {
      if (!body.ids?.length || body.ids.length > 100) throw new Error('Select between 1 and 100 recommendations')
      return NextResponse.json({ outcomes: await approveDistinct(prisma, batch.id, body.ids, access.actor.id) })
    }
    return NextResponse.json({ ok: true })
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Review failed' }, { status: 400 }) }
}
