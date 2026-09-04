'use client'

import Link from 'next/link'
import { ArrowRight, CircleDollarSign, Radar } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { PLATFORM_ROLE_DEFINITIONS } from '@/lib/platformTeamRoles'

/**
 * Landing page for platform staff who are not super admins.
 *
 * These accounts sit in the PLATFORM tenant but hold no console role, so the
 * super-admin dashboard is closed to them and the tenant product chooser has
 * nothing to offer — the platform workspace carries no plan entitlements. This
 * is the third case: it lists exactly the surfaces their granted team roles
 * unlock.
 *
 * Only the funding surfaces are listed because only those enforce access by
 * platform permission. The other screens a role like Tenant Manager implies are
 * still gated on `requirePlatformScope` (super admin only), so linking them
 * here would just hand staff a 403.
 */

type StaffSurface = {
  title: string
  description: string
  href: string
  icon: typeof Radar
  /** Any one of these permissions reveals the card. */
  permissions: string[]
}

const SURFACES: StaffSurface[] = [
  {
    title: 'Funding Control',
    description: 'Import and extract calls, tag research areas, and work the review queue.',
    href: '/super-admin/funding',
    icon: CircleDollarSign,
    permissions: ['funding.operations.write', 'funding.publisher.write', 'ai.model.manage', 'platform.support.read'],
  },
  {
    title: 'Source Watch',
    description: 'Watch funding sources for changes and confirm what becomes a call.',
    href: '/funding/monitor',
    icon: Radar,
    permissions: ['funding.operations.write'],
  },
]

/** Permissions that currently lead somewhere a staff account can actually use. */
const ROUTED_PERMISSIONS = new Set(SURFACES.flatMap((surface) => surface.permissions))

export default function PlatformStaffDashboard() {
  const { user } = useAuth()
  const permissions = user?.platformPermissions || []
  const visible = SURFACES.filter((surface) =>
    surface.permissions.some((permission) => permissions.includes(permission))
  )

  // Grants whose screens are still super-admin-only. Naming them beats letting
  // somebody discover the gap by hitting a 403.
  const unroutedRoles = PLATFORM_ROLE_DEFINITIONS.filter(
    (role) =>
      role.permissions.some((permission) => permissions.includes(permission)) &&
      role.permissions.every((permission) => !ROUTED_PERMISSIONS.has(permission))
  )

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Platform staff</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {user?.email ? `Welcome, ${user.email}` : 'Welcome'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your access comes from the platform team roles a super admin granted you.
        </p>

        {visible.length === 0 ? (
          // Provisioning refuses to create staff with no team roles, so this
          // means the grants were revoked after the fact rather than never set.
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-medium text-amber-900">No platform tools are assigned to you yet.</p>
            <p className="mt-1 text-sm text-amber-800">
              Ask a super admin to grant your platform team roles from Team Roles.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {visible.map((surface) => {
              const Icon = surface.icon
              return (
                <Link
                  key={surface.href}
                  href={surface.href}
                  className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-sky-400 hover:bg-sky-50/40"
                >
                  <Icon className="h-5 w-5 text-sky-600" />
                  <p className="mt-3 flex items-center gap-1 text-sm font-semibold text-slate-900">
                    {surface.title}
                    <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{surface.description}</p>
                </Link>
              )
            })}
          </div>
        )}

        {unroutedRoles.length > 0 ? (
          <p className="mt-6 text-xs text-slate-500">
            {unroutedRoles.map((role) => role.label).join(', ')}{' '}
            {unroutedRoles.length === 1 ? 'has' : 'have'} no staff screen yet — those areas still require a super
            admin.
          </p>
        ) : null}
      </div>
    </div>
  )
}
