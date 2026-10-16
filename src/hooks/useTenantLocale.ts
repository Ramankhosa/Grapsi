import { useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '@/lib/i18n/format'

/**
 * The signed-in user's organization zone and locale, for client-side date
 * formatting. Module-level so plain format helpers read the same values a
 * component that called the hook is rendering with. Fetched once per page
 * load; India until it arrives (and when it cannot).
 */
let current = { timezone: DEFAULT_TIMEZONE, locale: DEFAULT_LOCALE, currency: 'INR' }
let pending: Promise<void> | null = null

export function clientTimeZone(): string {
  return current.timezone
}

export function clientLocale(): string {
  return current.locale
}

export function useTenantLocale() {
  const { authFetch, user } = useAuth()
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!user) return
    let live = true
    if (!pending) {
      pending = authFetch('/api/v1/me/tenant-settings')
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { timezone?: string; locale?: string; currency?: string } | null) => {
          if (data?.timezone) current = { timezone: data.timezone, locale: data.locale || DEFAULT_LOCALE, currency: data.currency || 'INR' }
        })
        .catch(() => undefined)
    }
    void pending.then(() => {
      if (live) setVersion((version) => version + 1)
    })
    return () => {
      live = false
    }
  }, [authFetch, user])
  return current
}
