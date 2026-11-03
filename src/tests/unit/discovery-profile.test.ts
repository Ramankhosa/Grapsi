import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ profile: vi.fn(), user: vi.fn(), publications: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { researcherProfile: { findFirst: m.profile }, user: { findFirst: m.user }, referenceLibrary: { findMany: m.publications } } }))
import { loadFacultyProfile } from '@/lib/faculty/profile'
const options = { tenantId: 'tenant', userId: 'person', activeOnly: true, includeEmployeeId: false }
beforeEach(() => { vi.clearAllMocks(); m.profile.mockResolvedValue(null); m.user.mockResolvedValue(null); m.publications.mockResolvedValue([]) })
describe('Discovery profile access', () => {
  it('requires an active tenant colleague, excludes platform staff and does not select staff IDs for members', async () => {
    await loadFacultyProfile(options)
    expect(m.profile.mock.calls[0][0]).toMatchObject({ where: { user_id: 'person', user: { tenantId: 'tenant', status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } } }, select: { employee_id: false } })
    expect(m.user.mock.calls[0][0].where).toMatchObject({ id: 'person', tenantId: 'tenant', status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } })
    expect(m.publications).not.toHaveBeenCalled()
  })
  it('opens sparse colleagues and their available publications without inventing research areas', async () => {
    m.user.mockResolvedValue({ id: 'person', name: 'Person', email: 'person@example.test' })
    m.publications.mockResolvedValue([{ id: 'publication', title: 'A paper', authors: [], year: 2025, venue: null, doi: null, url: null }])
    expect(await loadFacultyProfile(options)).toMatchObject({ userId: 'person', name: 'Person', employeeId: null, summary: null, researchAreas: [], publications: [{ title: 'A paper' }] })
    expect(m.publications.mock.calls[0][0]).toMatchObject({ where: { userId: 'person', isActive: true, tags: { has: 'my-publication' } }, take: 25 })
  })
  it('retains the managed-unit boundary and staff IDs for the existing department endpoint', async () => {
    expect(await loadFacultyProfile({ tenantId: 'tenant', userId: 'foreign', unitIds: [], includeEmployeeId: true })).toBeNull()
    expect(m.profile.mock.calls[0][0].where).toMatchObject({ org_unit_id: { in: ['__none__'] }, user: { tenantId: 'tenant' } })
    expect(m.profile.mock.calls[0][0].select.employee_id).toBe(true)
    expect(m.user).not.toHaveBeenCalled()
  })
})
