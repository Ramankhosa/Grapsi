'use client'

import ArchivedFundingIntelligenceReport from '@/components/reports-archive/ArchivedFundingIntelligenceReport'
import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'

export default function TenantAdminFundingIntelligenceReportPage({ params }: { params: { runId: string } }) {
  return (
    <ReportArchiveGuard scope="tenant">
      <ArchivedFundingIntelligenceReport runId={params.runId} basePath="/tenant-admin/reports" />
    </ReportArchiveGuard>
  )
}
