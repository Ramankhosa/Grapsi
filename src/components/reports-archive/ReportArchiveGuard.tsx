'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { useAuth } from '@/lib/auth-context'

/**
 * Client-side gate for the archive pages.
 *
 * This only decides what to render — the API applies the same rules again and
 * pins a tenant admin to their own tenant, so a user who forces their way onto
 * the page still sees nothing outside their scope.
 */
// PLATFORM_STAFF is admitted to the page because whether their team roles carry
// `platform.support.read` cannot be told from the session; the API decides, and
// a staffer without the grant sees its 403 rather than a blank redirect.
const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF']
const TENANT_ROLES = ['OWNER', 'ADMIN', 'QUALITY_AUDITOR']

export default function ReportArchiveGuard({
  scope,
  children,
}: {
  scope: 'platform' | 'tenant'
  children: ReactNode
}) {
  const { user, isLoading } = useAuth()

  const roles: string[] = (user as any)?.roles || []
  const isPlatform = roles.some((role) => PLATFORM_ROLES.includes(role))
  const allowed = scope === 'platform' ? isPlatform : isPlatform || roles.some((role) => TENANT_ROLES.includes(role))

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!allowed) window.location.href = '/dashboard'
  }, [isLoading, user, allowed])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">
          Access denied. {scope === 'platform' ? 'Super admin' : 'Organization admin'} privileges are required.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
