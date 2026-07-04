'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import IndianPatentSearch from '@/components/patentnest/IndianPatentSearch'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

export default function IndianPatentsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) router.push('/login')
  }, [isLoading, router, user])

  if (isLoading) return <PageLoadingBird message="Loading Indian patent search..." />
  if (!user) return null

  return (
    <main className="min-h-screen bg-slate-50">
      <IndianPatentSearch />
    </main>
  )
}

