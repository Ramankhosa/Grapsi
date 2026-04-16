'use client'

import { useState, useEffect } from 'react'

interface WritingSample {
  id?: string
  sampleText: string
  notes?: string
  wordCount?: number
  isActive?: boolean
  updatedAt?: string
}

interface WritingSamplesModalProps {
  onClose: () => void
  onUpdate?: () => void
}

const SECTION_CONFIG = [
  { key: 'title', label: 'Title', hint: 'Your preferred title phrasing style' },
  { key: 'abstract', label: 'Abstract', hint: 'Example abstract paragraph showing your tone and structure' },
  { key: 'fieldOfInvention', label: 'Field of Invention', hint: 'How you describe the technical field' },
  { key: 'background', label: 'Background', hint: 'Your style for discussing prior art and problems' },
  { key: 'objectsOfInvention', label: 'Objects of Invention', hint: 'How you list invention objectives' },
  { key: 'summary', label: 'Summary', hint: 'Your summary/disclosure style' },
  { key: 'briefDescriptionOfDrawings', label: 'Brief Description of Drawings', hint: 'Your figure caption format' },
  { key: 'detailedDescription', label: 'Detailed Description', hint: 'Sample paragraph showing figure refs, embodiments' },
  { key: 'claims', label: 'Claims', hint: 'Sample claim showing your preamble and structure style' },
]

const JURISDICTIONS = [
  { code: '*', label: '🌐 Universal (All Jurisdictions)', description: 'Apply to all patent filings' },
  { code: 'US', label: '🇺🇸 United States', description: 'USPTO-specific style' },
  { code: 'IN', label: '🇮🇳 India', description: 'IPO-specific style' },
  { code: 'EP', label: '🇪🇺 European Patent', description: 'EPO-specific style' },
  { code: 'PCT', label: '🌍 PCT', description: 'International filing style' },
]

// Section-specific word limits - MUST match backend (src/app/api/writing-samples/limits/route.ts)
// Higher limits for key sections to capture more writing patterns for effective style mimicry
const SECTION_WORD_LIMITS: Record<string, { min: number; max: number; recommended: { min: number; max: number } }> = {
  title: { min: 3, max: 50, recommended: { min: 5, max: 30 } },
  fieldOfInvention: { min: 5, max: 200, recommended: { min: 10, max: 100 } },
  background: { min: 10, max: 1500, recommended: { min: 80, max: 400 } },
  objectsOfInvention: { min: 5, max: 500, recommended: { min: 20, max: 200 } },
  summary: { min: 10, max: 1500, recommended: { min: 80, max: 400 } },
  briefDescriptionOfDrawings: { min: 5, max: 500, recommended: { min: 20, max: 150 } },
  detailedDescription: { min: 20, max: 3000, recommended: { min: 150, max: 800 } },
  claims: { min: 10, max: 2000, recommended: { min: 100, max: 600 } },
  abstract: { min: 10, max: 500, recommended: { min: 50, max: 200 } },
}

// Default for unknown sections
const DEFAULT_LIMITS = { min: 5, max: 1000, recommended: { min: 10, max: 300 } }

function getSectionLimits(sectionKey: string) {
  return SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export default function WritingSamplesModal({ onClose, onUpdate }: WritingSamplesModalProps) {
  const [samples, setSamples] = useState<Record<string, Record<string, WritingSample>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [activeJurisdiction, setActiveJurisdiction] = useState('*')
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSamples()
  }, [])

  const fetchSamples = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/writing-samples', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setSamples(data.grouped || {})
      }
    } catch (err) {
      console.error('Failed to fetch samples:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (sectionKey: string) => {
    const text = editingText[sectionKey]
    if (!text?.trim()) return

    const limits = getSectionLimits(sectionKey)
    const wordCount = countWords(text)
    if (wordCount < limits.min) {
      setError(`Sample too short for ${sectionKey}. Minimum ${limits.min} words required.`)
      return
    }
    if (wordCount > limits.max) {
      setError(`Sample too long for ${sectionKey}. Maximum ${limits.max} words allowed.`)
      return
    }

    setSaving(sectionKey)
    setError(null)

    try {
      const response = await fetch('/api/writing-samples', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          jurisdiction: activeJurisdiction,
          sectionKey,
          sampleText: text.trim()
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSamples(prev => ({
          ...prev,
          [activeJurisdiction]: {
            ...(prev[activeJurisdiction] || {}),
            [sectionKey]: data.sample
          }
        }))
        setExpandedSection(null)
        onUpdate?.()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to save')
      }
    } catch (err) {
      setError('Failed to save sample')
    } finally {
      setSaving(null)
    }
  }

  const handleDelete = async (sectionKey: string) => {
    if (!confirm('Delete this writing sample?')) return

    setSaving(sectionKey)
    try {
      await fetch(`/api/writing-samples?jurisdiction=${activeJurisdiction}&sectionKey=${sectionKey}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })

      setSamples(prev => {
        const updated = { ...prev }
        if (updated[activeJurisdiction]) {
          delete updated[activeJurisdiction][sectionKey]
        }
        return updated
      })
      setEditingText(prev => ({ ...prev, [sectionKey]: '' }))
      onUpdate?.()
    } catch (err) {
      setError('Failed to delete sample')
    } finally {
      setSaving(null)
    }
  }

  const handleToggle = async (sectionKey: string, isActive: boolean) => {
    const sample = samples[activeJurisdiction]?.[sectionKey]
    if (!sample?.id) return

    try {
      await fetch('/api/writing-samples', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'toggle',
          id: sample.id,
          isActive
        })
      })

      setSamples(prev => ({
        ...prev,
        [activeJurisdiction]: {
          ...(prev[activeJurisdiction] || {}),
          [sectionKey]: { ...sample, isActive }
        }
      }))
      onUpdate?.()
    } catch (err) {
      console.error('Failed to toggle:', err)
    }
  }

  const currentSamples = samples[activeJurisdiction] || {}
  const totalSamples = Object.values(samples).reduce(
    (sum, jur) => sum + Object.keys(jur).length, 0
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              ✍️ Writing Style Samples
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Add examples of YOUR writing style. The AI will mimic your patterns.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Jurisdiction Tabs */}
        <div className="p-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {JURISDICTIONS.map(j => {
              const hassamples = samples[j.code] && Object.keys(samples[j.code]).length > 0
              return (
                <button
                  key={j.code}
                  onClick={() => setActiveJurisdiction(j.code)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                    activeJurisdiction === j.code
                      ? 'bg-violet-600 text-white'
                      : hassamples
                        ? 'bg-slate-700 text-violet-300 hover:bg-slate-600'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {j.label}
                  {hassamples && (
                    <span className="ml-2 px-1.5 py-0.5 bg-violet-500/30 rounded text-xs">
                      {Object.keys(samples[j.code]).length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {JURISDICTIONS.find(j => j.code === activeJurisdiction)?.description}
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            ⚠️ {error}
            <button 
              onClick={() => setError(null)} 
              className="ml-2 text-red-300 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {SECTION_CONFIG.map(section => {
                const sample = currentSamples[section.key]
                const isExpanded = expandedSection === section.key
                const currentText = editingText[section.key] ?? sample?.sampleText ?? ''
                const wordCount = countWords(currentText)
                const limits = getSectionLimits(section.key)
                const isOverLimit = wordCount > limits.max
                const isUnderLimit = wordCount > 0 && wordCount < limits.min
                const isInRecommendedRange = wordCount >= limits.recommended.min && wordCount <= limits.recommended.max

                return (
                  <div 
                    key={section.key}
                    className={`rounded-xl border transition ${
                      sample 
                        ? sample.isActive !== false
                          ? 'border-violet-500/50 bg-slate-800'
                          : 'border-slate-700 bg-slate-800/50 opacity-60'
                        : 'border-slate-700 bg-slate-800/30'
                    }`}
                  >
                    {/* Section Header */}
                    <div 
                      className="flex items-center justify-between p-4 cursor-pointer"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedSection(null)
                        } else {
                          setExpandedSection(section.key)
                          setEditingText(prev => ({
                            ...prev,
                            [section.key]: sample?.sampleText || ''
                          }))
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-lg ${sample ? '🟢' : '⚪'}`}>
                          {sample ? (sample.isActive !== false ? '✓' : '○') : '○'}
                        </span>
                        <div>
                          <h3 className="font-medium text-white">{section.label}</h3>
                          {sample ? (
                            <p className="text-xs text-slate-400 line-clamp-1">
                              {sample.sampleText?.substring(0, 80)}...
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500">{section.hint}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sample && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggle(section.key, sample.isActive === false)
                              }}
                              className={`px-2 py-1 text-xs rounded ${
                                sample.isActive !== false
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-slate-700 text-slate-400'
                              }`}
                            >
                              {sample.isActive !== false ? 'Active' : 'Disabled'}
                            </button>
                            <span className="text-xs text-slate-500">
                              {sample.wordCount || countWords(sample.sampleText || '')} words
                            </span>
                          </>
                        )}
                        <svg 
                          className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded Editor */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-700">
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs text-slate-400">
                              Your writing sample ({limits.recommended.min}-{limits.recommended.max} words recommended)
                            </label>
                            <span className={`text-xs ${
                              isOverLimit ? 'text-red-400' : isUnderLimit ? 'text-amber-400' : isInRecommendedRange ? 'text-emerald-400' : 'text-slate-500'
                            }`}>
                              {wordCount} words 
                              {isOverLimit && ` (max ${limits.max})`}
                              {isUnderLimit && ` (min ${limits.min})`}
                              {isInRecommendedRange && ' ✓'}
                            </span>
                          </div>
                          <textarea
                            value={currentText}
                            onChange={(e) => setEditingText(prev => ({
                              ...prev,
                              [section.key]: e.target.value
                            }))}
                            placeholder={`Example: "${section.key === 'claims' 
                              ? 'A system configured to process data, comprising: a first module operatively coupled to...'
                              : section.key === 'detailedDescription'
                                ? 'Referring now to FIG. 1, there is shown a system 100 in accordance with an embodiment...'
                                : 'Add your preferred writing style for this section...'
                            }"`}
                            className={`w-full px-3 py-3 bg-slate-900 border rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none resize-none ${
                              isOverLimit ? 'border-red-500' : 'border-slate-600 focus:border-violet-500'
                            }`}
                            rows={5}
                          />
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-slate-500">
                              💡 The AI will mimic your word choices, sentence structure, and tone from this example.
                            </p>
                            <p className="text-xs text-slate-500">
                              Range: {limits.min}-{limits.max} words
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-4">
                          {sample && (
                            <button
                              onClick={() => handleDelete(section.key)}
                              disabled={saving === section.key}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Delete Sample
                            </button>
                          )}
                          <div className="flex items-center gap-2 ml-auto">
                            <button
                              onClick={() => setExpandedSection(null)}
                              className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSave(section.key)}
                              disabled={saving === section.key || isOverLimit || isUnderLimit}
                              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg font-medium disabled:opacity-50"
                            >
                              {saving === section.key ? 'Saving...' : 'Save Sample'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              <span className="text-violet-400">{totalSamples}</span> writing samples saved
              {activeJurisdiction === '*' && ' • Universal samples apply to all jurisdictions'}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

