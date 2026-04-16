'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import SuperAdminDashboard from '@/components/dashboards/SuperAdminDashboard'
import TenantAdminDashboard from '@/components/dashboards/TenantAdminDashboard'
import UserDashboard from '@/components/dashboards/UserDashboard'
import { PageLoadingBird } from '@/components/ui/loading-bird'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { isSuperAdmin, isTenantAdmin } = useRoleAccess()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login')
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return <PageLoadingBird message="Loading your workspace..." />
  }

  if (!user) {
    return null
  }

  // Render different dashboards based on user role and tenant type
  if (isSuperAdmin) {
    return <SuperAdminDashboard />
  }

  // For tenant admins (ADMIN role) - show tenant admin dashboard
  if (isTenantAdmin && user.roles?.includes('ADMIN')) {
    return <TenantAdminDashboard />
  }

  // For individual users (OWNER role) and analysts - show user dashboard
  // Individual users get analyst-like interface with optional tenant admin access
  return <UserDashboard />
}
