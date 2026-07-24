/**
 * Verifies the streamlined grant route end to end against the dev database:
 *   chatbot entry -> Draft Zero -> (literature) -> (deep analysis) -> drafting.
 *
 * Confined to the throwaway finder-verification tenant. No LLM drafting calls.
 * Run with: npx tsx scripts/verify-streamlined-grant-pipeline.ts
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env', override: false })
dotenv.config({ path: '.env.local', override: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

async function readJson(response: Response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Could not parse JSON (${response.status}): ${text.slice(0, 400)}`)
  }
}

const checks: string[] = []
function pass(label: string) {
  checks.push(label)
  console.log(`  PASS  ${label}`)
}

async function main() {
  const [
    { generateJWT },
    { NextRequest },
    { prisma },
    seedModule,
    startGrantPrepRoute,
    handoffRoute,
    blueprintRoute,
  ] = await Promise.all([
    import('../src/lib/auth'),
    import('next/server'),
    import('../src/lib/prisma'),
    import('./seed-funding-finder-verification'),
    import('../src/app/api/funding/calls/[callId]/start-grant-prep/route'),
    import('../src/app/api/grant-prep/sessions/[id]/handoff/route'),
    import('../src/app/api/projects/[projectId]/grants/[grantId]/blueprint/route'),
  ])

  const seeded = await seedModule.seedFundingFinderVerificationData()
  const call =
    seeded.seededCalls.find((c: { scheme_title: string }) => c.scheme_title === seedModule.FINDER_EXPECTED_PRIMARY_TITLE)
    || seeded.seededCalls[0]
  assert(call?.id, 'no seeded funding call available')

  const token = generateJWT({
    sub: seeded.userId,
    email: seeded.userEmail,
    tenant_id: seeded.tenantId,
    roles: ['ANALYST'],
    ati_id: null,
    tenant_ati_id: seedModule.FINDER_VERIFICATION_TENANT_ATI,
    scope: 'tenant',
  })
  const headers = () => new Headers({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })

  async function startGrant() {
    const response = await startGrantPrepRoute.POST(
      new NextRequest(`http://localhost/api/funding/calls/${call.id}/start-grant-prep`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ engagementMode: 'guided' }),
      }),
      { params: Promise.resolve({ callId: call.id }) }
    )
    const body = await readJson(response)
    assert(response.status === 201, `start-grant-prep failed: ${JSON.stringify(body).slice(0, 400)}`)
    return body
  }

  async function launch(prepSessionId: string, pipeline: unknown) {
    const response = await handoffRoute.POST(
      new NextRequest(`http://localhost/api/grant-prep/sessions/${prepSessionId}/handoff`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ pipeline }),
      }),
      { params: Promise.resolve({ id: prepSessionId }) }
    )
    const body = await readJson(response)
    assert(response.status === 200, `handoff failed: ${JSON.stringify(body).slice(0, 600)}`)
    return body
  }

  // ---- 1. Chatbot entry lands on Draft Zero, not the GrantMentor chat -------
  const first = await startGrant()
  assert(
    typeof first.launchUrl === 'string' && first.launchUrl.endsWith('/draft-zero'),
    `entry launchUrl should point at Draft Zero, got: ${first.launchUrl}`
  )
  pass(`chatbot entry -> ${first.launchUrl}`)

  // ---- 2. Launch with both evidence stages ---------------------------------
  const bothOn = await launch(first.session.id, { literatureSearch: true, deepAnalysis: true })
  assert(
    String(bothOn.launchUrl).includes('stage=LITERATURE_SEARCH'),
    `both-on launch should enter literature search, got: ${bothOn.launchUrl}`
  )
  assert(
    bothOn.pipeline?.literatureSearch === true && bothOn.pipeline?.deepAnalysis === true,
    `handoff should echo the chosen route, got: ${JSON.stringify(bothOn.pipeline)}`
  )
  pass(`launch (lit + deep) -> ${bothOn.launchUrl}`)

  // ---- 3. Blueprint is committed at launch (this is the bypass) ------------
  const grantBlueprint = await prisma.grantBlueprint.findUnique({
    where: { grantSessionId: bothOn.grantSessionId },
    select: { status: true, frozenAt: true, freezePayloadJson: true },
  })
  assert(grantBlueprint?.status === 'FROZEN', `grant blueprint should be FROZEN, got: ${grantBlueprint?.status}`)
  assert(grantBlueprint?.frozenAt, 'grant blueprint frozenAt should be set')
  pass('grant blueprint committed as FROZEN at launch')

  const grantSession = await prisma.grantSession.findUnique({
    where: { id: bothOn.grantSessionId },
    select: { status: true, draftingSessionId: true },
  })
  assert(grantSession?.status === 'DRAFTING', `grant session should be DRAFTING, got: ${grantSession?.status}`)
  assert(grantSession?.draftingSessionId, 'shadow drafting session should exist')

  const shadowBlueprint = await prisma.paperBlueprint.findUnique({
    where: { sessionId: grantSession!.draftingSessionId! },
    select: { status: true, frozenAt: true, thesisStatement: true, centralObjective: true, keyContributions: true },
  })
  assert(shadowBlueprint?.status === 'FROZEN', `shadow paper blueprint should be FROZEN, got: ${shadowBlueprint?.status}`)
  pass('shadow paper blueprint committed as FROZEN')

  // The freeze rules the interactive path would have linted.
  assert(
    (shadowBlueprint?.thesisStatement || '').trim().length >= 20,
    `thesis too short to freeze: "${shadowBlueprint?.thesisStatement}"`
  )
  assert(
    (shadowBlueprint?.centralObjective || '').trim().length >= 20,
    `objective too short to freeze: "${shadowBlueprint?.centralObjective}"`
  )
  assert(
    (shadowBlueprint?.keyContributions || []).length >= 2,
    `needs >= 2 key contributions, got ${(shadowBlueprint?.keyContributions || []).length}`
  )
  pass('foundation satisfies the freeze rules (thesis, objective, >=2 contributions)')

  // ---- 4. Pipeline persisted with no migration, surfaced by the GET --------
  const payload = grantBlueprint!.freezePayloadJson as Record<string, unknown>
  // Compare fields, not stringified JSON — jsonb does not preserve key order.
  const storedPipeline = payload.pipeline as { literatureSearch?: boolean; deepAnalysis?: boolean } | undefined
  assert(
    storedPipeline?.literatureSearch === true && storedPipeline?.deepAnalysis === true,
    `pipeline should round-trip through freezePayloadJson, got: ${JSON.stringify(payload.pipeline)}`
  )
  pass('pipeline persisted in freezePayloadJson (no migration)')

  const blueprintResponse = await blueprintRoute.GET(
    new NextRequest(
      `http://localhost/api/projects/${first.project.id}/grants/${bothOn.grantSessionId}/blueprint`,
      { method: 'GET', headers: headers() }
    ),
    { params: Promise.resolve({ projectId: first.project.id, grantId: bothOn.grantSessionId }) }
  )
  const blueprintBody = await readJson(blueprintResponse)
  assert(blueprintResponse.status === 200, `blueprint GET failed: ${JSON.stringify(blueprintBody).slice(0, 400)}`)
  assert(
    blueprintBody.pipeline?.literatureSearch === true && blueprintBody.pipeline?.deepAnalysis === true,
    `blueprint GET should surface the pipeline, got: ${JSON.stringify(blueprintBody.pipeline)}`
  )
  assert(blueprintBody.blueprint?.status === 'FROZEN', 'blueprint GET should report FROZEN')
  assert(
    Array.isArray(blueprintBody.blueprint?.sectionDrafts) && blueprintBody.blueprint.sectionDrafts.length > 0,
    'blueprint GET should return section drafts to write into'
  )
  pass(`blueprint GET exposes pipeline + ${blueprintBody.blueprint.sectionDrafts.length} section drafts`)

  // ---- 5. Skipping both evidence stages goes straight to drafting ----------
  const second = await startGrant()
  const bothOff = await launch(second.session.id, { literatureSearch: false, deepAnalysis: false })
  assert(
    String(bothOff.launchUrl).includes('stage=SECTION_DRAFTING'),
    `skip-both launch should enter section drafting, got: ${bothOff.launchUrl}`
  )
  pass(`launch (skip both) -> ${bothOff.launchUrl}`)

  // ---- 6. Section generation is no longer blocked by the freeze gate -------
  const { generateGrantSectionDraft } = await import(
    '../src/lib/grants/drafting'
  )
  const draftable = blueprintBody.blueprint.sectionDrafts.find(
    (section: { sectionType: string; workflowMode: string }) =>
      section.sectionType === 'budget_rows' || section.sectionType === 'table'
  )
  if (draftable) {
    try {
      await generateGrantSectionDraft({
        projectId: first.project.id,
        grantSessionId: bothOn.grantSessionId,
        tenantId: seeded.tenantId,
        sectionKey: draftable.sectionKey,
        userId: seeded.userId,
      })
      pass(`structured section "${draftable.sectionKey}" generated (freeze gate cleared)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      assert(
        !message.includes('Freeze the blueprint'),
        `structured generation still blocked by the freeze gate: ${message}`
      )
      pass(`structured section reached generation (failed later on: ${message.slice(0, 120)})`)
    }
  } else {
    console.log('  SKIP  no structured section in this template to exercise the freeze gate')
  }

  console.log(`\n${checks.length} checks passed.`)
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
