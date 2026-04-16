'use client'

import { useState, useEffect, useCallback } from 'react'
import { PublicationVenueEditor } from './PublicationVenueEditor'

interface PublicationVenue {
  id: string
  code: string
  name: string
  venueType: 'JOURNAL' | 'CONFERENCE' | 'BOOK_PUBLISHER'
  citationStyleId: string
  citationStyle: { code: string; name: string }
  acceptedPaperTypes: string[]
  sectionOverrides?: Record<string, unknown>
  wordLimitOverrides?: Record<string, number>
  formattingGuidelines?: Record<string, unknown>
  impactFactor?: number
  ranking?: number
  website?: string
  submissionUrl?: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface PublicationVenueListProps {
  refreshTrigger: number
  onRefresh: () => void
}

const venueTypeLabels: Record<string, { label: string; color: string; icon: string }> = {
  JOURNAL: { label: 'Journal', color: 'bg-blue-100 text-blue-700', icon: '📖' },
  CONFERENCE: { label: 'Conference', color: 'bg-purple-100 text-purple-700', icon: '🎤' },
  BOOK_PUBLISHER: { label: 'Publisher', color: 'bg-orange-100 text-orange-700', icon: '🏛️' }
}

export function PublicationVenueList({ refreshTrigger, onRefresh }: PublicationVenueListProps) {
  const [venues, setVenues] = useState<PublicationVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingVenue, setEditingVenue] = useState<PublicationVenue | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [filterType, setFilterType] = useState<string>('')
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const fetchVenues = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (includeInactive) params.append('includeInactive', 'true')
      if (filterType) params.append('type', filterType)

      const response = await fetch(`/api/admin/publication-venues?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setVenues(data.venues || [])
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to fetch publication venues')
      }
    } catch (err) {
      setError('Failed to fetch publication venues: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [includeInactive, filterType])

  useEffect(() => {
    fetchVenues()
  }, [fetchVenues, refreshTrigger])

  const handleToggleActive = async (venue: PublicationVenue) => {
    const action = venue.isActive ? 'deactivate' : 'activate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${venue.name}"?`)) return

    try {
      const response = await fetch(`/api/admin/publication-venues/${venue.code}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ isActive: !venue.isActive })
      })

      if (response.ok) {
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to update: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to update: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleDelete = async (venue: PublicationVenue) => {
    if (!confirm(`Delete "${venue.name}"? This action cannot be undone if the venue has been used.`)) return

    try {
      const response = await fetch(`/api/admin/publication-venues/${venue.code}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to delete: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const filteredVenues = venues.filter(venue => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return venue.name.toLowerCase().includes(query) || 
             venue.code.toLowerCase().includes(query)
    }
    return true
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-700 rounded-lg m-6">
        {error}
        <button onClick={fetchVenues} className="ml-4 text-sm underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  if (editingVenue) {
    return (
      <PublicationVenueEditor
        venue={editingVenue}
        isNew={false}
        onSave={() => {
          setEditingVenue(null)
          onRefresh()
        }}
        onCancel={() => setEditingVenue(null)}
      />
    )
  }

  return (
    <div className="p-6">
      {/* Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search venues..."
              className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-64"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Types</option>
            <option value="JOURNAL">Journals</option>
            <option value="CONFERENCE">Conferences</option>
            <option value="BOOK_PUBLISHER">Publishers</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Show inactive
          </label>
        </div>
        <span className="text-sm text-slate-600">
          {filteredVenues.length} venue{filteredVenues.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Venue Cards */}
      <div className="space-y-4">
        {filteredVenues.map(venue => {
          const typeInfo = venueTypeLabels[venue.venueType] || { label: venue.venueType, color: 'bg-slate-100 text-slate-700', icon: '📄' }
          
          return (
            <div
              key={venue.id}
              className={`border rounded-xl transition-all ${
                venue.isActive 
                  ? 'bg-white border-slate-200 hover:border-teal-200' 
                  : 'bg-slate-50 border-slate-200 opacity-70'
              }`}
            >
              {/* Header */}
              <div 
                className="p-5 cursor-pointer"
                onClick={() => setExpandedVenue(expandedVenue === venue.code ? null : venue.code)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{typeInfo.icon}</span>
                      <h3 className="text-lg font-semibold text-slate-900">{venue.name}</h3>
                      <code className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded font-mono">
                        {venue.code}
                      </code>
                      <span className={`text-xs px-2 py-1 rounded ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      {!venue.isActive && (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    
                    {/* Quick Info */}
                    <div className="flex flex-wrap gap-3 text-sm">
                      <span className="flex items-center gap-1 text-slate-600">
                        <span className="font-medium">Style:</span>
                        <span className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded text-xs">
                          {venue.citationStyle?.name || venue.citationStyleId}
                        </span>
                      </span>
                      {venue.impactFactor && (
                        <span className="flex items-center gap-1 text-slate-600">
                          <span className="font-medium">IF:</span>
                          <span>{venue.impactFactor.toFixed(2)}</span>
                        </span>
                      )}
                      {venue.acceptedPaperTypes.length > 0 && (
                        <span className="flex items-center gap-1 text-slate-600">
                          <span className="font-medium">Accepts:</span>
                          <span>{venue.acceptedPaperTypes.length} paper types</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingVenue(venue)
                      }}
                      className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleActive(venue)
                      }}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        venue.isActive
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {venue.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(venue)
                      }}
                      className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                    <svg 
                      className={`w-5 h-5 text-slate-400 transition-transform ${
                        expandedVenue === venue.code ? 'rotate-180' : ''
                      }`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedVenue === venue.code && (
                <div className="border-t border-slate-200 p-5 bg-slate-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Details */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                        Venue Details
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                          <span className="text-slate-600">Citation Style</span>
                          <span className="font-medium text-slate-900">{venue.citationStyle?.name}</span>
                        </div>
                        {venue.impactFactor && (
                          <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="text-slate-600">Impact Factor</span>
                            <span className="font-medium text-slate-900">{venue.impactFactor.toFixed(3)}</span>
                          </div>
                        )}
                        {venue.ranking && (
                          <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="text-slate-600">Ranking</span>
                            <span className="font-medium text-slate-900">#{venue.ranking}</span>
                          </div>
                        )}
                        {venue.website && (
                          <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="text-slate-600">Website</span>
                            <a href={venue.website} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline truncate max-w-[200px]">
                              {venue.website}
                            </a>
                          </div>
                        )}
                        {venue.submissionUrl && (
                          <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="text-slate-600">Submission URL</span>
                            <a href={venue.submissionUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline truncate max-w-[200px]">
                              Submit →
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Overrides & Paper Types */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-slate-400 rounded-full"></span>
                        Configuration
                      </h4>
                      
                      {/* Accepted Paper Types */}
                      <div className="mb-4">
                        <p className="text-xs text-slate-500 mb-2">Accepted Paper Types</p>
                        {venue.acceptedPaperTypes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {venue.acceptedPaperTypes.map(type => (
                              <span key={type} className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                                {type}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">All paper types accepted</span>
                        )}
                      </div>

                      {/* Word Limit Overrides */}
                      {venue.wordLimitOverrides && Object.keys(venue.wordLimitOverrides).length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs text-slate-500 mb-2">Word Limit Overrides</p>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(venue.wordLimitOverrides).map(([section, limit]) => (
                              <span key={section} className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded border border-amber-200">
                                {section}: {limit}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section Overrides */}
                      {venue.sectionOverrides && Object.keys(venue.sectionOverrides).length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500 mb-2">Has Custom Section Configuration</p>
                          <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">
                            ✓ Section overrides configured
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Meta Info */}
                  <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span>Sort Order: {venue.sortOrder}</span>
                    <span>Created: {new Date(venue.createdAt).toLocaleDateString()}</span>
                    <span>Updated: {new Date(venue.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {filteredVenues.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="mb-2">No publication venues found</p>
            <p className="text-sm">
              {searchQuery || filterType ? 'Try adjusting your filters.' : 'Add a new venue to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

