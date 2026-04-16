'use client'

import { useState, useEffect, useCallback } from 'react'
import { CitationStyleEditor } from './CitationStyleEditor'

interface CitationStyle {
  id: string
  code: string
  name: string
  inTextFormatTemplate: string
  bibliographyRules: Record<string, unknown>
  bibliographySortOrder: string
  supportsShortTitles: boolean
  maxAuthorsBeforeEtAl: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface CitationStyleListProps {
  refreshTrigger: number
  onRefresh: () => void
}

const sampleCitation = {
  authors: ['Jane Doe', 'John Smith'],
  year: 2023,
  title: 'Sample Research Paper on Structured Writing',
  venue: 'Journal of Sample Studies',
  volume: '12',
  issue: '3',
  pages: '45-60',
  doi: '10.1234/sample.2023.001'
}

export function CitationStyleList({ refreshTrigger, onRefresh }: CitationStyleListProps) {
  const [citationStyles, setCitationStyles] = useState<CitationStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingStyle, setEditingStyle] = useState<CitationStyle | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [expandedStyle, setExpandedStyle] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, { inText: string; bibliography: string }>>({})

  const fetchCitationStyles = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (includeInactive) params.append('includeInactive', 'true')

      const response = await fetch(`/api/admin/citation-styles?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setCitationStyles(data.styles || [])
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to fetch citation styles')
      }
    } catch (err) {
      setError('Failed to fetch citation styles: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [includeInactive])

  useEffect(() => {
    fetchCitationStyles()
  }, [fetchCitationStyles, refreshTrigger])

  const fetchPreview = async (code: string) => {
    if (previews[code]) return

    try {
      const response = await fetch(`/api/citation-styles/${code}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPreviews(prev => ({
          ...prev,
          [code]: {
            inText: data.examples?.inText || '',
            bibliography: data.examples?.bibliography || ''
          }
        }))
      }
    } catch (err) {
      console.error('Failed to fetch preview:', err)
    }
  }

  const handleToggleActive = async (style: CitationStyle) => {
    const action = style.isActive ? 'deactivate' : 'activate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${style.name}"?`)) return

    try {
      const response = await fetch(`/api/admin/citation-styles/${style.code}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ isActive: !style.isActive })
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

  const handleDelete = async (style: CitationStyle) => {
    if (!confirm(`Delete "${style.name}"? This action cannot be undone if the style has been used.`)) return

    try {
      const response = await fetch(`/api/admin/citation-styles/${style.code}`, {
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

  const handleExpand = (code: string) => {
    if (expandedStyle === code) {
      setExpandedStyle(null)
    } else {
      setExpandedStyle(code)
      fetchPreview(code)
    }
  }

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
        <button onClick={fetchCitationStyles} className="ml-4 text-sm underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  if (editingStyle) {
    return (
      <CitationStyleEditor
        citationStyle={editingStyle}
        isNew={false}
        onSave={() => {
          setEditingStyle(null)
          onRefresh()
        }}
        onCancel={() => setEditingStyle(null)}
      />
    )
  }

  return (
    <div className="p-6">
      {/* Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">
            {citationStyles.length} citation style{citationStyles.length !== 1 ? 's' : ''}
          </span>
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
      </div>

      {/* Citation Style Cards */}
      <div className="space-y-4">
        {citationStyles.map(style => (
          <div
            key={style.id}
            className={`border rounded-xl transition-all ${
              style.isActive 
                ? 'bg-white border-slate-200 hover:border-violet-200' 
                : 'bg-slate-50 border-slate-200 opacity-70'
            }`}
          >
            {/* Header */}
            <div 
              className="p-5 cursor-pointer"
              onClick={() => handleExpand(style.code)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-slate-900">{style.name}</h3>
                    <code className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded font-mono">
                      {style.code}
                    </code>
                    {!style.isActive && (
                      <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  
                  {/* Quick Info */}
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="flex items-center gap-1 text-slate-600">
                      <span className="font-medium">In-text:</span>
                      <code className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded">
                        {style.inTextFormatTemplate}
                      </code>
                    </span>
                    <span className="flex items-center gap-1 text-slate-600">
                      <span className="font-medium">Sort:</span>
                      <span className="capitalize">{style.bibliographySortOrder.replace('_', ' ')}</span>
                    </span>
                    <span className="flex items-center gap-1 text-slate-600">
                      <span className="font-medium">Et al. after:</span>
                      <span>{style.maxAuthorsBeforeEtAl} authors</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingStyle(style)
                    }}
                    className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleActive(style)
                    }}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      style.isActive
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {style.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(style)
                    }}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                  <svg 
                    className={`w-5 h-5 text-slate-400 transition-transform ${
                      expandedStyle === style.code ? 'rotate-180' : ''
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
            {expandedStyle === style.code && (
              <div className="border-t border-slate-200 p-5 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Preview */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-violet-500 rounded-full"></span>
                      Sample Citation Preview
                    </h4>
                    <div className="space-y-3">
                      <div className="bg-white px-4 py-3 rounded-lg border border-slate-200">
                        <p className="text-xs text-slate-500 mb-1">In-text Citation</p>
                        <p className="text-sm font-medium text-slate-900">
                          {previews[style.code]?.inText || 'Loading...'}
                        </p>
                      </div>
                      <div className="bg-white px-4 py-3 rounded-lg border border-slate-200">
                        <p className="text-xs text-slate-500 mb-1">Bibliography Entry</p>
                        <p className="text-sm text-slate-900">
                          {previews[style.code]?.bibliography || 'Loading...'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200">
                      <p className="text-xs text-slate-500 mb-2">Sample Data Used:</p>
                      <ul className="text-xs text-slate-600 space-y-0.5">
                        <li>Authors: {sampleCitation.authors.join(', ')}</li>
                        <li>Year: {sampleCitation.year}</li>
                        <li>Title: {sampleCitation.title}</li>
                        <li>Venue: {sampleCitation.venue}</li>
                      </ul>
                    </div>
                  </div>

                  {/* Settings */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-slate-400 rounded-full"></span>
                      Style Settings
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                        <span className="text-slate-600">Bibliography Sort Order</span>
                        <span className="font-medium text-slate-900 capitalize">
                          {style.bibliographySortOrder.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                        <span className="text-slate-600">Max Authors Before Et Al.</span>
                        <span className="font-medium text-slate-900">{style.maxAuthorsBeforeEtAl}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                        <span className="text-slate-600">Supports Short Titles</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          style.supportsShortTitles 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {style.supportsShortTitles ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                        <span className="text-slate-600">Sort Order (UI)</span>
                        <span className="font-medium text-slate-900">{style.sortOrder}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Meta Info */}
                <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>Created: {new Date(style.createdAt).toLocaleDateString()}</span>
                  <span>Updated: {new Date(style.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {citationStyles.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <p className="mb-2">No citation styles found</p>
            <p className="text-sm">Create a new citation style to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

