import dotenv from 'dotenv'
import { pathToFileURL } from 'url'

dotenv.config({ path: '.env', override: false })
dotenv.config({ path: '.env.local', override: false })
dotenv.config({ path: '.env.override', override: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function readJson(response: Response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Could not parse JSON response (${response.status}): ${text}`)
  }
}

async function main() {
  const [
    { generateJWT },
    { NextRequest },
    seedModule,
    startGrantPrepRoute,
    grantDetailRoute,
    grantPrepMessageRoute,
  ] = await Promise.all([
    import('../src/lib/auth'),
    import('next/server'),
    import('./seed-funding-finder-verification'),
    import('../src/app/api/funding/calls/[callId]/start-grant-prep/route'),
    import('../src/app/api/projects/[projectId]/grants/[grantId]/route'),
    import('../src/app/api/grant-prep/sessions/[id]/message/route'),
  ])

  const seeded = await seedModule.seedFundingFinderVerificationData()
  const primaryCall =
    seeded.seededCalls.find((call: { scheme_title: string }) => call.scheme_title === seedModule.FINDER_EXPECTED_PRIMARY_TITLE) ||
    seeded.seededCalls[0]

  assert(primaryCall?.id, 'No seeded funding call was available for grant-launch verification')

  const token = generateJWT({
    sub: seeded.userId,
    email: seeded.userEmail,
    tenant_id: seeded.tenantId,
    roles: ['ANALYST'],
    ati_id: null,
    tenant_ati_id: seedModule.FINDER_VERIFICATION_TENANT_ATI,
    scope: 'tenant',
  })

  const authHeaders = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }

  const startRequest = new NextRequest(`http://localhost/api/funding/calls/${primaryCall.id}/start-grant-prep`, {
    method: 'POST',
    headers: new Headers(authHeaders),
    body: JSON.stringify({ engagementMode: 'guided' }),
  })
  const startResponse = await startGrantPrepRoute.POST(startRequest, {
    params: Promise.resolve({ callId: primaryCall.id }),
  })
  const startBody = await readJson(startResponse)

  assert(startResponse.status === 201, `Grant launch route failed: ${JSON.stringify(startBody)}`)
  assert(startBody.project?.projectType === 'GRANT', `Grant launch created the wrong project type: ${JSON.stringify(startBody)}`)
  assert(
    startBody.launchUrl === `/projects/${startBody.project.id}/grants/${startBody.session.id}/prep`,
    `Grant launch returned an unexpected prep URL: ${startBody.launchUrl}`
  )

  const grantDetailRequest = new NextRequest(
    `http://localhost/api/projects/${startBody.project.id}/grants/${startBody.session.id}`,
    {
      method: 'GET',
      headers: new Headers({
        authorization: `Bearer ${token}`,
      }),
    }
  )
  const grantDetailResponse = await grantDetailRoute.GET(grantDetailRequest, {
    params: Promise.resolve({ projectId: startBody.project.id, grantId: startBody.session.id }),
  })
  const grantDetailBody = await readJson(grantDetailResponse)

  assert(grantDetailResponse.status === 200, `Grant session load failed: ${JSON.stringify(grantDetailBody)}`)
  assert(grantDetailBody.session?.id === startBody.session.id, 'Loaded grant prep session did not match the launched session')
  assert(
    grantDetailBody.fundingContext?.title,
    `Grant prep session did not resolve funding context: ${JSON.stringify(grantDetailBody)}`
  )

  const messageRequest = new NextRequest(
    `http://localhost/api/grant-prep/sessions/${startBody.session.id}/message`,
    {
      method: 'POST',
      headers: new Headers(authHeaders),
      body: JSON.stringify({
        content: 'We are proposing explainable AI tools for radiology triage in Indian hospitals. Help me frame the project significance clearly.',
        clientMessageId: 'grant-launch-verification-turn-1',
      }),
    }
  )
  const messageResponse = await grantPrepMessageRoute.POST(messageRequest, {
    params: Promise.resolve({ id: startBody.session.id }),
  })
  const messageBody = await readJson(messageResponse)

  assert(messageResponse.status === 200, `Grant prep message failed: ${JSON.stringify(messageBody)}`)
  assert(messageBody.message?.role === 'assistant', `Grant prep did not return an assistant reply: ${JSON.stringify(messageBody)}`)
  assert(
    typeof messageBody.message?.content === 'string' && messageBody.message.content.trim().length > 0,
    'Grant prep assistant reply was empty'
  )

  console.log(
    JSON.stringify(
      {
        fundingCallId: primaryCall.id,
        fundingCallTitle: primaryCall.scheme_title,
        projectId: startBody.project.id,
        projectType: startBody.project.projectType,
        prepSessionId: startBody.session.id,
        launchUrl: startBody.launchUrl,
        fundingContextTitle: grantDetailBody.fundingContext.title,
        prepReplyPreview: messageBody.message.content.slice(0, 300),
      },
      null,
      2
    )
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
