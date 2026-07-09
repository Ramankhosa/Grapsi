'use client'

import React from 'react'
import Link from 'next/link'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { ProductModuleKey } from '@/lib/access/modules'

interface FeatureGateProps {
  /** Gate by a raw FeatureCode (e.g. 'GRANT_REVIEW'). */
  feature?: string
  /** Gate by a product module key (e.g. 'FUNDING_CHAT'). */
  module?: ProductModuleKey
  children: React.ReactNode
  /** Custom fallback when access is denied. Overrides the default upgrade card. */
  fallback?: React.ReactNode
  /** Render nothing (instead of the upgrade card) when denied. */
  hideWhenLocked?: boolean
  /** Shown in the default upgrade card. */
  title?: string
}

/**
 * Client-side access gate. Renders children when the tenant's plan unlocks the
 * given feature/module, otherwise shows an upgrade prompt (or a custom
 * fallback). This is a UX affordance — the API routes still hard-enforce access.
 */
export function FeatureGate({
  feature,
  module,
  children,
  fallback,
  hideWhenLocked,
  title
}: FeatureGateProps) {
  const { hasFeature, hasModule, isLoading } = useEntitlements()

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-6" aria-hidden />
    )
  }

  const allowed = module ? hasModule(module) : feature ? hasFeature(feature) : true
  if (allowed) return <>{children}</>
  if (hideWhenLocked) return null
  if (fallback) return <>{fallback}</>

  return <UpgradePrompt title={title} />
}

export function UpgradePrompt({ title }: { title?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
        🔒
      </div>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">
        {title || 'This feature is not included in your plan'}
      </h3>
      <p className="mb-6 text-sm text-gray-600">
        Upgrade to the Pro plan to unlock the AI chatbot, Funding Intelligence, Grant Studio, and the
        AI Grant Review. Contact your workspace administrator to change your plan.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700"
      >
        Back to dashboard
      </Link>
    </div>
  )
}

export default FeatureGate
