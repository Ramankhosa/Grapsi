'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 48) return `${Math.floor(hours / 24)} days`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} minutes`
}

/**
 * Shown to time-boxed (EVENT/workshop) accounts: a slim banner with the time
 * remaining. Renders nothing for regular accounts.
 */
export default function WorkshopAccessBanner() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => Date.now())

  const expiresAt = user?.access_expires_at ? new Date(user.access_expires_at).getTime() : null

  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (!expiresAt) return null

  const remaining = expiresAt - now
  const urgent = remaining < 60 * 60 * 1000 // under an hour

  return (
    <div
      className={`mb-8 flex items-center gap-3 rounded-xl border px-4 py-3 ${
        urgent ? 'border-amber-200 bg-amber-50' : 'border-nickel-200 bg-nickel-50'
      }`}
    >
      <span
        className={`nk-tile h-8 w-8 ${urgent ? 'border-amber-200 text-amber-600' : ''}`}
        aria-hidden
      >
        <Clock className="h-4 w-4" />
      </span>
      <p className={`text-[13px] leading-5 ${urgent ? 'text-amber-900' : 'text-nickel-600'}`}>
        <span className="nk-eyebrow mr-2 align-middle">Workshop access</span>
        {remaining > 0 ? (
          <>
            <span className="nk-mono font-semibold">{formatRemaining(remaining)}</span> remaining —
            explore freely; your work is saved while access lasts.
          </>
        ) : (
          <>your access window has ended.</>
        )}
      </p>
    </div>
  )
}
