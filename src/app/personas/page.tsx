'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'

interface Persona {
  id: string
  name: string
  description: string | null
  visibility: 'PRIVATE' | 'ORGANIZATION'
  isTemplate: boolean
  allowCopy: boolean
  sampleCount: number
  isOwn: boolean
  createdBy?: { id: string; name: string }
  createdAt: string
}

interface Sample {
  id: string
  sectionKey: string
  jurisdiction: string
  sampleText: string
  wordCount: number
  isActive: boolean
}

interface SectionInfo {
  key: string
  label: string
  displayOrder?: number
  isRequired?: boolean
  usedBy?: string[] // Countries that use this section (for universal view)
}

const JURISDICTIONS = [
  { code: '*', label: '🌐 Universal' },
  { code: 'IN', label: '🇮🇳 India' },
  { code: 'US', label: '🇺🇸 United States' },
  { code: 'EP', label: '🇪🇺 Europe' },
  { code: 'PCT', label: '🌍 PCT' },
  { code: 'CA', label: '🇨🇦 Canada' },
  { code: 'AU', label: '🇦🇺 Australia' }
]

// Section-specific word limits - MUST match backend (src/app/api/writing-samples/limits/route.ts)
// Higher limits for key sections to capture more writing patterns for effective style mimicry
const SECTION_WORD_LIMITS: Record<string, { min: number; max: number; recommended: { min: number; max: number } }> = {
  title: { min: 3, max: 50, recommended: { min: 5, max: 30 } },
  fieldOfInvention: { min: 5, max: 200, recommended: { min: 10, max: 100 } },
  background: { min: 10, max: 1500, recommended: { min: 80, max: 400 } }, // Increased for prior art patterns
  objectsOfInvention: { min: 5, max: 500, recommended: { min: 20, max: 200 } },
  summary: { min: 10, max: 1500, recommended: { min: 80, max: 400 } }, // Increased for structural patterns
  briefDescriptionOfDrawings: { min: 5, max: 500, recommended: { min: 20, max: 150 } },
  detailedDescription: { min: 20, max: 3000, recommended: { min: 150, max: 800 } }, // Increased significantly for complex writing patterns
  claims: { min: 10, max: 2000, recommended: { min: 100, max: 600 } }, // Increased for multi-claim structures
  abstract: { min: 10, max: 500, recommended: { min: 50, max: 200 } },
  technicalProblem: { min: 10, max: 500, recommended: { min: 30, max: 200 } },
  technicalSolution: { min: 10, max: 500, recommended: { min: 30, max: 200 } },
  advantageousEffects: { min: 10, max: 500, recommended: { min: 30, max: 200 } },
  industrialApplicability: { min: 5, max: 300, recommended: { min: 20, max: 150 } },
  bestMethod: { min: 10, max: 1000, recommended: { min: 50, max: 300 } },
  preamble: { min: 5, max: 200, recommended: { min: 10, max: 100 } },
  crossReference: { min: 5, max: 300, recommended: { min: 10, max: 100 } }
}

// Default limits for unknown sections
const DEFAULT_LIMITS = { min: 5, max: 1000, recommended: { min: 10, max: 300 } }

// Word count indicator component with visual feedback
function WordCountIndicator({ text, sectionKey }: { text: string; sectionKey: string }) {
  const wordCount = text.trim().split(/\s+/).filter(w => w).length
  const limits = SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS
  
  // Determine status
  let status: 'error' | 'warning' | 'good' | 'optimal' = 'good'
  let message = ''
  
  if (wordCount < limits.min) {
    status = 'error'
    message = `Min ${limits.min} words required`
  } else if (wordCount > limits.max) {
    status = 'error'
    message = `Max ${limits.max} words allowed`
  } else if (wordCount < limits.recommended.min) {
    status = 'warning'
    message = `Below recommended (${limits.recommended.min}+)`
  } else if (wordCount > limits.recommended.max) {
    status = 'warning'
    message = `Above recommended (${limits.recommended.max})`
  } else {
    status = 'optimal'
    message = 'Good length ✓'
  }
  
  const colors = {
    error: 'text-red-500',
    warning: 'text-yellow-600 dark:text-yellow-400',
    good: 'text-gray-500',
    optimal: 'text-green-600 dark:text-green-400'
  }
  
  return (
    <div className="flex flex-col text-xs">
      <span className={colors[status]}>
        {wordCount} words
        {(status === 'error' || status === 'warning') && (
          <span className="ml-1">• {message}</span>
        )}
        {status === 'optimal' && (
          <span className="ml-1">• {message}</span>
        )}
      </span>
      <span className="text-gray-400 text-[10px]">
        Recommended: {limits.recommended.min}-{limits.recommended.max} words
      </span>
    </div>
  )
}

export default function PersonasPage() {
  const { token, user } = useAuth()
  const [myPersonas, setMyPersonas] = useState<Persona[]>([])
  const [orgPersonas, setOrgPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newVisibility, setNewVisibility] = useState<'PRIVATE' | 'ORGANIZATION'>('PRIVATE')
  const [saving, setSaving] = useState(false)

  // Edit persona
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [loadingSamples, setLoadingSamples] = useState(false)
  const [activeJurisdiction, setActiveJurisdiction] = useState('*')
  const [editingSample, setEditingSample] = useState<{ sectionKey: string; text: string } | null>(null)
  
  // Jurisdiction-specific sections
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [loadingSections, setLoadingSections] = useState(false)
  
  // Delete confirmation
  const [showDeletePersonaModal, setShowDeletePersonaModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [personaToDelete, setPersonaToDelete] = useState<Persona | null>(null)
  
  // Jurisdiction delete
  const [showDeleteJurisdictionModal, setShowDeleteJurisdictionModal] = useState(false)
  const [jurisdictionToDelete, setJurisdictionToDelete] = useState<string | null>(null)
  
  // Track which jurisdictions have samples (for tick marks)
  const [jurisdictionSampleCounts, setJurisdictionSampleCounts] = useState<Record<string, number>>({})

  const isAdmin = user?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))
  
  // Fetch sections when jurisdiction changes
  const fetchSections = useCallback(async (jurisdiction: string) => {
    if (!token) return
    
    setLoadingSections(true)
    try {
      const res = await fetch(`/api/sections/by-jurisdiction?jurisdiction=${jurisdiction}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (res.ok) {
        const data = await res.json()
        setSections(data.sections || [])
      }
    } catch (err) {
      console.error('Failed to fetch sections:', err)
      // Fallback to empty array - will show message
      setSections([])
    } finally {
      setLoadingSections(false)
    }
  }, [token])
  
  // Fetch sections when jurisdiction changes
  useEffect(() => {
    if (editingPersona) {
      fetchSections(activeJurisdiction)
    }
  }, [activeJurisdiction, editingPersona, fetchSections])

  const fetchPersonas = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const res = await fetch('/api/personas', {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Failed to fetch personas')

      const data = await res.json()
      setMyPersonas(data.myPersonas || [])
      setOrgPersonas(data.orgPersonas || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchPersonas()
  }, [fetchPersonas])

  const fetchSamples = async (personaId: string) => {
    if (!token) return

    setLoadingSamples(true)
    try {
      const res = await fetch(`/api/writing-samples?personaId=${personaId}&includeInactive=true`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        const fetchedSamples = data.samples || []
        setSamples(fetchedSamples)
        
        // Calculate sample counts per jurisdiction
        const counts: Record<string, number> = {}
        for (const sample of fetchedSamples) {
          if (sample.isActive) {
            counts[sample.jurisdiction] = (counts[sample.jurisdiction] || 0) + 1
          }
        }
        setJurisdictionSampleCounts(counts)
      }
    } catch (err) {
      console.error('Failed to fetch samples:', err)
    } finally {
      setLoadingSamples(false)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim() || !token) return

    setSaving(true)
    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          visibility: newVisibility
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create persona')
      }

      setShowCreateForm(false)
      setNewName('')
      setNewDescription('')
      setNewVisibility('PRIVATE')
      fetchPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create persona')
    } finally {
      setSaving(false)
    }
  }

  // Open delete persona confirmation modal
  const openDeletePersonaModal = (persona: Persona) => {
    setPersonaToDelete(persona)
    setDeleteConfirmText('')
    setShowDeletePersonaModal(true)
  }
  
  // Confirm and delete entire persona
  const handleDeletePersona = async () => {
    if (!personaToDelete || !token) return
    if (deleteConfirmText.toLowerCase() !== 'delete') {
      alert('Please type "delete" to confirm')
      return
    }

    try {
      const res = await fetch(`/api/personas?id=${personaToDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete persona')
      }

      if (editingPersona?.id === personaToDelete.id) {
        setEditingPersona(null)
        setSamples([])
        setJurisdictionSampleCounts({})
      }
      setShowDeletePersonaModal(false)
      setPersonaToDelete(null)
      setDeleteConfirmText('')
      fetchPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete persona')
    }
  }
  
  // Open delete jurisdiction samples modal
  const openDeleteJurisdictionModal = (jurisdiction: string) => {
    setJurisdictionToDelete(jurisdiction)
    setShowDeleteJurisdictionModal(true)
  }
  
  // Delete all samples for a specific jurisdiction
  const handleDeleteJurisdictionSamples = async () => {
    if (!editingPersona || !jurisdictionToDelete || !token) return

    try {
      // Delete all samples for this persona + jurisdiction
      const res = await fetch(`/api/writing-samples/bulk-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          personaId: editingPersona.id,
          jurisdiction: jurisdictionToDelete
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete samples')
      }

      // Refresh samples
      await fetchSamples(editingPersona.id)
      fetchPersonas() // Update sample counts
      setShowDeleteJurisdictionModal(false)
      setJurisdictionToDelete(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete samples')
    }
  }

  const handleSaveSample = async (sectionKey: string, text: string) => {
    if (!editingPersona || !token) return

    setSaving(true)
    try {
      const res = await fetch('/api/writing-samples', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          personaId: editingPersona.id,
          personaName: editingPersona.name,
          jurisdiction: activeJurisdiction,
          sectionKey,
          sampleText: text
        })
      })

      const data = await res.json()

      if (!res.ok) {
        // Handle specific error codes
        if (data.code === 'ORG_PERSONA_READONLY') {
          alert('You cannot edit samples in organization personas you did not create.\n\nTo customize this persona, click "Copy" to create your own version.')
          return
        }
        if (data.code === 'PERSONA_NOT_FOUND') {
          alert('This persona was not found or you no longer have access to it. Please refresh the page.')
          return
        }
        
        // Show validation details if available
        let errorMessage = data.error || 'Failed to save sample'
        if (data.wordCount !== undefined && data.limits) {
          errorMessage += `\n\nYour sample: ${data.wordCount} words\nAllowed: ${data.limits.min} - ${data.limits.max} words`
        }
        
        throw new Error(errorMessage)
      }

      // Show warning if sample was saved but with a suggestion
      if (data.warning) {
        console.log('[PersonaSample] Warning:', data.warning)
        // Could show a toast/notification here in the future
      }

      setEditingSample(null)
      fetchSamples(editingPersona.id)
      fetchPersonas() // Update sample counts
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save sample')
    } finally {
      setSaving(false)
    }
  }

  const openPersonaEditor = (persona: Persona) => {
    setEditingPersona(persona)
    fetchSamples(persona.id)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              ✍️ Writing Personas
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Create reusable writing styles for different patent types (CSE, Bio, Mechanical, etc.)
            </p>
            <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">
              💡 Tip: Select a persona when drafting to have the AI mimic your writing style
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            + New Persona
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Persona List */}
          <div className="lg:col-span-1 space-y-6">
            {/* My Personas */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                👤 My Personas
                <span className="text-sm font-normal text-gray-500">({myPersonas.length})</span>
              </h2>

              {myPersonas.length === 0 ? (
                <div className="p-6 bg-white dark:bg-gray-800 rounded-lg text-center text-gray-500 dark:text-gray-400">
                  <p>No personas yet</p>
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="mt-2 text-blue-600 dark:text-blue-400 hover:underline text-sm"
                  >
                    Create your first persona
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myPersonas.map(persona => (
                    <div
                      key={persona.id}
                      onClick={() => openPersonaEditor(persona)}
                      className={`p-4 bg-white dark:bg-gray-800 rounded-lg shadow cursor-pointer transition-all hover:shadow-md ${
                        editingPersona?.id === persona.id ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white">{persona.name}</h3>
                          {persona.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{persona.description}</p>
                          )}
                          <div className="flex gap-2 mt-2">
                            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                              {persona.sampleCount} samples
                            </span>
                            {persona.visibility === 'ORGANIZATION' && (
                              <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                                Shared
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeletePersonaModal(persona) }}
                          className="text-red-500 hover:text-red-700 text-sm"
                          title="Delete persona and all samples"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Organization Personas */}
            {orgPersonas.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  🏢 Organization Personas
                  <span className="text-sm font-normal text-gray-500">({orgPersonas.length})</span>
                </h2>

                <div className="space-y-3">
                  {orgPersonas.map(persona => (
                    <div
                      key={persona.id}
                      onClick={() => openPersonaEditor(persona)}
                      className={`p-4 bg-white dark:bg-gray-800 rounded-lg shadow cursor-pointer transition-all hover:shadow-md ${
                        editingPersona?.id === persona.id ? 'ring-2 ring-blue-500' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                            {persona.name}
                            {persona.isTemplate && (
                              <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">Template</span>
                            )}
                          </h3>
                          {persona.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{persona.description}</p>
                          )}
                          <div className="flex gap-2 mt-2">
                            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                              {persona.sampleCount} samples
                            </span>
                            <span className="text-xs text-gray-500">
                              by {persona.createdBy?.name}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Sample Editor */}
          <div className="lg:col-span-2">
            {editingPersona ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {editingPersona.name}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Add writing samples for each section to teach the AI your style
                    </p>
                  </div>
                  <button
                    onClick={() => { setEditingPersona(null); setSamples([]) }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                {/* Jurisdiction Tabs */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {JURISDICTIONS.map(j => {
                    const sampleCount = jurisdictionSampleCounts[j.code] || 0
                    const hasSamples = sampleCount > 0
                    
                    return (
                      <button
                        key={j.code}
                        onClick={() => setActiveJurisdiction(j.code)}
                        className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap flex items-center gap-1.5 ${
                          activeJurisdiction === j.code
                            ? 'bg-blue-600 text-white'
                            : hasSamples
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {j.label}
                        {hasSamples && (
                          <span className={`text-xs ${activeJurisdiction === j.code ? 'text-white' : 'text-green-600 dark:text-green-400'}`}>
                            ✓ {sampleCount}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                
                {/* Jurisdiction Actions */}
                {jurisdictionSampleCounts[activeJurisdiction] > 0 && (
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => openDeleteJurisdictionModal(activeJurisdiction)}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                    >
                      🗑️ Clear {JURISDICTIONS.find(j => j.code === activeJurisdiction)?.label} Samples
                    </button>
                  </div>
                )}

                {loadingSamples || loadingSections ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  </div>
                ) : sections.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <p>No sections configured for this jurisdiction.</p>
                    <p className="text-sm mt-2">Try selecting a different jurisdiction or contact admin.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sections.map((section) => {
                      const sample = samples.find(
                        s => s.sectionKey === section.key && s.jurisdiction === activeJurisdiction
                      )
                      const isEditing = editingSample?.sectionKey === section.key

                      return (
                        <div key={section.key} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h3 className="font-medium text-gray-900 dark:text-white">
                                {section.label}
                                {section.isRequired === false && (
                                  <span className="ml-2 text-xs text-gray-400">(optional)</span>
                                )}
                              </h3>
                              {/* Show which countries use this section (Universal view only) */}
                              {activeJurisdiction === '*' && section.usedBy && section.usedBy.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Applies to: {section.usedBy.map(code => {
                                    const j = JURISDICTIONS.find(j => j.code === code)
                                    return j ? j.label.replace(/^[^\s]+\s/, '') : code
                                  }).join(', ')}
                                </p>
                              )}
                            </div>
                            {sample && !isEditing && (
                              <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">
                                ✓ {sample.wordCount} words
                              </span>
                            )}
                          </div>

                          {isEditing ? (
                            <div>
                              <textarea
                                value={editingSample.text}
                                onChange={(e) => setEditingSample({ sectionKey: section.key, text: e.target.value })}
                                rows={6}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-y min-h-[100px]"
                                placeholder={`Paste a sample of your writing style for ${section.label}...\n\nThis can be from a previous patent application or a draft you've written. The AI will learn to mimic your vocabulary, sentence structure, and formatting preferences.`}
                              />
                              <div className="flex justify-between items-center mt-2">
                                <WordCountIndicator 
                                  text={editingSample.text} 
                                  sectionKey={section.key} 
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setEditingSample(null)}
                                    className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveSample(section.key, editingSample.text)}
                                    disabled={saving || !editingSample.text.trim() || editingSample.text.trim().split(/\s+/).filter(w => w).length < 3}
                                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {saving ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : sample ? (
                            <div>
                              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
                                {sample.sampleText}
                              </p>
                              <button
                                onClick={() => setEditingSample({ sectionKey: section.key, text: sample.sampleText })}
                                className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Edit sample
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingSample({ sectionKey: section.key, text: '' })}
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              + Add sample
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center">
                <div className="text-6xl mb-4">✍️</div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Select a Persona
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  Click on a persona from the left to add or edit writing samples
                </p>
                <p className="text-sm text-gray-400">
                  Or create a new persona to get started
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Create Persona Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Create New Persona
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    placeholder="e.g., CSE Patents, Bio Patents, Pharma Style"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    placeholder="Optional: Describe when to use this style"
                  />
                </div>

                {isAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Visibility
                    </label>
                    <select
                      value={newVisibility}
                      onChange={(e) => setNewVisibility(e.target.value as 'PRIVATE' | 'ORGANIZATION')}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    >
                      <option value="PRIVATE">🔒 Private (only me)</option>
                      <option value="ORGANIZATION">🏢 Organization (everyone can use)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateForm(false)
                    setNewName('')
                    setNewDescription('')
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving || !newName.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Persona'}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Delete Persona Modal - Requires typing "delete" */}
        {showDeletePersonaModal && personaToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4 flex items-center gap-2">
                ⚠️ Delete Persona
              </h3>
              
              <div className="space-y-4">
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-sm text-red-700 dark:text-red-300">
                    <strong>Warning:</strong> This will permanently delete the persona 
                    <strong className="mx-1">&quot;{personaToDelete.name}&quot;</strong> 
                    and <strong>ALL writing samples</strong> across <strong>ALL jurisdictions</strong>.
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                    This action cannot be undone.
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Type <strong className="text-red-600">delete</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    placeholder="Type 'delete' here"
                    autoComplete="off"
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowDeletePersonaModal(false)
                    setPersonaToDelete(null)
                    setDeleteConfirmText('')
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeletePersona}
                  disabled={deleteConfirmText.toLowerCase() !== 'delete'}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Delete Jurisdiction Samples Modal */}
        {showDeleteJurisdictionModal && jurisdictionToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-orange-600 dark:text-orange-400 mb-4 flex items-center gap-2">
                🗑️ Clear Jurisdiction Samples
              </h3>
              
              <div className="space-y-4">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  This will delete all writing samples for 
                  <strong className="mx-1">
                    {JURISDICTIONS.find(j => j.code === jurisdictionToDelete)?.label || jurisdictionToDelete}
                  </strong>
                  from persona <strong>&quot;{editingPersona?.name}&quot;</strong>.
                </p>
                
                <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    The persona will remain, and samples for other jurisdictions will not be affected.
                    You can re-add samples for this jurisdiction later.
                  </p>
                </div>
                
                <p className="text-sm text-gray-500">
                  Samples to delete: <strong>{jurisdictionSampleCounts[jurisdictionToDelete] || 0}</strong>
                </p>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowDeleteJurisdictionModal(false)
                    setJurisdictionToDelete(null)
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteJurisdictionSamples}
                  className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg"
                >
                  Clear Samples
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

