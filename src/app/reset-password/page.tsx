'use client'

import { useEffect, useState } from 'react'

/**
 * Set-a-new-password screen, reached three ways: "Forgot password", an
 * activation link for a provisioned account, and a forced change.
 *
 * The forced variant arrives from the login screen carrying `forced=1` and a
 * one-time token the login route minted after accepting an
 * administrator-issued temporary password. It is the same form — only the
 * explanation differs, because a person who was just told "your password is
 * correct, now change it" needs to know why.
 */
export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [forced, setForced] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      setToken(sp.get('token') || '')
      setForced(sp.get('forced') === '1')
    }
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      })
      if (!res.ok) {
        const d = await res.json().catch(()=>({}))
        throw new Error(d.error || 'Failed to reset password')
      }
      setDone(true)
    } catch (e:any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          {forced ? 'Choose a new password' : 'Reset password'}
        </h1>
        {done ? (
          <div className="space-y-4">
            <div className="text-sm text-green-600">
              Password updated. Any other devices signed in to this account have been signed out.
            </div>
            <a href="/login" className="inline-block bg-[#4C5EFF] text-white rounded-lg px-4 py-2 text-sm font-medium">
              Go to sign in
            </a>
          </div>
        ) : (
          <>
            {forced ? (
              <p className="text-sm text-gray-600 mb-4">
                Your administrator set a temporary password for this account. Pick your own password to
                finish signing in — the temporary one stops working straight away.
              </p>
            ) : null}
            {!token ? (
              <div className="text-sm text-red-600">
                This link is missing its token. Open the link from your email again, or request a new one
                from the sign-in page.
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="New password" required className="w-full border rounded-lg px-3 py-2" />
                <input type="password" value={confirm} onChange={(e)=>setConfirm(e.target.value)} placeholder="Confirm password" required className="w-full border rounded-lg px-3 py-2" />
                {error && <div className="text-sm text-red-600">{error}</div>}
                <button disabled={submitting} className="w-full bg-[#4C5EFF] text-white rounded-lg px-4 py-2 disabled:opacity-60">
                  {submitting ? 'Updating…' : 'Update password'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
