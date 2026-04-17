import { POST as createFundingImportRoute } from "./src/app/api/funding/imports/route"
import { POST as fundingImportDecisionRoute } from "./src/app/api/funding/import/[id]/decision/route"
import { GET as getFundingImportJobRoute } from "./src/app/api/funding/imports/[jobId]/route"
import { createJsonRequest, createTenant, createUser, issueAccessToken } from "./src/tests/integration/helpers/phase1-test-helpers"

function tokenFor(user: { id: string; email: string; roles: string[]; tenantId: string | null }, tenantAtiId?: string | null) {
  return issueAccessToken({ userId: user.id, email: user.email, roles: user.roles, tenantId: user.tenantId, tenantAtiId })
}

async function waitForFundingImportJob(jobId: string, token: string, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let lastBody: any = null
  while (Date.now() < deadline) {
    const response = await getFundingImportJobRoute(createJsonRequest(`/api/funding/imports/${jobId}`, token, 'GET'), { params: { jobId } })
    const body = await response.json()
    lastBody = body
    if (body?.job?.status === 'NEEDS_REVIEW' || body?.job?.status === 'COMPLETED' || body?.job?.status === 'FAILED') {
      return body.job
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`timeout ${JSON.stringify(lastBody)}`)
}

async function main() {
  const tenant = await createTenant(`debug-grant-draft-${Date.now()}`)
  const user = await createUser({ tenantId: tenant.id, emailPrefix: `debug-analyst-${Date.now()}`, roles: ['ANALYST'] })
  const token = tokenFor(user, tenant.atiId)

  const createResponse = await createFundingImportRoute(createJsonRequest('/api/funding/imports', token, 'POST', {
    inputType: 'text',
    visibility: 'TENANT_PRIVATE',
    rawText: ['Digital Equity Growth Fund','Agency: Civic Access Lab','Deadline: December 1, 2026','','Supports digital inclusion pilots for underserved districts.'].join('\n')
  }))
  const createBody = await createResponse.json()
  console.log('create', createResponse.status, JSON.stringify(createBody, null, 2))

  const job = await waitForFundingImportJob(createBody.job.id, token)
  console.log('job', JSON.stringify(job, null, 2))

  const decisionResponse = await fundingImportDecisionRoute(
    createJsonRequest(`/api/funding/import/${createBody.job.id}/decision`, token, 'POST', { action: 'create_private_draft' }),
    { params: { id: createBody.job.id } }
  )
  const decisionBody = await decisionResponse.json()
  console.log('decision', decisionResponse.status, JSON.stringify(decisionBody, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
