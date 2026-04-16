'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'

function RegisterContent() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [atiToken, setAtiToken] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isInvited, setIsInvited] = useState(false)
  const [isTrial, setIsTrial] = useState(false)
  const { signup } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Check for invite token in URL (magic link support)
  useEffect(() => {
    const inviteToken = searchParams?.get('invite')
    const trialParam = searchParams?.get('trial')
    const emailParam = searchParams?.get('email')
    
    if (inviteToken) {
      setAtiToken(inviteToken)
      setIsInvited(true)
    }
    if (trialParam === 'true') {
      setIsTrial(true)
    }
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsLoading(true)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      setIsLoading(false)
      return
    }

    const result = await signup(email, password, atiToken, firstName, lastName, isTrial)

    if (result.success) {
      if (isTrial) {
        setSuccess('Trial account created! Redirecting to login...')
      } else {
        setSuccess('Account created successfully! You can now log in.')
      }
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } else {
      setError(result.error || 'Signup failed')
    }

    setIsLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950 relative overflow-hidden py-12 px-4 sm:px-6 lg:px-8">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[50%] -left-[20%] w-[100%] h-[100%] rounded-full bg-ai-blue-900/10 blur-[150px]" />
        <div className="absolute -bottom-[20%] -right-[20%] w-[80%] h-[80%] rounded-full bg-purple-900/10 blur-[150px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full space-y-8 relative z-10"
      >
        <div className="flex flex-col items-center">
          <div className="mb-6 relative">
            <div className="absolute -inset-4 bg-ai-blue-500/20 blur-xl rounded-full" />
            <AnimatedLogo size="lg" />
          </div>
          
          {/* Dynamic header based on invite/trial status */}
          {isInvited && isTrial ? (
            <>
              <div className="mb-2 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                <span className="text-xs font-medium text-emerald-400">✨ Free Trial Access</span>
              </div>
              <h2 className="text-center text-3xl font-bold text-white tracking-tight">
                Welcome to Your Trial
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-400">
                You&apos;ve been invited to try our platform. Create your account to get started.
              </p>
            </>
          ) : isInvited ? (
            <>
              <div className="mb-2 px-3 py-1 bg-ai-blue-500/20 border border-ai-blue-500/30 rounded-full">
                <span className="text-xs font-medium text-ai-blue-400">🎉 You&apos;re Invited</span>
              </div>
              <h2 className="text-center text-3xl font-bold text-white tracking-tight">
                Join Your Team
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-400">
                Your team has invited you to collaborate. Create your account to join.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-center text-3xl font-bold text-white tracking-tight">
                Create your account
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-400">
                Join your organization&apos;s secure workspace with an access code.
              </p>
            </>
          )}
        </div>

        {/* Social Login Section */}
        <div className="mt-8">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ai-graphite-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-ai-graphite-950 text-ai-graphite-400">Sign up with</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/google'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-700 bg-ai-graphite-900/50 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>

            {/* Facebook button hidden for now
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/facebook'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-700 bg-ai-graphite-900/50 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="#1877F2" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Facebook
            </button>
            */}

            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/linkedin'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-700 bg-ai-graphite-900/50 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="#0077B5" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </button>

            {/* Twitter button hidden for now
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/twitter'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-700 bg-ai-graphite-900/50 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-ai-graphite-800 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="#1DA1F2" viewBox="0 0 24 24">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
              </svg>
              Twitter
            </button>
            */}
          </div>

          <p className="mt-3 text-xs text-center text-ai-graphite-500">
            {isInvited 
              ? 'Your access code will be applied automatically' 
              : 'You\'ll enter your access code after social verification'}
          </p>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ai-graphite-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-ai-graphite-950 text-ai-graphite-400">Or register with email</span>
          </div>
        </div>

        {/* Email Registration Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="firstName" className="sr-only">
                  First name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="lastName" className="sr-only">
                  Last name
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {/* ATI Token Section - Hidden if pre-filled from invite link */}
            {isInvited ? (
              <div className="p-3 bg-ai-graphite-900/50 border border-ai-graphite-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-ai-graphite-300">Access code applied from your invitation</span>
                </div>
                <input type="hidden" name="atiToken" value={atiToken} />
              </div>
            ) : (
              <div>
                <label htmlFor="atiToken" className="block text-sm font-medium text-ai-graphite-300 mb-1.5">
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
                {/* Helpful info about access codes */}
                <div className="mt-2 p-3 bg-ai-graphite-900/30 border border-ai-graphite-800 rounded-lg">
                  <p className="text-xs text-ai-graphite-400 leading-relaxed">
                    <span className="text-ai-graphite-300 font-medium">What&apos;s an access code?</span>
                    <br />
                    Your organization admin provides this code to control who can join the team workspace. 
                    It ensures your patent data stays secure and only authorized team members can access it.
                  </p>
                  <p className="mt-2 text-xs text-ai-graphite-500">
                    💡 Check your email or ask your team admin for the code.
                  </p>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
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
            disabled={isLoading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ai-blue-900/30 transition-all duration-200 overflow-hidden"
          >
            <span className="relative z-10">
              {isLoading ? 'Creating account...' : 'Create account'}
            </span>
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500" />
          </button>

          <p className="mt-4 text-xs text-ai-graphite-500 text-center">
            By creating an account, you agree to our{' '}
            <Link href="/terms" className="text-ai-blue-400 hover:text-ai-blue-300 underline-offset-2 hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-ai-blue-400 hover:text-ai-blue-300 underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>

          <div className="text-center">
            <span className="text-sm text-ai-graphite-400">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-ai-blue-400 hover:text-ai-blue-300 transition-colors">
                Sign in
              </Link>
            </span>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// Wrap with Suspense for useSearchParams
export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-ai-graphite-950">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  )
}
