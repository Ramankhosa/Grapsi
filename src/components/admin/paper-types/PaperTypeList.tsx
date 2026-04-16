'use client'

import { useState, useEffect, useCallback } from 'react'
import { PaperTypeEditor } from './PaperTypeEditor'

interface PaperType {
  id: string
  code: string
  name: string
  description?: string
  requiredSections: string[]
  optionalSections: string[]
  sectionOrder: string[]
  defaultWordLimits: Record<string, number>
  defaultCitationStyle?: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface PaperTypeListProps {
  refreshTrigger: number
  onRefresh: () => void
}

export function PaperTypeList({ refreshTrigger, onRefresh }: PaperTypeListProps) {
  const [paperTypes, setPaperTypes] = useState<PaperType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingType, setEditingType] = useState<PaperType | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [expandedType, setExpandedType] = useState<string | null>(null)

  const fetchPaperTypes = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (includeInactive) params.append('includeInactive', 'true')

      const response = await fetch(`/api/paper-types?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPaperTypes(data.paperTypes || [])
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to fetch paper types')
      }
    } catch (err) {
      setError('Failed to fetch paper types: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [includeInactive])

  useEffect(() => {
    fetchPaperTypes()
  }, [fetchPaperTypes, refreshTrigger])

  const handleToggleActive = async (paperType: PaperType) => {
    const action = paperType.isActive ? 'deactivate' : 'activate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${paperType.name}"?`)) return

    try {
      const response = await fetch(`/api/admin/paper-types/${paperType.code}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ isActive: !paperType.isActive })
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

  const handleDelete = async (paperType: PaperType) => {
    if (!confirm(`Delete "${paperType.name}"? This action cannot be undone if the type has been used.`)) return

    try {
      const response = await fetch(`/api/admin/paper-types/${paperType.code}`, {
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
        <button onClick={fetchPaperTypes} className="ml-4 text-sm underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  if (editingType) {
    return (
      <PaperTypeEditor
        paperType={editingType}
        isNew={false}
        onSave={() => {
          setEditingType(null)
          onRefresh()
        }}
        onCancel={() => setEditingType(null)}
      />
    )
  }

  return (
    <div className="p-6">
      {/* Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">
            {paperTypes.length} paper type{paperTypes.length !== 1 ? 's' : ''}
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

      {/* Paper Type Cards */}
      <div className="space-y-4">
        {paperTypes.map(paperType => (
          <div
            key={paperType.id}
            className={`border rounded-xl transition-all ${
              paperType.isActive 
                ? 'bg-white border-slate-200 hover:border-indigo-200' 
                : 'bg-slate-50 border-slate-200 opacity-70'
            }`}
          >
            {/* Header */}
            <div 
              className="p-5 cursor-pointer"
              onClick={() => setExpandedType(expandedType === paperType.code ? null : paperType.code)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-slate-900">{paperType.name}</h3>
                    <code className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded font-mono">
                      {paperType.code}
                    </code>
                    {!paperType.isActive && (
                      <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded">
                        Inactive
                      </span>
                    )}
                    {paperType.defaultCitationStyle && (
                      <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-600 rounded">
                        {paperType.defaultCitationStyle}
                      </span>
                    )}
                  </div>
                  {paperType.description && (
                    <p className="text-sm text-slate-600 mb-3">{paperType.description}</p>
                  )}
                  
                  {/* Section Preview */}
                  <div className="flex flex-wrap gap-2">
                    {paperType.requiredSections.slice(0, 5).map(section => (
                      <span key={section} className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                        {formatSectionName(section)}
                      </span>
                    ))}
                    {paperType.requiredSections.length > 5 && (
                      <span className="text-xs px-2 py-1 text-slate-500">
                        +{paperType.requiredSections.length - 5} more
                      </span>
                    )}
                    {paperType.optionalSections.length > 0 && (
                      <span className="text-xs text-slate-400 flex items-center">
                        • {paperType.optionalSections.length} optional
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingType(paperType)
                    }}
                    className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleActive(paperType)
                    }}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      paperType.isActive
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {paperType.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(paperType)
                    }}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                  <svg 
                    className={`w-5 h-5 text-slate-400 transition-transform ${
                      expandedType === paperType.code ? 'rotate-180' : ''
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
            {expandedType === paperType.code && (
              <div className="border-t border-slate-200 p-5 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Required Sections */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                      Required Sections ({paperType.requiredSections.length})
                    </h4>
                    <div className="space-y-2">
                      {paperType.sectionOrder
                        .filter(s => paperType.requiredSections.includes(s))
                        .map((section, index) => (
                          <div key={section} className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="flex items-center gap-2">
                              <span className="text-slate-400">{index + 1}.</span>
                              <span className="text-slate-900">{formatSectionName(section)}</span>
                            </span>
                            <span className="text-slate-500">
                              {paperType.defaultWordLimits[section] || '-'} words
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Optional Sections */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-slate-400 rounded-full"></span>
                      Optional Sections ({paperType.optionalSections.length})
                    </h4>
                    {paperType.optionalSections.length > 0 ? (
                      <div className="space-y-2">
                        {paperType.optionalSections.map((section) => (
                          <div key={section} className="flex items-center justify-between text-sm bg-white px-3 py-2 rounded border border-slate-200">
                            <span className="text-slate-700">{formatSectionName(section)}</span>
                            <span className="text-slate-500">
                              {paperType.defaultWordLimits[section] || '-'} words
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 italic">No optional sections defined</p>
                    )}
                  </div>
                </div>

                {/* Meta Info */}
                <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>Sort Order: {paperType.sortOrder}</span>
                  <span>Created: {new Date(paperType.createdAt).toLocaleDateString()}</span>
                  <span>Updated: {new Date(paperType.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {paperTypes.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mb-2">No paper types found</p>
            <p className="text-sm">Create a new paper type to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatSectionName(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

