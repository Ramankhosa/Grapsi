'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Cookies from 'js-cookie'

export default function ClearCookiesPage() {
  const router = useRouter()

  useEffect(() => {
    // Clear all cookies
    const cookies = Object.keys(Cookies.get())
    cookies.forEach(cookie => {
      Cookies.remove(cookie)
      Cookies.remove(cookie, { path: '/' })
    })

    // Clear specific NextAuth cookies
    Cookies.remove('next-auth.session-token')
    Cookies.remove('next-auth.csrf-token')
    Cookies.remove('next-auth.callback-url')
    Cookies.remove('__Secure-next-auth.session-token')
    Cookies.remove('__Secure-next-auth.csrf-token')
    Cookies.remove('__Secure-next-auth.callback-url')

    // Redirect to login page
    setTimeout(() => {
      router.push('/login')
    }, 2000)
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gpt-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <h2 className="mt-6 text-3xl font-bold text-gpt-gray-900">Clearing cookies...</h2>
        <p className="mt-2 text-sm text-gpt-gray-600">
          You will be redirected to the login page shortly.
        </p>
        <div className="mt-5">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gpt-blue-600 mx-auto"></div>
        </div>
      </div>
    </div>
  )
}

