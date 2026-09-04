import { describe, expect, it } from 'vitest'

import { resolveTenantFilter, scopeAllows, type ArchiveScope } from '@/lib/reportsArchive/access'

const platform: ArchiveScope = { kind: 'platform' }
const tenant: ArchiveScope = { kind: 'tenant', tenantId: 'tenant-a' }

describe('report archive scope', () => {
  it('lets a platform viewer narrow to one tenant, or see all of them', () => {
    expect(resolveTenantFilter(platform, null)).toBeNull()
    expect(resolveTenantFilter(platform, 'all')).toBeNull()
    expect(resolveTenantFilter(platform, 'tenant-b')).toBe('tenant-b')
  })

  it('pins a tenant viewer to their own tenant whatever they ask for', () => {
    // The whole point of the module's tenant restriction: a tenant admin
    // cannot widen their scope by sending someone else's tenant id.
    expect(resolveTenantFilter(tenant, 'tenant-b')).toBe('tenant-a')
    expect(resolveTenantFilter(tenant, 'all')).toBe('tenant-a')
    expect(resolveTenantFilter(tenant, null)).toBe('tenant-a')
  })

  it('admits any report to a platform viewer, including untenanted ones', () => {
    expect(scopeAllows(platform, 'tenant-a')).toBe(true)
    expect(scopeAllows(platform, null)).toBe(true)
  })

  it('admits only the viewer’s own tenant to a tenant viewer', () => {
    expect(scopeAllows(tenant, 'tenant-a')).toBe(true)
    expect(scopeAllows(tenant, 'tenant-b')).toBe(false)
    // A report whose tenant could not be resolved is outside every tenant
    // scope; a detail route must not serve it on a "probably ours" guess.
    expect(scopeAllows(tenant, null)).toBe(false)
  })
})
