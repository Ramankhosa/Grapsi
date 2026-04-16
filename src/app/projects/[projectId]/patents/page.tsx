'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function ProjectPatentsPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string

  useEffect(() => {
    // Redirect to main project page
    router.replace(`/projects/${projectId}`)
  }, [router, projectId])

  return null
}
