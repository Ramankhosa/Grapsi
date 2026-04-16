'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// Types
interface Campaign {
  id: string
  name: string
  description: string | null
  status: string
  totalInvites: number
  sentCount: number
  deliveredCount: number
  openedCount: number
  clickedCount: number
  signedUpCount: number
  bouncedCount: number
  createdAt: string
  inviteCount: number
  // Trial Plan Limits
  trialDurationDays: number | null
  patentDraftLimit: number | null
  noveltySearchLimit: number | null
  ideationRunLimit: number | null
  priorArtSearchLimit: number | null
  diagramLimit: number | null
  totalTokenBudget: number | null
}

interface InviteImport {
  email: string
  firstName?: string
  lastName?: string
  country?: string
  company?: string
  jobTitle?: string
}

export default function TrialCampaignsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'invites' | 'users' | 'analytics'>('overview')

  // Check auth
  useEffect(() => {
    if (user && !user.roles?.includes('SUPER_ADMIN')) {
      router.push('/dashboard')
    }
  }, [user, router])

  // Fetch campaigns
  useEffect(() => {
    fetchCampaigns()
  }, [])

  const fetchCampaigns = async () => {
    try {
      const response = await fetch('/api/v1/platform/trial-campaigns', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setCampaigns(data.campaigns)
      } else {
        setError('Failed to load campaigns')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-green-100 text-green-800'
      case 'DRAFT': return 'bg-gray-100 text-gray-800'
      case 'PAUSED': return 'bg-yellow-100 text-yellow-800'
      case 'COMPLETED': return 'bg-blue-100 text-blue-800'
      case 'ARCHIVED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const calculateConversionRate = (campaign: Campaign) => {
    if (campaign.sentCount === 0) return '0%'
    return ((campaign.signedUpCount / campaign.sentCount) * 100).toFixed(1) + '%'
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <div className="flex items-center gap-3">
                <Link href="/dashboard" className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">Trial Invite Campaigns</h1>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Manage trial access invitations and track conversions
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <svg className="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Campaign
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-indigo-100">
                <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total Campaigns</p>
                <p className="text-2xl font-bold text-gray-900">{campaigns.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Emails Sent</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.reduce((sum, c) => sum + c.sentCount, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Signups</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.reduce((sum, c) => sum + c.signedUpCount, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100">
                <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Avg. Conversion</p>
                <p className="text-2xl font-bold text-gray-900">
                  {campaigns.length > 0 
                    ? (campaigns.reduce((sum, c) => sum + (c.sentCount > 0 ? (c.signedUpCount / c.sentCount) * 100 : 0), 0) / campaigns.length).toFixed(1) + '%'
                    : '0%'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Campaign List */}
        {campaigns.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No campaigns yet</h3>
            <p className="mt-2 text-gray-500">Get started by creating your first trial invite campaign.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-6 inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map(campaign => (
              <div
                key={campaign.id}
                className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  setSelectedCampaign(campaign)
                  setActiveTab('overview')
                }}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(campaign.status)}`}>
                            {campaign.status}
                          </span>
                        </div>
                        {campaign.description && (
                          <p className="mt-1 text-sm text-gray-500">{campaign.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      {/* Mini Funnel */}
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-gray-900">{campaign.totalInvites}</p>
                          <p className="text-xs text-gray-500">Invites</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-600">{campaign.sentCount}</p>
                          <p className="text-xs text-gray-500">Sent</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-indigo-600">{campaign.openedCount}</p>
                          <p className="text-xs text-gray-500">Opened</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-green-600">{campaign.signedUpCount}</p>
                          <p className="text-xs text-gray-500">Signed Up</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-green-600">{calculateConversionRate(campaign)}</p>
                        <p className="text-xs text-gray-500">Conversion</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <CreateCampaignModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(campaign) => {
            setCampaigns(prev => [campaign, ...prev])
            setShowCreateModal(false)
            setSelectedCampaign(campaign)
          }}
        />
      )}

      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <CampaignDetailModal
          campaign={selectedCampaign}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setSelectedCampaign(null)}
          onUpdate={(updated) => {
            setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c))
            setSelectedCampaign(updated)
          }}
        />
      )}
    </div>
  )
}

// Create Campaign Modal Component
function CreateCampaignModal({ 
  onClose, 
  onCreated 
}: { 
  onClose: () => void
  onCreated: (campaign: Campaign) => void 
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [emailSubject, setEmailSubject] = useState("You're Invited to Try Our Patent Platform")
  const [trialDays, setTrialDays] = useState(14)
  const [expiryDays, setExpiryDays] = useState(30)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [emailTemplate, setEmailTemplate] = useState('')
  const [showLimitsEditor, setShowLimitsEditor] = useState(false)
  // Trial Plan Limits (null = use defaults)
  const [patentLimit, setPatentLimit] = useState<number | ''>('')
  const [noveltyLimit, setNoveltyLimit] = useState<number | ''>('')
  const [ideationLimit, setIdeationLimit] = useState<number | ''>('')
  const [priorArtLimit, setPriorArtLimit] = useState<number | ''>('')
  const [diagramLimit, setDiagramLimit] = useState<number | ''>('')
  const [tokenBudget, setTokenBudget] = useState<number | ''>('') // Empty = use default (500K)

  const defaultTemplate = `Hi {{firstName}},

You've been personally invited to try our AI-powered patent drafting platform!

🎯 Novelty Search: AI-powered prior art analysis
📝 Smart Drafting: Generate claims and specifications  
🔒 Secure: Your data stays private and protected

Click below to start your free trial:
{{inviteLink}}

This invitation expires on {{expiryDate}}.

Best regards,
The Patent Platform Team`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/v1/platform/trial-campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          name,
          description: description || undefined,
          emailSubject,
          emailTemplate: emailTemplate || defaultTemplate,
          trialDurationDays: trialDays,
          inviteExpiryDays: expiryDays,
          // Trial limits (only send if explicitly set - empty string means use defaults)
          // Note: We check !== '' to allow 0 as a valid explicit value
          ...(patentLimit !== '' && { patentDraftLimit: patentLimit }),
          ...(noveltyLimit !== '' && { noveltySearchLimit: noveltyLimit }),
          ...(ideationLimit !== '' && { ideationRunLimit: ideationLimit }),
          ...(priorArtLimit !== '' && { priorArtSearchLimit: priorArtLimit }),
          ...(diagramLimit !== '' && { diagramLimit: diagramLimit }),
          ...(tokenBudget !== '' && { totalTokenBudget: tokenBudget })
        })
      })

      const data = await response.json()

      if (response.ok) {
        onCreated({ ...data, inviteCount: 0 })
      } else {
        setError(data.message || 'Failed to create campaign')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Create New Campaign</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., Q1 2025 Product Launch"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional campaign description..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email Subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Trial Duration (days)</label>
              <input
                type="number"
                value={trialDays}
                onChange={(e) => setTrialDays(parseInt(e.target.value))}
                min={1}
                max={365}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Invite Expiry (days)</label>
              <input
                type="number"
                value={expiryDays}
                onChange={(e) => setExpiryDays(parseInt(e.target.value))}
                min={1}
                max={365}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Email Template Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              type="button"
              onClick={() => setShowTemplateEditor(!showTemplateEditor)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 rounded-lg"
            >
              <span className="text-sm font-medium text-gray-700">
                ✉️ Customize Email Template
              </span>
              <svg 
                className={`w-5 h-5 text-gray-400 transition-transform ${showTemplateEditor ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showTemplateEditor && (
              <div className="px-4 pb-4 space-y-3">
                <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                  <strong>Available variables:</strong>
                  <code className="ml-2">{'{{firstName}}'}</code>
                  <code className="ml-2">{'{{lastName}}'}</code>
                  <code className="ml-2">{'{{email}}'}</code>
                  <code className="ml-2">{'{{inviteLink}}'}</code>
                  <code className="ml-2">{'{{expiryDate}}'}</code>
                </div>
                <textarea
                  value={emailTemplate || defaultTemplate}
                  onChange={(e) => setEmailTemplate(e.target.value)}
                  rows={12}
                  placeholder={defaultTemplate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEmailTemplate(defaultTemplate)}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    Reset to Default
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setEmailTemplate('')}
                    className="text-xs text-gray-600 hover:text-gray-800"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Trial Plan Limits Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              type="button"
              onClick={() => setShowLimitsEditor(!showLimitsEditor)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 rounded-lg"
            >
              <span className="text-sm font-medium text-gray-700">
                📊 Configure Trial Limits
              </span>
              <svg 
                className={`w-5 h-5 text-gray-400 transition-transform ${showLimitsEditor ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showLimitsEditor && (
              <div className="px-4 pb-4 space-y-4">
                <p className="text-xs text-gray-500">
                  Set usage limits for trial users. Leave empty to use defaults (3 patents, 10 searches, etc.)
                </p>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      📝 Patent Drafts
                    </label>
                    <input
                      type="number"
                      value={patentLimit}
                      onChange={(e) => setPatentLimit(e.target.value ? parseInt(e.target.value) : '')}
                      min={1}
                      max={100}
                      placeholder="3"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      🔍 Novelty Searches
                    </label>
                    <input
                      type="number"
                      value={noveltyLimit}
                      onChange={(e) => setNoveltyLimit(e.target.value ? parseInt(e.target.value) : '')}
                      min={1}
                      max={100}
                      placeholder="10"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      💡 Ideation Runs
                    </label>
                    <input
                      type="number"
                      value={ideationLimit}
                      onChange={(e) => setIdeationLimit(e.target.value ? parseInt(e.target.value) : '')}
                      min={1}
                      max={100}
                      placeholder="5"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      📚 Prior Art Searches
                    </label>
                    <input
                      type="number"
                      value={priorArtLimit}
                      onChange={(e) => setPriorArtLimit(e.target.value ? parseInt(e.target.value) : '')}
                      min={1}
                      max={100}
                      placeholder="10"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      🎨 Diagrams
                    </label>
                    <input
                      type="number"
                      value={diagramLimit}
                      onChange={(e) => setDiagramLimit(e.target.value ? parseInt(e.target.value) : '')}
                      min={1}
                      max={200}
                      placeholder="20"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      🪙 Token Budget (Safety Cap)
                    </label>
                    <input
                      type="number"
                      value={tokenBudget}
                      onChange={(e) => setTokenBudget(e.target.value ? parseInt(e.target.value) : '')}
                      min={10000}
                      max={1000000}
                      step={10000}
                      placeholder="70000"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
                  <strong>⚠️ Token Budget is the SAFETY CAP:</strong> Trial ends when <em>either</em> time expires, feature limits hit, <em>or</em> token budget exhausted — whichever comes first. This prevents abuse from users who regenerate content endlessly.
                </div>
                <div className="bg-indigo-50 rounded-lg p-3 text-xs text-indigo-700">
                  <strong>Default Limits:</strong> 3 patents, 10 novelty searches, 5 ideation runs, 10 prior art searches, 20 diagrams, <strong>70K tokens</strong>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Campaign Detail Modal with Tabs
function CampaignDetailModal({
  campaign,
  activeTab,
  setActiveTab,
  onClose,
  onUpdate
}: {
  campaign: Campaign
  activeTab: 'overview' | 'invites' | 'users' | 'analytics'
  setActiveTab: (tab: 'overview' | 'invites' | 'users' | 'analytics') => void
  onClose: () => void
  onUpdate: (campaign: Campaign) => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{campaign.name}</h2>
              {campaign.description && (
                <p className="mt-1 text-sm text-gray-500">{campaign.description}</p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-6 bg-gray-100 p-1 rounded-lg w-fit">
            {(['overview', 'invites', 'users', 'analytics'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && <CampaignOverview campaign={campaign} onUpdate={onUpdate} />}
          {activeTab === 'invites' && <CampaignInvites campaign={campaign} onUpdate={onUpdate} />}
          {activeTab === 'users' && <CampaignUsers campaign={campaign} />}
          {activeTab === 'analytics' && <CampaignAnalytics campaign={campaign} />}
        </div>
      </div>
    </div>
  )
}

// Overview Tab with Editable Trial Limits
function CampaignOverview({ campaign, onUpdate }: { campaign: Campaign; onUpdate?: (c: Campaign) => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editError, setEditError] = useState('')
  
  // Editable limits
  const [patentLimit, setPatentLimit] = useState<number | ''>(campaign.patentDraftLimit || '')
  const [noveltyLimit, setNoveltyLimit] = useState<number | ''>(campaign.noveltySearchLimit || '')
  const [ideationLimit, setIdeationLimit] = useState<number | ''>(campaign.ideationRunLimit || '')
  const [priorArtLimit, setPriorArtLimit] = useState<number | ''>(campaign.priorArtSearchLimit || '')
  const [diagramLimitVal, setDiagramLimitVal] = useState<number | ''>(campaign.diagramLimit || '')
  const [tokenBudgetVal, setTokenBudgetVal] = useState<number | ''>(campaign.totalTokenBudget || '')
  const [trialDays, setTrialDays] = useState<number>(campaign.trialDurationDays || 14)

  const handleSaveLimits = async () => {
    setIsSaving(true)
    setEditError('')
    
    try {
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          trialDurationDays: trialDays,
          patentDraftLimit: patentLimit || null,
          noveltySearchLimit: noveltyLimit || null,
          ideationRunLimit: ideationLimit || null,
          priorArtSearchLimit: priorArtLimit || null,
          diagramLimit: diagramLimitVal || null,
          totalTokenBudget: tokenBudgetVal || null
        })
      })
      
      if (response.ok) {
        const updated = await response.json()
        onUpdate?.(updated)
        setIsEditing(false)
      } else {
        const data = await response.json()
        setEditError(data.message || 'Failed to update')
      }
    } catch (err) {
      setEditError('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Funnel Visualization */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversion Funnel</h3>
        <div className="flex items-center justify-between">
          {[
            { label: 'Total Invites', value: campaign.totalInvites, color: 'bg-gray-500' },
            { label: 'Sent', value: campaign.sentCount, color: 'bg-blue-500' },
            { label: 'Opened', value: campaign.openedCount, color: 'bg-indigo-500' },
            { label: 'Clicked', value: campaign.clickedCount, color: 'bg-purple-500' },
            { label: 'Signed Up', value: campaign.signedUpCount, color: 'bg-green-500' }
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center">
              <div className="text-center">
                <div className={`w-16 h-16 rounded-full ${step.color} flex items-center justify-center`}>
                  <span className="text-xl font-bold text-white">{step.value}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-700">{step.label}</p>
                {i > 0 && arr[i - 1].value > 0 && (
                  <p className="text-xs text-gray-500">
                    {((step.value / arr[i - 1].value) * 100).toFixed(0)}%
                  </p>
                )}
              </div>
              {i < arr.length - 1 && (
                <svg className="w-8 h-8 mx-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-500">Open Rate</p>
          <p className="text-2xl font-bold text-indigo-600">
            {campaign.sentCount > 0 ? ((campaign.openedCount / campaign.sentCount) * 100).toFixed(1) : 0}%
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-500">Click Rate</p>
          <p className="text-2xl font-bold text-purple-600">
            {campaign.openedCount > 0 ? ((campaign.clickedCount / campaign.openedCount) * 100).toFixed(1) : 0}%
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-500">Bounce Rate</p>
          <p className="text-2xl font-bold text-red-600">
            {campaign.sentCount > 0 ? ((campaign.bouncedCount / campaign.sentCount) * 100).toFixed(1) : 0}%
          </p>
        </div>
      </div>

      {/* Trial Plan Limits - Editable */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">📊 Trial Plan Limits</h3>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Limits
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLimits}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {editError && (
          <div className="mb-4 p-2 bg-red-50 text-red-700 text-sm rounded-lg">{editError}</div>
        )}

        {isEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">⏰ Trial Days</label>
                <input
                  type="number"
                  value={trialDays}
                  onChange={(e) => setTrialDays(parseInt(e.target.value) || 14)}
                  min={1}
                  max={365}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">📝 Patents</label>
                <input
                  type="number"
                  value={patentLimit}
                  onChange={(e) => setPatentLimit(e.target.value ? parseInt(e.target.value) : '')}
                  min={1}
                  max={100}
                  placeholder="3"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">🔍 Novelty</label>
                <input
                  type="number"
                  value={noveltyLimit}
                  onChange={(e) => setNoveltyLimit(e.target.value ? parseInt(e.target.value) : '')}
                  min={1}
                  max={100}
                  placeholder="10"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">💡 Ideation</label>
                <input
                  type="number"
                  value={ideationLimit}
                  onChange={(e) => setIdeationLimit(e.target.value ? parseInt(e.target.value) : '')}
                  min={1}
                  max={100}
                  placeholder="5"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">📚 Prior Art</label>
                <input
                  type="number"
                  value={priorArtLimit}
                  onChange={(e) => setPriorArtLimit(e.target.value ? parseInt(e.target.value) : '')}
                  min={1}
                  max={100}
                  placeholder="10"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">🎨 Diagrams</label>
                <input
                  type="number"
                  value={diagramLimitVal}
                  onChange={(e) => setDiagramLimitVal(e.target.value ? parseInt(e.target.value) : '')}
                  min={1}
                  max={200}
                  placeholder="20"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">🪙 Token Budget (Safety Cap)</label>
                <input
                  type="number"
                  value={tokenBudgetVal}
                  onChange={(e) => setTokenBudgetVal(e.target.value ? parseInt(e.target.value) : '')}
                  min={10000}
                  max={1000000}
                  step={10000}
                  placeholder="70000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Leave empty to use defaults. Changes apply immediately to all trial users from this campaign.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">⏰ Trial Duration</p>
              <p className="font-semibold text-gray-900">{campaign.trialDurationDays || 14} days</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">📝 Patent Drafts</p>
              <p className="font-semibold text-gray-900">{campaign.patentDraftLimit || '3 (default)'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">🔍 Novelty Searches</p>
              <p className="font-semibold text-gray-900">{campaign.noveltySearchLimit || '10 (default)'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">💡 Ideation Runs</p>
              <p className="font-semibold text-gray-900">{campaign.ideationRunLimit || '5 (default)'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">📚 Prior Art</p>
              <p className="font-semibold text-gray-900">{campaign.priorArtSearchLimit || '10 (default)'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">🎨 Diagrams</p>
              <p className="font-semibold text-gray-900">{campaign.diagramLimit || '20 (default)'}</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 col-span-2">
              <p className="text-amber-700 text-xs">🪙 Token Budget (Safety Cap)</p>
              <p className="font-semibold text-amber-900">{campaign.totalTokenBudget ? `${(campaign.totalTokenBudget / 1000).toFixed(0)}K` : '70K (default)'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Campaign Info */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Details</h3>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium text-gray-900">{campaign.status}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="font-medium text-gray-900">{new Date(campaign.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

// Invites Tab with Import and Send
function CampaignInvites({ campaign, onUpdate }: { campaign: Campaign; onUpdate: (c: Campaign) => void }) {
  const [invites, setInvites] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSending, setIsSending] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    fetchInvites()
  }, [campaign.id, statusFilter])

  const fetchInvites = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}/invites?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setInvites(data.invites)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendSelected = async () => {
    if (selectedIds.size === 0) return
    setIsSending(true)
    
    try {
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ inviteIds: Array.from(selectedIds) })
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(`Sent ${data.sent} emails (${data.failed} failed)`)
        fetchInvites()
        setSelectedIds(new Set())
        // Refresh campaign stats
        const campaignRes = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        })
        if (campaignRes.ok) {
          onUpdate(await campaignRes.json())
        }
      }
    } catch (err) {
      alert('Failed to send')
    } finally {
      setIsSending(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-gray-100 text-gray-700',
      SCHEDULED: 'bg-yellow-100 text-yellow-700',
      SENT: 'bg-blue-100 text-blue-700',
      OPENED: 'bg-indigo-100 text-indigo-700',
      CLICKED: 'bg-purple-100 text-purple-700',
      SIGNED_UP: 'bg-green-100 text-green-700',
      BOUNCED: 'bg-red-100 text-red-700',
      FAILED: 'bg-red-100 text-red-700',
      EXPIRED: 'bg-gray-100 text-gray-500'
    }
    return colors[status] || 'bg-gray-100 text-gray-700'
  }

  // Export invites to CSV
  const exportInvitesCSV = () => {
    if (invites.length === 0) return
    
    const headers = ['Email', 'First Name', 'Last Name', 'Country', 'Status', 'Sent At', 'Opened At', 'Clicked At', 'Signed Up At', 'Open Count', 'Click Count']
    const rows = invites.map(i => [
      i.email,
      i.firstName || '',
      i.lastName || '',
      i.country || '',
      i.status,
      i.sentAt ? new Date(i.sentAt).toLocaleString() : '',
      i.openedAt ? new Date(i.openedAt).toLocaleString() : '',
      i.clickedAt ? new Date(i.clickedAt).toLocaleString() : '',
      i.signedUpAt ? new Date(i.signedUpAt).toLocaleString() : '',
      i.openCount || 0,
      i.clickCount || 0
    ])
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invites-${campaign.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="OPENED">Opened</option>
            <option value="CLICKED">Clicked</option>
            <option value="SIGNED_UP">Signed Up</option>
            <option value="BOUNCED">Bounced</option>
          </select>
          <span className="text-sm text-gray-500">{invites.length} invites</span>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              onClick={handleSendSelected}
              disabled={isSending}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSending ? 'Sending...' : `Send ${selectedIds.size} Selected`}
            </button>
          )}
          {invites.length > 0 && (
            <button
              onClick={exportInvitesCSV}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1"
              title="Export invites to CSV"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export
            </button>
          )}
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg text-sm hover:bg-indigo-50"
          >
            Import CSV
          </button>
        </div>
      </div>

      {/* Invites Table */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <p className="text-gray-500">No invites yet. Import a CSV to get started.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === invites.filter(i => i.status === 'PENDING' || i.status === 'FAILED').length && selectedIds.size > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(invites.filter(i => i.status === 'PENDING' || i.status === 'FAILED').map(i => i.id)))
                      } else {
                        setSelectedIds(new Set())
                      }
                    }}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Country</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {invites.map(invite => (
                <tr key={invite.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {(invite.status === 'PENDING' || invite.status === 'FAILED') && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(invite.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedIds)
                          if (e.target.checked) {
                            newSet.add(invite.id)
                          } else {
                            newSet.delete(invite.id)
                          }
                          setSelectedIds(newSet)
                        }}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{[invite.firstName, invite.lastName].filter(Boolean).join(' ') || '-'}</p>
                      <p className="text-sm text-gray-500">{invite.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{invite.country || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(invite.status)}`}>
                      {invite.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {invite.openCount > 0 && <span className="mr-2">👁 {invite.openCount}</span>}
                    {invite.clickCount > 0 && <span>🔗 {invite.clickCount}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          campaignId={campaign.id}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false)
            fetchInvites()
          }}
        />
      )}
    </div>
  )
}

// Import Modal
function ImportModal({
  campaignId,
  onClose,
  onImported
}: {
  campaignId: string
  onClose: () => void
  onImported: () => void
}) {
  const [csvText, setCsvText] = useState('')
  const [parsedData, setParsedData] = useState<any[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [step, setStep] = useState<'input' | 'preview' | 'result'>('input')

  const parseCSV = () => {
    const lines = csvText.trim().split('\n')
    if (lines.length < 2) {
      alert('CSV must have a header row and at least one data row')
      return
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const emailIndex = headers.findIndex(h => h === 'email')
    
    if (emailIndex === -1) {
      alert('CSV must have an "email" column')
      return
    }

    const data = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim())
      const row: any = {}
      headers.forEach((header, i) => {
        if (header === 'email') row.email = values[i]
        else if (header === 'firstname' || header === 'first_name') row.firstName = values[i]
        else if (header === 'lastname' || header === 'last_name') row.lastName = values[i]
        else if (header === 'country') row.country = values[i]
        else if (header === 'company') row.company = values[i]
        else if (header === 'jobtitle' || header === 'job_title') row.jobTitle = values[i]
      })
      return row
    }).filter(row => row.email)

    setParsedData(data)
    setStep('preview')
  }

  const handleImport = async () => {
    setIsImporting(true)
    try {
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaignId}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ invites: parsedData })
      })

      const data = await response.json()
      setResult(data)
      setStep('result')
    } catch (err) {
      alert('Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Import Invites</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-medium">CSV Format</p>
                <p className="mt-1">Required: email</p>
                <p>Optional: firstName, lastName, country, company, jobTitle</p>
                <code className="block mt-2 text-xs bg-blue-100 p-2 rounded">
                  email,firstName,lastName,country<br/>
                  john@example.com,John,Doe,USA
                </code>
              </div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Paste your CSV data here..."
                rows={10}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm"
              />
              <button
                onClick={parseCSV}
                disabled={!csvText.trim()}
                className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                Parse & Preview
              </button>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Found {parsedData.length} valid email addresses</p>
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Country</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedData.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{row.email}</td>
                        <td className="px-3 py-2">{[row.firstName, row.lastName].filter(Boolean).join(' ') || '-'}</td>
                        <td className="px-3 py-2">{row.country || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedData.length > 50 && (
                <p className="text-sm text-gray-500">...and {parsedData.length - 50} more</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('input')}
                  className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isImporting ? 'Importing...' : `Import ${parsedData.length} Invites`}
                </button>
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">Import Complete!</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                  <p className="text-green-700">Imported</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-yellow-600">{result.duplicates}</p>
                  <p className="text-yellow-700">Duplicates</p>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="text-left bg-red-50 rounded-lg p-3 text-sm">
                  <p className="font-medium text-red-800">{result.errors.length} errors:</p>
                  <ul className="mt-1 text-red-700 list-disc list-inside">
                    {result.errors.slice(0, 5).map((e: any, i: number) => (
                      <li key={i}>{e.email}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={onImported}
                className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Users Tab - Shows signed up users with activity
function CampaignUsers({ campaign }: { campaign: Campaign }) {
  const [users, setUsers] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchUsers()
  }, [campaign.id])

  const fetchUsers = async () => {
    try {
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}/users`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users)
        setSummary(data.summary)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const getEngagementColor = (score: number) => {
    if (score >= 70) return 'text-green-600 bg-green-100'
    if (score >= 40) return 'text-yellow-600 bg-yellow-100'
    return 'text-red-600 bg-red-100'
  }

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
      </div>
    )
  }

  // Export users to CSV
  const exportUsersCSV = () => {
    if (users.length === 0) return
    
    const headers = ['Email', 'First Name', 'Last Name', 'Company', 'Country', 'Signed Up', 'Days Active', 'Patents Drafted', 'Patents Completed', 'Novelty Searches', 'Sessions', 'Tokens Used', 'Engagement Score']
    const rows = users.map(u => [
      u.email,
      u.firstName || '',
      u.lastName || '',
      u.company || '',
      u.country || '',
      u.signedUpAt ? new Date(u.signedUpAt).toLocaleDateString() : '',
      u.daysSinceSignup || 0,
      u.activity?.patentsDrafted || 0,
      u.activity?.patentsCompleted || 0,
      u.activity?.noveltySearches || 0,
      u.activity?.draftingSessions || 0,
      u.activity?.totalTokens || 0,
      u.activity?.engagementScore || 0
    ])
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trial-users-${campaign.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="flex items-center justify-between mb-4">
          <div className="grid grid-cols-4 gap-4 flex-1">
            <div className="bg-green-50 rounded-xl p-4">
              <p className="text-3xl font-bold text-green-600">{summary.totalSignedUp}</p>
              <p className="text-sm text-green-700">Total Signups</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-3xl font-bold text-blue-600">{summary.activeUsers}</p>
              <p className="text-sm text-blue-700">Active Users</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-4">
              <p className="text-3xl font-bold text-purple-600">{summary.totalPatentsDrafted}</p>
              <p className="text-sm text-purple-700">Patents Drafted</p>
            </div>
            <div className="bg-indigo-50 rounded-xl p-4">
              <p className="text-3xl font-bold text-indigo-600">{summary.totalNoveltySearches}</p>
              <p className="text-sm text-indigo-700">Novelty Searches</p>
            </div>
          </div>
          {users.length > 0 && (
            <button
              onClick={exportUsersCSV}
              className="ml-4 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          )}
        </div>
      )}

      {/* Users Table */}
      {users.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="mt-4 text-gray-500">No users have signed up yet</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Signed Up</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Patents</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Searches</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sessions</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Tokens Used</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(user => (
                <tr key={user.inviteId} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <div>
                      <p className="font-medium text-gray-900">
                        {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                      {user.company && <p className="text-xs text-gray-400">{user.company}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm text-gray-900">
                      {user.signedUpAt ? new Date(user.signedUpAt).toLocaleDateString() : '-'}
                    </p>
                    <p className="text-xs text-gray-500">{user.daysSinceSignup} days ago</p>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-lg font-semibold text-purple-600">
                      {user.activity?.patentsDrafted || 0}
                    </span>
                    {user.activity?.patentsCompleted > 0 && (
                      <span className="text-xs text-gray-500 block">
                        ({user.activity.patentsCompleted} complete)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-lg font-semibold text-indigo-600">
                      {user.activity?.noveltySearches || 0}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-lg font-semibold text-blue-600">
                      {user.activity?.draftingSessions || 0}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-sm text-gray-600">
                      {user.activity?.totalTokens ? (user.activity.totalTokens / 1000).toFixed(1) + 'K' : '0'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${getEngagementColor(user.activity?.engagementScore || 0)}`}>
                      {user.activity?.engagementScore || 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Analytics Tab
function CampaignAnalytics({ campaign }: { campaign: Campaign }) {
  const [analytics, setAnalytics] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [campaign.id])

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`/api/v1/platform/trial-campaigns/${campaign.id}/analytics`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        setAnalytics(await response.json())
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  // Export analytics to CSV
  const exportAnalyticsCSV = () => {
    if (!analytics) return
    
    const lines = [
      ['Campaign Analytics Report'],
      [`Campaign: ${campaign.name}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [''],
      ['FUNNEL METRICS'],
      ['Metric', 'Value'],
      ['Total Invites', analytics.funnel.total],
      ['Sent', analytics.funnel.sent],
      ['Opened', analytics.funnel.opened],
      ['Clicked', analytics.funnel.clicked],
      ['Signed Up', analytics.funnel.signedUp],
      ['Bounced', analytics.funnel.bounced],
      [''],
      ['CONVERSION RATES'],
      ['Metric', 'Rate'],
      ['Delivery Rate', analytics.rates.deliveryRate + '%'],
      ['Open Rate', analytics.rates.openRate + '%'],
      ['Click Rate', analytics.rates.clickRate + '%'],
      ['Signup Rate', analytics.rates.signupRate + '%'],
      ['Overall Conversion', analytics.rates.overallConversion + '%'],
      [''],
      ['BY COUNTRY'],
      ['Country', 'Total Invites', 'Signups', 'Conversion Rate']
    ]
    
    Object.entries(analytics.byCountry).forEach(([country, data]: [string, any]) => {
      lines.push([country, data.total, data.signedUp, data.total > 0 ? ((data.signedUp / data.total) * 100).toFixed(1) + '%' : '0%'])
    })
    
    lines.push([''], ['STATUS BREAKDOWN'], ['Status', 'Count'])
    Object.entries(analytics.statusCounts).forEach(([status, count]) => {
      lines.push([status, count as number])
    })
    
    const csv = lines.map(row => Array.isArray(row) ? row.map(cell => `"${cell}"`).join(',') : row).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${campaign.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
      </div>
    )
  }

  if (!analytics) {
    return <p className="text-gray-500">Failed to load analytics</p>
  }

  return (
    <div className="space-y-6">
      {/* Export Button */}
      <div className="flex justify-end">
        <button
          onClick={exportAnalyticsCSV}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Report (CSV)
        </button>
      </div>

      {/* Conversion Rates */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversion Rates</h3>
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: 'Delivery Rate', value: analytics.rates.deliveryRate + '%', color: 'text-blue-600' },
            { label: 'Open Rate', value: analytics.rates.openRate + '%', color: 'text-indigo-600' },
            { label: 'Click Rate', value: analytics.rates.clickRate + '%', color: 'text-purple-600' },
            { label: 'Signup Rate', value: analytics.rates.signupRate + '%', color: 'text-green-600' },
            { label: 'Overall Conv.', value: analytics.rates.overallConversion + '%', color: 'text-emerald-600' }
          ].map(stat => (
            <div key={stat.label} className="text-center p-4 bg-gray-50 rounded-xl">
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* By Country */}
      {Object.keys(analytics.byCountry).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">By Country</h3>
          <div className="space-y-2">
            {Object.entries(analytics.byCountry)
              .sort((a: any, b: any) => b[1].total - a[1].total)
              .slice(0, 10)
              .map(([country, data]: [string, any]) => (
                <div key={country} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <span className="font-medium text-gray-900">{country}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">{data.total} invites</span>
                    <span className="text-sm font-medium text-green-600">{data.signedUp} signups</span>
                    <span className="text-xs text-gray-400">
                      ({data.total > 0 ? ((data.signedUp / data.total) * 100).toFixed(0) : 0}%)
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Status Breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Breakdown</h3>
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(analytics.statusCounts).map(([status, count]) => (
            <div key={status} className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xl font-bold text-gray-900">{count as number}</p>
              <p className="text-xs text-gray-500">{status}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

