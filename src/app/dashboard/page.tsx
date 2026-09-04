'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import SuperAdminDashboard from '@/components/dashboards/SuperAdminDashboard'
import PlatformStaffDashboard from '@/components/dashboards/PlatformStaffDashboard'
import UserProductChooser from '@/components/dashboards/UserProductChooser'
import { PageLoadingBird } from '@/components/ui/loading-bird'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { isSuperAdmin } = useRoleAccess()

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

  // Platform staff get the platform dashboard
  if (isSuperAdmin) {
    return <SuperAdminDashboard />
  }

  // Platform staff without a console role: the product chooser reads tenant
  // entitlements, and the PLATFORM workspace has none, so it would render an
  // empty page. Route them to the surfaces their team roles actually unlock.
  if ((user.platformPermissions || []).length > 0) {
    return <PlatformStaffDashboard />
  }

  // Everyone else — owners, admins, analysts — lands on the product chooser.
  // Owners/admins see an extra "Team & Workspace Admin" card that opens /admin.
  return <UserProductChooser />
}
