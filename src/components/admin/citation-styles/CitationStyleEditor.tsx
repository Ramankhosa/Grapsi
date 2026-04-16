'use client'

import { useState } from 'react'

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
}

interface CitationStyleEditorProps {
  citationStyle?: CitationStyle
  isNew: boolean
  onSave: () => void
  onCancel: () => void
}

const DEFAULT_BIBLIOGRAPHY_RULES = {
  article: {
    format: "{authors} ({year}). {title}. {venue}, {volume}({issue}), {pages}.",
    fields: ["authors", "year", "title", "venue", "volume", "issue", "pages", "doi"]
  },
  book: {
    format: "{authors} ({year}). {title} ({edition}). {publisher}.",
    fields: ["authors", "year", "title", "edition", "publisher", "isbn"]
  },
  inproceedings: {
    format: "{authors} ({year}). {title}. In {venue} (pp. {pages}).",
    fields: ["authors", "year", "title", "venue", "pages", "doi"]
  },
  website: {
    format: "{authors} ({year}). {title}. Retrieved from {url}",
    fields: ["authors", "year", "title", "url", "accessed_date"]
  }
}

export function CitationStyleEditor({ citationStyle, isNew, onSave, onCancel }: CitationStyleEditorProps) {
  const [code, setCode] = useState(citationStyle?.code || '')
  const [name, setName] = useState(citationStyle?.name || '')
  const [inTextFormatTemplate, setInTextFormatTemplate] = useState(citationStyle?.inTextFormatTemplate || '({authors}, {year})')
  const [bibliographySortOrder, setBibliographySortOrder] = useState(citationStyle?.bibliographySortOrder || 'alphabetical')
  const [supportsShortTitles, setSupportsShortTitles] = useState(citationStyle?.supportsShortTitles || false)
  const [maxAuthorsBeforeEtAl, setMaxAuthorsBeforeEtAl] = useState(citationStyle?.maxAuthorsBeforeEtAl || 3)
  const [sortOrder, setSortOrder] = useState(citationStyle?.sortOrder || 0)
  const [bibliographyRules, setBibliographyRules] = useState<Record<string, unknown>>(
    citationStyle?.bibliographyRules || DEFAULT_BIBLIOGRAPHY_RULES
  )
  const [bibliographyRulesText, setBibliographyRulesText] = useState(
    JSON.stringify(citationStyle?.bibliographyRules || DEFAULT_BIBLIOGRAPHY_RULES, null, 2)
  )
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleRulesChange = (text: string) => {
    setBibliographyRulesText(text)
    try {
      const parsed = JSON.parse(text)
      setBibliographyRules(parsed)
      setRulesError(null)
    } catch {
      setRulesError('Invalid JSON format')
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
    if (!inTextFormatTemplate.trim()) {
      setError('In-text format template is required')
      return
    }
    if (rulesError) {
      setError('Please fix the bibliography rules JSON')
      return
    }

    const payload = {
      code: code.toUpperCase().replace(/\s+/g, '_'),
      name: name.trim(),
      inTextFormatTemplate: inTextFormatTemplate.trim(),
      bibliographyRules,
      bibliographySortOrder,
      supportsShortTitles,
      maxAuthorsBeforeEtAl,
      sortOrder
    }

    try {
      setSaving(true)
      const url = isNew ? '/api/admin/citation-styles' : `/api/admin/citation-styles/${citationStyle?.code}`
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
        setError(errorData.error || 'Failed to save citation style')
      }
    } catch (err) {
      setError('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {isNew ? 'Create New Citation Style' : `Edit: ${citationStyle?.name}`}
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
              placeholder="APA7"
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
              placeholder="APA 7th Edition"
            />
          </div>
        </div>

        {/* In-Text Format */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            In-Text Format Template <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={inTextFormatTemplate}
            onChange={(e) => setInTextFormatTemplate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
            placeholder="({authors}, {year})"
          />
          <p className="text-xs text-slate-500 mt-1">
            Available placeholders: {'{authors}'}, {'{year}'}, {'{title}'}, {'{number}'} (for numbered styles like IEEE)
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setInTextFormatTemplate('({authors}, {year})')}
              className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
            >
              APA style
            </button>
            <button
              type="button"
              onClick={() => setInTextFormatTemplate('[{number}]')}
              className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
            >
              IEEE style
            </button>
            <button
              type="button"
              onClick={() => setInTextFormatTemplate('{authors} ({year})')}
              className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
            >
              Harvard style
            </button>
          </div>
        </div>

        {/* Style Settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Bibliography Sort Order
            </label>
            <select
              value={bibliographySortOrder}
              onChange={(e) => setBibliographySortOrder(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="alphabetical">Alphabetical (A-Z)</option>
              <option value="order_of_appearance">Order of Appearance</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">How citations are sorted in bibliography</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Max Authors Before Et Al.
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={maxAuthorsBeforeEtAl}
              onChange={(e) => setMaxAuthorsBeforeEtAl(parseInt(e.target.value) || 3)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">After this many, show &quot;et al.&quot;</p>
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

        {/* Toggle Options */}
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={supportsShortTitles}
              onChange={(e) => setSupportsShortTitles(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">Supports Short Titles / Ibid.</span>
          </label>
        </div>

        {/* Advanced: Bibliography Rules JSON */}
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
            Advanced: Bibliography Rules (JSON)
          </button>

          {showAdvanced && (
            <div className="mt-4">
              <p className="text-sm text-slate-600 mb-3">
                Define formatting rules for different source types (article, book, inproceedings, website, etc.)
              </p>
              <div className="relative">
                <textarea
                  value={bibliographyRulesText}
                  onChange={(e) => handleRulesChange(e.target.value)}
                  rows={15}
                  className={`w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                    rulesError ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  placeholder={JSON.stringify(DEFAULT_BIBLIOGRAPHY_RULES, null, 2)}
                />
                {rulesError && (
                  <p className="text-xs text-red-600 mt-1">{rulesError}</p>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBibliographyRulesText(JSON.stringify(DEFAULT_BIBLIOGRAPHY_RULES, null, 2))
                    setBibliographyRules(DEFAULT_BIBLIOGRAPHY_RULES)
                    setRulesError(null)
                  }}
                  className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  Reset to Default
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(bibliographyRulesText), null, 2)
                      setBibliographyRulesText(formatted)
                      setRulesError(null)
                    } catch {
                      setRulesError('Cannot format - invalid JSON')
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
            disabled={saving || !!rulesError}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {isNew ? 'Create Citation Style' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

