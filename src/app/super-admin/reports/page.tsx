'use client'

import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'
import ReportsArchiveBrowser from '@/components/reports-archive/ReportsArchiveBrowser'

/** Platform-wide archive: every tenant's grant-reviewer and funding-intelligence reports. */
export default function SuperAdminReportsPage() {
  return (
    <ReportArchiveGuard scope="platform">
      <ReportsArchiveBrowser scope="platform" basePath="/super-admin/reports" />
    </ReportArchiveGuard>
  )
}
