/**
 * Verifies the idea-intelligence funding-match split without touching the UI.
 *
 * Phase A (the review) must produce no funding call at all; Phase B (the
 * user-driven step) is what surfaces funders and, only on request, reads the
 * idea against one chosen call.
 *
 * It inspects the newest completed run and exercises the catalogue match, which
 * reads the FundingCall table rather than the sanctioned-award ledger. The
 * call-fit step costs an LLM call, so it runs only with --with-call-fit (and
 * writes a target call onto that run).
 *
 *   npm run verify:idea-funding-match
 *   npm run verify:idea-funding-match -- --run-analysis
 *   npm run verify:idea-funding-match -- --run-analysis --with-call-fit
 */
import Module from 'module'
import dotenv from 'dotenv'

// `server-only` exists to fail the build when server code is pulled into a
// client bundle. There is no client here, so stub it out or the evidence-source
// providers refuse to load.
const originalLoad = (Module as any)._load
;(Module as any)._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {}
  return originalLoad.call(this, request, ...rest)
}

dotenv.config({ path: '.env', override: false })
dotenv.config({ path: '.env.local', override: true })

const WITH_CALL_FIT = process.argv.includes('--with-call-fit')
const RUN_ANALYSIS = process.argv.includes('--run-analysis')

const IDEA_ARG = process.argv.find((arg) => arg.startsWith('--idea='))
const SAMPLE_IDEA = IDEA_ARG
  ? IDEA_ARG.slice('--idea='.length)
  : `We propose a low-cost, offline retinal screening system for rural primary-health centres. The system will combine a portable fundus camera with an on-device AI model to identify patients at risk of diabetic retinopathy and prioritise referrals. We will validate it with community health workers across three districts.`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function ok(message: string) {
  console.log(`  PASS  ${message}`)
}


async function main() {
  const [{ default: prisma }, { ideaIntelligenceService }, { IDEA_SOURCE_FLAGS }] = await Promise.all([
    import('../src/lib/prisma'),
    import('../src/lib/ideaIntelligence/service'),
    import('../src/lib/ideaIntelligence/sourceFlags'),
  ])

  console.log('Source flags:', IDEA_SOURCE_FLAGS)

  if (RUN_ANALYSIS) {
    // Costs LLM calls. Creates a real run for the newest user so the review
    // pipeline is exercised exactly as the workspace would exercise it.
    const user = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, email: true, tenantId: true } })
    assert(user, 'No user in this database to run an analysis as')
    console.log(`\nRunning a fresh analysis as ${user.email}...`)
    const actorForRun = { userId: user.id, tenantId: user.tenantId, access: { tenantId: user.tenantId, isSuperAdmin: false } }
    const created = await ideaIntelligenceService.createRun({ ideaText: SAMPLE_IDEA, title: 'Verification: offline retinal screening' }, actorForRun)
    await ideaIntelligenceService.execute(created.id, actorForRun)
    console.log(`  created run ${created.id}`)
  }

  const run = await prisma.ideaIntelligenceRun.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  })
  if (!run) {
    const [totalRuns, publicProjects, fundingCalls] = await Promise.all([
      prisma.ideaIntelligenceRun.count(),
      prisma.publicProject.count(),
      prisma.fundingCall.count(),
    ])
    console.log(`\nNo completed idea-intelligence run in this database (${totalRuns} run(s) total).`)
    console.log(`Corpus available: ${publicProjects} sanctioned projects, ${fundingCalls} funding calls.`)
    console.log('Run an analysis from /funding/intelligence/idea/new, then re-run this script.')
    await prisma.$disconnect()
    return
  }

  const retrieval = (run.retrievalResultsJson || {}) as any
  const report = (run.reportJson || {}) as any
  const scores = (run.scoresJson || {}) as any
  const isNewRun = Boolean(retrieval.sourcesUsed)

  console.log(`\nRun ${run.id} — "${run.title?.slice(0, 70)}"`)
  console.log(`  created ${run.createdAt.toISOString()}, anchored call: ${run.anchorFundingCallId || 'none'}`)
  console.log(`  sourcesUsed: ${isNewRun ? JSON.stringify(retrieval.sourcesUsed) : '(legacy run — field absent)'}`)
  console.log(`  projects=${retrieval.projects?.length || 0} publications=${retrieval.publications?.length || 0} patents=${retrieval.patents?.length || 0} web=${retrieval.webResults?.length || 0} calls=${retrieval.fundingCalls?.length || 0}`)

  console.log('\nPhase A — the review must not attach a call')
  if (!isNewRun) {
    console.log('  SKIP  This run predates the change; re-run an analysis to check Phase A.')
  } else if (run.anchorFundingCallId) {
    console.log('  SKIP  This run anchored a call on purpose, so a call fit is expected.')
  } else if (report.targetFundingCallId) {
    console.log('  SKIP  A call has since been chosen through the funding-match step, so the run now carries one by design.')
  } else {
    assert(!retrieval.fundingCalls?.length, `Review retrieved ${retrieval.fundingCalls?.length} calls but none was requested`)
    ok('no funding call retrieved')
    assert(!(scores.callAlignments || []).length, 'Review produced call alignments without a chosen call')
    ok('no call alignment scored')
    assert(!(report.callGaps || []).length, 'Review produced a gap report without a chosen call')
    ok('no gap report')
    assert(!retrieval.publications?.length && !retrieval.patents?.length && !retrieval.webResults?.length,
      'External evidence was retrieved while the corpora are switched off')
    ok('publications, patents and web are off')
    assert(retrieval.projects?.length >= 0, 'Sanctioned project retrieval is missing')
    ok(`sanctioned corpus still read (${retrieval.projects?.length || 0} projects)`)
    if (!retrieval.projects?.length) {
      // Nothing retrieved is a corpus/retrieval problem, not a funding-match one,
      // but it makes every later step read as "no evidence" — so name it here.
      const [total, embedded] = await Promise.all([
        prisma.publicProject.count(),
        prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM public_projects WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL`,
      ])
      console.log(`  WARN  0 sanctioned projects retrieved for this idea. Corpus has ${total} projects, ${embedded[0]?.count ?? 0} with embeddings.`)
      console.log(`        Query used: "${(run.structuredIdeaJson as any)?.semanticQuery?.slice(0, 120)}"`)
      const sample = await prisma.publicProject.findMany({ take: 8, select: { title: true, sourceKey: true, schemeName: true } })
      console.log('        Corpus sample:')
      for (const project of sample) console.log(`          - [${project.sourceKey}/${project.schemeName || '?'}] ${project.title?.slice(0, 90)}`)
    }
  }

  const actor = {
    userId: run.userId,
    tenantId: run.tenantId,
    access: { tenantId: run.tenantId, isSuperAdmin: false },
  }

  console.log('\nPhase B step 1 — open calls from the catalogue, matched to the idea')
  const { fundingMatch: match } = await ideaIntelligenceService.matchCallsForIdea(run.id, actor)
  ok(`${match.calls.length} calls (rankedSemantically=${match.rankedSemantically}, lowConfidence=${match.lowConfidence})`)
  for (const call of match.calls.slice(0, 5)) {
    console.log(`        - ${call.schemeTitle} (${Math.round(call.score * 100)}%)`)
  }
  assert(match.calls.every((call) => call.agencyName), 'A matched call is missing its funder name')
  if (!match.calls.length) {
    // Nothing matched: show what the catalogue does hold, so it is clear whether
    // this is a matching bug or simply an empty catalogue.
    // Mirrors the published/active filter the service applies for a non-super-admin.
    const catalogue = await prisma.fundingCall.findMany({
      where: {
        visibility: 'GLOBAL_PUBLISHED',
        is_active: { not: false },
        OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }],
      },
      select: { id: true, agency_name: true, agencyName: true, scheme_title: true, title: true, close_date: true },
      take: 25,
    })
    console.log(`  INFO  catalogue holds ${catalogue.length} accessible call(s):`)
    for (const call of catalogue) {
      console.log(`          - ${call.id}  [${call.agency_name || call.agencyName || '?'}] ${(call.scheme_title || call.title || '').slice(0, 60)}`)
    }
  }

  if (!WITH_CALL_FIT) {
    console.log('\nPhase B step 2 — skipped (costs an LLM call). Re-run with --with-call-fit to exercise it.')
    await prisma.$disconnect()
    return
  }

  // --call-id lets step 2 be exercised on a catalogue where nothing matched.
  const callIdArg = process.argv.find((arg) => arg.startsWith('--call-id='))?.slice('--call-id='.length)
  const targetCall = callIdArg
    ? match.calls.find((call) => call.id === callIdArg) || { id: callIdArg, schemeTitle: `(catalogue call ${callIdArg})` }
    : match.calls[0]
  if (!targetCall) {
    console.log('\nPhase B step 2 — skipped, the catalogue has no open call to check against. Pass --call-id=<id> to force one.')
    await prisma.$disconnect()
    return
  }
  console.log(`\nPhase B step 2 — reading the idea against "${targetCall.schemeTitle}"`)
  const updated = await ideaIntelligenceService.evaluateAgainstCall(run.id, targetCall.id, actor)
  const updatedReport = (updated.report || {}) as any
  const updatedScores = (updated.scores || {}) as any
  assert(updatedReport.targetFundingCallId === targetCall.id, 'The chosen call was not recorded as the target')
  ok('target call recorded')
  assert((updatedScores.callAlignments || []).length === 1, 'Expected exactly one call alignment')
  ok(`alignment ${updatedScores.callAlignments[0].alignment}% over ${updatedScores.callAlignments[0].assessedFacets} assessed facets`)
  assert((updatedReport.callGaps || []).length > 0, 'Expected a gap report for the chosen call')
  ok(`${updatedReport.callGaps.length} gaps`)
  console.log(`  INFO  reviewer panel: ${(updatedReport.reviewerPanel || []).length} personas`)
  assert((updated.retrievalResults as any)?.fundingCalls?.some((call: any) => call.id === targetCall.id),
    'The chosen call was not added to the retrieval payload the UI reads')
  ok('chosen call is resolvable by the workspace')

  await prisma.$disconnect()
}

main()
  .then(() => console.log('\nDone.'))
  .catch((error) => { console.error('\nFAILED:', error); process.exit(1) })
