'use client'

import ArchivedReviewerReport from '@/components/reports-archive/ArchivedReviewerReport'
import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'

export default function TenantAdminReviewerReportPage({ params }: { params: { callId: string } }) {
  return (
    <ReportArchiveGuard scope="tenant">
      <ArchivedReviewerReport callId={params.callId} basePath="/tenant-admin/reports" />
    </ReportArchiveGuard>
  )
}
