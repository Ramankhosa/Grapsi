'use client'

import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'
import ReportsArchiveBrowser from '@/components/reports-archive/ReportsArchiveBrowser'

/**
 * The same archive as /super-admin/reports, restricted to one tenant. The
 * restriction is applied server-side from the session, not by this page.
 */
export default function TenantAdminReportsPage() {
  return (
    <ReportArchiveGuard scope="tenant">
      <ReportsArchiveBrowser scope="tenant" basePath="/tenant-admin/reports" />
    </ReportArchiveGuard>
  )
}
