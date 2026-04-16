'use client'

import { useState, useEffect, useCallback } from 'react'
import { SectionPromptEditor } from './SectionPromptEditor'

interface SectionPrompt {
  id: string
  countryCode: string
  sectionKey: string
  instruction: string
  constraints: string[]
  additions: string[]
  version: number
  status: string
  createdAt: string
  updatedAt: string
}

interface PromptHistory {
  version: number
  instruction: string
  constraints: string[]
  additions: string[]
  changeType: string
  changeReason?: string
  changedBy?: string
  changedAt: string
}

interface SectionPromptListProps {
  refreshTrigger: number
  onRefresh: () => void
}

export function SectionPromptList({ refreshTrigger, onRefresh }: SectionPromptListProps) {
  const [promptsByCountry, setPromptsByCountry] = useState<Record<string, SectionPrompt[]>>({})
  const [countryNames, setCountryNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<SectionPrompt | null>(null)
  const [showHistory, setShowHistory] = useState<{ countryCode: string; sectionKey: string } | null>(null)
  const [history, setHistory] = useState<PromptHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (includeArchived) params.append('includeArchived', 'true')

      const response = await fetch(`/api/super-admin/section-prompts?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setPromptsByCountry(data.promptsByCountry || {})
        setCountryNames(data.countryNames || {})
        setError(null)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to fetch prompts')
      }
    } catch (err) {
      setError('Failed to fetch prompts: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [includeArchived])

  const fetchHistory = async (countryCode: string, sectionKey: string) => {
    try {
      setHistoryLoading(true)
      const response = await fetch(
        `/api/super-admin/section-prompts?countryCode=${countryCode}&sectionKey=${sectionKey}&history=true`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        setHistory(data.history || [])
      }
    } catch (err) {
      console.error('Failed to fetch history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleArchive = async (prompt: SectionPrompt) => {
    if (!confirm(`Archive ${prompt.sectionKey} prompt for ${prompt.countryCode}?`)) return

    try {
      const response = await fetch(
        `/api/super-admin/section-prompts?id=${prompt.id}&reason=Archived by admin`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      )

      if (response.ok) {
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to archive: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to archive: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleSeedFromJson = async (countryCode: string) => {
    if (!confirm(`Seed prompts from JSON for ${countryCode}? This will not overwrite existing prompts.`)) return

    try {
      const response = await fetch('/api/super-admin/section-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ action: 'seed', countryCode })
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Seeding complete: ${data.result.created} created, ${data.result.skipped} skipped`)
        onRefresh()
      } else {
        const errorData = await response.json()
        alert('Failed to seed: ' + (errorData.error || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to seed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts, includeArchived, refreshTrigger])

  useEffect(() => {
    if (showHistory) {
      fetchHistory(showHistory.countryCode, showHistory.sectionKey)
    }
  }, [showHistory])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-md">
        {error}
        <button onClick={fetchPrompts} className="ml-4 text-sm underline">
          Retry
        </button>
      </div>
    )
  }

  // Editor modal
  if (editingPrompt || isCreating) {
    return (
      <SectionPromptEditor
        prompt={editingPrompt}
        countryCode={isCreating ? selectedCountry || undefined : undefined}
        isNew={isCreating}
        onSave={() => {
          setEditingPrompt(null)
          setIsCreating(false)
          onRefresh()
        }}
        onCancel={() => {
          setEditingPrompt(null)
          setIsCreating(false)
        }}
      />
    )
  }

  // History modal
  if (showHistory) {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">
            Version History: {showHistory.countryCode} / {showHistory.sectionKey}
          </h3>
          <button
            onClick={() => setShowHistory(null)}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕ Close
          </button>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((h, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-medium">v{h.version}</span>
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded ${
                      h.changeType === 'CREATE' ? 'bg-green-100 text-green-700' :
                      h.changeType === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                      h.changeType === 'ARCHIVE' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {h.changeType}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(h.changedAt).toLocaleString()}
                    {h.changedBy && ` by ${h.changedBy}`}
                  </div>
                </div>
                {h.changeReason && (
                  <p className="text-sm text-gray-600 mb-2">Reason: {h.changeReason}</p>
                )}
                <details className="text-sm">
                  <summary className="cursor-pointer text-blue-600">View instruction</summary>
                  <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto max-h-40">
                    {h.instruction}
                  </pre>
                </details>
              </div>
            ))}
            {history.length === 0 && (
              <p className="text-gray-500 text-center py-4">No version history available</p>
            )}
          </div>
        )}
      </div>
    )
  }

  const countries = Object.keys(promptsByCountry).sort()

  return (
    <div className="p-6">
      {/* Controls */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedCountry || ''}
            onChange={(e) => setSelectedCountry(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All Countries ({countries.length})</option>
            {countries.map(code => (
              <option key={code} value={code}>
                {countryNames[code] || code} ({promptsByCountry[code]?.length || 0})
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded"
            />
            Include archived
          </label>
        </div>

        <div className="flex gap-2">
          {selectedCountry && (
            <>
              <button
                onClick={() => handleSeedFromJson(selectedCountry)}
                className="px-4 py-2 text-sm bg-yellow-100 text-yellow-700 rounded-md hover:bg-yellow-200"
              >
                Seed from JSON
              </button>
              <button
                onClick={() => setIsCreating(true)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                + Add Prompt
              </button>
            </>
          )}
        </div>
      </div>

      {/* Prompt List */}
      {(selectedCountry ? [selectedCountry] : countries).map(countryCode => (
        <div key={countryCode} className="mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-2xl">{getCountryFlag(countryCode)}</span>
            {countryNames[countryCode] || countryCode}
            <span className="text-sm font-normal text-gray-500">
              ({promptsByCountry[countryCode]?.length || 0} prompts)
            </span>
          </h3>

          <div className="grid gap-4">
            {promptsByCountry[countryCode]?.map(prompt => (
              <div
                key={prompt.id}
                className={`border rounded-lg p-4 ${
                  prompt.status === 'ARCHIVED' ? 'bg-gray-50 opacity-60' : 'bg-white'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-lg">{prompt.sectionKey}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">v{prompt.version}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        prompt.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                        prompt.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {prompt.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                      {prompt.instruction.substring(0, 200)}...
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {prompt.constraints?.slice(0, 3).map((c, i) => (
                        <span key={i} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded">
                          {c.substring(0, 50)}...
                        </span>
                      ))}
                      {(prompt.constraints?.length || 0) > 3 && (
                        <span className="text-xs text-gray-500">
                          +{prompt.constraints.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => setShowHistory({ countryCode: prompt.countryCode, sectionKey: prompt.sectionKey })}
                      className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                      title="View history"
                    >
                      📜
                    </button>
                    <button
                      onClick={() => setEditingPrompt(prompt)}
                      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
                    >
                      Edit
                    </button>
                    {prompt.status === 'ACTIVE' && (
                      <button
                        onClick={() => handleArchive(prompt)}
                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 text-xs text-gray-400">
                  Updated: {new Date(prompt.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}

            {(!promptsByCountry[countryCode] || promptsByCountry[countryCode].length === 0) && (
              <div className="text-center py-8 text-gray-500">
                No prompts found for {countryNames[countryCode] || countryCode}
                <button
                  onClick={() => {
                    setSelectedCountry(countryCode)
                    handleSeedFromJson(countryCode)
                  }}
                  className="ml-2 text-blue-600 underline"
                >
                  Seed from JSON
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {countries.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-4">No section prompts found in database.</p>
          <p className="text-sm">
            Use the seed scripts to populate prompts from JSON files, or create them manually.
          </p>
        </div>
      )}
    </div>
  )
}

// Helper to get country flag emoji
function getCountryFlag(countryCode: string): string {
  const flags: Record<string, string> = {
    'IN': '🇮🇳',
    'US': '🇺🇸',
    'AU': '🇦🇺',
    'CA': '🇨🇦',
    'CANADA': '🇨🇦',
    'JP': '🇯🇵',
    'CN': '🇨🇳',
    'EP': '🇪🇺',
    'PCT': '🌐',
    'UK': '🇬🇧',
    'DE': '🇩🇪',
    'FR': '🇫🇷',
    'KR': '🇰🇷',
    'BR': '🇧🇷'
  }
  return flags[countryCode.toUpperCase()] || '🏳️'
}

