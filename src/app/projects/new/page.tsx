'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, FolderOpen, CheckCircle } from 'lucide-react'
import LoadingBird from '@/components/ui/loading-bird'

export default function NewProjectPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [projectName, setProjectName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      setError('Project name is required')
      return
    }

    setIsCreating(true)
    setError('')

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name: projectName.trim() })
      })

      if (response.ok) {
        const data = await response.json()
        router.push(`/projects/${data.project.id}`)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to create project')
      }
    } catch (error) {
      console.error('Failed to create project:', error)
      setError('An unexpected error occurred')
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      handleCreateProject()
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
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <Link href="/projects" className="text-[#64748B] hover:text-[#475569] transition-colors">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-[#1E293B]">Create New Project</h1>
                <p className="text-[#64748B] text-lg">Start a new project to organize your patent work</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-[#334155]">{user?.email}</div>
                <div className="text-xs text-[#64748B]">Role: {user?.roles?.join(', ') || 'None'}</div>
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
              <div className="w-12 h-12 bg-[#4C5EFF] rounded-full flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#1E293B]">Project Details</h2>
                <p className="text-[#64748B] text-sm">Give your project a clear, descriptive name</p>
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
                placeholder="e.g., AI-Powered Medical Diagnostics"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value)
                  if (error) setError('')
                }}
                onKeyPress={handleKeyPress}
                className="w-full px-4 py-3 border border-[#D1D5DB] rounded-lg focus:ring-2 focus:ring-[#4C5EFF] focus:border-[#4C5EFF]"
                disabled={isCreating}
              />
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg p-4">
              <h3 className="text-sm font-medium text-[#374151] mb-2">What you&apos;ll get:</h3>
              <ul className="space-y-2 text-sm text-[#64748B]">
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Organized patent management</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Collaborator management</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Draft tracking and progress monitoring</span>
                </li>
                <li className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>Applicant profile integration</span>
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
                onClick={handleCreateProject}
                disabled={!projectName.trim() || isCreating}
                className="flex-1 bg-[#4C5EFF] text-white hover:bg-[#3B4ACC] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
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
