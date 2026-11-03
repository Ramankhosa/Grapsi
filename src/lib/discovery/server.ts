import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { isAccessError, requireTenantScope, type TenantScopeContext } from '@/lib/auth/tenantAccess'
import prisma from '@/lib/prisma'
import { loadStandardAreas } from '@/lib/researchAreas/store'

/**
 * Who may browse people in Research Discovery: every member of the
 * organisation, across the whole organisation (decided 3 Nov 2026 — it was
 * administrators, school managers and the funding department only). Every
 * query stays inside the member's own tenant. Acting on a person — allocating
 * a call, opening the matching workspace, seeing staff numbers — keeps the
 * narrower rule in `discoveryCapabilities`.
 */
export function canDiscoverPeople(context: TenantScopeContext) {
  return Boolean(context.tenantId)
}

/** What a member may do with what they find, beyond reading it. */
export function discoveryCapabilities(context: TenantScopeContext) {
  const { scope } = context
  const manages = scope.isTenantWide || scope.canAssign || scope.canViewReports
  return {
    canAssign: scope.isTenantWide || scope.canAssign,
    /** The DSR matching workspace keeps its assigner-only rule. */
    canOpenMatching: manages,
    /** Staff numbers are HR identifiers: administrators, heads and the funding department only. */
    canSeeEmployeeIds: manages,
  }
}

export async function requireDiscoveryPeople(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return context
  if (!canDiscoverPeople(context)) return { error: 'People discovery is available to members of an organisation.', status: 403 }
  return context
}

/**
 * The org units a people search may read. No unit means the whole
 * organisation (undefined: no unit filter). A unit expands to everything below
 * it unless `includeSubunits` is false; either way it must belong to this
 * tenant, and an unknown or foreign unit becomes an impossible filter rather
 * than "everyone".
 */
export async function discoveryUnits(context: TenantScopeContext, unitId?: string, includeSubunits = true) {
  if (!unitId) return undefined
  const units = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM tenant_org_units WHERE tenant_id=${context.tenantId} AND is_active
      AND ${includeSubunits ? Prisma.sql`path && ARRAY[${unitId}]::text[]` : Prisma.sql`id = ${unitId}`}`)
  return units.length ? units.map(u => u.id) : ['__none__']
}

/** People who are faculty of the organisation: active, and not platform staff attached to it. */
export function discoverablePersonSql(userAlias = 'u'): Prisma.Sql {
  const u = Prisma.raw(userAlias)
  return Prisma.sql`${u}.status = 'ACTIVE' AND NOT (${u}.roles && ARRAY['SUPER_ADMIN','SUPER_ADMIN_VIEWER','PLATFORM_STAFF']::"UserRole"[])`
}

export async function validateDiscoveryAreas(ids: string[]) {
  if (!ids.length) return []
  const areas = await loadStandardAreas()
  const selected = areas.filter(a => ids.includes(a.id))
  if (selected.length !== new Set(ids).size) throw new Error('An area is no longer available. Choose it again from the current area list.')
  return selected
}
