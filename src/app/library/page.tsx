'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import ReferenceManagementPage from '@/components/library/ReferenceManagementPage'
import LoadingBird from '@/components/ui/loading-bird'

export default function LibraryPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [authToken, setAuthToken] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }
    
    // Get auth token from localStorage
    const token = localStorage.getItem('auth_token')
    if (token) {
      setAuthToken(token)
    }
  }, [user, authLoading, router])

  if (authLoading || !authToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <LoadingBird message="Loading Reference Management..." useKishoFallback={true} />
      </div>
    )
  }

  return <ReferenceManagementPage authToken={authToken} />
}

