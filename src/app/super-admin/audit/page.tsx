'use client'

/**
 * The audit trail across every organisation.
 *
 * Same component and same endpoint as the tenant view; the server decides which
 * rows come back, and `platform` only tells the list to name the organisation on
 * each row.
 */

import AuditTrail from '@/components/audit/AuditTrail'

export default function PlatformAuditPage() {
  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-2">
          <p className="nk-eyebrow">Platform</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Audit trail
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            Every recorded change, across every organisation. Platform actions such as team-role
            grants and runtime settings carry no organisation of their own.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <AuditTrail platform />
      </div>
    </main>
  )
}
