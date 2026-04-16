'use client'

import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (!res.ok) throw new Error('Failed to request reset')
      setSent(true)
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Forgot password</h1>
        <p className="text-sm text-gray-600 mb-6">Enter your email and we’ll send you a reset link.</p>
        {sent ? (
          <div className="text-sm text-green-600">If the email exists, a reset link has been sent.</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" required className="w-full border rounded-lg px-3 py-2" />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button className="w-full bg-[#4C5EFF] text-white rounded-lg px-4 py-2">Send reset link</button>
          </form>
        )}
      </div>
    </div>
  )
}

