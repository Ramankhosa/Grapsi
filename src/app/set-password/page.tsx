'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useAuth } from '@/lib/auth-context'
import AuthLoader from '@/components/ui/AuthLoader'
import AnimatedLogo from '@/components/ui/animated-logo'

/**
 * First-login activation for seeded accounts.
 *
 * The person proves identity with their email + Employee ID (already in the
 * roster the admin uploaded), sets a password, and is signed straight in — no
 * activation email involved.
 */
export default function SetPasswordPage() {
  const [email, setEmail] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { activateFirstLogin } = useAuth()
  const router = useRouter()

  // Prefill the email when we arrive from the login page. Reading the query
  // string directly (rather than useSearchParams) avoids a Suspense boundary.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const e = sp.get('email')
      if (e) setEmail(e)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 1200))
    const [result] = await Promise.all([
      activateFirstLogin(email.trim(), employeeId.trim(), password),
      minLoadTime,
    ])

    if (result.success) {
      router.push('/dashboard')
    } else {
      setError(result.error || 'Activation failed')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[50%] -left-[20%] w-[100%] h-[100%] rounded-full bg-ai-blue-900/10 blur-[150px]" />
        <div className="absolute -bottom-[20%] -right-[20%] w-[80%] h-[80%] rounded-full bg-purple-900/10 blur-[150px]" />
      </div>

      {isLoading && <AuthLoader />}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full space-y-8 relative z-10 p-8"
      >
        <div className="flex flex-col items-center">
          <div className="mb-6 relative">
            <div className="absolute -inset-4 bg-ai-blue-500/20 blur-xl rounded-full" />
            <AnimatedLogo size="lg" />
          </div>
          <h2 className="text-center text-3xl font-bold text-white tracking-tight">
            Activate your account
          </h2>
          <p className="mt-2 text-center text-sm text-ai-graphite-400">
            First time here? Confirm your details and choose a password.
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Work email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="employeeId" className="sr-only">Employee ID</label>
              <input
                id="employeeId"
                name="employeeId"
                type="text"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Employee ID"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">New password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="New password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirm" className="sr-only">Confirm password</label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-ai-graphite-500">
            Your Employee ID is the one your organization added to the roster. Ask your admin if you're not sure.
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg bg-red-900/20 border border-red-900/50 p-4"
            >
              <div className="text-sm text-red-400 text-center">{error}</div>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ai-blue-900/30 transition-all duration-200 overflow-hidden"
          >
            <span className="relative z-10">Set password &amp; sign in</span>
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500" />
          </button>

          <div className="text-center text-sm">
            <Link href="/login" className="font-medium text-ai-graphite-400 hover:text-white transition-colors">
              Already activated? Sign in
            </Link>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
