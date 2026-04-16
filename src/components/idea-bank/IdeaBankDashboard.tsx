'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import IdeaCard from './IdeaCard'
import IdeaListItem from './IdeaListItem'
import IdeaDetailsModal from './IdeaDetailsModal'
import IdeaEditorModal from './IdeaEditorModal'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'

interface IdeaSearchFilters {
  query?: string
  domainTags?: string[]
  technicalField?: string
  status?: string
}

interface IdeaBankStats {
  totalIdeas: number
  publicIdeas: number
  reservedIdeas: number
  userReservations: number
}

type LayoutType = 'tile' | 'list'

export default function IdeaBankDashboard() {
  const { user } = useAuth()
  const router = useRouter()
  const [ideas, setIdeas] = useState<IdeaBankIdeaWithDetails[]>([])
  const [stats, setStats] = useState<IdeaBankStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedIdea, setSelectedIdea] = useState<IdeaBankIdeaWithDetails | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditorModal, setShowEditorModal] = useState(false)
  const [editingIdea, setEditingIdea] = useState<IdeaBankIdeaWithDetails | null>(null)

  // Layout
  const [layout, setLayout] = useState<LayoutType>('tile')
  // Page size
  const [pageSize, setPageSize] = useState<number>(20)

  // Search and filters
  const [filters, setFilters] = useState<IdeaSearchFilters>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDomain, setSelectedDomain] = useState<string>('')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  // Auto refresh
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [fadeInKey, setFadeInKey] = useState(Date.now())

  // Create idea form
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    abstract: '',
    domainTags: [] as string[],
    technicalField: '',
    keyFeatures: [] as string[],
    potentialApplications: [] as string[]
  })
  const [creatingIdea, setCreatingIdea] = useState(false)

  // Available domain tags (could be fetched from API)
  const availableDomains = [
    'AI/ML', 'IoT', 'Biotech', 'Medical Devices', 'Software', 'Hardware',
    'Energy', 'Transportation', 'Agriculture', 'Manufacturing', 'Finance', 'Other'
  ]

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch('/api/idea-bank/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        }
      })
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats)
      } else if (response.status === 403) {
        // User doesn't have access to Idea Bank
        setStats({ totalIdeas: 0, publicIdeas: 0, reservedIdeas: 0, userReservations: 0 })
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
      // Set default stats if there's an error
      setStats({ totalIdeas: 0, publicIdeas: 0, reservedIdeas: 0, userReservations: 0 })
    }
  }, [])

  const loadIdeas = useCallback(async (page: number = 1, silent: boolean = false) => {
    if (!silent) setSearchLoading(true)
    if (silent) setIsRefreshing(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: String(pageSize),
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, v]) => v !== undefined && v !== '')
        )
      })

      if (filters.domainTags?.length) {
        params.set('domainTags', filters.domainTags.join(','))
      }

      const response = await fetch(`/api/idea-bank?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        }
      })

      console.log('📡 Idea Bank API response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('✅ Idea Bank: Received', data.ideas?.length || 0, 'ideas, total:', data.totalCount)
        setIdeas(data.ideas || [])
        if (silent) {
          setFadeInKey(Date.now()) // Trigger fade-in effect for silent refreshes
        }
        setTotalPages(data.totalPages)
        setHasMore(data.currentPage < data.totalPages)
        setCurrentPage(data.currentPage)
      } else if (response.status === 403) {
        // User doesn't have access to Idea Bank
        setIdeas([])
        setTotalPages(0)
        setHasMore(false)
        if (page === 1) {
          alert('You do not have access to the Idea Bank feature. Please contact your administrator to upgrade your plan.')
        }
      }
    } catch (error) {
      console.error('Failed to load ideas:', error)
    } finally {
      if (!silent) {
        setLoading(false)
        setSearchLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }, [filters, pageSize])

  // Load initial data
  useEffect(() => {
    loadStats()
    loadIdeas()
  }, [loadIdeas, loadStats])

  // Manual refresh (subtle - only refresh ideas, not stats)
  useEffect(() => {
    if (lastRefresh > 0) {
      loadIdeas(currentPage, true) // Silent refresh for manual refresh
    }
  }, [currentPage, lastRefresh, loadIdeas])

  // Update filters when search query changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, query: searchQuery }))
      setCurrentPage(1)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Update filters when domain changes
  useEffect(() => {
    const newDomainTags = selectedDomain ? [selectedDomain] : undefined
    setFilters(prev => ({ ...prev, domainTags: newDomainTags }))
    setCurrentPage(1)
  }, [selectedDomain])

  // Load ideas whenever filters, page or page size change
  useEffect(() => {
    loadIdeas(currentPage)
  }, [currentPage, filters, loadIdeas, pageSize])

  // Auto refresh ideas every 30 seconds (only when no filters active)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only auto-refresh ideas when no active search filters
      if (!searchQuery && !selectedDomain) {
        loadIdeas(currentPage, true) // Silent refresh, no loading spinner
      }
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [currentPage, loadIdeas, searchQuery, selectedDomain])

  const handleCreateIdea = async () => {
    if (!createForm.title.trim() || !createForm.description.trim()) return

    setCreatingIdea(true)
    try {
      const response = await fetch('/api/idea-bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(createForm)
      })

      if (response.ok) {
        const data = await response.json()
        // Reload ideas to ensure proper filtering and ordering
        loadIdeas(1, true) // Silent refresh
        setShowCreateModal(false)
        setCreateForm({
          title: '',
          description: '',
          abstract: '',
          domainTags: [],
          technicalField: '',
          keyFeatures: [],
          potentialApplications: []
        })
        loadStats() // Refresh stats
      } else if (response.status === 403) {
        // This shouldn't happen since creating ideas doesn't require subscription
        alert('Failed to create idea. Please try again.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to create idea')
      }
    } catch (error) {
      console.error('Failed to create idea:', error)
      alert('Failed to create idea. Please try again.')
    } finally {
      setCreatingIdea(false)
    }
  }

  const handleReserveIdea = async (ideaId: string) => {
    // Find the idea to check its current state
    const idea = ideas.find(i => i.id === ideaId)
    if (!idea || idea.status !== 'PUBLIC' || idea._isReservedByCurrentUser) {
      return // Already reserved or not available
    }

    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Update the idea in the list
        setIdeas(prev => prev.map(idea =>
          idea.id === ideaId
            ? { ...idea, status: 'RESERVED', _isReservedByCurrentUser: true, reservedCount: idea.reservedCount + 1 }
            : idea
        ))
        loadStats() // Refresh stats
      } else if (response.status === 403) {
        alert('You do not have permission to reserve ideas. Please upgrade your plan.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to reserve idea')
      }
    } catch (error) {
      console.error('Failed to reserve idea:', error)
      alert('Failed to reserve idea. Please try again.')
    }
  }

  const handleReleaseReservation = async (ideaId: string) => {
    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/reserve`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Update the idea in the list
        setIdeas(prev => prev.map(idea =>
          idea.id === ideaId
            ? { ...idea, status: 'PUBLIC', _isReservedByCurrentUser: false }
            : idea
        ))
        loadStats() // Refresh stats
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to release reservation')
      }
    } catch (error) {
      console.error('Failed to release reservation:', error)
      alert('Failed to release reservation. Please try again.')
    }
  }

  // Helper to build merged description from idea
  const buildMergedDescription = (idea: IdeaBankIdeaWithDetails): string => {
    const parts: string[] = []
    
    if (idea.description) {
      parts.push(idea.description)
    }
    
    if (idea.abstract) {
      parts.push(`\n\n## Abstract\n${idea.abstract}`)
    }
    
    if (idea.technicalField) {
      parts.push(`\n\n## Technical Field\n${idea.technicalField}`)
    }
    
    if (idea.keyFeatures && idea.keyFeatures.length > 0) {
      parts.push(`\n\n## Key Features\n${idea.keyFeatures.map(f => `• ${f}`).join('\n')}`)
    }
    
    if (idea.potentialApplications && idea.potentialApplications.length > 0) {
      parts.push(`\n\n## Potential Applications\n${idea.potentialApplications.map(a => `• ${a}`).join('\n')}`)
    }
    
    if (idea.priorArtSummary) {
      parts.push(`\n\n## Prior Art Summary\n${idea.priorArtSummary}`)
    }
    
    const result = parts.join('') || idea.description || 'No description available'
    // Truncate to avoid URL length limits (keep under 4000 chars for safety)
    return result.length > 4000 ? result.substring(0, 4000) + '...' : result
  }

  const handleSendToSearch = (ideaId: string) => {
    const idea = ideas.find(i => i.id === ideaId)
    if (!idea) {
      alert('Idea not found')
      return
    }
    
    // Verify the idea is reserved by current user
    if (!idea._isReservedByCurrentUser) {
      alert('You must reserve this idea before sending it to novelty search')
      return
    }
    
    const mergedDescription = buildMergedDescription(idea)
    const params = new URLSearchParams({
      title: idea.title,
      description: mergedDescription,
      ideaId: ideaId
    })
    
    router.push(`/novelty-search?${params.toString()}`)
  }

  const handleSendToDrafting = (ideaId: string) => {
    const idea = ideas.find(i => i.id === ideaId)
    if (!idea) {
      alert('Idea not found')
      return
    }
    
    // Verify the idea is reserved by current user
    if (!idea._isReservedByCurrentUser) {
      alert('You must reserve this idea before sending it to drafting')
      return
    }
    
    const mergedDescription = buildMergedDescription(idea)
    const params = new URLSearchParams({
      title: idea.title,
      rawIdea: mergedDescription,
      ideaId: ideaId
    })
    
    router.push(`/patents/draft/new?${params.toString()}`)
  }

  // Pagination controls
  const goToPage = (p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p))
    if (clamped !== currentPage) setCurrentPage(clamped)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50/50 text-slate-900 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div>
              <h1 className="text-5xl font-black tracking-tight mb-2 text-slate-900">
                IDEA BANK
                <span className="ml-3 text-xl font-light text-slate-400 align-top tracking-widest">INTELLIGENCE</span>
              </h1>
              <p className="text-slate-500 text-lg max-w-2xl font-light leading-relaxed">
                Curated repository of <span className="font-medium text-cyan-600">AI-generated</span> intellectual property. 
                Identify, reserve, and cultivate high-value concepts.
              </p>
            </div>
            <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
              <DialogTrigger asChild>
                <Button className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-8 py-6 rounded-full shadow-lg shadow-slate-200 transition-all hover:scale-105 active:scale-95 border border-slate-700">
                  + Initialize Invention
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white border-slate-100 shadow-2xl sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-xl text-slate-900">Initialize New Invention</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="title" className="text-slate-700">Designation (Title) *</Label>
                    <Input
                      id="title"
                      value={createForm.title}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Enter idea title"
                      className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-slate-900/10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="description" className="text-slate-700">Core Logic (Description) *</Label>
                    <Textarea
                      id="description"
                      value={createForm.description}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe your invention idea"
                      rows={4}
                      className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-slate-900/10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="abstract" className="text-slate-700">Executive Summary (Abstract)</Label>
                    <Textarea
                      id="abstract"
                      value={createForm.abstract}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, abstract: e.target.value }))}
                      placeholder="Patent abstract (optional)"
                      rows={3}
                      className="bg-slate-50 border-slate-200 text-slate-900 focus:ring-slate-900/10"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-700">Domain Classification</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {availableDomains.map(domain => (
                        <Badge
                          key={domain}
                          variant="outline"
                          className={`cursor-pointer transition-all ${
                            createForm.domainTags.includes(domain) 
                              ? "bg-slate-900 text-white border-slate-900" 
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                          }`}
                          onClick={() => {
                            setCreateForm(prev => ({
                              ...prev,
                              domainTags: prev.domainTags.includes(domain)
                                ? prev.domainTags.filter(t => t !== domain)
                                : [...prev.domainTags, domain]
                            }))
                          }}
                        >
                          {domain}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setShowCreateModal(false)}
                      className="border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Abort
                    </Button>
                    <Button
                      onClick={handleCreateIdea}
                      disabled={creatingIdea || !createForm.title.trim() || !createForm.description.trim()}
                      className="bg-slate-900 hover:bg-slate-800 text-white"
                    >
                      {creatingIdea ? 'Initializing...' : 'Initialize'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stats HUD - Light Version */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'TOTAL ASSETS', value: stats.totalIdeas, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
                { label: 'AVAILABLE', value: stats.publicIdeas, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
                { label: 'RESERVED', value: stats.reservedIdeas, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
                { label: 'MY HOLDINGS', value: stats.userReservations, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100' },
              ].map((stat, i) => (
                <div key={i} className={`bg-white border ${stat.border} p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group`}>
                   <div className={`absolute top-0 right-0 w-24 h-24 ${stat.bg} rounded-full -mr-10 -mt-10 opacity-50 group-hover:scale-110 transition-transform duration-500`}></div>
                   <div className={`text-4xl font-bold ${stat.color} mb-2 relative z-10 tracking-tight`}>{stat.value}</div>
                   <div className="text-xs tracking-widest text-slate-400 font-semibold uppercase relative z-10">{stat.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Search and Filters - Light */}
          <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex-1 relative group">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                 <span className="text-slate-400 group-focus-within:text-cyan-500 transition-colors">🔍</span>
              </div>
              <Input
                placeholder="Search protocols, keywords, or descriptions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 border-transparent bg-slate-50 focus:bg-white focus:border-slate-200 focus:ring-0 rounded-xl transition-all h-11"
              />
            </div>
            <div className="w-full md:w-64">
               <Select value={selectedDomain} onValueChange={setSelectedDomain}>
                <SelectTrigger className="w-full border-transparent bg-slate-50 focus:bg-white focus:border-slate-200 focus:ring-0 rounded-xl h-11">
                  <SelectValue placeholder="All Sectors" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-100">
                  <SelectItem value="">All Sectors</SelectItem>
                  {availableDomains.map(domain => (
                    <SelectItem key={domain} value={domain}>{domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Layout Toggle and Refresh */}
        <div className="flex items-center justify-between mb-6 px-1">
          <div className="flex items-center gap-4">
            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(value: string) => value && setLayout(value as LayoutType)}
              className="bg-white border border-slate-200 p-1 rounded-lg shadow-sm"
            >
              <ToggleGroupItem value="tile" aria-label="Tile view" className="data-[state=on]:bg-slate-100 data-[state=on]:text-slate-900 text-slate-400 px-3 py-1.5 rounded-md transition-all">
                <span className="mr-2">⊞</span> Grid
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view" className="data-[state=on]:bg-slate-100 data-[state=on]:text-slate-900 text-slate-400 px-3 py-1.5 rounded-md transition-all">
                <span className="mr-2">☰</span> List
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="h-4 w-px bg-slate-200 mx-2"></div>
            <Button
              onClick={() => setLastRefresh(Date.now())}
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-slate-900 transition-colors"
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-slate-300 border-t-slate-600"></div>
                  <span className="text-xs uppercase tracking-wider font-medium">Syncing...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs">↻</span>
                  <span className="text-xs uppercase tracking-wider hidden sm:inline font-medium">Sync</span>
                </div>
              )}
            </Button>
          </div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider bg-white px-3 py-1 rounded-full shadow-sm border border-slate-100">
            <span className="text-slate-900">{ideas.length}</span> Records Found • Page <span className="text-slate-900">{currentPage}</span>/{totalPages}
          </div>
        </div>

        {/* Ideas Display */}
        <div
          key={fadeInKey}
          className="transition-opacity duration-500 ease-in-out opacity-100"
        >
          {searchLoading && ideas.length === 0 ? (
            <div className="flex items-center justify-center min-h-64">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
              </div>
            </div>
          ) : ideas.length === 0 ? (
            <div className="text-center py-24 bg-white border border-dashed border-slate-200 rounded-2xl shadow-sm">
              <div className="text-slate-300 mb-6">
                <svg className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-slate-900 mb-2">Database Empty</h3>
              <p className="text-slate-500">Adjust search parameters or initialize new idea.</p>
            </div>
          ) : (
            <>
              {layout === 'tile' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                  {ideas.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      onView={() => setSelectedIdea(idea)}
                      onReserve={() => handleReserveIdea(idea.id)}
                      onRelease={() => handleReleaseReservation(idea.id)}
                      onEdit={() => {
                        setEditingIdea(idea)
                        setShowEditorModal(true)
                      }}
                      onSendToSearch={() => handleSendToSearch(idea.id)}
                      onSendToDrafting={() => handleSendToDrafting(idea.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-4 mb-12">
                  {ideas.map((idea) => (
                    <IdeaListItem
                      key={idea.id}
                      idea={idea}
                      onView={() => setSelectedIdea(idea)}
                      onReserve={() => handleReserveIdea(idea.id)}
                      onRelease={() => handleReleaseReservation(idea.id)}
                      onEdit={() => {
                        setEditingIdea(idea)
                        setShowEditorModal(true)
                      }}
                      onSendToSearch={() => handleSendToSearch(idea.id)}
                      onSendToDrafting={() => handleSendToDrafting(idea.id)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination Controls */}
              <div className="flex items-center justify-between mt-8 pt-8 border-t border-slate-200">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span className="uppercase tracking-wider text-xs">Density</span>
                  <Select value={String(pageSize)} onValueChange={(v) => { setCurrentPage(1); setPageSize(parseInt(v, 10)); }}>
                    <SelectTrigger className="w-20 h-9 bg-white border-slate-200 text-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-700">
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage <= 1 || searchLoading} onClick={() => goToPage(currentPage - 1)}
                    className="bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                    Prev
                  </Button>
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    const span = 3
                    let start = Math.max(1, currentPage - span)
                    let end = Math.min(totalPages, currentPage + span)
                    if (end - start < 6) {
                      if (start === 1) end = Math.min(totalPages, start + 6)
                      else if (end === totalPages) start = Math.max(1, end - 6)
                    }
                    const pageNums = [] as number[]
                    for (let p = start; p <= end; p++) pageNums.push(p)
                    return (
                      <span key={`pg-${i}`} className="flex items-center gap-1">
                        {pageNums.map(p => (
                          <Button key={p} 
                            variant={p === currentPage ? 'default' : 'outline'} 
                            size="sm" 
                            disabled={searchLoading} 
                            onClick={() => goToPage(p)}
                            className={p === currentPage 
                              ? "bg-slate-900 hover:bg-slate-800 text-white shadow-md" 
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            }
                          >
                            {p}
                          </Button>
                        ))}
                      </span>
                    )
                  })[0]}
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages || searchLoading} onClick={() => goToPage(currentPage + 1)}
                    className="bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {selectedIdea && (
        <IdeaDetailsModal
          idea={selectedIdea}
          open={!!selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onReserve={() => handleReserveIdea(selectedIdea.id)}
          onRelease={() => handleReleaseReservation(selectedIdea.id)}
          onEdit={() => {
            setEditingIdea(selectedIdea)
            setShowEditorModal(true)
            setSelectedIdea(null)
          }}
          onSendToSearch={() => handleSendToSearch(selectedIdea.id)}
          onSendToDrafting={() => handleSendToDrafting(selectedIdea.id)}
        />
      )}

      {editingIdea && (
        <IdeaEditorModal
          idea={editingIdea}
          open={showEditorModal}
          onClose={() => {
            setShowEditorModal(false)
            setEditingIdea(null)
          }}
          onSave={(updatedIdea) => {
            setIdeas(prev => prev.map(idea =>
              idea.id === updatedIdea.id ? updatedIdea : idea
            ))
            setShowEditorModal(false)
            setEditingIdea(null)
          }}
        />
      )}
    </div>
  )
}
