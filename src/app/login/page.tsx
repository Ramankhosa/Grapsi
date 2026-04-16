'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import AuthLoader from '@/components/ui/AuthLoader'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [socialProvider, setSocialProvider] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSocialProvider(null)

    // Simulate a minimum loading time to show the animation
    // This adds to the "premium" feel - sometimes too fast feels glitchy
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 2000))
    
    const [result] = await Promise.all([
      login(email, password),
      minLoadTime
    ])

    if (result.success) {
      router.push('/dashboard')
    } else {
      // Check if this is a social login account
      if (result.error?.includes('uses') && result.error?.includes('login')) {
        // Extract provider from error message
        const match = result.error.match(/uses (\w+) login/)
        if (match) {
          setSocialProvider(match[1].toLowerCase())
        }
      }
      setError(result.error || 'Login failed')
      setIsLoading(false)
    }
  }

  const handleSocialRedirect = () => {
    if (socialProvider) {
      window.location.href = `/api/auth/social/${socialProvider}`
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
            Welcome Back
          </h2>
          <p className="mt-2 text-center text-sm text-ai-graphite-400">
            Enter the neural link to access your drafts.
          </p>
        </div>

        {/* Social Login Buttons */}
        <div className="mt-8">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ai-graphite-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-ai-graphite-950 text-ai-graphite-400">Or continue with</span>
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
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
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
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-700 bg-ai-graphite-900/50 placeholder-ai-graphite-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <Link href="/register" className="font-medium text-ai-blue-400 hover:text-ai-blue-300 transition-colors">
                Create account
              </Link>
            </div>
            <div className="text-sm">
              <Link href="/forgot-password" className="font-medium text-ai-graphite-400 hover:text-white transition-colors">
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg bg-red-900/20 border border-red-900/50 p-4"
            >
              <div className="text-sm text-red-400 text-center">{error}</div>
              {socialProvider && (
                <button
                  type="button"
                  onClick={handleSocialRedirect}
                  className="mt-3 w-full py-2 px-4 border border-ai-blue-500 rounded-lg text-sm font-medium text-ai-blue-400 hover:bg-ai-blue-500/10 transition-colors"
                >
                  Sign in with {socialProvider.charAt(0).toUpperCase() + socialProvider.slice(1)}
                </button>
              )}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ai-blue-900/30 transition-all duration-200 overflow-hidden"
          >
            <span className="relative z-10">Sign in</span>
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500" />
          </button>

          <p className="mt-4 text-xs text-ai-graphite-500 text-center">
            By signing in, you agree to our{' '}
            <Link href="/terms" className="text-ai-blue-400 hover:text-ai-blue-300 underline-offset-2 hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-ai-blue-400 hover:text-ai-blue-300 underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </form>
      </motion.div>
    </div>
  )
}
