import { describe, expect, it } from 'vitest'

import { fundingCallAccessWhere } from '@/lib/funding/callAccess'

describe('fundingCallAccessWhere', () => {
  it('lets super admins read any call', () => {
    expect(fundingCallAccessWhere({ tenantId: 'tenant-1', isSuperAdmin: true })).toEqual({})
  })

  it('scopes tenant users to published, active, global-or-own-tenant calls', () => {
    const where = fundingCallAccessWhere({ tenantId: 'tenant-1', isSuperAdmin: false })
    expect(where).toEqual({
      AND: [
        { OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }] },
        { OR: [{ is_active: true }, { is_active: null }] },
        { OR: [{ visibility: 'GLOBAL_PUBLISHED' }, { visibility: 'TENANT_PRIVATE', tenantId: 'tenant-1' }] },
      ],
    })
  })

  it('never exposes tenant-private calls without a tenant scope', () => {
    const where = fundingCallAccessWhere({ tenantId: null, isSuperAdmin: false })
    expect(JSON.stringify(where)).not.toContain('TENANT_PRIVATE')
    expect(fundingCallAccessWhere(undefined)).toEqual(where)
  })
})
