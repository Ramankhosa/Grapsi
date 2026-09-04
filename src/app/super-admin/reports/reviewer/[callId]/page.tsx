'use client'

import ArchivedReviewerReport from '@/components/reports-archive/ArchivedReviewerReport'
import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'

export default function SuperAdminReviewerReportPage({ params }: { params: { callId: string } }) {
  return (
    <ReportArchiveGuard scope="platform">
      <ArchivedReviewerReport callId={params.callId} basePath="/super-admin/reports" />
    </ReportArchiveGuard>
  )
}
