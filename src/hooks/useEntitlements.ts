'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import type { ProductModuleKey } from '@/lib/access/modules'

export interface EntitlementModule {
  key: ProductModuleKey
  name: string
  description: string
  entryRoute: string
  minTier: 'STARTER' | 'PRO' | 'ENTERPRISE'
  icon: string
  featureCodes: string[]
  unlocked: boolean
}

export interface EntitlementSummary {
  plan: { code: string; name: string; tier: 'STARTER' | 'PRO' | 'ENTERPRISE' | null } | null
  featureCodes: string[]
  modules: EntitlementModule[]
  isPlatform: boolean
}

/**
 * Loads the current user's plan/feature/module access from
 * `/api/v1/me/entitlements`. Use `hasModule` / `hasFeature` to gate UI, and
 * `modules` to render a product chooser with locked states.
 */
export function useEntitlements() {
  const { token, authFetch } = useAuth()
  const [data, setData] = useState<EntitlementSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) {
      setData(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const res = await authFetch('/api/v1/me/entitlements')
      if (!res.ok) {
        throw new Error(`Failed to load entitlements (${res.status})`)
      }
      const json = (await res.json()) as EntitlementSummary
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entitlements')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [token, authFetch])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isPlatform = data?.isPlatform ?? false

  const hasFeature = useCallback(
    (code: string) => isPlatform || Boolean(data?.featureCodes.includes(code)),
    [data, isPlatform]
  )

  const hasModule = useCallback(
    (key: ProductModuleKey) => {
      if (isPlatform) return true
      const mod = data?.modules.find((m) => m.key === key)
      return Boolean(mod?.unlocked)
    },
    [data, isPlatform]
  )

  return {
    summary: data,
    plan: data?.plan ?? null,
    modules: data?.modules ?? [],
    isPlatform,
    isLoading,
    error,
    hasFeature,
    hasModule,
    refresh
  }
}
