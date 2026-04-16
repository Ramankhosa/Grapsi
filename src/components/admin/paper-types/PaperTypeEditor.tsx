'use client'

import { useState, useEffect } from 'react'

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
}

interface PaperTypeEditorProps {
  paperType?: PaperType
  isNew: boolean
  onSave: () => void
  onCancel: () => void
}

const COMMON_SECTIONS = [
  'abstract',
  'introduction',
  'literature_review',
  'methodology',
  'results',
  'discussion',
  'conclusion',
  'acknowledgments',
  'appendix',
  'future_work',
  'related_work',
  'case_description',
  'analysis',
  'recommendations',
  'main_content',
  'main_findings',
  'publications'
]

const DEFAULT_WORD_LIMITS: Record<string, number> = {
  abstract: 250,
  introduction: 1000,
  literature_review: 2000,
  methodology: 1500,
  results: 1500,
  discussion: 2000,
  conclusion: 500,
  acknowledgments: 200,
  appendix: 1000,
  future_work: 500,
  related_work: 1500,
  case_description: 1000,
  analysis: 1500,
  recommendations: 500,
  main_content: 3000,
  main_findings: 1000,
  publications: 300
}

export function PaperTypeEditor({ paperType, isNew, onSave, onCancel }: PaperTypeEditorProps) {
  const [code, setCode] = useState(paperType?.code || '')
  const [name, setName] = useState(paperType?.name || '')
  const [description, setDescription] = useState(paperType?.description || '')
  const [requiredSections, setRequiredSections] = useState<string[]>(paperType?.requiredSections || ['abstract', 'introduction', 'conclusion'])
  const [optionalSections, setOptionalSections] = useState<string[]>(paperType?.optionalSections || [])
  const [sectionOrder, setSectionOrder] = useState<string[]>(paperType?.sectionOrder || ['abstract', 'introduction', 'conclusion'])
  const [wordLimits, setWordLimits] = useState<Record<string, number>>(paperType?.defaultWordLimits || {})
  const [defaultCitationStyle, setDefaultCitationStyle] = useState(paperType?.defaultCitationStyle || '')
  const [sortOrder, setSortOrder] = useState(paperType?.sortOrder || 0)
  const [citationStyles, setCitationStyles] = useState<{ code: string; name: string }[]>([])
  const [newSectionName, setNewSectionName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fetch available citation styles
    fetch('/api/citation-styles', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      }
    })
      .then(res => res.json())
      .then(data => setCitationStyles(data.styles || []))
      .catch(console.error)
  }, [])

  // Update sectionOrder when requiredSections or optionalSections change
  useEffect(() => {
    const allSections = [...requiredSections, ...optionalSections]
    const newOrder = [...sectionOrder.filter(s => allSections.includes(s))]
    
    // Add any new sections that aren't in the order yet
    allSections.forEach(section => {
      if (!newOrder.includes(section)) {
        newOrder.push(section)
      }
    })
    
    if (JSON.stringify(newOrder) !== JSON.stringify(sectionOrder)) {
      setSectionOrder(newOrder)
    }
  }, [requiredSections, optionalSections])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate
    if (!code.trim()) {
      setError('Code is required')
      return
    }
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (requiredSections.length === 0) {
      setError('At least one required section is needed')
      return
    }

    // Ensure all sections have word limits
    const finalWordLimits = { ...wordLimits }
    sectionOrder.forEach(section => {
      if (!finalWordLimits[section]) {
        finalWordLimits[section] = DEFAULT_WORD_LIMITS[section] || 500
      }
    })

    const payload = {
      code: code.toUpperCase().replace(/\s+/g, '_'),
      name: name.trim(),
      description: description.trim() || undefined,
      requiredSections,
      optionalSections,
      sectionOrder,
      defaultWordLimits: finalWordLimits,
      defaultCitationStyle: defaultCitationStyle || undefined,
      sortOrder
    }

    try {
      setSaving(true)
      const url = isNew ? '/api/admin/paper-types' : `/api/admin/paper-types/${paperType?.code}`
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
        setError(errorData.error || 'Failed to save paper type')
      }
    } catch (err) {
      setError('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  const addSection = (section: string, isRequired: boolean) => {
    const normalizedSection = section.toLowerCase().replace(/\s+/g, '_')
    
    if (requiredSections.includes(normalizedSection) || optionalSections.includes(normalizedSection)) {
      return // Already exists
    }

    if (isRequired) {
      setRequiredSections([...requiredSections, normalizedSection])
    } else {
      setOptionalSections([...optionalSections, normalizedSection])
    }

    // Set default word limit
    if (!wordLimits[normalizedSection]) {
      setWordLimits({
        ...wordLimits,
        [normalizedSection]: DEFAULT_WORD_LIMITS[normalizedSection] || 500
      })
    }
  }

  const removeSection = (section: string) => {
    setRequiredSections(requiredSections.filter(s => s !== section))
    setOptionalSections(optionalSections.filter(s => s !== section))
    setSectionOrder(sectionOrder.filter(s => s !== section))
    const newWordLimits = { ...wordLimits }
    delete newWordLimits[section]
    setWordLimits(newWordLimits)
  }

  const moveSection = (section: string, direction: 'up' | 'down') => {
    const index = sectionOrder.indexOf(section)
    if (index === -1) return

    const newOrder = [...sectionOrder]
    if (direction === 'up' && index > 0) {
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    } else if (direction === 'down' && index < newOrder.length - 1) {
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    }
    setSectionOrder(newOrder)
  }

  const toggleSectionRequired = (section: string) => {
    if (requiredSections.includes(section)) {
      setRequiredSections(requiredSections.filter(s => s !== section))
      setOptionalSections([...optionalSections, section])
    } else {
      setOptionalSections(optionalSections.filter(s => s !== section))
      setRequiredSections([...requiredSections, section])
    }
  }

  const formatSectionName = (key: string): string => {
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const availableSections = COMMON_SECTIONS.filter(
    s => !requiredSections.includes(s) && !optionalSections.includes(s)
  )

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {isNew ? 'Create New Paper Type' : `Edit: ${paperType?.name}`}
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
              placeholder="JOURNAL_ARTICLE"
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
              placeholder="Journal Article"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="A standard research paper for peer-reviewed journals..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Default Citation Style
            </label>
            <select
              value={defaultCitationStyle}
              onChange={(e) => setDefaultCitationStyle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">None (user selects)</option>
              {citationStyles.map(style => (
                <option key={style.code} value={style.code}>{style.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Sort Order
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="0"
            />
            <p className="text-xs text-slate-500 mt-1">Lower numbers appear first</p>
          </div>
        </div>

        {/* Sections Configuration */}
        <div className="border-t border-slate-200 pt-6">
          <h3 className="text-lg font-medium text-slate-900 mb-4">Sections Configuration</h3>

          {/* Add Section */}
          <div className="mb-4 p-4 bg-slate-50 rounded-lg">
            <label className="block text-sm font-medium text-slate-700 mb-2">Add Section</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {availableSections.map(section => (
                <button
                  key={section}
                  type="button"
                  onClick={() => addSection(section, true)}
                  className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg hover:border-indigo-500 hover:text-indigo-600 transition-colors"
                >
                  + {formatSectionName(section)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Custom section name..."
              />
              <button
                type="button"
                onClick={() => {
                  if (newSectionName.trim()) {
                    addSection(newSectionName, true)
                    setNewSectionName('')
                  }
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
              >
                Add Required
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newSectionName.trim()) {
                    addSection(newSectionName, false)
                    setNewSectionName('')
                  }
                }}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm"
              >
                Add Optional
              </button>
            </div>
          </div>

          {/* Section Order with Word Limits */}
          <div className="space-y-2">
            <div className="flex items-center text-sm font-medium text-slate-700 px-3 py-2 bg-slate-100 rounded-t-lg">
              <span className="w-8">#</span>
              <span className="flex-1">Section Name</span>
              <span className="w-24 text-center">Type</span>
              <span className="w-32 text-center">Word Limit</span>
              <span className="w-32 text-right">Actions</span>
            </div>

            {sectionOrder.map((section, index) => {
              const isRequired = requiredSections.includes(section)
              return (
                <div
                  key={section}
                  className={`flex items-center px-3 py-2 border rounded-lg ${
                    isRequired ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <span className="w-8 text-slate-400 text-sm">{index + 1}</span>
                  <span className="flex-1 font-medium text-slate-900">{formatSectionName(section)}</span>
                  <span className="w-24 text-center">
                    <button
                      type="button"
                      onClick={() => toggleSectionRequired(section)}
                      className={`text-xs px-2 py-1 rounded ${
                        isRequired
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      {isRequired ? 'Required' : 'Optional'}
                    </button>
                  </span>
                  <span className="w-32 text-center">
                    <input
                      type="number"
                      value={wordLimits[section] || ''}
                      onChange={(e) => setWordLimits({
                        ...wordLimits,
                        [section]: parseInt(e.target.value) || 0
                      })}
                      className="w-20 px-2 py-1 text-sm border border-slate-300 rounded text-center focus:ring-1 focus:ring-indigo-500"
                      placeholder="500"
                    />
                  </span>
                  <span className="w-32 flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => moveSection(section, 'up')}
                      disabled={index === 0}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(section, 'down')}
                      disabled={index === sectionOrder.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(section)}
                      className="p-1 text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )
            })}

            {sectionOrder.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                No sections added yet. Add sections using the buttons above.
              </div>
            )}
          </div>
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
            disabled={saving}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {isNew ? 'Create Paper Type' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

