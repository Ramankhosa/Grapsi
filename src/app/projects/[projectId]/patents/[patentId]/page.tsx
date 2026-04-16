'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Patent {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface Project {
  id: string
  name: string
}

interface DraftingSession {
  id: string
  status: string
  createdAt: string
  updatedAt: string
}

export default function PatentDetailPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string
  const patentId = params?.patentId as string

  const [patent, setPatent] = useState<Patent | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [draftingSession, setDraftingSession] = useState<DraftingSession | null>(null)

  const checkPatentStatus = useCallback(async () => {
    try {
      // Fetch patent details
      const patentResponse = await fetch(`/api/projects/${projectId}/patents/${patentId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (!patentResponse.ok) {
        if (patentResponse.status === 404) {
          router.push(`/projects/${projectId}/setup`)
        } else {
          console.error('Failed to fetch patent')
          router.push(`/projects/${projectId}/setup`)
        }
        return
      }

      const patentData = await patentResponse.json()
      setPatent(patentData.patent)
      setProject(patentData.project)

      // Check for drafting sessions
      const draftingResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (draftingResponse.ok) {
        const draftingData = await draftingResponse.json()
        const latestSession = draftingData.sessions?.[0] || null
        setDraftingSession(latestSession)

        // Route based on drafting status
        if (latestSession) {
          const status = latestSession.status
          if (status === 'EXPORT_READY' || status === 'COMPLETED') {
            // Patent is complete - redirect to export interface
            router.replace(`/patents/${patentId}/draft`)
          } else {
            // Patent is mid-draft - redirect to current stage
            router.replace(`/patents/${patentId}/draft`)
          }
        } else {
          // No drafting session exists - redirect to start new draft
          router.replace(`/patents/draft/new?projectId=${projectId}`)
        }
      } else {
        // No drafting sessions - redirect to start new draft
        router.replace(`/patents/draft/new?projectId=${projectId}`)
      }

    } catch (error) {
      console.error('Failed to check patent status:', error)
      // Fallback to drafting page
      router.replace(`/patents/draft/new?projectId=${projectId}`)
    }
  }, [patentId, projectId, router])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      checkPatentStatus()
    }
  }, [authLoading, user, checkPatentStatus, router])

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading patent...</p>
        </div>
      </div>
    )
  }

  if (!user || !patent || !project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Patent Not Found</h2>
          <p className="text-gray-600 mb-4">The patent you&apos;re looking for could not be found.</p>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700"
          >
            Back to Project
          </Link>
        </div>
      </div>
    )
  }

  // This component now just redirects - it should never reach this render
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Redirecting...</p>
      </div>
    </div>
  )
}
