import { afterEach, describe, expect, it } from 'vitest'

import { DELETE as deleteCollaboratorRoute } from '@/app/api/projects/[projectId]/collaborators/[collaboratorId]/route'
import { POST as addCollaboratorRoute } from '@/app/api/projects/[projectId]/collaborators/route'
import { GET as getApplicantProfileRoute, POST as saveApplicantProfileRoute } from '@/app/api/projects/[projectId]/applicant-profile/route'
import { DELETE as deleteProjectRoute, GET as getProjectRoute, PATCH as updateProjectRoute } from '@/app/api/projects/[projectId]/route'
import { GET as listProjectsRoute, POST as createProjectRoute } from '@/app/api/projects/route'
import { prisma } from '@/lib/prisma'
import {
  addCollaborator,
  createJsonRequest,
  createProject,
  createRequest,
  createTenant,
  createUser,
  issueAccessToken,
  resetPhase1Data,
} from '@/tests/integration/helpers/phase1-test-helpers'

const applicantProfilePayload = {
  applicantLegalName: 'Acme Labs Pvt Ltd',
  applicantCategory: 'startup',
  applicantAddressLine1: '123 Science Park',
  applicantAddressLine2: 'Block A',
  applicantCity: 'Bangalore',
  applicantState: 'Karnataka',
  applicantCountryCode: 'IN',
  applicantPostalCode: '560001',
  correspondenceName: 'Raman Khosa',
  correspondenceEmail: 'raman@example.com',
  correspondencePhone: '+919999999999',
  correspondenceAddressLine1: '123 Science Park',
  correspondenceAddressLine2: 'Block A',
  correspondenceCity: 'Bangalore',
  correspondenceState: 'Karnataka',
  correspondenceCountryCode: 'IN',
  correspondencePostalCode: '560001',
  useAgent: false,
  agentName: '',
  agentRegistrationNo: '',
  agentEmail: '',
  agentPhone: '',
  agentAddressLine1: '',
  agentAddressLine2: '',
  agentCity: '',
  agentState: '',
  agentCountryCode: '',
  agentPostalCode: '',
  defaultJurisdiction: 'IN',
  defaultRoute: 'national',
  defaultLanguage: 'EN',
  defaultEntityStatusIn: 'startup',
} as const

async function createAccessFixture() {
  const tenant = await createTenant('Project Access Tenant')
  const owner = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-owner', roles: ['OWNER'] })
  const editor = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-editor', roles: ['ANALYST'] })
  const viewer = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-viewer', roles: ['VIEWER'] })
  const project = await createProject({ tenantId: tenant.id, userId: owner.id, name: 'Phase 1 Project' })

  const editorCollaborator = await addCollaborator({
    projectId: project.id,
    userId: editor.id,
    addedBy: owner.id,
    role: 'collaborator',
  })
  const viewerCollaborator = await addCollaborator({
    projectId: project.id,
    userId: viewer.id,
    addedBy: owner.id,
    role: 'viewer',
  })

  const foreignTenant = await createTenant('Foreign Tenant')
  const foreignUser = await createUser({ tenantId: foreignTenant.id, emailPrefix: 'phase1-foreign', roles: ['ANALYST'] })

  return {
    tenant,
    owner,
    editor,
    viewer,
    project,
    editorCollaborator,
    viewerCollaborator,
    foreignTenant,
    foreignUser,
  }
}

function tokenFor(user: { id: string; email: string; roles: string[]; tenantId: string | null }, tenantAtiId?: string | null) {
  return issueAccessToken({
    userId: user.id,
    email: user.email,
    roles: user.roles,
    tenantId: user.tenantId,
    tenantAtiId,
  })
}

afterEach(async () => {
  await resetPhase1Data()
})

describe('Project API real DB integration', () => {
  it('POST /api/projects creates a tenant-bound project for a tenant user', async () => {
    const tenant = await createTenant('Create Project Tenant')
    const user = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-create-user', roles: ['ANALYST'] })
    const token = tokenFor(user, tenant.atiId)

    const response = await createProjectRoute(
      createJsonRequest('/api/projects', token, 'POST', { name: 'Tenant Project' })
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.project.tenantId).toBe(tenant.id)
    expect(body.project.accessLevel).toBe('owner')

    const persistedProject = await prisma.project.findUnique({
      where: { id: body.project.id },
    })

    expect(persistedProject?.tenantId).toBe(tenant.id)
    expect(persistedProject?.userId).toBe(user.id)
  })

  it('POST /api/projects rejects a null-tenant user', async () => {
    const user = await createUser({ tenantId: null, emailPrefix: 'phase1-platform-user', roles: ['ANALYST'] })
    const token = tokenFor(user)

    const response = await createProjectRoute(
      createJsonRequest('/api/projects', token, 'POST', { name: 'Should Fail' })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('TENANT_REQUIRED')
  })

  it('GET /api/projects returns owned and collaborator projects with normalized access levels', async () => {
    const tenant = await createTenant('List Projects Tenant')
    const actor = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-list-actor', roles: ['ANALYST'] })
    const owner = await createUser({ tenantId: tenant.id, emailPrefix: 'phase1-list-owner', roles: ['OWNER'] })
    const actorOwnedProject = await createProject({ tenantId: tenant.id, userId: actor.id, name: 'Actor Owned Project' })
    const sharedProject = await createProject({ tenantId: tenant.id, userId: owner.id, name: 'Shared Project' })
    await addCollaborator({ projectId: sharedProject.id, userId: actor.id, addedBy: owner.id, role: 'collaborator' })

    const foreignTenant = await createTenant('List Foreign Tenant')
    const foreignOwner = await createUser({ tenantId: foreignTenant.id, emailPrefix: 'phase1-list-foreign-owner', roles: ['OWNER'] })
    await createProject({ tenantId: foreignTenant.id, userId: foreignOwner.id, name: 'Foreign Project' })

    const token = tokenFor(actor, tenant.atiId)
    const response = await listProjectsRoute(createRequest('/api/projects', token))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.projects).toHaveLength(2)

    const owned = body.projects.find((project: any) => project.id === actorOwnedProject.id)
    const shared = body.projects.find((project: any) => project.id === sharedProject.id)

    expect(owned?.accessLevel).toBe('owner')
    expect(owned?.isOwner).toBe(true)
    expect(shared?.accessLevel).toBe('editor')
    expect(shared?.isOwner).toBe(false)
    expect(body.projects.some((project: any) => project.name === 'Foreign Project')).toBe(false)
  })

  it('GET /api/projects/[projectId] allows owner, editor, and viewer but rejects foreign tenant users', async () => {
    const fixture = await createAccessFixture()

    const ownerResponse = await getProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.owner, fixture.tenant.atiId)),
      { params: { projectId: fixture.project.id } }
    )
    const editorResponse = await getProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.editor, fixture.tenant.atiId)),
      { params: { projectId: fixture.project.id } }
    )
    const viewerResponse = await getProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.viewer, fixture.tenant.atiId)),
      { params: { projectId: fixture.project.id } }
    )
    const foreignResponse = await getProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.foreignUser, fixture.foreignTenant.atiId)),
      { params: { projectId: fixture.project.id } }
    )

    expect(ownerResponse.status).toBe(200)
    expect((await ownerResponse.json()).project.accessLevel).toBe('owner')
    expect(editorResponse.status).toBe(200)
    expect((await editorResponse.json()).project.accessLevel).toBe('editor')
    expect(viewerResponse.status).toBe(200)
    expect((await viewerResponse.json()).project.accessLevel).toBe('viewer')
    expect(foreignResponse.status).toBe(404)
  })

  it('PATCH /api/projects/[projectId] only allows the owner', async () => {
    const fixture = await createAccessFixture()

    const ownerResponse = await updateProjectRoute(
      createJsonRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.owner, fixture.tenant.atiId), 'PATCH', { name: 'Renamed By Owner' }),
      { params: { projectId: fixture.project.id } }
    )
    const editorResponse = await updateProjectRoute(
      createJsonRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.editor, fixture.tenant.atiId), 'PATCH', { name: 'Editor Rename' }),
      { params: { projectId: fixture.project.id } }
    )
    const viewerResponse = await updateProjectRoute(
      createJsonRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.viewer, fixture.tenant.atiId), 'PATCH', { name: 'Viewer Rename' }),
      { params: { projectId: fixture.project.id } }
    )

    expect(ownerResponse.status).toBe(200)
    expect((await ownerResponse.json()).project.name).toBe('Renamed By Owner')
    expect(editorResponse.status).toBe(403)
    expect(viewerResponse.status).toBe(403)
  })

  it('DELETE /api/projects/[projectId] only allows the owner', async () => {
    const fixture = await createAccessFixture()

    const editorResponse = await deleteProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.editor, fixture.tenant.atiId), 'DELETE'),
      { params: { projectId: fixture.project.id } }
    )
    const viewerResponse = await deleteProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.viewer, fixture.tenant.atiId), 'DELETE'),
      { params: { projectId: fixture.project.id } }
    )

    expect(editorResponse.status).toBe(403)
    expect(viewerResponse.status).toBe(403)

    const ownerResponse = await deleteProjectRoute(
      createRequest(`/api/projects/${fixture.project.id}`, tokenFor(fixture.owner, fixture.tenant.atiId), 'DELETE'),
      { params: { projectId: fixture.project.id } }
    )

    expect(ownerResponse.status).toBe(200)
    expect(await prisma.project.findUnique({ where: { id: fixture.project.id } })).toBeNull()
  })

  it('owner can add same-tenant collaborators and cannot add cross-tenant users', async () => {
    const fixture = await createAccessFixture()
    const sameTenantUser = await createUser({ tenantId: fixture.tenant.id, emailPrefix: 'phase1-extra-editor', roles: ['ANALYST'] })

    const addSameTenantResponse = await addCollaboratorRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/collaborators`,
        tokenFor(fixture.owner, fixture.tenant.atiId),
        'POST',
        { userId: sameTenantUser.id }
      ),
      { params: { projectId: fixture.project.id } }
    )

    expect(addSameTenantResponse.status).toBe(200)

    const addForeignResponse = await addCollaboratorRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/collaborators`,
        tokenFor(fixture.owner, fixture.tenant.atiId),
        'POST',
        { userId: fixture.foreignUser.id }
      ),
      { params: { projectId: fixture.project.id } }
    )

    expect(addForeignResponse.status).toBe(403)
  })

  it('editor cannot add or remove collaborators', async () => {
    const fixture = await createAccessFixture()
    const extraUser = await createUser({ tenantId: fixture.tenant.id, emailPrefix: 'phase1-non-owner-collab', roles: ['ANALYST'] })

    const addResponse = await addCollaboratorRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/collaborators`,
        tokenFor(fixture.editor, fixture.tenant.atiId),
        'POST',
        { userId: extraUser.id }
      ),
      { params: { projectId: fixture.project.id } }
    )

    const removeResponse = await deleteCollaboratorRoute(
      createRequest(
        `/api/projects/${fixture.project.id}/collaborators/${fixture.viewerCollaborator.id}`,
        tokenFor(fixture.editor, fixture.tenant.atiId),
        'DELETE'
      ),
      { params: { projectId: fixture.project.id, collaboratorId: fixture.viewerCollaborator.id } }
    )

    expect(addResponse.status).toBe(403)
    expect(removeResponse.status).toBe(403)
  })

  it('applicant profile allows owner and editor writes, and viewer is read-only', async () => {
    const fixture = await createAccessFixture()

    const ownerWriteResponse = await saveApplicantProfileRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/applicant-profile`,
        tokenFor(fixture.owner, fixture.tenant.atiId),
        'POST',
        applicantProfilePayload
      ),
      { params: { projectId: fixture.project.id } }
    )
    expect(ownerWriteResponse.status).toBe(200)

    const editorWriteResponse = await saveApplicantProfileRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/applicant-profile`,
        tokenFor(fixture.editor, fixture.tenant.atiId),
        'POST',
        { ...applicantProfilePayload, applicantLegalName: 'Editor Updated Labs' }
      ),
      { params: { projectId: fixture.project.id } }
    )
    expect(editorWriteResponse.status).toBe(200)

    const viewerReadResponse = await getApplicantProfileRoute(
      createRequest(`/api/projects/${fixture.project.id}/applicant-profile`, tokenFor(fixture.viewer, fixture.tenant.atiId)),
      { params: { projectId: fixture.project.id } }
    )
    expect(viewerReadResponse.status).toBe(200)
    expect((await viewerReadResponse.json()).project.applicantProfile.applicantLegalName).toBe('Editor Updated Labs')

    const viewerWriteResponse = await saveApplicantProfileRoute(
      createJsonRequest(
        `/api/projects/${fixture.project.id}/applicant-profile`,
        tokenFor(fixture.viewer, fixture.tenant.atiId),
        'POST',
        { ...applicantProfilePayload, applicantLegalName: 'Viewer Update Attempt' }
      ),
      { params: { projectId: fixture.project.id } }
    )
    expect(viewerWriteResponse.status).toBe(403)
  })

})
