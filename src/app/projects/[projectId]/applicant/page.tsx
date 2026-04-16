'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import { ApplicantProfileForm } from '@/components/ApplicantProfileForm'

interface Project {
  id: string
  name: string
  applicantProfile?: {
    id: string
    applicantLegalName: string
    applicantCategory: string
    applicantAddressLine1: string
    applicantAddressLine2?: string
    applicantCity: string
    applicantState: string
    applicantCountryCode: string
    applicantPostalCode: string
    correspondenceName: string
    correspondenceEmail: string
    correspondencePhone: string
    correspondenceAddressLine1: string
    correspondenceAddressLine2?: string
    correspondenceCity: string
    correspondenceState: string
    correspondenceCountryCode: string
    correspondencePostalCode: string
    useAgent: boolean
    agentName?: string
    agentRegistrationNo?: string
    agentEmail?: string
    agentPhone?: string
    agentAddressLine1?: string
    agentAddressLine2?: string
    agentCity?: string
    agentState?: string
    agentCountryCode?: string
    agentPostalCode?: string
    defaultJurisdiction: string
    defaultRoute: string
    defaultLanguage: string
    defaultEntityStatusIn: string
  }
}

export default function ApplicantProfilePage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string

  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!authLoading && user && projectId) {
      const fetchProject = async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })
          if (response.ok) {
            const data = await response.json()
            setProject(data.project)
          } else if (response.status === 404) {
            router.push('/dashboard')
          }
        } catch (error) {
          console.error('Failed to fetch project:', error)
          router.push('/dashboard')
        } finally {
          setIsLoading(false)
        }
      }
      fetchProject()
    }
  }, [authLoading, user, projectId, router])

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gpt-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gpt-blue-600"></div>
      </div>
    )
  }

  if (!user || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-gpt-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gpt-gray-900">Applicant Profile</h1>
              <p className="mt-2 text-gpt-gray-600">
                Configure the applicant details for project: <span className="font-medium">{project.name}</span>
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>

        {/* Form */}
        <ApplicantProfileForm
          projectId={projectId}
          initialData={project.applicantProfile ? {
            ...project.applicantProfile,
            applicantCategory: project.applicantProfile.applicantCategory as any,
            defaultJurisdiction: project.applicantProfile.defaultJurisdiction as any,
            defaultRoute: project.applicantProfile.defaultRoute as any,
            defaultEntityStatusIn: project.applicantProfile.defaultEntityStatusIn as any,
          } : undefined}
          onSuccess={() => {
            // Could show a success message or redirect
            router.push('/dashboard')
          }}
        />
      </div>
    </div>
  )
}
