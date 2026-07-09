'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import TenantAdminDashboard from '@/components/dashboards/TenantAdminDashboard'
import { PageLoadingBird } from '@/components/ui/loading-bird'

export default function AdminPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { isSuperAdmin, isTenantAdmin } = useRoleAccess()

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    // Super admins have their own dashboard; non-admin tenant users have no
    // business here — the API layer enforces this too, this is just UX.
    if (isSuperAdmin || !isTenantAdmin) {
      router.push('/dashboard')
    }
  }, [user, isLoading, isSuperAdmin, isTenantAdmin, router])

  if (isLoading) {
    return <PageLoadingBird message="Loading admin workspace..." />
  }

  if (!user || isSuperAdmin || !isTenantAdmin) {
    return null
  }

  return <TenantAdminDashboard />
}
