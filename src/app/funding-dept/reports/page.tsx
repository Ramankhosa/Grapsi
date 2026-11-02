'use client'

import DsrReportsHub from '@/components/funding-dept/reports/DsrReportsHub'
import FundingWorkspaceHeader, { FundingWorkspaceLink } from '@/components/funding/FundingWorkspaceHeader'

export default function DsrReportsPage() {
  return (
    <main className="funding-workspace">
      <div className="relative mx-auto max-w-[1440px] px-4 pb-10 sm:px-6 lg:px-8">
        <FundingWorkspaceHeader section="dsr" title="DSR reports & pending work."
          description="Review opportunities, move allocations forward, and resolve outstanding work with a clear owner and next step."
          actions={<FundingWorkspaceLink href="/funding-dept/accountability">Management & accountability</FundingWorkspaceLink>} />
        <DsrReportsHub />
      </div>
    </main>
  )
}
