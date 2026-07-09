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
      className={`mb-8 flex items-center gap-3 rounded-2xl border px-5 py-3 backdrop-blur-sm ${
        urgent
          ? 'border-amber-300 bg-amber-50/90'
          : 'border-violet-200 bg-violet-50/70'
      }`}
    >
      <Clock className={`h-4 w-4 shrink-0 ${urgent ? 'text-amber-500' : 'text-violet-500'}`} />
      <p className={`text-sm ${urgent ? 'text-amber-800' : 'text-violet-800'}`}>
        <span className="font-semibold">Workshop access</span>
        {remaining > 0 ? (
          <> — {formatRemaining(remaining)} remaining. Explore freely; your work is saved while access lasts.</>
        ) : (
          <> — your access window has ended.</>
        )}
      </p>
    </div>
  )
}
