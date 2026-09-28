'use client'

import DsrReportsHub from '@/components/funding-dept/reports/DsrReportsHub'

export default function DsrReportsPage() {
  return (
    <main className="nk-ground nk-wash">
      <div className="relative mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <header className="mb-5">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">DSR reports</h1>
          <p className="nk-sub mt-1">From the call arriving to the proposal going in: what came in, who has it, what slipped, and the follow-up behind every submission.</p>
        </header>
        <DsrReportsHub />
      </div>
    </main>
  )
}
