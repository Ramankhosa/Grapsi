'use client'
/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react/jsx-no-comment-textnodes */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

// Superset section info (loaded from API, this is fallback)
interface SupersetSection {
  key: string
  label: string
  order: number
  required: boolean
}

interface SectionPrompt {
  id: string
  countryCode: string
  sectionKey: string
  sectionLabel?: string // From API - resolved label
  sectionOrder?: number
  instruction: string
  constraints: string[]
  additions: string[]
  importFiguresDirectly?: boolean // When true, bypass LLM and import figure titles directly
  version: number
  status: string
}

interface CountryData {
  code: string
  name: string
  prompts: SectionPrompt[]
}

const FLAGS: Record<string, string> = {
  'IN': '🇮🇳', 'US': '🇺🇸', 'AU': '🇦🇺', 'CA': '🇨🇦', 'JP': '🇯🇵',
  'CN': '🇨🇳', 'EP': '🇪🇺', 'PCT': '🌐', 'UK': '🇬🇧', 'DE': '🇩🇪',
  'FR': '🇫🇷', 'KR': '🇰🇷', 'BR': '🇧🇷'
}

export default function SuperAdminSectionPromptsPage() {
  noStore()

  const { user } = useAuth()
  const [countries, setCountries] = useState<CountryData[]>([])
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingPrompt, setEditingPrompt] = useState<SectionPrompt | null>(null)
  const [showHierarchy, setShowHierarchy] = useState(true)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  
  // Superset sections and country headings from API (master source)
  const [supersetSections, setSupersetSections] = useState<SupersetSection[]>([])
  const [countryHeadings, setCountryHeadings] = useState<Record<string, Record<string, string>>>({})


  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/super-admin/section-prompts', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        
        // Store superset sections (master labels from jurisdiction-config)
        if (data.supersetSections) {
          setSupersetSections(data.supersetSections)
        }
        
        // Store country-specific headings
        if (data.countryHeadings) {
          setCountryHeadings(data.countryHeadings)
        }
        
        const countriesData: CountryData[] = Object.entries(data.promptsByCountry || {}).map(
          ([code, prompts]) => ({
            code,
            name: data.countryNames?.[code] || code,
            prompts: prompts as SectionPrompt[]
          })
        ).sort((a, b) => a.name.localeCompare(b.name))
        setCountries(countriesData)
        if (countriesData.length > 0 && !selectedCountry) {
          setSelectedCountry(countriesData[0].code)
        }
      }
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedCountry])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
    fetchData()
  }, [user, fetchData])

  // Helper to get section label: country-specific > superset > sectionKey
  const getSectionLabel = (countryCode: string, sectionKey: string): string => {
    // Priority 1: Country-specific heading from CountrySectionMapping
    const countryLabel = countryHeadings[countryCode]?.[sectionKey]
    if (countryLabel) return countryLabel
    
    // Priority 2: Superset section label
    const supersetSection = supersetSections.find(s => s.key === sectionKey)
    if (supersetSection) return supersetSection.label
    
    // Fallback: sectionKey
    return sectionKey
  }
  
  // Helper to get superset info
  const getSupersetInfo = (sectionKey: string): SupersetSection | undefined => {
    return supersetSections.find(s => s.key === sectionKey)
  }

  const selectedCountryData = countries.find(c => c.code === selectedCountry)
  const promptsMap = new Map(selectedCountryData?.prompts.map(p => [p.sectionKey, p]) || [])

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading prompt hierarchy...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                📝 Section Prompt Management
              </h1>
              <p className="text-gray-500 mt-1">
                Configure jurisdiction-specific drafting prompts with visual hierarchy
              </p>
            </div>
            <button
              onClick={() => setShowHierarchy(!showHierarchy)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                showHierarchy
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {showHierarchy ? '📊 Hide Hierarchy' : '📊 Show Hierarchy'}
            </button>
          </div>
        </div>
      </div>

      {/* Hierarchy Explainer */}
      {showHierarchy && (
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-xl p-1">
            <div className="bg-white rounded-lg p-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <span className="text-2xl">🏗️</span>
                Prompt Hierarchy (How Prompts Are Merged)
              </h3>
              <div className="flex flex-col md:flex-row gap-4 items-stretch">
                {/* Layer 1 */}
                <div className="flex-1 bg-slate-100 rounded-lg p-4 border-2 border-slate-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-slate-500 text-white text-xs font-bold px-2 py-1 rounded">L1</span>
                    <span className="font-semibold text-slate-700">Base Superset</span>
                  </div>
                  <p className="text-sm text-slate-600 mb-2">
                    Universal prompts from database. Apply to ALL countries.
                  </p>
                  <div className="text-xs bg-slate-200 rounded p-2 font-mono">
                    DB: superset_sections
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    🗄️ Stored in SupersetSection table
                  </div>
                </div>

                <div className="flex items-center justify-center text-2xl text-gray-400">
                  <span className="hidden md:block">→</span>
                  <span className="md:hidden">↓</span>
                </div>

                {/* Layer 2 */}
                <div className="flex-1 bg-blue-50 rounded-lg p-4 border-2 border-blue-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">L2</span>
                    <span className="font-semibold text-blue-700">Country Top-Up</span>
                    <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">EDIT HERE</span>
                  </div>
                  <p className="text-sm text-blue-600 mb-2">
                    Jurisdiction-specific additions. <strong>You manage these!</strong>
                  </p>
                  <div className="text-xs bg-blue-100 rounded p-2 font-mono">
                    DB: country_section_prompts
                  </div>
                  <div className="mt-2 text-xs text-blue-500">
                    🗄️ Stored in database (editable below)
                  </div>
                </div>

                <div className="flex items-center justify-center text-2xl text-gray-400">
                  <span className="hidden md:block">→</span>
                  <span className="md:hidden">↓</span>
                </div>

                {/* Layer 3 */}
                <div className="flex-1 bg-green-50 rounded-lg p-4 border-2 border-green-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded">L3</span>
                    <span className="font-semibold text-green-700">User Instructions</span>
                  </div>
                  <p className="text-sm text-green-600 mb-2">
                    Per-session overrides by users. Highest priority.
                  </p>
                  <div className="text-xs bg-green-100 rounded p-2 font-mono">
                    DB: user_section_instructions
                  </div>
                  <div className="mt-2 text-xs text-green-500">
                    👤 Set by users during drafting
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  <strong>💡 How it works:</strong> When drafting, the system merges L1 + L2 + L3. 
                  Your L2 edits add jurisdiction rules (e.g., "Per Indian Patents Act Section 10(4)...") 
                  on top of the universal L1 base prompts.
                </p>
              </div>
              
              {/* Label Hierarchy */}
              <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                <p className="text-sm text-indigo-800 mb-2">
                  <strong>📋 Section Labels & Headings:</strong> This page inherits labels from:
                </p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="bg-slate-200 text-slate-700 px-2 py-1 rounded inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                    Superset Sections (default labels)
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="bg-amber-200 text-amber-800 px-2 py-1 rounded inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Country Mappings (custom headings)
                  </span>
                  <span className="text-slate-400">— from</span>
                  <a 
                    href="/super-admin/jurisdiction-config"
                    className="bg-purple-200 text-purple-800 px-2 py-1 rounded hover:bg-purple-300 transition"
                  >
                    🔧 Jurisdiction Config →
                  </a>
                </div>
                <p className="text-xs text-indigo-600 mt-2">
                  Sections with <span className="bg-amber-100 text-amber-700 px-1 rounded">Custom</span> label have country-specific headings defined in Jurisdiction Config.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* Country Sidebar */}
          <div className="col-span-3">
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold text-gray-700">🌍 Jurisdictions</h3>
              </div>
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {countries.map(country => (
                  <button
                    key={country.code}
                    onClick={() => {
                      setSelectedCountry(country.code)
                      setSelectedSection(null)
                    }}
                    className={`w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-50 transition ${
                      selectedCountry === country.code ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{FLAGS[country.code] || '🏳️'}</span>
                      <div>
                        <div className="font-medium text-gray-900">{country.name}</div>
                        <div className="text-xs text-gray-500">{country.code}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-indigo-600">
                        {country.prompts.length}
                      </div>
                      <div className="text-xs text-gray-400">prompts</div>
                    </div>
                  </button>
                ))}
                {countries.length === 0 && (
                  <div className="px-4 py-8 text-center text-gray-500">
                    <p>No countries found</p>
                    <p className="text-sm mt-2">Run seed script to populate</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section List */}
          <div className="col-span-9">
            {selectedCountryData && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <span className="text-2xl">{FLAGS[selectedCountry!] || '🏳️'}</span>
                      {selectedCountryData.name} Section Prompts
                    </h3>
                    <p className="text-sm text-gray-500">
                      {selectedCountryData.prompts.length} of {supersetSections.length} sections configured
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        // Seed from JSON
                        if (confirm(`Seed missing prompts for ${selectedCountryData.name} from JSON file?`)) {
                          fetch('/api/super-admin/section-prompts', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                            },
                            body: JSON.stringify({ action: 'seed', countryCode: selectedCountry })
                          }).then(() => fetchData())
                        }
                      }}
                      className="px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"
                    >
                      🌱 Seed from JSON
                    </button>
                  </div>
                </div>

                {/* Section Grid */}
                <div className="p-6">
                  <div className="grid grid-cols-1 gap-3">
                    {supersetSections.map((section, idx) => {
                      const prompt = promptsMap.get(section.key)
                      const isConfigured = !!prompt
                      const isSelected = selectedSection === section.key
                      // Get country-specific label if available
                      const displayLabel = getSectionLabel(selectedCountry!, section.key)
                      const hasCountryOverride = countryHeadings[selectedCountry!]?.[section.key]

                      return (
                        <div
                          key={section.key}
                          className={`rounded-lg border-2 transition-all ${
                            isSelected 
                              ? 'border-indigo-400 bg-indigo-50 shadow-md' 
                              : isConfigured 
                                ? 'border-green-200 bg-green-50 hover:border-green-300' 
                                : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          <div 
                            className="px-4 py-3 flex items-center justify-between cursor-pointer"
                            onClick={() => setSelectedSection(isSelected ? null : section.key)}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                isConfigured 
                                  ? 'bg-green-500 text-white' 
                                  : 'bg-gray-300 text-gray-600'
                              }`}>
                                {section.order}
                              </span>
                              <div>
                                <div className="font-medium text-gray-900 flex items-center gap-2">
                                  {displayLabel}
                                  {hasCountryOverride && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded" title={`Superset label: ${section.label}`}>
                                      Custom
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 font-mono">
                                  {section.key}
                                  {hasCountryOverride && (
                                    <span className="ml-2 text-gray-400">← {section.label}</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              {isConfigured ? (
                                <>
                                  <span className="text-xs px-2 py-1 bg-green-200 text-green-800 rounded">
                                    v{prompt.version} • {prompt.status}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {prompt.constraints?.length || 0} constraints
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingPrompt(prompt)
                                    }}
                                    className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                                  >
                                    ✏️ Edit
                                  </button>
                                </>
                              ) : (
                                <span className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded">
                                  Not configured (using base only)
                                </span>
                              )}
                              <span className="text-gray-400">
                                {isSelected ? '▼' : '▶'}
                              </span>
                            </div>
                          </div>

                          {/* Expanded Detail */}
                          {isSelected && prompt && (
                            <div className="px-4 pb-4 border-t border-gray-200 mt-2 pt-4">
                              <div className="grid grid-cols-2 gap-4">
                                {/* L1 Base (Readonly) */}
                                <div className="bg-slate-100 rounded-lg p-4">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="bg-slate-500 text-white text-xs font-bold px-2 py-0.5 rounded">L1</span>
                                    <span className="font-medium text-slate-700">Base Superset (Database)</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mb-2">
                                    Universal prompt from SupersetSection table
                                  </p>
                                  <div className="bg-slate-200 rounded p-3 text-xs font-mono text-slate-600 max-h-32 overflow-y-auto">
                                    DB: superset_sections['{section.key}']<br/>
                                    <span className="text-slate-400">// Manage via SupersetSection database table</span>
                                  </div>
                                </div>

                                {/* L2 Country Top-Up (Editable) */}
                                <div className="bg-blue-50 rounded-lg p-4 border-2 border-blue-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded">L2</span>
                                      <span className="font-medium text-blue-700">Country Top-Up</span>
                                    </div>
                                    <button
                                      onClick={() => setEditingPrompt(prompt)}
                                      className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                                    >
                                      ✏️ Edit
                                    </button>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div>
                                      <label className="text-xs font-medium text-blue-700">Instruction:</label>
                                      <div className="bg-white rounded p-2 text-xs max-h-24 overflow-y-auto border">
                                        {prompt.instruction?.substring(0, 200)}...
                                      </div>
                                    </div>

                                    {prompt.constraints?.length > 0 && (
                                      <div>
                                        <label className="text-xs font-medium text-blue-700">
                                          Constraints ({prompt.constraints.length}):
                                        </label>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {prompt.constraints.slice(0, 3).map((c, i) => (
                                            <span key={i} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                              {c.substring(0, 30)}...
                                            </span>
                                          ))}
                                          {prompt.constraints.length > 3 && (
                                            <span className="text-xs text-blue-500">
                                              +{prompt.constraints.length - 3} more
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {prompt.additions?.length > 0 && (
                                      <div>
                                        <label className="text-xs font-medium text-blue-700">
                                          Additions ({prompt.additions.length}):
                                        </label>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {prompt.additions.slice(0, 2).map((a, i) => (
                                            <span key={i} className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                                              {a.substring(0, 30)}...
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Merged Preview */}
                              <div className="mt-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-lg">🔀</span>
                                  <span className="font-medium text-purple-700">Merged Result Preview</span>
                                </div>
                                <p className="text-xs text-purple-600">
                                  This is what the LLM receives: L1 base instruction + L2 country guidance + any L3 user overrides
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            toast.type === 'success' 
              ? 'bg-emerald-600 text-white' 
              : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="font-medium">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingPrompt && (
        <EditPromptModal
          prompt={editingPrompt}
          countryName={selectedCountryData?.name || ''}
          sectionLabel={getSectionLabel(selectedCountry!, editingPrompt.sectionKey)}
          supersetLabel={getSupersetInfo(editingPrompt.sectionKey)?.label}
          onSave={async (updated) => {
            try {
              const response = await fetch('/api/super-admin/section-prompts', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({
                  id: editingPrompt.id,
                  instruction: updated.instruction,
                  constraints: updated.constraints,
                  additions: updated.additions,
                  importFiguresDirectly: updated.importFiguresDirectly,
                  changeReason: updated.changeReason
                })
              })
              if (response.ok) {
                setToast({ type: 'success', message: `✓ Prompt updated successfully for ${selectedCountryData?.name} → ${getSectionLabel(selectedCountry!, editingPrompt.sectionKey)}` })
                setEditingPrompt(null)
                fetchData()
                // Auto-hide toast after 3 seconds
                setTimeout(() => setToast(null), 3000)
              } else {
                const err = await response.json()
                setToast({ type: 'error', message: 'Failed to save: ' + (err.error || 'Unknown error') })
              }
            } catch (err) {
              setToast({ type: 'error', message: 'Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error') })
            }
          }}
          onCancel={() => setEditingPrompt(null)}
        />
      )}
    </div>
  )
}

// Edit Modal Component
function EditPromptModal({
  prompt,
  countryName,
  sectionLabel,
  supersetLabel,
  onSave,
  onCancel
}: {
  prompt: SectionPrompt
  countryName: string
  sectionLabel: string  // Resolved label (country-specific or superset)
  supersetLabel?: string // Original superset label for reference
  onSave: (data: { instruction: string; constraints: string[]; additions: string[]; importFiguresDirectly: boolean; changeReason: string }) => void
  onCancel: () => void
}) {
  const [instruction, setInstruction] = useState(prompt.instruction)
  const [constraints, setConstraints] = useState<string[]>(prompt.constraints || [])
  const [additions, setAdditions] = useState<string[]>(prompt.additions || [])
  const [importFiguresDirectly, setImportFiguresDirectly] = useState(prompt.importFiguresDirectly || false)
  const [newConstraint, setNewConstraint] = useState('')
  const [newAddition, setNewAddition] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = () => {
    if (!changeReason.trim()) {
      alert('Please provide a change reason for the audit log')
      return
    }
    setSaving(true)
    onSave({ instruction, constraints, additions, importFiguresDirectly, changeReason })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded">L2</span>
                Edit Country Top-Up Prompt
              </h2>
              <p className="text-indigo-200 mt-1">
                {countryName} • {sectionLabel}
                {supersetLabel && supersetLabel !== sectionLabel && (
                  <span className="ml-2 text-indigo-300 text-xs">(Superset: {supersetLabel})</span>
                )}
              </p>
            </div>
            <button onClick={onCancel} className="text-white/70 hover:text-white text-2xl">×</button>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
          <p className="text-sm text-amber-800">
            ⚠️ <strong>Caution:</strong> Changes here affect ALL future drafts for {countryName}. 
            This prompt will be merged with the base superset prompt.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Instruction */}
          <div className="mb-6">
            <label className="block font-medium text-gray-700 mb-2">
              📝 Jurisdiction-Specific Instruction
              <span className="text-sm font-normal text-gray-500 ml-2">
                (appended to base prompt)
              </span>
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={6}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 font-mono text-sm"
              placeholder="Per [Country] Patent Act Section X, ensure that..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Reference local laws, rules, and patent office guidelines here.
            </p>
          </div>

          {/* Import Figures Directly Toggle */}
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={importFiguresDirectly}
                onChange={(e) => setImportFiguresDirectly(e.target.checked)}
                className="mt-1 w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
              />
              <div>
                <span className="font-medium text-gray-700 flex items-center gap-2">
                  📋 Import Figure Titles Directly
                  <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded">Special Mode</span>
                </span>
                <p className="text-sm text-gray-600 mt-1">
                  When enabled, this section will <strong>bypass LLM generation</strong> and directly import
                  figure titles from the Figure Planner stage. Use this for &quot;Brief Description of Drawings&quot;
                  to ensure figure titles remain exactly as defined by the user.
                </p>
              </div>
            </label>
          </div>

          {/* Constraints */}
          <div className="mb-6">
            <label className="block font-medium text-gray-700 mb-2">
              🚫 Constraints
              <span className="text-sm font-normal text-gray-500 ml-2">
                (rules the LLM must follow)
              </span>
            </label>
            <div className="space-y-2 mb-3">
              {constraints.map((c, index) => (
                <div key={index} className="flex items-start gap-2 bg-blue-50 p-3 rounded-lg">
                  <span className="text-blue-600 font-bold">•</span>
                  <span className="flex-1 text-sm">{c}</span>
                  <button
                    onClick={() => setConstraints(constraints.filter((_, i) => i !== index))}
                    className="text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newConstraint}
                onChange={(e) => setNewConstraint(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newConstraint.trim()) {
                    setConstraints([...constraints, newConstraint.trim()])
                    setNewConstraint('')
                  }
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Add a constraint (e.g., 'Do not exceed 150 words')"
              />
              <button
                onClick={() => {
                  if (newConstraint.trim()) {
                    setConstraints([...constraints, newConstraint.trim()])
                    setNewConstraint('')
                  }
                }}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Additions */}
          <div className="mb-6">
            <label className="block font-medium text-gray-700 mb-2">
              ➕ Additions
              <span className="text-sm font-normal text-gray-500 ml-2">
                (extra guidance beyond constraints)
              </span>
            </label>
            <div className="space-y-2 mb-3">
              {additions.map((a, index) => (
                <div key={index} className="flex items-start gap-2 bg-green-50 p-3 rounded-lg">
                  <span className="text-green-600 font-bold">+</span>
                  <span className="flex-1 text-sm">{a}</span>
                  <button
                    onClick={() => setAdditions(additions.filter((_, i) => i !== index))}
                    className="text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newAddition}
                onChange={(e) => setNewAddition(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newAddition.trim()) {
                    setAdditions([...additions, newAddition.trim()])
                    setNewAddition('')
                  }
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Add extra guidance (e.g., 'Reference Section 10(4) where applicable')"
              />
              <button
                onClick={() => {
                  if (newAddition.trim()) {
                    setAdditions([...additions, newAddition.trim()])
                    setNewAddition('')
                  }
                }}
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Change Reason */}
          <div className="bg-gray-50 rounded-lg p-4 border">
            <label className="block font-medium text-gray-700 mb-2">
              📋 Change Reason (Required for Audit Log)
            </label>
            <input
              type="text"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="e.g., 'Updated per new Patent Office guidelines dated Nov 2025'"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-gray-50 px-6 py-4 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Current: v{prompt.version} • Will create v{prompt.version + 1}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              disabled={saving || !changeReason.trim()}
            >
              {saving ? 'Saving...' : '💾 Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
