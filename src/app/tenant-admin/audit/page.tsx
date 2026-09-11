'use client'

/**
 * The organisation's own audit trail.
 *
 * Scope comes from the session, so this page passes no tenant and cannot be made
 * to show another organisation's rows.
 */

import AuditTrail from '@/components/audit/AuditTrail'

export default function TenantAuditPage() {
  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-2">
          <p className="nk-eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Audit trail
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            Who changed what in your organisation, and when. Roles granted and removed, accounts
            created and suspended, passwords reset by an administrator, school coverage moved.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <AuditTrail />
      </div>
    </main>
  )
}
