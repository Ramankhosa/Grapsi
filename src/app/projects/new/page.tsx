'use client'

import { type KeyboardEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, FolderOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import LoadingBird from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

export default function NewProjectPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const router = useRouter()
  const [projectName, setProjectName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreateProject = async () => {
    const trimmedName = projectName.trim()
    if (!trimmedName) {
      setError('Project name is required')
      return
    }

    setIsCreating(true)
    setError('')

    try {
      const response = await authFetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to create project')
      }

      router.push(`/projects/${payload.project.id}`)
    } catch (err) {
      console.error('Failed to create project:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !isCreating) {
      void handleCreateProject()
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7] flex items-center justify-center">
        <LoadingBird message="Loading..." useKishoFallback={true} />
      </div>
    )
  }

  if (!user) {
    router.push('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7]">
      <header className="bg-white shadow-sm border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <Link href="/projects" className="text-[#64748B] hover:text-[#475569] transition-colors">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-[#1E293B]">Create New Project</h1>
                <p className="text-[#64748B] text-lg">
                  Start a workspace, then upload the funding call from inside the project.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-[#334155]">{user.email}</div>
                <div className="text-xs text-[#64748B]">Role: {user.roles?.join(', ') || 'None'}</div>
              </div>
              <Link href="/projects">
                <Button variant="outline" className="text-[#334155] border-[#E5E7EB] hover:bg-[#F8FAFC]">
                  Back to Projects
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <Card className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm">
          <CardHeader className="pb-6">
            <CardTitle className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-[#059669] rounded-full flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#1E293B]">Project Details</h2>
                <p className="text-[#64748B] text-sm">Give this grant workspace a clear name.</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="projectName" className="text-sm font-medium text-[#374151]">
                Project Name *
              </Label>
              <Input
                id="projectName"
                type="text"
                placeholder="e.g., ICSSR NSTC 2026 proposal"
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value)
                  if (error) setError('')
                }}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 border border-[#D1D5DB] rounded-lg focus:ring-2 focus:ring-[#059669] focus:border-[#059669]"
                disabled={isCreating}
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-4">
              <h3 className="text-sm font-medium text-[#374151] mb-2">What happens next:</h3>
              <ul className="space-y-2 text-sm text-[#64748B]">
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Open the project workspace.</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Upload or paste the funding call inside that project.</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Add guideline text and an optional funder template.</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Launch Grant Prep with the fallback template if no template is provided.</span>
                </li>
              </ul>
            </div>

            <div className="flex space-x-4 pt-4">
              <Link href="/projects" className="flex-1">
                <Button variant="outline" className="w-full" disabled={isCreating}>
                  Cancel
                </Button>
              </Link>
              <Button
                onClick={() => void handleCreateProject()}
                disabled={!projectName.trim() || isCreating}
                className="flex-1 bg-[#059669] text-white hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <FolderOpen className="w-5 h-5 mr-2" />
                    Create Project
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
