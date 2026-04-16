'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

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

interface PersonaManagerProps {
  isOpen: boolean
  onClose: () => void
  onSelectPersona?: (selection: PersonaSelection) => void
  currentSelection?: PersonaSelection
  showSelector?: boolean // If true, show persona selector mode
}

export interface PersonaSelection {
  primaryPersonaId?: string
  primaryPersonaName?: string
  secondaryPersonaIds?: string[]
  secondaryPersonaNames?: string[]
}

export default function PersonaManager({
  isOpen,
  onClose,
  onSelectPersona,
  currentSelection,
  showSelector = false
}: PersonaManagerProps) {
  const { token, user } = useAuth()
  const [myPersonas, setMyPersonas] = useState<Persona[]>([])
  const [orgPersonas, setOrgPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newVisibility, setNewVisibility] = useState<'PRIVATE' | 'ORGANIZATION'>('PRIVATE')
  const [saving, setSaving] = useState(false)

  // Selection state (for selector mode)
  const [primaryId, setPrimaryId] = useState<string | undefined>(currentSelection?.primaryPersonaId)
  const [secondaryIds, setSecondaryIds] = useState<string[]>(currentSelection?.secondaryPersonaIds || [])

  // Copy modal state
  const [copyingPersona, setCopyingPersona] = useState<Persona | null>(null)
  const [copyName, setCopyName] = useState('')

  const isAdmin = user?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))

  const fetchPersonas = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const res = await fetch('/api/personas', {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        throw new Error('Failed to fetch personas')
      }

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
    if (isOpen) {
      fetchPersonas()
    }
  }, [isOpen, fetchPersonas])

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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this persona?')) return
    if (!token) return

    try {
      const res = await fetch(`/api/personas?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete persona')
      }

      fetchPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete persona')
    }
  }

  const handleCopy = async () => {
    if (!copyingPersona || !copyName.trim() || !token) return

    setSaving(true)
    try {
      const res = await fetch('/api/personas', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'copy',
          sourceId: copyingPersona.id,
          newName: copyName.trim()
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to copy persona')
      }

      setCopyingPersona(null)
      setCopyName('')
      fetchPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to copy persona')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectPrimary = (persona: Persona) => {
    setPrimaryId(persona.id)
    // Remove from secondary if it was there
    setSecondaryIds(prev => prev.filter(id => id !== persona.id))
  }

  const handleToggleSecondary = (persona: Persona) => {
    if (persona.id === primaryId) return // Can't be both primary and secondary
    
    setSecondaryIds(prev => 
      prev.includes(persona.id)
        ? prev.filter(id => id !== persona.id)
        : [...prev, persona.id]
    )
  }

  const handleConfirmSelection = () => {
    const allPersonas = [...myPersonas, ...orgPersonas]
    const primary = allPersonas.find(p => p.id === primaryId)
    const secondaries = allPersonas.filter(p => secondaryIds.includes(p.id))

    onSelectPersona?.({
      primaryPersonaId: primaryId,
      primaryPersonaName: primary?.name,
      secondaryPersonaIds: secondaryIds,
      secondaryPersonaNames: secondaries.map(p => p.name)
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        // Close when clicking backdrop (not the modal content)
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {showSelector ? '✍️ Select Writing Style' : '✍️ Manage Writing Personas'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {showSelector 
                ? 'Choose a primary style and optionally add secondary styles for multidisciplinary patents'
                : 'Create and manage your writing style profiles'
              }
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500">{error}</div>
          ) : (
            <div className="space-y-8">
              {/* Selector Mode - Primary/Secondary explanation */}
              {showSelector && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-sm">
                  <p className="font-medium text-blue-800 dark:text-blue-300">How persona selection works:</p>
                  <ul className="mt-2 space-y-1 text-blue-700 dark:text-blue-400">
                    <li>• <strong>Primary Style:</strong> Sets the overall structure, sentence patterns, and voice</li>
                    <li>• <strong>Secondary Styles:</strong> Add domain-specific terminology (e.g., Bio + CSE for a medical device patent)</li>
                  </ul>
                </div>
              )}

              {/* My Personas */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    👤 My Personas
                    <span className="text-sm font-normal text-gray-500">({myPersonas.length})</span>
                  </h3>
                  {!showSelector && (
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      + New Persona
                    </button>
                  )}
                </div>

                {myPersonas.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <p>You haven't created any personas yet.</p>
                    {!showSelector && (
                      <button
                        onClick={() => setShowCreateForm(true)}
                        className="mt-2 text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Create your first persona
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {myPersonas.map(persona => (
                      <PersonaCard
                        key={persona.id}
                        persona={persona}
                        showSelector={showSelector}
                        isPrimary={primaryId === persona.id}
                        isSecondary={secondaryIds.includes(persona.id)}
                        onSelectPrimary={() => handleSelectPrimary(persona)}
                        onToggleSecondary={() => handleToggleSecondary(persona)}
                        onDelete={() => handleDelete(persona.id)}
                        canDelete={true}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Organization Personas */}
              {orgPersonas.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
                    🏢 Organization Personas
                    <span className="text-sm font-normal text-gray-500">({orgPersonas.length})</span>
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {orgPersonas.map(persona => (
                      <PersonaCard
                        key={persona.id}
                        persona={persona}
                        showSelector={showSelector}
                        isPrimary={primaryId === persona.id}
                        isSecondary={secondaryIds.includes(persona.id)}
                        onSelectPrimary={() => handleSelectPrimary(persona)}
                        onToggleSecondary={() => handleToggleSecondary(persona)}
                        onCopy={persona.allowCopy ? () => {
                          setCopyingPersona(persona)
                          setCopyName(`${persona.name} (Copy)`)
                        } : undefined}
                        canDelete={!!isAdmin}
                        onDelete={isAdmin ? () => handleDelete(persona.id) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {showSelector && primaryId && (
              <span>
                Primary: <strong>{[...myPersonas, ...orgPersonas].find(p => p.id === primaryId)?.name}</strong>
                {secondaryIds.length > 0 && ` + ${secondaryIds.length} secondary`}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancel
            </button>
            {showSelector && (
              <button
                onClick={handleConfirmSelection}
                disabled={!primaryId}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Apply Selection
              </button>
            )}
          </div>
        </div>

        {/* Create Persona Modal */}
        {showCreateForm && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
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
                    placeholder="e.g., CSE Patents, Bio Patents"
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
                    placeholder="Optional description..."
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
                      <option value="PRIVATE">Private (only me)</option>
                      <option value="ORGANIZATION">Organization (everyone)</option>
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
                  {saving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Copy Persona Modal */}
        {copyingPersona && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Copy Persona
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Create a copy of "{copyingPersona.name}" with all its samples.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Name *
                </label>
                <input
                  type="text"
                  value={copyName}
                  onChange={(e) => setCopyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setCopyingPersona(null)
                    setCopyName('')
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCopy}
                  disabled={saving || !copyName.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Copying...' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Individual Persona Card
function PersonaCard({
  persona,
  showSelector,
  isPrimary,
  isSecondary,
  onSelectPrimary,
  onToggleSecondary,
  onDelete,
  onCopy,
  canDelete
}: {
  persona: Persona
  showSelector: boolean
  isPrimary: boolean
  isSecondary: boolean
  onSelectPrimary: () => void
  onToggleSecondary: () => void
  onDelete?: () => void
  onCopy?: () => void
  canDelete: boolean
}) {
  return (
    <div className={`p-4 rounded-lg border-2 transition-all ${
      isPrimary 
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
        : isSecondary
          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
    }`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-gray-900 dark:text-white">{persona.name}</h4>
          {persona.isTemplate && (
            <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded">
              Template
            </span>
          )}
          {persona.visibility === 'ORGANIZATION' && persona.isOwn && (
            <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded">
              Shared
            </span>
          )}
        </div>
        
        {!showSelector && (
          <div className="flex gap-2">
            {onCopy && (
              <button
                onClick={onCopy}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Copy
              </button>
            )}
            {canDelete && onDelete && (
              <button
                onClick={onDelete}
                className="text-xs text-red-600 dark:text-red-400 hover:underline"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {persona.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{persona.description}</p>
      )}

      <div className="flex justify-between items-center text-xs text-gray-400">
        <span>{persona.sampleCount} samples</span>
        {!persona.isOwn && persona.createdBy && (
          <span>by {persona.createdBy.name}</span>
        )}
      </div>

      {showSelector && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onSelectPrimary}
            className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              isPrimary
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {isPrimary ? '✓ Primary' : 'Set Primary'}
          </button>
          <button
            onClick={onToggleSecondary}
            disabled={isPrimary}
            className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              isSecondary
                ? 'bg-green-600 text-white'
                : isPrimary
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {isSecondary ? '✓ Secondary' : '+ Secondary'}
          </button>
        </div>
      )}
    </div>
  )
}

