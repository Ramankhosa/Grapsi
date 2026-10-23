import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { isAccessError, requireTenantScope, type TenantScopeContext } from '@/lib/auth/tenantAccess'
import { intersectRequestedUnits } from '@/lib/orgUnits/scope'
import prisma from '@/lib/prisma'
import { loadStandardAreas } from '@/lib/researchAreas/store'

export function canDiscoverPeople(context: TenantScopeContext) {
  return context.scope.isTenantWide || context.scope.canAssign || context.scope.canViewReports
}
export async function requireDiscoveryPeople(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return context
  if (!canDiscoverPeople(context)) return { error: 'People discovery is available to your organisation’s administrators, school managers and funding department.', status: 403 }
  return context
}
export async function discoveryUnits(context: TenantScopeContext, unitId?: string) {
  let requested: string[] = []
  if (unitId) {
    const units = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM tenant_org_units WHERE tenant_id=${context.tenantId} AND is_active
        AND path && ARRAY[${unitId}]::text[]`)
    requested = units.map(u => u.id)
    if (!requested.length) return ['__none__']
  }
  const clamped = intersectRequestedUnits(context.scope, requested)
  return context.scope.isTenantWide && !unitId ? undefined : clamped.length ? clamped : ['__none__']
}
export async function validateDiscoveryAreas(ids: string[]) {
  if (!ids.length) return []
  const areas = await loadStandardAreas()
  const selected = areas.filter(a => ids.includes(a.id))
  if (selected.length !== new Set(ids).size) throw new Error('An area is no longer available. Choose it again from the current area list.')
  return selected
}
