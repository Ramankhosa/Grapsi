'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Collaborator {
  id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string
  }
}

interface Project {
  id: string
  name: string
  createdAt: string
  collaborators?: Collaborator[]
}

export default function ProjectSetupPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentCollaborator, setCurrentCollaborator] = useState('')
  const [isAddingCollaborator, setIsAddingCollaborator] = useState(false)

  const fetchProject = useCallback(async () => {
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
      } else {
        console.error('Failed to fetch project')
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Failed to fetch project:', error)
      router.push('/dashboard')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, router])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProject()
    }
  }, [authLoading, user, fetchProject, router])

  const addCollaborator = async () => {
    if (!currentCollaborator.trim() || !project) return

    setIsAddingCollaborator(true)
    try {
      const response = await fetch(`/api/projects/${project.id}/collaborators`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ userId: currentCollaborator.trim() }),
      })

      if (response.ok) {
        const data = await response.json()
        setProject(data.project)
        setCurrentCollaborator('')
      } else {
        const error = await response.text()
        console.error('Failed to add collaborator:', error)
        alert('Failed to add collaborator. Please check the user ID or email address.')
      }
    } catch (error) {
      console.error('Failed to add collaborator:', error)
      alert('Failed to add collaborator.')
    } finally {
      setIsAddingCollaborator(false)
    }
  }

  const removeCollaborator = async (collaboratorId: string) => {
    if (!project) return

    try {
      const response = await fetch(`/api/projects/${project.id}/collaborators/${collaboratorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
      })

      if (response.ok) {
        const data = await response.json()
        setProject(data.project)
      } else {
        console.error('Failed to remove collaborator')
        alert('Failed to remove collaborator.')
      }
    } catch (error) {
      console.error('Failed to remove collaborator:', error)
      alert('Failed to remove collaborator.')
    }
  }

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
      <div className="max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-gpt-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gpt-gray-900 mb-4">
            Project Created Successfully!
          </h1>
          <p className="text-lg text-gpt-gray-600 mb-2">
            Your project <span className="font-semibold text-gpt-gray-900">&quot;{project.name}&quot;</span> has been created.
          </p>
          <p className="text-gpt-gray-600">
            To get started, you&apos;ll need an applicant profile for patent filings.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
          <h2 className="text-xl font-semibold text-gpt-gray-900 mb-6 text-center">
            Manage Project: {project.name}
          </h2>

          {/* Add Collaborator Section */}
          <div className="mb-6 p-4 bg-gpt-gray-50 rounded-lg">
            <h3 className="text-lg font-medium text-gpt-gray-900 mb-3">Add Collaborator</h3>
            <div className="flex space-x-2">
              <input
                type="text"
                value={currentCollaborator}
                onChange={(e) => setCurrentCollaborator(e.target.value)}
                placeholder="Enter user ID or email address"
                className="appearance-none relative block flex-1 px-3 py-2 border border-gpt-gray-300 placeholder-gpt-gray-500 text-gpt-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gpt-blue-500 focus:border-transparent transition-all duration-200"
              />
              <button
                onClick={addCollaborator}
                disabled={!currentCollaborator.trim() || isAddingCollaborator}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-green-600 hover:bg-gpt-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isAddingCollaborator ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Adding...
                  </>
                ) : (
                  'Add'
                )}
              </button>
            </div>
          </div>

          {/* Current Collaborators */}
          {project.collaborators && project.collaborators.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gpt-gray-900 mb-3">
                Current Collaborators ({project.collaborators.length})
              </h3>
              <div className="space-y-2">
                {project.collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className="flex items-center justify-between p-3 bg-gpt-gray-50 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {collaborator.user.name?.charAt(0) || collaborator.user.email.charAt(0) || 'U'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gpt-gray-900">
                          {collaborator.user.name || collaborator.user.email}
                        </p>
                        <p className="text-xs text-gpt-gray-500">{collaborator.role}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCollaborator(collaborator.id)}
                      className="inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-all duration-200"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gpt-gray-200 pt-6">
            <h2 className="text-xl font-semibold text-gpt-gray-900 mb-6 text-center">
              Set up your applicant profile
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Add Profile Option */}
              <div className="border border-gpt-gray-200 rounded-lg p-6 hover:border-gpt-blue-300 transition-colors">
                <div className="text-center mb-4">
                  <div className="w-12 h-12 bg-gpt-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gpt-gray-900 mb-2">
                    Add Applicant Profile
                  </h3>
                  <p className="text-sm text-gpt-gray-600 mb-4">
                    Set up your organization details, contact information, and patent filing preferences.
                  </p>
                </div>
                <Link
                  href={`/projects/${projectId}/applicant`}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                >
                  Add Profile
                </Link>
              </div>

              {/* Add Patent Option */}
              <div className="border border-gpt-gray-200 rounded-lg p-6 hover:border-gpt-blue-300 transition-colors">
                <div className="text-center mb-4">
                  <div className="w-12 h-12 bg-gpt-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gpt-gray-900 mb-2">
                    Add Patent
                  </h3>
                  <p className="text-sm text-gpt-gray-600 mb-4">
                    Start creating your first patent application for this project.
                  </p>
                </div>
                <Link
                  href={`/patents/draft/new?projectId=${projectId}`}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                >
                  Add Patent
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
          >
            Back to Dashboard
          </Link>
          <p className="text-sm text-gpt-gray-500 mt-4">
            You can always access your project from the dashboard to manage collaborators, add patents, or set up applicant profiles.
          </p>
        </div>
      </div>
    </div>
  )
}
