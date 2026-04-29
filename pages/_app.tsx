import { useEffect } from 'react'
import type { AppProps } from 'next/app'
import { Toaster } from 'react-hot-toast'
import axios from 'axios'

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

function PagesAxiosAuthBridge() {
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      if (typeof window === 'undefined') return config

      const requestUrl = config.url || ''
      const isApiRequest = requestUrl.startsWith('/api/') || requestUrl.startsWith(`${window.location.origin}/api/`)
      if (!isApiRequest) return config

      const token = window.localStorage.getItem('auth_token')
      if (token) {
        config.headers = config.headers || {}
        if (!config.headers.Authorization) {
          config.headers.Authorization = `Bearer ${token}`
        }
      }
      config.withCredentials = config.withCredentials ?? true
      return config
    })

    return () => {
      axios.interceptors.request.eject(requestInterceptor)
    }
  }, [])

  return null
}

export default function GrapsiPagesApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <PagesAuthFetchBridge />
      <PagesAxiosAuthBridge />
      <Toaster position="top-right" />
      <Component {...pageProps} />
    </AuthProvider>
  )
}
