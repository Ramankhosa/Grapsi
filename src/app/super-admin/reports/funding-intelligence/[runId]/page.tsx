'use client'

import ArchivedFundingIntelligenceReport from '@/components/reports-archive/ArchivedFundingIntelligenceReport'
import ReportArchiveGuard from '@/components/reports-archive/ReportArchiveGuard'

export default function SuperAdminFundingIntelligenceReportPage({ params }: { params: { runId: string } }) {
  return (
    <ReportArchiveGuard scope="platform">
      <ArchivedFundingIntelligenceReport runId={params.runId} basePath="/super-admin/reports" />
    </ReportArchiveGuard>
  )
}
