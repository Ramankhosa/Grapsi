'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewPatentPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string

  useEffect(() => {
    // Redirect to drafting page
    router.replace(`/patents/draft/new?projectId=${projectId}`)
  }, [router, projectId])

  return null
}
