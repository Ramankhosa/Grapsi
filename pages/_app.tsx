import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { Toaster } from 'react-hot-toast'

import { AuthProvider } from '@/lib/auth-context'
import '@/app/globals.css'

function PagesAuthFetchBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      const isApiRequest = requestUrl.startsWith('/api/') || requestUrl.startsWith(`${window.location.origin}/api/`)
      if (!isApiRequest) {
        return originalFetch(input, init)
      }

      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      if (!headers.has('Authorization')) {
        const token = window.localStorage.getItem('auth_token')
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
        }
      }

      return originalFetch(input, {
        ...init,
        credentials: init?.credentials || 'include',
        headers,
      })
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}

export default function GrapsiPagesApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <PagesAuthFetchBridge />
      <Toaster position="top-right" />
      <Component {...pageProps} />
    </AuthProvider>
  )
}
