'use client'
import ManagementWorkspace from '@/components/funding-dept/ManagementWorkspace'
import FundingWorkspaceHeader, { FundingWorkspaceLink } from '@/components/funding/FundingWorkspaceHeader'
export default function AccountabilityPage() {return <main className="funding-workspace"><div className="relative mx-auto max-w-[1500px] px-4 pb-10 sm:px-6 lg:px-8"><FundingWorkspaceHeader section="dsr" title="From opportunity to accountable progress." description="Follow your portfolio, assign the next step, and review performance with clear ownership and evidenced outcomes." actions={<FundingWorkspaceLink href="/funding-dept/reports">Daily DSR reports</FundingWorkspaceLink>} /><ManagementWorkspace/></div></main>}
