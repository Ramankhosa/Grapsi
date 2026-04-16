import { afterEach, describe, expect, it } from 'vitest'

import { POST as archiveFundingCallRoute } from '@/app/api/super-admin/funding/calls/[callId]/archive/route'
import { POST as publishFundingCallRoute } from '@/app/api/super-admin/funding/calls/[callId]/publish/route'
import { GET as getFundingCallRoute } from '@/app/api/funding/calls/[callId]/route'
import { GET as listFundingCallsRoute } from '@/app/api/funding/calls/route'
import { GET as getFundingImportJobRoute } from '@/app/api/funding/imports/[jobId]/route'
import { POST as resolveDuplicateRoute } from '@/app/api/funding/imports/[jobId]/resolve-duplicate/route'
import { POST as retryFundingImportRoute } from '@/app/api/funding/imports/[jobId]/retry/route'
import { GET as listFundingImportsRoute, POST as createFundingImportRoute } from '@/app/api/funding/imports/route'
import { prisma } from '@/lib/prisma'
import {
  createJsonRequest,
  createMultipartRequest,
  createTenant,
  createUser,
  issueAccessToken,
  resetPhase1Data,
} from '@/tests/integration/helpers/phase1-test-helpers'
import {
  createFundingDocxFile,
  createFundingHtmlFile,
  createFundingPdfFile,
  createFundingTextFile,
  startFundingFixtureServer,
} from '@/tests/integration/helpers/phase2-funding-fixtures'

afterEach(async () => {
  await resetPhase1Data()
})

function tokenFor(user: { id: string; email: string; roles: string[]; tenantId: string | null }, tenantAtiId?: string | null) {
  return issueAccessToken({
    userId: user.id,
    email: user.email,
    roles: user.roles,
    tenantId: user.tenantId,
    tenantAtiId,
  })
}

async function createTenantAnalyst(prefix: string) {
  const tenant = await createTenant(prefix)
  const user = await createUser({
    tenantId: tenant.id,
    emailPrefix: `${prefix}-analyst`,
    roles: ['ANALYST'],
  })

  return { tenant, user, token: tokenFor(user, tenant.atiId) }
}

describe('Funding ingestion real DB integration', () => {
  it('tenant-private URL import creates a published tenant funding call and import assets', async () => {
    const fixture = await createTenantAnalyst('phase2-url-import')
    const server = await startFundingFixtureServer()

    try {
      const response = await createFundingImportRoute(
        createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
          inputType: 'url',
          visibility: 'TENANT_PRIVATE',
          sourceUrl: server.url,
        })
      )
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.job.status).toBe('COMPLETED')
      expect(body.job.outcome).toBe('CREATED')

      const fundingCall = await prisma.fundingCall.findUnique({
        where: { id: body.job.resultFundingCallId },
      })

      expect(fundingCall?.tenantId).toBe(fixture.tenant.id)
      expect(fundingCall?.status).toBe('PUBLISHED')
      expect(fundingCall?.title?.toLowerCase()).toContain('community climate action fund')

      const assets = await prisma.fundingImportAsset.findMany({
        where: { jobId: body.job.id },
        orderBy: { createdAt: 'asc' },
      })

      expect(assets.some((asset) => asset.kind === 'FETCHED_SOURCE')).toBe(true)
      expect(assets.some((asset) => asset.kind === 'NORMALIZED_TEXT')).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('pasted text import creates a tenant-scoped funding call', async () => {
    const fixture = await createTenantAnalyst('phase2-text-import')

    const response = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
        inputType: 'text',
        visibility: 'TENANT_PRIVATE',
        rawText: [
          'Rural Innovation Challenge 2026',
          'Agency: State Research Council',
          'Funding Opportunity Number: SRC-RIC-2026',
          'Deadline: September 20, 2026',
          '',
          'This grant funds pilot programs that improve rural health delivery and digital access.',
        ].join('\n'),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.job.status).toBe('COMPLETED')

    const call = await prisma.fundingCall.findUnique({ where: { id: body.job.resultFundingCallId } })
    expect(call?.tenantId).toBe(fixture.tenant.id)
    expect(call?.title?.toLowerCase()).toContain('rural innovation challenge 2026')
  }, 60000)

  it('file imports support txt, html, docx, and pdf and persist source assets', async () => {
    const fixture = await createTenantAnalyst('phase2-file-import')
    const files = [
      createFundingTextFile(),
      createFundingHtmlFile(),
      await createFundingDocxFile(),
      await createFundingPdfFile(),
    ]

    for (const file of files) {
      const response = await createFundingImportRoute(
        createMultipartRequest({
          path: '/api/funding/imports',
          token: fixture.token,
          fields: {
            inputType: 'file',
            visibility: 'TENANT_PRIVATE',
          },
          file,
        })
      )
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.job.status).toBe('COMPLETED')

      const assets = await prisma.fundingImportAsset.findMany({
        where: { jobId: body.job.id },
      })

      expect(assets.some((asset) => asset.kind === 'UPLOADED_FILE')).toBe(true)
      expect(assets.some((asset) => asset.kind === 'NORMALIZED_TEXT')).toBe(true)
    }
  }, 120000)

  it('invalid funding import payload returns 400', async () => {
    const fixture = await createTenantAnalyst('phase2-invalid-import')

    const response = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
        inputType: 'url',
        visibility: 'TENANT_PRIVATE',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('SOURCE_URL_REQUIRED')
  })

  it('user without funding discovery role access is rejected', async () => {
    const tenant = await createTenant('phase2-viewer-tenant')
    const viewer = await createUser({
      tenantId: tenant.id,
      emailPrefix: 'phase2-viewer',
      roles: ['VIEWER'],
    })
    const token = tokenFor(viewer, tenant.atiId)

    const response = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', token, 'POST', {
        inputType: 'text',
        visibility: 'TENANT_PRIVATE',
        rawText: 'Funding call body',
      })
    )

    expect(response.status).toBe(403)
  })

  it('super admin global import lands in READY_FOR_REVIEW and not PUBLISHED', async () => {
    const superAdmin = await createUser({
      tenantId: null,
      emailPrefix: 'phase2-superadmin',
      roles: ['SUPER_ADMIN'],
    })
    const token = tokenFor(superAdmin)

    const response = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', token, 'POST', {
        inputType: 'text',
        visibility: 'GLOBAL_PUBLISHED',
        rawText: [
          'Global Health Acceleration Fund',
          'Agency: International Health Consortium',
          'Funding Opportunity Number: IHC-GLOBAL-2026',
          'Deadline: October 12, 2026',
          '',
          'This global fund supports scalable public health pilots and implementation research.',
        ].join('\n'),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    const call = await prisma.fundingCall.findUnique({ where: { id: body.job.resultFundingCallId } })
    expect(call?.tenantId).toBeNull()
    expect(call?.status).toBe('READY_FOR_REVIEW')
    expect(call?.publishedAt).toBeNull()
  })

  it('exact duplicate URL auto-reuses an existing funding call', async () => {
    const fixture = await createTenantAnalyst('phase2-duplicate-url')
    const server = await startFundingFixtureServer()

    try {
      const existing = await prisma.fundingCall.create({
        data: {
          tenantId: fixture.tenant.id,
          visibility: 'TENANT_PRIVATE',
          status: 'PUBLISHED',
          title: 'Community Climate Action Fund',
          agencyName: 'Global Resilience Council',
          sourceUrl: server.url,
          sourceDomain: '127.0.0.1',
          sourceFingerprint: 'existing-fingerprint',
          summary: 'Existing call',
          sourceType: 'URL',
          createdByUserId: fixture.user.id,
          updatedByUserId: fixture.user.id,
        },
      })

      const response = await createFundingImportRoute(
        createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
          inputType: 'url',
          visibility: 'TENANT_PRIVATE',
          sourceUrl: server.url,
        })
      )
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.job.outcome).toBe('REUSED_EXISTING')
      expect(body.job.resultFundingCallId).toBe(existing.id)
    } finally {
      await server.close()
    }
  })

  it('ambiguous duplicate match moves the job to NEEDS_REVIEW and can be resolved to an existing call', async () => {
    const fixture = await createTenantAnalyst('phase2-duplicate-review')
    const existing = await prisma.fundingCall.create({
      data: {
        tenantId: fixture.tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: 'Climate Resilience Innovation Grant',
        agencyName: 'Urban Futures Agency',
        sourceUrl: 'https://example.com/original-call',
        sourceDomain: 'example.com',
        programIdentifier: 'UFA-CLIMATE-2026',
        summary: 'Original funding call',
        deadlineAt: new Date('2026-11-30T00:00:00.000Z'),
        sourceType: 'URL',
        createdByUserId: fixture.user.id,
        updatedByUserId: fixture.user.id,
      },
    })

    const createResponse = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
        inputType: 'text',
        visibility: 'TENANT_PRIVATE',
        rawText: [
          'Climate Resilience Innovation Grant',
          'Agency: Urban Futures Agency',
          'Deadline: November 30, 2026',
          '',
          'This import intentionally matches title, agency, and deadline but omits the exact URL and program identifier.',
        ].join('\n'),
      })
    )
    const createBody = await createResponse.json()

    expect(createResponse.status).toBe(202)
    expect(createBody.job.status).toBe('NEEDS_REVIEW')
    expect(createBody.job.duplicateCandidates).toHaveLength(1)

    const resolveResponse = await resolveDuplicateRoute(
      createJsonRequest(
        `/api/funding/imports/${createBody.job.id}/resolve-duplicate`,
        fixture.token,
        'POST',
        {
          resolution: 'reuse_existing',
          fundingCallId: existing.id,
        }
      ),
      { params: { jobId: createBody.job.id } }
    )
    const resolveBody = await resolveResponse.json()

    expect(resolveResponse.status).toBe(200)
    expect(resolveBody.job.status).toBe('COMPLETED')
    expect(resolveBody.job.resultFundingCallId).toBe(existing.id)
  })

  it('retry reruns failed jobs and leaves already-completed jobs alone', async () => {
    const fixture = await createTenantAnalyst('phase2-retry')
    const server = await startFundingFixtureServer()

    try {
      const failedCreateResponse = await createFundingImportRoute(
        createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
          inputType: 'url',
          visibility: 'TENANT_PRIVATE',
          sourceUrl: 'http://127.0.0.1:9/unreachable-call.html',
        })
      )
      const failedBody = await failedCreateResponse.json()

      expect(failedCreateResponse.status).toBe(201)
      expect(failedBody.job.status).toBe('FAILED')

      await prisma.fundingImportJob.update({
        where: { id: failedBody.job.id },
        data: {
          sourceLocator: server.url,
          rawPayload: { sourceUrl: server.url, visibility: 'TENANT_PRIVATE' },
        },
      })

      const retryResponse = await retryFundingImportRoute(
        createJsonRequest(`/api/funding/imports/${failedBody.job.id}/retry`, fixture.token, 'POST'),
        { params: { jobId: failedBody.job.id } }
      )
      const retryBody = await retryResponse.json()

      expect(retryResponse.status).toBe(200)
      expect(retryBody.job.status).toBe('COMPLETED')

      const secondRetryResponse = await retryFundingImportRoute(
        createJsonRequest(`/api/funding/imports/${failedBody.job.id}/retry`, fixture.token, 'POST'),
        { params: { jobId: failedBody.job.id } }
      )

      expect(secondRetryResponse.status).toBe(409)
    } finally {
      await server.close()
    }
  })

  it('GET funding lists respect tenant visibility', async () => {
    const tenantFixture = await createTenantAnalyst('phase2-call-list-a')
    const otherTenant = await createTenant('phase2-call-list-b')
    const otherUser = await createUser({
      tenantId: otherTenant.id,
      emailPrefix: 'phase2-call-list-b-user',
      roles: ['ANALYST'],
    })

    const globalCall = await prisma.fundingCall.create({
      data: {
        visibility: 'GLOBAL_PUBLISHED',
        status: 'PUBLISHED',
        title: 'Global Visible Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/global-visible',
        createdByUserId: tenantFixture.user.id,
        updatedByUserId: tenantFixture.user.id,
      },
    })
    const tenantCall = await prisma.fundingCall.create({
      data: {
        tenantId: tenantFixture.tenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: 'Tenant Visible Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/tenant-visible',
        createdByUserId: tenantFixture.user.id,
        updatedByUserId: tenantFixture.user.id,
      },
    })
    await prisma.fundingCall.create({
      data: {
        tenantId: otherTenant.id,
        visibility: 'TENANT_PRIVATE',
        status: 'PUBLISHED',
        title: 'Foreign Tenant Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/tenant-hidden',
        createdByUserId: otherUser.id,
        updatedByUserId: otherUser.id,
      },
    })
    await prisma.fundingCall.create({
      data: {
        visibility: 'GLOBAL_PUBLISHED',
        status: 'READY_FOR_REVIEW',
        title: 'Global Hidden Review Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/global-review',
        createdByUserId: tenantFixture.user.id,
        updatedByUserId: tenantFixture.user.id,
      },
    })

    const callsResponse = await listFundingCallsRoute(createJsonRequest('/api/funding/calls', tenantFixture.token, 'GET'))
    const callsBody = await callsResponse.json()

    expect(callsResponse.status).toBe(200)
    expect(callsBody.calls.some((call: any) => call.id === globalCall.id)).toBe(true)
    expect(callsBody.calls.some((call: any) => call.id === tenantCall.id)).toBe(true)
    expect(callsBody.calls.some((call: any) => call.title === 'Foreign Tenant Call')).toBe(false)
    expect(callsBody.calls.some((call: any) => call.title === 'Global Hidden Review Call')).toBe(false)
  })

  it('super-admin publish and archive endpoints enforce role checks', async () => {
    const superAdmin = await createUser({
      tenantId: null,
      emailPrefix: 'phase2-superadmin-moderator',
      roles: ['SUPER_ADMIN'],
    })
    const superAdminViewer = await createUser({
      tenantId: null,
      emailPrefix: 'phase2-superadmin-viewer',
      roles: ['SUPER_ADMIN_VIEWER'],
    })

    const call = await prisma.fundingCall.create({
      data: {
        visibility: 'GLOBAL_PUBLISHED',
        status: 'READY_FOR_REVIEW',
        title: 'Moderation Target Call',
        sourceType: 'URL',
        sourceUrl: 'https://example.com/moderation-target',
        createdByUserId: superAdmin.id,
        updatedByUserId: superAdmin.id,
      },
    })

    const viewerPublishResponse = await publishFundingCallRoute(
      createJsonRequest(`/api/super-admin/funding/calls/${call.id}/publish`, tokenFor(superAdminViewer), 'POST'),
      { params: { callId: call.id } }
    )
    expect(viewerPublishResponse.status).toBe(403)

    const publishResponse = await publishFundingCallRoute(
      createJsonRequest(`/api/super-admin/funding/calls/${call.id}/publish`, tokenFor(superAdmin), 'POST'),
      { params: { callId: call.id } }
    )
    expect(publishResponse.status).toBe(200)

    const archiveResponse = await archiveFundingCallRoute(
      createJsonRequest(`/api/super-admin/funding/calls/${call.id}/archive`, tokenFor(superAdmin), 'POST'),
      { params: { callId: call.id } }
    )
    expect(archiveResponse.status).toBe(200)

    const updated = await prisma.fundingCall.findUnique({ where: { id: call.id } })
    expect(updated?.status).toBe('ARCHIVED')
  })

  it('funding import detail route returns persisted normalized facts and assets', async () => {
    const fixture = await createTenantAnalyst('phase2-job-detail')

    const createResponse = await createFundingImportRoute(
      createJsonRequest('/api/funding/imports', fixture.token, 'POST', {
        inputType: 'text',
        visibility: 'TENANT_PRIVATE',
        rawText: [
          'Digital Equity Growth Fund',
          'Agency: Civic Access Lab',
          'Deadline: December 1, 2026',
          '',
          'Supports digital inclusion pilots for underserved districts.',
        ].join('\n'),
      })
    )
    const createBody = await createResponse.json()

    const detailResponse = await getFundingImportJobRoute(
      createJsonRequest(`/api/funding/imports/${createBody.job.id}`, fixture.token, 'GET'),
      { params: { jobId: createBody.job.id } }
    )
    const detailBody = await detailResponse.json()

    expect(detailResponse.status).toBe(200)
    expect(detailBody.job.normalizedFacts.title).toContain('Digital Equity Growth Fund')
    expect(detailBody.job.assets.length).toBeGreaterThan(0)

    const callDetailResponse = await getFundingCallRoute(
      createJsonRequest(`/api/funding/calls/${createBody.job.resultFundingCallId}`, fixture.token, 'GET'),
      { params: { callId: createBody.job.resultFundingCallId } }
    )
    const callDetailBody = await callDetailResponse.json()

    expect(callDetailResponse.status).toBe(200)
    expect(callDetailBody.call.assets.length).toBeGreaterThan(0)

    const listJobsResponse = await listFundingImportsRoute(createJsonRequest('/api/funding/imports', fixture.token, 'GET'))
    expect(listJobsResponse.status).toBe(200)
  })
})
