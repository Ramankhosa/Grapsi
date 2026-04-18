'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import UserDashboard from '@/components/dashboards/UserDashboard'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { PageLoadingBird } from '@/components/ui/loading-bird'

export default function DashboardWorkspacePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { isSuperAdmin, isTenantAdmin } = useRoleAccess()

  const isAdminDashboardUser = isSuperAdmin || (isTenantAdmin && user?.roles?.includes('ADMIN'))

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login')
    }
  }, [isLoading, router, user])

  useEffect(() => {
    if (!isLoading && user && isAdminDashboardUser) {
      router.replace('/dashboard')
    }
  }, [isAdminDashboardUser, isLoading, router, user])

  if (isLoading || isAdminDashboardUser) {
    return <PageLoadingBird message="Loading your workspace..." />
  }

  if (!user) {
    return null
  }

  return <UserDashboard />
}
