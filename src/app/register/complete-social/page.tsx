'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Force dynamic rendering since we use search params
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'

const providerIcons: Record<string, JSX.Element> = {
  google: (
    <svg className="w-6 h-6" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  ),
  facebook: (
    <svg className="w-6 h-6" fill="#1877F2" viewBox="0 0 24 24">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  linkedin: (
    <svg className="w-6 h-6" fill="#0077B5" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  twitter: (
    <svg className="w-6 h-6" fill="#1DA1F2" viewBox="0 0 24 24">
      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
    </svg>
  )
}

const providerNames: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  twitter: 'Twitter'
}

interface PendingData {
  provider: string
  providerId: string
  email: string
  name?: string
  firstName?: string
  lastName?: string
  exp: number
}

function CompleteSocialSignupContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [atiToken, setAtiToken] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingData, setPendingData] = useState<PendingData | null>(null)
  const [isExpired, setIsExpired] = useState(false)

  const token = searchParams?.get('token')
  const provider = searchParams?.get('provider') || 'social'

  useEffect(() => {
    if (token) {
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
        setPendingData(decoded)

        // Check if token is expired
        if (Date.now() > decoded.exp) {
          setIsExpired(true)
          setError('Your registration session has expired. Please try again.')
        }
      } catch (e) {
        setError('Invalid registration token. Please try again.')
      }
    } else {
      setError('Missing registration token. Please start the signup process again.')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsLoading(true)

    if (!atiToken.trim()) {
      setError('Please enter your ATI token')
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/social/complete-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          atiToken: atiToken.trim(),
          pendingToken: token
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess('Account created successfully! Redirecting to dashboard...')
        
        // Store token in localStorage
        if (data.token) {
          localStorage.setItem('auth_token', data.token)
        }

        setTimeout(() => {
          router.push('/dashboard')
        }, 1500)
      } else {
        setError(data.message || 'Failed to complete registration')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
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
            Complete Your Registration
          </h2>

          {/* Provider info */}
          {pendingData && (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-ai-graphite-900/50 rounded-lg border border-ai-graphite-700">
              <div className="flex-shrink-0">
                {providerIcons[provider] || providerIcons.google}
              </div>
              <div className="text-left">
                <p className="text-sm text-ai-graphite-400">
                  Signing up with {providerNames[provider] || 'Social'}
                </p>
                <p className="text-white font-medium truncate max-w-[200px]">
                  {pendingData.email}
                </p>
                {pendingData.name && (
                  <p className="text-sm text-ai-graphite-400">{pendingData.name}</p>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-sm text-ai-graphite-400">
            Enter your organization&apos;s access code to complete registration.
          </p>
        </div>

        {isExpired ? (
          <div className="text-center space-y-4">
            <div className="rounded-lg bg-red-900/20 border border-red-900/50 p-4">
              <p className="text-red-400">Your registration session has expired.</p>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-4 py-2 border border-ai-graphite-700 rounded-lg text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
            >
              Return to Login
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="atiToken" className="block text-sm font-medium text-ai-graphite-300 mb-2">
                  Organization Access Code
                </label>
                <input
                  id="atiToken"
                  name="atiToken"
                  type="text"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                  placeholder="Enter your organization's access code"
                  value={atiToken}
                  onChange={(e) => setAtiToken(e.target.value)}
                />
                {/* Helpful info box */}
                <div className="mt-3 p-3 bg-ai-graphite-900/30 border border-ai-graphite-800 rounded-lg">
                  <p className="text-xs text-ai-graphite-400 leading-relaxed">
                    <span className="text-ai-graphite-300 font-medium">What&apos;s an access code?</span>
                    <br />
                    Your organization admin provides this code to control who can join. 
                    It ensures only authorized team members can access your workspace.
                  </p>
                  <p className="mt-2 text-xs text-ai-graphite-500">
                    💡 Check your email or ask your team admin for the code.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-lg bg-red-900/20 border border-red-900/50 p-4"
              >
                <div className="text-sm text-red-400 text-center">{error}</div>
              </motion.div>
            )}

            {success && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-lg bg-green-900/20 border border-green-900/50 p-4"
              >
                <div className="text-sm text-green-400 text-center">{success}</div>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isLoading || !token}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ai-blue-900/30 transition-all duration-200 overflow-hidden"
            >
              <span className="relative z-10">
                {isLoading ? 'Creating account...' : 'Complete Registration'}
              </span>
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500" />
            </button>

            <div className="text-center space-y-2">
              <Link
                href="/login"
                className="text-sm text-ai-graphite-400 hover:text-white transition-colors"
              >
                Cancel and return to login
              </Link>
              <span className="block text-sm text-ai-graphite-600">or</span>
              <Link
                href="/register"
                className="text-sm font-medium text-ai-blue-400 hover:text-ai-blue-300 transition-colors"
              >
                Register with email instead
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

export default function CompleteSocialSignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <CompleteSocialSignupContent />
    </Suspense>
  )
}

