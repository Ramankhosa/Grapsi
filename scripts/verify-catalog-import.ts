/**
 * Scenario proof for the external-catalogue importer, on a THROWAWAY database.
 *
 * Clones the dev schema (never its data) with scripts/lib/disposableDb.ts,
 * seeds a few existing calls, builds a small synthetic Scientify snapshot and
 * walks the whole lifecycle: dry run, apply, re-run, crashed run + resume,
 * concurrent lock, duplicate review (listing variants, chains, existing
 * duplicates), release by source, unrelease, rollback — asserting after each
 * step that existing calls are byte-identical and nothing notified anyone.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-catalog-import.ts
 *
 * Only ever touches the disposable database; refuses non-local databases.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { withDisposableDb } from './lib/disposableDb'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const TODAY = '2026-10-15'

function grant(id: number, over: Record<string, unknown>) {
  return {
    id,
    slug: `grant-${id}`,
    url: `https://www.scientifyresearch.org/grant/grant-${id}/`,
    title: `Grant ${id}`,
    description: `Funding for research number ${id} with enough words to be a description.`,
    seo_description: null,
    published_gmt: '2026-01-10T10:00:00',
    modified_gmt: '2026-01-11T10:00:00',
    fetched_at: '2026-10-14T10:00:00+00:00',
    funder_id: 900,
    funder_name: 'Gamma Foundation',
    funders: [{ id: 900, name: 'Gamma Foundation' }],
    apply_url: `https://gamma.example.org/apply/${id}`,
    amount_raw: '50,000 USD',
    duration_raw: '2 years',
    deadlines: [{ label: 'Full application due', date: '2026-12-01' }],
    other_detail_fields: {},
    detail_error: null,
    taxonomies: {
      location: ['USA'],
      'multi-citizenship': ['Global'],
      'recipient-citizenship': ['India', 'Kenya'],
      mul: [],
      'my-primary-locations': ['USA'],
      'multi-location': [],
      'host-location': ['USA'],
      'grant-type': ['Research grant'],
      'career-stage': ['Senior researchers'],
      discipline: ['Genetics'],
      'my-subject': ['Life Sciences'],
      'funding-sources': ['Foundation and society funding'],
      challenge: [],
      'indirect-cost': ['Indirect costs included'],
      'legal-working-rights': [],
      'recipient-qualification': ['PhD'],
      nomination: [],
      diversities: [],
      'society-memberships': [],
      'additional-benefit': [],
      horizon: [],
    },
    ...over,
  }
}

function buildSnapshotRecords() {
  return [
    // Three different awards on one programme page → RELATED only.
    grant(101, { title: 'Young Investigator Award (melanoma | worldwide)', apply_url: 'https://gamma.example.org/rfp' }),
    grant(102, { title: 'Team Science Award (melanoma | worldwide)', apply_url: 'https://gamma.example.org/rfp' }),
    grant(103, { title: 'Dermatology Partnership Grant (melanoma | worldwide)', apply_url: 'https://gamma.example.org/rfp' }),
    // Listing variants of one opportunity → LIKELY + listingVariant.
    grant(201, { title: 'Postdoctoral Fellowships (USA | multiple sclerosis)', apply_url: 'https://gamma.example.org/postdoc' }),
    grant(202, { title: 'Postdoctoral Fellowships (US citizens | multiple sclerosis)', apply_url: 'https://gamma.example.org/postdoc' }),
    // Chain A~B (same page, 45 days apart), B~C (similar, 45 days), A–C a different round.
    grant(301, { title: 'Chain Research Award', apply_url: 'https://gamma.example.org/chain', deadlines: [{ label: 'Full application due', date: '2026-11-01' }] }),
    grant(302, { title: 'Chain Research Award', apply_url: 'https://gamma.example.org/chain', deadlines: [{ label: 'Full application due', date: '2026-12-16' }] }),
    grant(303, { title: 'Chain Research Award', apply_url: 'https://gamma.example.org/chain-2', deadlines: [{ label: 'Full application due', date: '2027-01-30' }] }),
    // Annual rounds → never a duplicate.
    grant(401, { title: '2025 Delta Prize', apply_url: 'https://gamma.example.org/delta-2025', deadlines: [{ label: 'Full application due', date: '2025-03-01' }] }),
    grant(402, { title: '2026 Delta Prize', apply_url: 'https://gamma.example.org/delta-2026', deadlines: [{ label: 'Full application due', date: '2026-03-01' }] }),
    // Same as an EXISTING curated call (funder, title, deadline).
    grant(501, { title: 'Clinical Pilot and Feasibility Award (cystic fibrosis | worldwide)', funder_id: 901, funder_name: 'Cystic Fibrosis Foundation', funders: [{ id: 901, name: 'Cystic Fibrosis Foundation' }], apply_url: 'https://cff.example.org/pilot', deadlines: [{ label: 'Full application due', date: '2027-02-17' }] }),
    // Matches only a TENANT-PRIVATE call: must never be compared.
    grant(601, { title: 'Private Lab Seed Grant', funder_id: 902, funder_name: 'Epsilon Trust', funders: [{ id: 902, name: 'Epsilon Trust' }], apply_url: 'https://epsilon.example.org/seed' }),
    // Missing funder → READINESS_FAILED (blocks release).
    grant(701, { title: 'Orphan Grant', funder_id: null, funder_name: null, funders: [], apply_url: 'https://orphan.example.org/x' }),
    // Source page gone (404): lifecycle unaffected, reported only.
    grant(801, { title: 'Gone Page Grant', funder_id: 903, funder_name: 'Zeta Council', funders: [{ id: 903, name: 'Zeta Council' }], apply_url: 'https://zeta.example.org/gone', detail_error: 'HTTP 404' }),
    // Closed by the source; rolling; forthcoming.
    grant(901, { title: 'Closed Programme', funder_id: 903, funder_name: 'Zeta Council', funders: [{ id: 903, name: 'Zeta Council' }], apply_url: 'https://zeta.example.org/closed', other_detail_fields: { 'This grant is currently closed. Create a grant alert…': 'Add notes' } }),
    grant(902, { title: 'Rolling Programme', funder_id: 903, funder_name: 'Zeta Council', funders: [{ id: 903, name: 'Zeta Council' }], apply_url: 'https://zeta.example.org/rolling', deadlines: [], other_detail_fields: { 'Rolling submissions': 'Add notes' } }),
  ]
}

const FUNDERS = [
  { id: 900, slug: 'gamma', url: 'https://www.scientifyresearch.org/funder/gamma/', name: 'Gamma Foundation', description: 'A foundation.', published_gmt: '2025-01-01T00:00:00', modified_gmt: '2025-01-01T00:00:00', taxonomies: { location: ['USA'] } },
  { id: 901, slug: 'cff', url: 'https://www.scientifyresearch.org/funder/cff/', name: 'Cystic Fibrosis Foundation', description: 'CF.', published_gmt: '2025-01-01T00:00:00', modified_gmt: '2025-01-01T00:00:00', taxonomies: { location: ['USA'] } },
  { id: 902, slug: 'epsilon', url: 'https://www.scientifyresearch.org/funder/epsilon/', name: 'Epsilon Trust', description: 'E.', published_gmt: '2025-01-01T00:00:00', modified_gmt: '2025-01-01T00:00:00', taxonomies: { location: ['United Kingdom'] } },
  { id: 903, slug: 'zeta', url: 'https://www.scientifyresearch.org/funder/zeta/', name: 'Zeta Council', description: 'Z.', published_gmt: '2025-01-01T00:00:00', modified_gmt: '2025-01-01T00:00:00', taxonomies: { location: ['Sweden'] } },
]

function writeSourceDir(records: unknown[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-verify-src-'))
  fs.mkdirSync(path.join(dir, 'raw'))
  fs.writeFileSync(path.join(dir, 'grants.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'funders.jsonl'), FUNDERS.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'raw', 'taxonomy_terms.json'), '{}')
  return dir
}

async function main() {
  await withDisposableDb(async ({ db, database }) => {
    // Imported lazily, after the disposable client is installed as the shared one.
    const { freezeSnapshot } = await import('../src/lib/fundingCatalogImport/snapshot')
    const { runCatalogImport } = await import('../src/lib/fundingCatalogImport/service')
    const { releaseImportedCalls, unreleaseImportedCalls } = await import('../src/lib/fundingCatalogImport/release')
    const { rollbackImportRun } = await import('../src/lib/fundingCatalogImport/rollback')
    const { resolveReviewItems } = await import('../src/lib/fundingCatalogImport/review')
    const { captureSafetySnapshot, compareSafetySnapshots } = await import('../src/lib/fundingCatalogImport/safety')
    const snapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-verify-snap-'))
    const ext = (id: number) => db.externalSourceRecord.findUnique({ where: { source_key_entity_type_external_id: { source_key: 'scientify', entity_type: 'CALL', external_id: String(id) } } }) as Promise<any>
    const callOf = async (id: number) => {
      const record = await ext(id)
      return record?.funding_call_id ? db.fundingCall.findUnique({ where: { id: record.funding_call_id } }) : null
    }

    // ---- existing data: a curated duplicate, a tenant-private twin, a placeholder
    const tenant = await db.tenant.create({ data: { name: 'Verify Tenant', atiId: `VERIFY-${Date.now()}` } })
    const base = { createdByUserId: 'verify', updatedByUserId: 'verify', sourceType: 'URL' as const }
    const existing = await db.fundingCall.create({
      data: { ...base, visibility: 'GLOBAL_PUBLISHED', status: 'PUBLISHED', catalog_status: 'PUBLISHED', is_active: true, title: 'Clinical Pilot and Feasibility Award', scheme_title: 'Clinical Pilot and Feasibility Award', agency_name: 'Cystic Fibrosis Foundation', close_date: new Date('2027-02-17T00:00:00Z'), eligible_countries: ['United States of America'], funding_kinds: ['Research Grant'], disciplines: ['Genetics'], description: 'Existing curated call.' },
    })
    await db.fundingCall.create({
      data: { ...base, visibility: 'TENANT_PRIVATE', tenantId: tenant.id, status: 'PUBLISHED', catalog_status: 'PUBLISHED', title: 'Private Lab Seed Grant', scheme_title: 'Private Lab Seed Grant', agency_name: 'Epsilon Trust', source_url: 'https://epsilon.example.org/seed' },
    })
    await db.fundingCall.create({
      data: { ...base, visibility: 'TENANT_PRIVATE', tenantId: tenant.id, status: 'READY_FOR_REVIEW', catalog_status: 'DRAFT', title: 'Default Grant Format - X', scheme_title: 'Default Grant Format - X', agency_name: 'Default Grant Format', source: 'default-grant-format', metadata: { kind: 'default_grant_format' } },
    })
    const before = await captureSafetySnapshot(db as any)
    const notificationsBefore = await db.notification.count()

    const records = buildSnapshotRecords()
    const { snapshotDir } = await freezeSnapshot({ sourceKey: 'scientify', sourceDir: writeSourceDir(records), files: ['grants.jsonl', 'funders.jsonl', 'raw/taxonomy_terms.json'], snapshotRoot: snapRoot })
    const common = { db: db as any, sourceKey: 'scientify' as const, snapshotDir, today: TODAY, isFullSnapshot: true }

    console.log('\nDry run')
    const dry = await runCatalogImport({ ...common, mode: 'DRY_RUN' })
    check('dry run writes nothing', (await db.fundingCall.count({ where: { import_run_id: { not: null } } })) === 0 && dry.runId === null)
    check('dry run counts every record', dry.report.counts.records === records.length)

    console.log('\nLock, crash and resume')
    await db.fundingImportRun.create({ data: { source_key: 'scientify', mode: 'APPLY', status: 'RUNNING', importer_version: 'x' } })
    let locked = false
    try {
      await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: database })
    } catch (error) {
      locked = /in progress/.test(String(error))
    }
    check('a second APPLY is refused while one is RUNNING', locked)
    await db.fundingImportRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED' } })
    const partial = await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: database, limit: 4, isFullSnapshot: false })
    await db.fundingImportRun.update({ where: { id: partial.runId! }, data: { status: 'FAILED' } }) // simulate a crash after 4 records
    check('a partial run retires nothing', (await db.externalSourceRecord.count({ where: { availability: 'NOT_SEEN_IN_SNAPSHOT' } })) === 0)
    const full = await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: database })
    check('resume creates only what was missing', (await db.fundingCall.count({ where: { import_run_id: { not: null } } })) === records.length)
    check('wrong target database is refused', await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: 'not-this-db' }).then(() => false, () => true))

    console.log('\nStaging and duplicates')
    const staged = await db.fundingCall.count({ where: { import_run_id: { not: null }, catalog_status: 'STAGED', is_active: false, visibility: 'GLOBAL_CATALOG', notification_policy: 'SUPPRESSED' } })
    check('every imported call is STAGED, inactive, catalogue, suppressed', staged === records.length)
    const items = await db.fundingImportCandidate.findMany()
    const pairTier = (a: number, b: number) => {
      return Promise.all([callOf(a), callOf(b)]).then(([x, y]) => items.find((i) => (i.subject_call_id === x?.id && i.candidate_call_id === y?.id) || (i.subject_call_id === y?.id && i.candidate_call_id === x?.id))?.tier || null)
    }
    check('different awards on one page are RELATED', (await pairTier(101, 102)) === 'RELATED' && (await pairTier(101, 103)) === 'RELATED')
    const variant = items.find((i) => (i.signals as any)?.listingVariant)
    check('listing variants are LIKELY and flagged', (await pairTier(201, 202)) === 'LIKELY_DUPLICATE' && Boolean(variant))
    check('annual rounds are not duplicates', ['RELATED', null].includes(await pairTier(401, 402)))
    const existingItem = items.find((i) => i.candidate_call_id === existing.id)
    check('an import matching a curated call is a blocking duplicate', Boolean(existingItem?.blocks_release) && existingItem?.tier === 'LIKELY_DUPLICATE')
    const privateIds = (await db.fundingCall.findMany({ where: { tenantId: tenant.id }, select: { id: true } })).map((c) => c.id)
    check('tenant-private calls and placeholders are never compared', !items.some((i) => privateIds.includes(i.subject_call_id || '') || privateIds.includes(i.candidate_call_id || '')))
    check('a call with no funder is held (readiness)', items.some((i) => i.reason === 'READINESS_FAILED'))
    const gone = await callOf(801)
    check('a 404 source keeps the lifecycle and is only reported', gone?.source_closed_at === null && items.some((i) => i.reason === 'SOURCE_UNAVAILABLE' && !i.blocks_release))
    check('the source "closed" marker closes the call', (await callOf(901))?.source_closed_at !== null)

    console.log('\nRe-run')
    const rerun = await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: database })
    const rerunUpdates = await db.fundingImportChange.count({ where: { run_id: rerun.runId!, operation: 'UPDATE' } })
    check('an unchanged re-run changes nothing', rerunUpdates === 0 && (await db.fundingCall.count({ where: { import_run_id: { not: null } } })) === records.length)

    console.log('\nReview')
    const a = await callOf(301)
    const b = await callOf(302)
    const c = await callOf(303)
    const ab = (await db.fundingImportCandidate.findMany({ where: { reason: 'POSSIBLE_DUPLICATE' } })).find(
      (i) => [i.subject_call_id, i.candidate_call_id].sort().join() === [a!.id, b!.id].sort().join()
    )
    check('chain: A~B is a blocking pair', Boolean(ab?.blocks_release))
    const keep = ab?.subject_call_id === a!.id ? 'subject' : 'candidate'
    await resolveReviewItems(db as any, { ids: [ab!.id], resolution: 'merged_to_existing', keep, actorUserId: 'verify' })
    const bAfter = await db.fundingCall.findUnique({ where: { id: b!.id } })
    const cAfter = await db.fundingCall.findUnique({ where: { id: c!.id } })
    check('chain: B is set aside, its source linked to A', bAfter?.catalog_status === 'REJECTED' && (await ext(302))?.funding_call_id === a!.id && (await ext(302))?.link_role === 'LINKED')
    check('chain: C stays held, now compared with A', cAfter?.review_status === 'NEEDS_REVIEW')

    const existingBefore = await db.fundingCall.findUnique({ where: { id: existing.id } })
    await resolveReviewItems(db as any, { ids: [existingItem!.id], resolution: 'merged_to_existing', actorUserId: 'verify' })
    const existingAfter = await db.fundingCall.findUnique({ where: { id: existing.id } })
    check('"same as existing" never writes the existing call', JSON.stringify(existingBefore) === JSON.stringify(existingAfter))
    check('"same as existing" sets the imported copy aside', (await callOf(501)) === null || (await db.fundingCall.findFirst({ where: { sourceFingerprint: 'catalog-import:scientify:501' } }))?.catalog_status === 'REJECTED')

    console.log('\nRelease, unrelease')
    const updatedAtBefore = new Map((await db.fundingCall.findMany({ where: { import_run_id: { not: null } }, select: { id: true, updatedAt: true } })).map((r) => [r.id, r.updatedAt.toISOString()]))
    const released = await releaseImportedCalls({ db: db as any, sourceKey: 'scientify', dryRun: false })
    const fromCrashedRun = await db.fundingCall.count({ where: { import_run_id: partial.runId!, catalog_status: 'PUBLISHED' } })
    check('release by source includes calls of a crashed run', released.released > 0 && fromCrashedRun > 0)
    check('release never publishes a held call', (await db.fundingCall.count({ where: { import_run_id: { not: null }, catalog_status: 'PUBLISHED', review_status: 'NEEDS_REVIEW' } })) === 0)
    const loggedFields = await db.fundingImportChange.groupBy({ by: ['field'], where: { run_id: released.releaseRunId! }, _count: { _all: true } })
    check('release logs all four columns it changes', ['catalog_status', 'status', 'is_active', 'publishedAt'].every((f) => loggedFields.some((g) => g.field === f && g._count._all === released.released)))
    const afterRelease = await db.fundingCall.findMany({ where: { import_run_id: { not: null }, catalog_status: 'PUBLISHED' }, select: { id: true, updatedAt: true, visibility: true, notification_policy: true } })
    check('release does not bump updatedAt', afterRelease.every((r) => updatedAtBefore.get(r.id) === r.updatedAt.toISOString()))
    const stamped = await db.fundingCall.findFirst({ where: { import_run_id: { not: null }, catalog_status: 'PUBLISHED' }, select: { publishedAt: true } })
    check('release stamps the true instant, whatever the DB time zone', Boolean(stamped?.publishedAt && Math.abs(Date.now() - stamped.publishedAt.getTime()) < 120000), stamped?.publishedAt?.toISOString())
    check('released calls stay GLOBAL_CATALOG and suppressed', afterRelease.every((r) => r.visibility === 'GLOBAL_CATALOG' && r.notification_policy === 'SUPPRESSED'))
    const dsrVisible = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM funding_calls WHERE "tenantId" IS NULL AND visibility = 'GLOBAL_PUBLISHED' AND status = 'PUBLISHED' AND import_run_id IS NOT NULL`)
    check('funding-department scope still sees no imported call', dsrVisible[0].n === 0)

    console.log('\nPromotion to the funding department')
    const { previewPromotion, promoteToDsr, withdrawFromDsr, PromotionError, WITHDRAW_REASON } = await import('../src/lib/fundingCatalogImport/promote')
    const { fundingAlertService } = await import('../src/lib/services/fundingAlertService')
    const { archiveFundingCall } = await import('../src/lib/funding/ingestion-service')
    // A tenant with a funding department (no country set: India) and one school.
    const officer = await db.user.create({ data: { email: `officer-${Date.now()}@verify.test`, tenantId: tenant.id } })
    await db.fundingDeptMember.create({ data: { tenant_id: tenant.id, user_id: officer.id } })
    const school = await db.tenantOrgUnit.create({ data: { tenant_id: tenant.id, kind: 'SCHOOL', name: 'Verify School' } })
    const operator = { userId: officer.id, email: officer.email, role: 'ADMIN' as const, tenantId: tenant.id }
    const superAdmin = { id: officer.id, email: officer.email, roles: ['SUPER_ADMIN'], tenantId: null, tenantAtiId: 'PLATFORM', isSuperAdmin: true, isSuperAdminWriter: true, platformPermissions: ['funding.publisher.write'] }
    const releasedCalls = await db.fundingCall.findMany({ where: { import_run_id: { not: null }, catalog_status: 'PUBLISHED', review_status: 'CLEAR' }, orderBy: { id: 'asc' } })
    // No country set: India is assumed, and these US-only calls are blocked.
    const blockedForIndia = (await previewPromotion(releasedCalls[0].id)).blockers
    check('a call that rules out the department country cannot be promoted', blockedForIndia.some((b) => /Not open to researchers in India/.test(b)))
    await db.tenant.update({ where: { id: tenant.id }, data: { country_code: 'US' } })
    let target: (typeof releasedCalls)[number] | null = null
    const seen: string[] = []
    for (const candidate of releasedCalls) {
      const preview = await previewPromotion(candidate.id)
      if (preview.promotable) { target = candidate; break }
      seen.push(`${candidate.scheme_title}: ${preview.blockers.join(' ')}`)
    }
    check('a released, clear, open call can be promoted', Boolean(target), seen.slice(0, 4).join(' | '))
    const stagedCall = await db.fundingCall.findFirst({ where: { import_run_id: { not: null }, catalog_status: 'STAGED' } })
    if (stagedCall) check('an unreleased call cannot be promoted', (await previewPromotion(stagedCall.id)).blockers.some((b) => /Release/.test(b)))

    const t = target!
    const publishedBefore = t.publishedAt
    const promotion = await promoteToDsr(t.id, operator, { notifyOfficers: true, alertResearchers: false }, { runEnrichment: false })
    const promoted = await db.fundingCall.findUnique({ where: { id: t.id } })
    check('promotion makes it a department call, officers only', promoted?.visibility === 'GLOBAL_PUBLISHED' && promoted?.notification_policy === 'OFFICERS_ONLY')
    check('promotion dates it now, not at its catalogue release', Boolean(promoted?.publishedAt && Math.abs(Date.now() - promoted.publishedAt.getTime()) < 120000))
    const promoteFields = (await db.fundingImportChange.findMany({ where: { run_id: promotion.runId }, select: { field: true } })).map((r) => r.field)
    check('promotion logs every column it changes', ['visibility', 'notification_policy', 'notification_policy_reason', 'publishedAt'].every((f) => promoteFields.includes(f)))
    const dsrVisibleNow = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM funding_calls WHERE "tenantId" IS NULL AND visibility = 'GLOBAL_PUBLISHED' AND status = 'PUBLISHED' AND import_run_id IS NOT NULL`)
    check('the funding department sees exactly the promoted call', dsrVisibleNow[0].n === 1)
    const dispatch = await fundingAlertService.dispatchAlertsForFundingCall(t.id, { force: true })
    check('officers only: researchers are never alerted', dispatch.reason === 'notifications_suppressed' && (await db.fundingCallAlert.count()) === 0)
    check('a second promotion is refused', await promoteToDsr(t.id, operator, { notifyOfficers: true, alertResearchers: false }, { runEnrichment: false }).then(() => false, (e) => e instanceof PromotionError))
    check('archive refuses a promoted call', await archiveFundingCall(t.id, superAdmin as any).then(() => false, (e) => /withdraw/i.test(String(e?.message))))
    check('unrelease leaves a promoted call alone', (await unreleaseImportedCalls({ db: db as any, sourceKey: 'scientify', dryRun: true, ids: [t.id] })).inScope === 0)
    const rollbackPlan = await rollbackImportRun({ db: db as any, runId: t.import_run_id!, dryRun: true })
    const runCalls = await db.fundingCall.count({ where: { import_run_id: t.import_run_id! } })
    check('rollback leaves a promoted call alone', rollbackPlan.toDelete! + rollbackPlan.toArchive! === runCalls - 1)

    const reimport = await runCatalogImport({ ...common, mode: 'APPLY', confirmTarget: database })
    const afterReimport = await db.fundingCall.findUnique({ where: { id: t.id } })
    check('a re-import keeps the promotion', Boolean(reimport.runId) && afterReimport?.visibility === 'GLOBAL_PUBLISHED' && afterReimport?.notification_policy === 'OFFICERS_ONLY' && afterReimport?.publishedAt?.getTime() === promoted?.publishedAt?.getTime())

    // A school took the call, and an officer assigned it.
    await db.$executeRawUnsafe(`INSERT INTO dsr_call_school_mappings(tenant_id, call_id, school_id, source, tier, reason) VALUES ($1, $2, $3, 'INGESTION_DIRECT', 'direct', 'verify')`, tenant.id, t.id, school.id)
    const assignment = await db.callAssignment.create({ data: { tenant_id: tenant.id, funding_call_id: t.id, assignee_user_id: officer.id, assigned_by_user_id: officer.id } })
    check('withdraw is refused while work is attached', await withdrawFromDsr(t.id, operator).then(() => false, (e) => /assignments/.test(String(e?.message))))
    await db.callAssignment.delete({ where: { id: assignment.id } })
    await withdrawFromDsr(t.id, operator)
    const withdrawn = await db.fundingCall.findUnique({ where: { id: t.id } })
    const mapping = async () => (await db.$queryRawUnsafe<Array<{ is_active: boolean; ended_reason: string | null }>>(`SELECT is_active, ended_reason FROM dsr_call_school_mappings WHERE call_id = $1`, t.id))[0]
    check('withdraw restores the catalogue state', withdrawn?.visibility === 'GLOBAL_CATALOG' && withdrawn?.notification_policy === 'SUPPRESSED' && withdrawn?.publishedAt?.getTime() === publishedBefore?.getTime())
    const ended = await mapping()
    check('withdraw ends the school mapping, kept as history', ended?.is_active === false && ended?.ended_reason === WITHDRAW_REASON)
    await promoteToDsr(t.id, operator, { notifyOfficers: false, alertResearchers: false }, { runEnrichment: false })
    check('promoting again reinstates the mapping', (await mapping())?.is_active === true)
    check('no ticks: nobody is told', (await db.fundingCall.findUnique({ where: { id: t.id } }))?.notification_policy === 'SUPPRESSED')
    await withdrawFromDsr(t.id, operator)
    check('nothing notified anyone while promoting', (await db.notification.count()) === notificationsBefore)
    // Test scaffolding: the mapping row inserted above is history now, and
    // history counts as attached work for unrelease and rollback below.
    await db.$executeRawUnsafe(`DELETE FROM dsr_call_school_mappings WHERE call_id = $1`, t.id)
    const un = await unreleaseImportedCalls({ db: db as any, sourceKey: 'scientify', dryRun: false })
    const restoredRows = await db.fundingCall.findMany({ where: { import_run_id: { not: null }, catalog_status: 'STAGED', review_status: 'CLEAR' }, select: { status: true, is_active: true, publishedAt: true } })
    check('unrelease restores every released column', un.restored === released.released && restoredRows.every((r) => r.status === 'READY_FOR_REVIEW' && r.is_active === false && r.publishedAt === null))

    console.log('\nRollback and safety')
    for (const run of [full.runId!, partial.runId!]) await rollbackImportRun({ db: db as any, runId: run, dryRun: false, confirmTarget: database })
    check('rollback archives every imported call without deleting history', (await db.fundingCall.count({ where: { import_run_id: { not: null } } })) > 0 && (await db.fundingCall.count({ where: { import_run_id: { not: null }, OR: [{ catalog_status: { not: 'ARCHIVED' } }, { is_active: true }] } })) === 0)
    check('rollback retains provenance and linked funders', (await db.externalSourceRecord.count()) > 0 && (await db.funder.count()) > 0)
    const after = await captureSafetySnapshot(db as any)
    const comparison = compareSafetySnapshots(before, after)
    check('existing calls are byte-identical end to end', comparison.ok && comparison.appEdits.length === 0, JSON.stringify({ silent: comparison.silentChanges.length, missing: comparison.missingRows.length, invariant: comparison.invariantViolations }))
    check('nothing notified anyone', (await db.notification.count()) === notificationsBefore && (await db.fundingCallAlert.count()) === 0)
  })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
