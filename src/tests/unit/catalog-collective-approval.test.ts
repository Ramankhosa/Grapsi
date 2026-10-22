import { describe, expect, it, vi } from 'vitest'
const guards = vi.hoisted(() => ({ attached: vi.fn(), archive: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/fundingCatalogImport/rollback', () => ({ callsWithAttachedWork: guards.attached }))
vi.mock('@/lib/fundingCatalogImport/service', () => ({ refreshReviewStatus: guards.refresh }))
vi.mock('@/lib/fundingCatalogImport/review', async original => ({ ...await original<any>(), setAside: guards.archive }))
import { approveDistinct, snapshotItem } from '@/lib/fundingCatalogImport/aiReview'
import { inputHash } from '@/lib/fundingCatalogImport/aiReviewPolicy'
function fixture(imported = true) {
 const call = (id: string) => ({ id, title: 'Example', scheme_title: 'Example', agency_name: 'Funder', description: 'Stored description', eligibility_text: '', disciplines: [], import_run_id: imported ? 'run' : null, catalog_status: 'STAGED', visibility: 'GLOBAL_CATALOG' })
 const fresh = { id: 'pair', reason: 'POSSIBLE_DUPLICATE', resolution: 'pending', subject_call_id: 'subject', candidate_call_id: 'survivor', subject_call: call('subject'), candidate_call: call('survivor') }
 const snapshot = snapshotItem(fresh)
 const result = { decision: 'SAME_OPPORTUNITY', confidence: 0.91, conflicts: ['DUPLICATE_LISTING'], explanation: 'Same call.', evidence: [{ side: 'subject', field: 'title', quote: 'Example' }, { side: 'candidate', field: 'title', quote: 'Example' }], suggestedFacts: [] }
 const tx = { $queryRaw: vi.fn(), catalogAiReviewItem: { findFirst: vi.fn().mockResolvedValue({ candidate_id: 'pair', snapshot, input_hash: inputHash(snapshot), result }), update: vi.fn() }, fundingImportCandidate: { findUnique: vi.fn().mockResolvedValue(fresh), update: vi.fn() } }
 return { tx, db: { $transaction: (fn: any) => fn(tx) } as any }
}
describe('Human-confirmed same-call safeguards', () => {
 it('archives only the imported subject and records human attribution', async () => {
  vi.clearAllMocks(); guards.attached.mockResolvedValue(new Set())
  const { db, tx } = fixture()
  expect((await approveDistinct(db, 'batch', ['item'], 'admin', true))[0].applied).toBe(true)
  expect(guards.archive).toHaveBeenCalledWith(tx, 'subject', 'survivor')
  expect(tx.fundingImportCandidate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolution: 'merged_to_existing', resolved_by_user_id: 'admin' }) }))
 })
 it('refuses attached work without archiving or resolving', async () => {
  vi.clearAllMocks(); guards.attached.mockResolvedValue(new Set(['subject']))
  const { db, tx } = fixture()
  expect((await approveDistinct(db, 'batch', ['item'], 'admin', true))[0].reason).toMatch(/Attached work/)
  expect(guards.archive).not.toHaveBeenCalled(); expect(tx.fundingImportCandidate.update).not.toHaveBeenCalled()
 })
 it('never archives intake calls', async () => {
  vi.clearAllMocks(); const { db } = fixture(false)
  expect((await approveDistinct(db, 'batch', ['item'], 'admin', true))[0].applied).toBe(false)
  expect(guards.archive).not.toHaveBeenCalled()
 })
})
