'use client'

import { useEffect, useState } from 'react'

export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      setToken(sp.get('token') || '')
    }
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
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
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Reset password</h1>
        {done ? (
          <div className="text-sm text-green-600">Password updated. You can now log in.</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="New password" required className="w-full border rounded-lg px-3 py-2" />
            <input type="password" value={confirm} onChange={(e)=>setConfirm(e.target.value)} placeholder="Confirm password" required className="w-full border rounded-lg px-3 py-2" />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button className="w-full bg-[#4C5EFF] text-white rounded-lg px-4 py-2">Update password</button>
          </form>
        )}
      </div>
    </div>
  )
}

