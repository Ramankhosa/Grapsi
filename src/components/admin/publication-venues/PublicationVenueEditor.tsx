'use client'

import { useState, useEffect } from 'react'

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
}

interface PublicationVenueEditorProps {
  venue?: PublicationVenue
  isNew: boolean
  onSave: () => void
  onCancel: () => void
}

interface CitationStyle {
  code: string
  name: string
}

interface PaperType {
  code: string
  name: string
}

export function PublicationVenueEditor({ venue, isNew, onSave, onCancel }: PublicationVenueEditorProps) {
  const [code, setCode] = useState(venue?.code || '')
  const [name, setName] = useState(venue?.name || '')
  const [venueType, setVenueType] = useState<'JOURNAL' | 'CONFERENCE' | 'BOOK_PUBLISHER'>(venue?.venueType || 'JOURNAL')
  const [citationStyleCode, setCitationStyleCode] = useState(venue?.citationStyle?.code || '')
  const [acceptedPaperTypes, setAcceptedPaperTypes] = useState<string[]>(venue?.acceptedPaperTypes || [])
  const [impactFactor, setImpactFactor] = useState(venue?.impactFactor?.toString() || '')
  const [ranking, setRanking] = useState(venue?.ranking?.toString() || '')
  const [website, setWebsite] = useState(venue?.website || '')
  const [submissionUrl, setSubmissionUrl] = useState(venue?.submissionUrl || '')
  const [sortOrder, setSortOrder] = useState(venue?.sortOrder || 0)
  const [wordLimitOverrides, setWordLimitOverrides] = useState<Record<string, number>>(venue?.wordLimitOverrides || {})
  const [wordLimitOverridesText, setWordLimitOverridesText] = useState(
    JSON.stringify(venue?.wordLimitOverrides || {}, null, 2)
  )
  
  const [citationStyles, setCitationStyles] = useState<CitationStyle[]>([])
  const [paperTypes, setPaperTypes] = useState<PaperType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wordLimitError, setWordLimitError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    // Fetch citation styles
    fetch('/api/citation-styles', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      }
    })
      .then(res => res.json())
      .then(data => setCitationStyles(data.styles || []))
      .catch(console.error)

    // Fetch paper types
    fetch('/api/paper-types', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      }
    })
      .then(res => res.json())
      .then(data => setPaperTypes(data.paperTypes || []))
      .catch(console.error)
  }, [])

  const handleWordLimitChange = (text: string) => {
    setWordLimitOverridesText(text)
    try {
      const parsed = JSON.parse(text)
      setWordLimitOverrides(parsed)
      setWordLimitError(null)
    } catch {
      setWordLimitError('Invalid JSON format')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!code.trim()) {
      setError('Code is required')
      return
    }
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!citationStyleCode) {
      setError('Citation style is required')
      return
    }
    if (wordLimitError) {
      setError('Please fix the word limit overrides JSON')
      return
    }

    // Find citation style ID
    const selectedStyle = citationStyles.find(s => s.code === citationStyleCode)
    if (!selectedStyle) {
      setError('Invalid citation style selected')
      return
    }

    const payload = {
      code: code.toUpperCase().replace(/\s+/g, '_'),
      name: name.trim(),
      venueType,
      citationStyleCode: citationStyleCode,
      acceptedPaperTypes,
      wordLimitOverrides: Object.keys(wordLimitOverrides).length > 0 ? wordLimitOverrides : undefined,
      impactFactor: impactFactor ? parseFloat(impactFactor) : undefined,
      ranking: ranking ? parseInt(ranking) : undefined,
      website: website.trim() || undefined,
      submissionUrl: submissionUrl.trim() || undefined,
      sortOrder
    }

    try {
      setSaving(true)
      const url = isNew ? '/api/admin/publication-venues' : `/api/admin/publication-venues/${venue?.code}`
      const method = isNew ? 'POST' : 'PUT'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        onSave()
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to save publication venue')
      }
    } catch (err) {
      setError('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  const togglePaperType = (typeCode: string) => {
    if (acceptedPaperTypes.includes(typeCode)) {
      setAcceptedPaperTypes(acceptedPaperTypes.filter(t => t !== typeCode))
    } else {
      setAcceptedPaperTypes([...acceptedPaperTypes, typeCode])
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {isNew ? 'Add New Publication Venue' : `Edit: ${venue?.name}`}
        </h2>
        <button
          onClick={onCancel}
          className="text-slate-500 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              disabled={!isNew}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-500 font-mono text-sm"
              placeholder="NATURE"
            />
            <p className="text-xs text-slate-500 mt-1">Unique identifier (auto-uppercase)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Nature"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Venue Type <span className="text-red-500">*</span>
            </label>
            <select
              value={venueType}
              onChange={(e) => setVenueType(e.target.value as 'JOURNAL' | 'CONFERENCE' | 'BOOK_PUBLISHER')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="JOURNAL">📖 Journal</option>
              <option value="CONFERENCE">🎤 Conference</option>
              <option value="BOOK_PUBLISHER">🏛️ Book Publisher</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Citation Style <span className="text-red-500">*</span>
            </label>
            <select
              value={citationStyleCode}
              onChange={(e) => setCitationStyleCode(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">Select a citation style...</option>
              {citationStyles.map(style => (
                <option key={style.code} value={style.code}>{style.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Website URL
            </label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="https://www.nature.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Submission URL
            </label>
            <input
              type="url"
              value={submissionUrl}
              onChange={(e) => setSubmissionUrl(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="https://submit.nature.com"
            />
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Impact Factor
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={impactFactor}
              onChange={(e) => setImpactFactor(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="42.778"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Ranking
            </label>
            <input
              type="number"
              min="1"
              value={ranking}
              onChange={(e) => setRanking(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Sort Order (UI)
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">Lower numbers appear first</p>
          </div>
        </div>

        {/* Accepted Paper Types */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Accepted Paper Types
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Leave empty to accept all paper types. Select specific types to restrict what can be submitted to this venue.
          </p>
          <div className="flex flex-wrap gap-2">
            {paperTypes.map(type => (
              <button
                key={type.code}
                type="button"
                onClick={() => togglePaperType(type.code)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  acceptedPaperTypes.includes(type.code)
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                    : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {acceptedPaperTypes.includes(type.code) && '✓ '}
                {type.name}
              </button>
            ))}
          </div>
          {acceptedPaperTypes.length > 0 && (
            <button
              type="button"
              onClick={() => setAcceptedPaperTypes([])}
              className="mt-2 text-xs text-slate-500 hover:text-slate-700"
            >
              Clear selection (accept all)
            </button>
          )}
        </div>

        {/* Advanced: Word Limit Overrides */}
        <div className="border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-indigo-600"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Advanced: Word Limit Overrides (JSON)
          </button>

          {showAdvanced && (
            <div className="mt-4">
              <p className="text-sm text-slate-600 mb-3">
                Override default word limits for specific sections. Format: {`{"section_key": word_limit}`}
              </p>
              <div className="relative">
                <textarea
                  value={wordLimitOverridesText}
                  onChange={(e) => handleWordLimitChange(e.target.value)}
                  rows={6}
                  className={`w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                    wordLimitError ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  placeholder='{\n  "abstract": 200,\n  "introduction": 800\n}'
                />
                {wordLimitError && (
                  <p className="text-xs text-red-600 mt-1">{wordLimitError}</p>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWordLimitOverridesText('{}')
                    setWordLimitOverrides({})
                    setWordLimitError(null)
                  }}
                  className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(wordLimitOverridesText), null, 2)
                      setWordLimitOverridesText(formatted)
                      setWordLimitError(null)
                    } catch {
                      setWordLimitError('Cannot format - invalid JSON')
                    }
                  }}
                  className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  Format JSON
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !!wordLimitError}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {isNew ? 'Add Venue' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

