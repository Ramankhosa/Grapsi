import assert from 'node:assert/strict'
import { withDisposableDb } from './lib/disposableDb'
import { approveDistinct, createAiBatch, estimateReview, runAiReviewStep, selectAiReviewItems, selectionHash } from '../src/lib/fundingCatalogImport/aiReview'
import { finalizeAiItem } from '../src/lib/fundingCatalogImport/finalizeAiReview'

async function main() {
  await withDisposableDb(async ({ db }) => {
    const run = await db.fundingImportRun.create({ data: { source_key: 'test', mode: 'APPLY', status: 'COMPLETED', importer_version: 'test' } })
    const base = { createdByUserId: 'test', updatedByUserId: 'test', sourceType: 'URL' as const, visibility: 'GLOBAL_CATALOG' as const, catalog_status: 'STAGED' as const, status: 'READY_FOR_REVIEW' as const, import_run_id: run.id, notification_policy: 'SUPPRESSED', review_status: 'NEEDS_REVIEW' }
    const left = await db.fundingCall.create({ data: { ...base, title: 'Round 2026', agency_name: 'Test agency', disciplines: ['Science'], close_date: new Date('2099-11-01') } })
    const right = await db.fundingCall.create({ data: { ...base, title: 'Round 2025', agency_name: 'Test agency' } })
    const intake = await db.fundingCall.create({ data: { ...base, title: 'Existing intake', import_run_id: null, visibility: 'GLOBAL_PUBLISHED', catalog_status: 'PUBLISHED', status: 'PUBLISHED' } })
    const pair = await db.fundingImportCandidate.create({ data: { run_id: run.id, dedupe_key: 'pair', reason: 'POSSIBLE_DUPLICATE', tier: 'POSSIBLE_DUPLICATE', blocks_release: true, subject_call_id: left.id, candidate_call_id: right.id } })
    await db.fundingImportCandidate.create({ data: { run_id: run.id, dedupe_key: 'other-blocker', reason: 'READINESS_FAILED', tier: 'INFO', blocks_release: true, subject_call_id: left.id } })
    const oldKey = process.env.OPENAI_API_KEY, oldFetch = globalThis.fetch
    process.env.OPENAI_API_KEY = 'test-only-no-real-provider'
    let providerCalls = 0
    globalThis.fetch = async () => {
      providerCalls++
      await new Promise(r => setTimeout(r, 80))
      const mocked = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ decision: 'SEPARATE_OPPORTUNITIES', confidence: .98, conflicts: ['DIFFERENT_ROUND'], explanation: 'These are explicitly different annual rounds.', evidence: [{ side: 'subject', field: 'title', quote: '2026' }, { side: 'candidate', field: 'title', quote: '2025' }], suggestedFacts: [] }) }] } }], usageMetadata: { totalTokenCount: 123 } }; return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:mocked.candidates[0].content.parts[0].text}}],usage:{total_tokens:123}}), { status: 200 })
    }
    try {
      const rows = await selectAiReviewItems(db as any, { reason: 'POSSIBLE_DUPLICATE', lifecycle: 'OPEN', agency: 'test', subject: 'science' })
      assert.equal(rows.length, 1)
      assert.equal(estimateReview(rows).uniqueCalls, 2)
      const batch = await createAiBatch(db as any, 'admin', {}, [pair.id], selectionHash(rows))
      await assert.rejects(createAiBatch(db as any, 'admin', {}, [pair.id], selectionHash(rows)), /unfinished batch/)
      await Promise.all([runAiReviewStep(db as any, batch.id), runAiReviewStep(db as any, batch.id)])
      assert.equal(providerCalls, 1, 'Concurrent processing must make only one provider request')
      const item = await db.catalogAiReviewItem.findFirstOrThrow({ where: { batch_id: batch.id } })
      assert.equal(item.status, 'DONE')
      assert.equal((item.usage as any).totalTokenCount, 123)
      const approved = await approveDistinct(db as any, batch.id, [item.id], 'admin')
      assert.equal(approved[0].applied, true)
      assert.equal((await db.fundingCall.findUniqueOrThrow({ where: { id: left.id } })).review_status, 'NEEDS_REVIEW', 'Another blocker must remain blocking')
      assert.equal((await db.fundingCall.findUniqueOrThrow({ where: { id: left.id } })).catalog_status, 'STAGED', 'Approval must not publish')
      assert.deepEqual(await db.fundingCall.findUniqueOrThrow({ where: { id: intake.id } }), intake, 'Existing intake must remain unchanged')
      assert.equal((await approveDistinct(db as any, batch.id, [item.id], 'admin'))[0].applied, false)
      // Source changed while queued: no provider request and no conflict resolution.
      await db.fundingImportCandidate.update({ where: { id: pair.id }, data: { resolution: 'pending' } })
      const again = await selectAiReviewItems(db as any, {}, [pair.id])
      const stale = await createAiBatch(db as any, 'admin', {}, [pair.id], selectionHash(again))
      await db.fundingCall.update({ where: { id: left.id }, data: { description: 'Changed after selection' } })
      await runAiReviewStep(db as any, stale.id)
      assert.equal(providerCalls, 1)
      assert.equal((await db.catalogAiReviewItem.findFirstOrThrow({ where: { batch_id: stale.id } })).status, 'FAILED')
      // Recover an expired lease without resetting its attempt budget.
      const recoverRows = await selectAiReviewItems(db as any, {}, [pair.id])
      const recover = await createAiBatch(db as any, 'admin', {}, [pair.id], selectionHash(recoverRows))
      await db.catalogAiReviewItem.updateMany({ where: { batch_id: recover.id }, data: { status: 'RUNNING', attempts: 1, lease_token: 'dead-worker', lease_until: new Date(0) } })
      await runAiReviewStep(db as any, recover.id)
      const recovered = await db.catalogAiReviewItem.findFirstOrThrow({ where: { batch_id: recover.id } })
      assert.equal(recovered.status, 'DONE')
      assert.equal(recovered.attempts, 2)
      // Provider outages/quota errors pause the entire batch rather than flooding requests.
      const outage = await createAiBatch(db as any, 'admin', {}, [pair.id], selectionHash(recoverRows))
      globalThis.fetch = async () => new Response('{}', { status: 429 })
      await runAiReviewStep(db as any, outage.id)
      assert.equal((await db.catalogAiReviewBatch.findUniqueOrThrow({ where: { id: outage.id } })).status, 'PAUSED')
      assert.equal(await db.fundingCallAlert.count(), 0)
      // Final decisions use their own locked transaction and preserve all records.
      const duplicateData = { ...base, title: 'Exact duplicate', agency_name: 'Identical agency', description: 'Identical factual description for this exact duplicate listing. '.repeat(5), source_url: 'https://example.org/exact', eligibility_text: 'Any researcher', disciplines: ['Science'] }
      const cloneA = await db.fundingCall.create({ data: duplicateData })
      const cloneB = await db.fundingCall.create({ data: duplicateData })
      const clonePair = await db.fundingImportCandidate.create({ data: { run_id: run.id, dedupe_key: 'clone-pair', reason: 'POSSIBLE_DUPLICATE', tier: 'LIKELY_DUPLICATE', blocks_release: true, subject_call_id: cloneA.id, candidate_call_id: cloneB.id } })
      const cloneRows = await selectAiReviewItems(db as any, {}, [clonePair.id])
      const cloneBatch = await createAiBatch(db as any, 'admin', {}, [clonePair.id], selectionHash(cloneRows))
      const cloneItem = await db.catalogAiReviewItem.findFirstOrThrow({ where: { batch_id: cloneBatch.id } })
      await db.catalogAiReviewBatch.update({ where: { id: cloneBatch.id }, data: { status: 'COMPLETE' } })
      await db.catalogAiReviewItem.update({ where: { id: cloneItem.id }, data: { status: 'DONE', result: { decision: 'SAME_OPPORTUNITY', confidence: .99, conflicts: ['DUPLICATE_LISTING'], explanation: 'Both records have identical stored facts.', evidence: [{ side: 'subject', field: 'title', quote: 'Exact duplicate' }, { side: 'candidate', field: 'title', quote: 'Exact duplicate' }], suggestedFacts: [] } } })
      const countBefore = await db.fundingCall.count()
      const journals: unknown[] = []
      const final = await finalizeAiItem(db as any, cloneItem.id, 'admin', entry => { journals.push(entry) })
      assert.equal(final.applied, true)
      assert.equal(await db.fundingCall.count(), countBefore, 'Finalization must never delete a call')
      assert.equal(await db.fundingCall.count({ where: { id: { in: [cloneA.id, cloneB.id] }, status: 'ARCHIVED' } }), 1)
      assert.equal(await db.fundingCall.count({ where: { id: { in: [cloneA.id, cloneB.id] }, catalog_status: 'PUBLISHED' } }), 0)
      assert.equal(journals.length, 1)
      assert.deepEqual(await db.fundingCall.findUniqueOrThrow({ where: { id: intake.id } }), intake)
      const protectedA = await db.fundingCall.create({ data: duplicateData })
      const protectedB = await db.fundingCall.create({ data: duplicateData })
      const protectedPair = await db.fundingImportCandidate.create({ data: { run_id: run.id, dedupe_key: 'protected-clone-pair', reason: 'POSSIBLE_DUPLICATE', tier: 'LIKELY_DUPLICATE', blocks_release: true, subject_call_id: protectedA.id, candidate_call_id: protectedB.id } })
      const protectedRows = await selectAiReviewItems(db as any, {}, [protectedPair.id])
      const protectedBatch = await createAiBatch(db as any, 'admin', {}, [protectedPair.id], selectionHash(protectedRows))
      const protectedItem = await db.catalogAiReviewItem.findFirstOrThrow({ where: { batch_id: protectedBatch.id } })
      const priorResult = (await db.catalogAiReviewItem.findUniqueOrThrow({ where: { id: cloneItem.id } })).result
      await db.catalogAiReviewBatch.update({ where: { id: protectedBatch.id }, data: { status: 'COMPLETE' } })
      await db.catalogAiReviewItem.update({ where: { id: protectedItem.id }, data: { status: 'DONE', result: priorResult as any } })
      await db.$executeRawUnsafe("INSERT INTO funding_intake_duplicates (id,job_id,candidate_funding_call_id,match_type,match_score) VALUES ($1,$2,$3,'exact_fingerprint',1)", 'protected-reference', 'protected-job', protectedA.id)
      const protectedOutcome = await finalizeAiItem(db as any, protectedItem.id, 'admin', () => { throw new Error('Protected work must never reach the write journal') })
      assert.equal(protectedOutcome.applied, false)
      assert.match(protectedOutcome.reason || '', /Attached work/)
      assert.equal(await db.fundingCall.count({ where: { id: { in: [protectedA.id, protectedB.id] }, status: 'ARCHIVED' } }), 0)
      console.log('PASS final decisions archive exact duplicates without deletion, publication or intake edits; journal retained')
      console.log('PASS filters, migration, overlap guard, concurrent leases, stored usage, explicit approval, other blockers, intake preservation, stale-input rejection, expired-lease recovery, quota pause and zero alerts')
    } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey }
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })


