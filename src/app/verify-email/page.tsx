'use client'

import { useEffect, useState } from 'react'

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<'idle'|'ok'|'error'>('idle')
  const [message, setMessage] = useState('Verifying your email...')

  useEffect(() => {
    async function run() {
      try {
        const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
        const token = sp.get('token')
        if (!token) { setStatus('error'); setMessage('Missing verification token.'); return }
        const res = await fetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(()=>({}))
        if (res.ok && data.success) { setStatus('ok'); setMessage('Email verified. You can now log in.') }
        else { setStatus('error'); setMessage(data.error || 'Verification failed.') }
      } catch (e:any) {
        setStatus('error'); setMessage(e.message || 'Verification failed.')
      }
    }
    run()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Email verification</h1>
        <p className={status==='error' ? 'text-red-600' : 'text-gray-700'}>{message}</p>
      </div>
    </div>
  )
}

