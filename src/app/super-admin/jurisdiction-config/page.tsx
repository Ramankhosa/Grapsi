'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth-context'

// ============================================================================
// Types
// ============================================================================

interface SupersetSection {
  id: string
  sectionKey: string
  displayOrder: number
  label: string
  description: string | null
  instruction: string
  constraints: string[]
  isRequired: boolean
  isActive: boolean
  mappingCount: number
  // Context injection flags (base defaults for all countries)
  requiresPriorArt: boolean
  requiresFigures: boolean
  requiresClaims: boolean
  requiresComponents: boolean
}

interface CountryConfig {
  code: string
  name: string
  version: number
  mappings: any[]
  prompts: any[]
  enabledSections: string[]
  requiredSections: string[]
}

interface MatrixRow {
  sectionKey: string
  label: string
  displayOrder: number
  description: string | null
  isActive: boolean
  baseInstruction: string
  baseConstraints: string[]
  // Base context flags from superset section
  requiresPriorArt: boolean
  requiresFigures: boolean
  requiresClaims: boolean
  requiresComponents: boolean
  countries: Record<string, {
    mapped: boolean
    enabled: boolean
    required: boolean
    heading: string | null
    hasPrompt: boolean
    promptVersion: number | null
    // Context override flags (null = use superset default)
    requiresPriorArtOverride: boolean | null
    requiresFiguresOverride: boolean | null
    requiresClaimsOverride: boolean | null
    requiresComponentsOverride: boolean | null
  }>
}

interface Stats {
  totalSupersetSections: number
  activeSupersetSections: number
  totalCountries: number
  totalMappings: number
  totalPrompts: number
  unmappedCombinations: number
}

const FLAGS: Record<string, string> = {
  'IN': '🇮🇳', 'US': '🇺🇸', 'AU': '🇦🇺', 'CA': '🇨🇦', 'JP': '🇯🇵',
  'CN': '🇨🇳', 'EP': '🇪🇺', 'PCT': '🌐', 'UK': '🇬🇧', 'DE': '🇩🇪',
  'FR': '🇫🇷', 'KR': '🇰🇷', 'BR': '🇧🇷', 'MX': '🇲🇽', 'SG': '🇸🇬'
}

// ============================================================================
// Main Component
// ============================================================================

export default function JurisdictionConfigPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [supersetSections, setSupersetSections] = useState<SupersetSection[]>([])
  const [countries, setCountries] = useState<Record<string, CountryConfig>>({})
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  // UI State
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [showAddCountry, setShowAddCountry] = useState(false)
  const [showAddSection, setShowAddSection] = useState(false)
  const [showEditSection, setShowEditSection] = useState<SupersetSection | null>(null)
  const [showMappingDetails, setShowMappingDetails] = useState<{ country: string; section: string } | null>(null)
  const [viewMode, setViewMode] = useState<'matrix' | 'list'>('matrix')
  const [clearingCache, setClearingCache] = useState(false)

  // Fetch data
  useEffect(() => {
    if (!user) return
    fetchData()
  }, [user])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setSupersetSections(data.supersetSections || [])
        setCountries(data.countries || {})
        setMatrix(data.matrix || [])
        setStats(data.stats || null)
      }
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleClearCache = async () => {
    try {
      setClearingCache(true)
      const response = await fetch('/api/super-admin/section-prompts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'clear-cache' })
      })

      if (response.ok) {
        // Refresh data after cache clear
        await fetchData()
      } else {
        const data = await response.json()
        alert(`Failed to clear cache: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Clear cache error:', err)
      alert('An unexpected error occurred while clearing cache')
    } finally {
      setClearingCache(false)
    }
  }

  const countryList = useMemo(() => {
    return Object.values(countries).sort((a, b) => a.name.localeCompare(b.name))
  }, [countries])

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-amber-500 border-t-transparent mx-auto"></div>
          <p className="mt-6 text-slate-300 font-medium">Loading jurisdiction configuration...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <span className="text-3xl">🏗️</span>
                Jurisdiction Configuration
              </h1>
              <p className="text-slate-400 mt-1">
                Unified superset & country mapping management
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* View Toggle */}
              <div className="bg-slate-700 rounded-lg p-1 flex">
                <button
                  onClick={() => setViewMode('matrix')}
                  className={`px-3 py-1.5 text-sm rounded ${
                    viewMode === 'matrix' 
                      ? 'bg-amber-500 text-slate-900 font-medium' 
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  📊 Matrix
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm rounded ${
                    viewMode === 'list' 
                      ? 'bg-amber-500 text-slate-900 font-medium' 
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  📋 List
                </button>
              </div>
              <button
                onClick={handleClearCache}
                disabled={clearingCache}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                  clearingCache
                    ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                    : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
                }`}
                title="Invalidate server-side prompt and country profile caches"
              >
                {clearingCache ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full"></div>
                    Rebuilding...
                  </>
                ) : (
                  <>
                    <span>🔄</span> Rebuild Cache
                  </>
                )}
              </button>
              <button
                onClick={() => setShowAddSection(true)}
                className="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 flex items-center gap-2"
              >
                <span>➕</span> Add Section
              </button>
              <button
                onClick={() => setShowAddCountry(true)}
                className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg hover:bg-amber-400 font-medium flex items-center gap-2"
              >
                <span>🌍</span> Add Country
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div className="bg-slate-800/50 border-b border-slate-700">
          <div className="max-w-[1920px] mx-auto px-6 py-3">
            <div className="flex gap-8">
              <StatBadge label="Superset Sections" value={stats.activeSupersetSections} color="slate" />
              <StatBadge label="Countries" value={stats.totalCountries} color="amber" />
              <StatBadge label="Mappings" value={stats.totalMappings} color="emerald" />
              <StatBadge label="Top-Up Prompts" value={stats.totalPrompts} color="blue" />
              <StatBadge label="Unmapped" value={stats.unmappedCombinations} color="red" />
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-6">
        {viewMode === 'matrix' ? (
          <MatrixView
            matrix={matrix}
            countries={countryList}
            supersetSections={supersetSections}
            onCellClick={(country, section) => setShowMappingDetails({ country, section })}
            onSectionEdit={setShowEditSection}
            onSectionSelect={setSelectedSection}
            selectedSection={selectedSection}
          />
        ) : (
          <ListView
            supersetSections={supersetSections}
            countries={countryList}
            matrix={matrix}
            onSectionEdit={setShowEditSection}
          />
        )}
      </main>

      {/* Legend */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur border-t border-slate-700 py-3 px-6">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-slate-400 font-medium">Legend:</span>
            <LegendItem color="bg-slate-600" label="Superset Section (Base)" />
            <LegendItem color="bg-amber-500/30 border-amber-500" label="Mapped" />
            <LegendItem color="bg-emerald-500/30 border-emerald-500" label="Has Prompt" />
            <LegendItem color="bg-slate-700" label="Not Mapped" />
            <LegendItem color="bg-red-500/20 border-red-500" label="Disabled" />
          </div>
          <div className="text-slate-500 text-sm">
            Click any cell to edit mapping • Drag sections to reorder
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddCountry && (
        <AddCountryModal
          onClose={() => setShowAddCountry(false)}
          onSuccess={() => { setShowAddCountry(false); fetchData() }}
        />
      )}

      {showAddSection && (
        <AddSectionModal
          existingSections={supersetSections}
          onClose={() => setShowAddSection(false)}
          onSuccess={() => { setShowAddSection(false); fetchData() }}
        />
      )}

      {showEditSection && (
        <EditSectionModal
          section={showEditSection}
          onClose={() => setShowEditSection(null)}
          onSuccess={() => { setShowEditSection(null); fetchData() }}
        />
      )}

      {showMappingDetails && (
        <MappingDetailsModal
          countryCode={showMappingDetails.country}
          sectionKey={showMappingDetails.section}
          countries={countries}
          matrix={matrix}
          onClose={() => setShowMappingDetails(null)}
          onSuccess={() => { setShowMappingDetails(null); fetchData() }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Matrix View Component
// ============================================================================

function MatrixView({
  matrix,
  countries,
  supersetSections,
  onCellClick,
  onSectionEdit,
  onSectionSelect,
  selectedSection
}: {
  matrix: MatrixRow[]
  countries: CountryConfig[]
  supersetSections: SupersetSection[]
  onCellClick: (country: string, section: string) => void
  onSectionEdit: (section: SupersetSection) => void
  onSectionSelect: (key: string | null) => void
  selectedSection: string | null
}) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-700/50">
              <th className="sticky left-0 z-20 bg-slate-700 px-4 py-3 text-left min-w-[280px] border-r border-slate-600">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs font-normal">SUPERSET</span>
                  <span className="text-white font-semibold">Sections</span>
                </div>
              </th>
              {countries.map(country => (
                <th key={country.code} className="px-3 py-3 text-center min-w-[100px] border-r border-slate-600/50 last:border-r-0">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl">{FLAGS[country.code] || '🏳️'}</span>
                    <span className="text-white font-medium text-sm">{country.code}</span>
                    <span className="text-slate-400 text-xs truncate max-w-[90px]">{country.name}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, index) => {
              const section = supersetSections.find(s => s.sectionKey === row.sectionKey)
              const isSelected = selectedSection === row.sectionKey

              return (
                <tr 
                  key={row.sectionKey}
                  className={`border-t border-slate-700/50 ${
                    isSelected ? 'bg-slate-700/50' : 'hover:bg-slate-700/30'
                  } ${!row.isActive ? 'opacity-50' : ''}`}
                >
                  {/* Section Cell (Grey - Superset Foundation) */}
                  <td 
                    className="sticky left-0 z-10 bg-slate-800 px-4 py-3 border-r border-slate-600 cursor-pointer"
                    onClick={() => onSectionSelect(isSelected ? null : row.sectionKey)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                        row.isActive 
                          ? 'bg-slate-600 text-slate-200' 
                          : 'bg-slate-700 text-slate-500'
                      }`}>
                        {row.displayOrder}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white truncate">{row.label}</span>
                          {!row.isActive && (
                            <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">{row.sectionKey}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); section && onSectionEdit(section) }}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-600 rounded"
                      >
                        ✏️
                      </button>
                    </div>
                  </td>

                  {/* Country Mapping Cells */}
                  {countries.map(country => {
                    const cell = row.countries[country.code]
                    if (!cell) {
                      return (
                        <td key={country.code} className="px-2 py-2 text-center border-r border-slate-700/30 last:border-r-0">
                          <button
                            onClick={() => onCellClick(country.code, row.sectionKey)}
                            className="w-full h-12 bg-slate-700/50 rounded-lg border border-dashed border-slate-600 hover:border-amber-500/50 hover:bg-slate-700 transition flex items-center justify-center"
                          >
                            <span className="text-slate-500 text-lg">+</span>
                          </button>
                        </td>
                      )
                    }

                    const bgColor = !cell.enabled 
                      ? 'bg-red-500/10 border-red-500/30' 
                      : cell.hasPrompt 
                        ? 'bg-emerald-500/20 border-emerald-500/40' 
                        : cell.mapped 
                          ? 'bg-amber-500/20 border-amber-500/40' 
                          : 'bg-slate-700/50 border-slate-600'

                    return (
                      <td key={country.code} className="px-2 py-2 text-center border-r border-slate-700/30 last:border-r-0">
                        <button
                          onClick={() => onCellClick(country.code, row.sectionKey)}
                          className={`w-full h-12 rounded-lg border transition hover:scale-105 ${bgColor}`}
                        >
                          <div className="flex flex-col items-center justify-center h-full">
                            {cell.mapped ? (
                              <>
                                <div className="flex items-center gap-1">
                                  {cell.required && <span className="text-red-400 text-xs">*</span>}
                                  {cell.hasPrompt && <span className="text-emerald-400">📝</span>}
                                  {!cell.enabled && <span className="text-red-400">⊘</span>}
                                </div>
                                {cell.promptVersion && (
                                  <span className="text-xs text-emerald-400">v{cell.promptVersion}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </div>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// List View Component
// ============================================================================

function ListView({
  supersetSections,
  countries,
  matrix,
  onSectionEdit
}: {
  supersetSections: SupersetSection[]
  countries: CountryConfig[]
  matrix: MatrixRow[]
  onSectionEdit: (section: SupersetSection) => void
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Superset Sections */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/50 px-4 py-3 border-b border-slate-600">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <span className="text-xl">🧱</span>
            Superset Sections (Foundation)
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            These sections form the base for all jurisdictions
          </p>
        </div>
        <div className="divide-y divide-slate-700/50 max-h-[600px] overflow-y-auto">
          {supersetSections.map(section => (
            <div 
              key={section.id}
              className={`px-4 py-3 hover:bg-slate-700/30 ${!section.isActive ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center text-sm font-bold text-slate-200">
                    {section.displayOrder}
                  </span>
                  <div>
                    <div className="font-medium text-white">{section.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{section.sectionKey}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    section.isRequired ? 'bg-red-500/20 text-red-400' : 'bg-slate-600 text-slate-400'
                  }`}>
                    {section.isRequired ? 'Required' : 'Optional'}
                  </span>
                  <span className="text-xs px-2 py-1 bg-amber-500/20 text-amber-400 rounded">
                    {section.mappingCount} mappings
                  </span>
                  <button
                    onClick={() => onSectionEdit(section)}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-600 rounded"
                  >
                    ✏️
                  </button>
                </div>
              </div>
              {section.description && (
                <p className="text-slate-400 text-sm mt-2 pl-11">{section.description}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Countries */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/50 px-4 py-3 border-b border-slate-600">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <span className="text-xl">🌍</span>
            Configured Countries
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Countries with section mappings and prompts
          </p>
        </div>
        <div className="divide-y divide-slate-700/50 max-h-[600px] overflow-y-auto">
          {countries.map(country => (
            <div key={country.code} className="px-4 py-3 hover:bg-slate-700/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{FLAGS[country.code] || '🏳️'}</span>
                  <div>
                    <div className="font-medium text-white">{country.name}</div>
                    <div className="text-xs text-slate-500">{country.code} • v{country.version}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 bg-amber-500/20 text-amber-400 rounded">
                    {country.mappings.length} mapped
                  </span>
                  <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded">
                    {country.prompts.length} prompts
                  </span>
                </div>
              </div>
              <div className="mt-2 pl-12 flex flex-wrap gap-1">
                {country.enabledSections.map(key => (
                  <span key={key} className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">
                    {key}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Helper Components
// ============================================================================

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-700 text-slate-300',
    amber: 'bg-amber-500/20 text-amber-400',
    emerald: 'bg-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/20 text-blue-400',
    red: 'bg-red-500/20 text-red-400'
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-1 rounded text-sm font-bold ${colors[color]}`}>{value}</span>
      <span className="text-slate-400 text-sm">{label}</span>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded border ${color}`}></div>
      <span className="text-slate-300">{label}</span>
    </div>
  )
}

// ============================================================================
// Modals
// ============================================================================

function AddCountryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [continent, setContinent] = useState('Unknown')
  const [autoMap, setAutoMap] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!code || !name) {
      setError('Country code and name are required')
      return
    }

    setSaving(true)
    setError('')

    try {
      // Create country
      const createRes = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'createCountry',
          countryCode: code.toUpperCase(),
          name,
          continent
        })
      })

      if (!createRes.ok) {
        const err = await createRes.json()
        throw new Error(err.error || 'Failed to create country')
      }

      // Auto-create mappings if selected
      if (autoMap) {
        await fetch('/api/super-admin/jurisdiction-config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'bulkCreateMappings',
            countryCode: code.toUpperCase()
          })
        })
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create country')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalWrapper title="Add New Country" onClose={onClose}>
      <div className="space-y-4">
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Country Code *</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="IN, US, JP..."
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Continent</label>
            <select
              value={continent}
              onChange={(e) => setContinent(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500"
            >
              <option value="Unknown">Unknown</option>
              <option value="Asia">Asia</option>
              <option value="Europe">Europe</option>
              <option value="North America">North America</option>
              <option value="South America">South America</option>
              <option value="Africa">Africa</option>
              <option value="Oceania">Oceania</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Country Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="India, United States..."
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <label className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={autoMap}
            onChange={(e) => setAutoMap(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500"
          />
          <div>
            <div className="text-white font-medium">Auto-map all superset sections</div>
            <div className="text-slate-400 text-sm">Create mappings for all active sections automatically</div>
          </div>
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Country'}
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}

function AddSectionModal({ 
  existingSections, 
  onClose, 
  onSuccess 
}: { 
  existingSections: SupersetSection[]
  onClose: () => void
  onSuccess: () => void 
}) {
  const [sectionKey, setSectionKey] = useState('')
  const [label, setLabel] = useState('')
  const [displayOrder, setDisplayOrder] = useState(existingSections.length + 1)
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [isRequired, setIsRequired] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  
  // Context injection flags (defaults for new section)
  const [requiresPriorArt, setRequiresPriorArt] = useState(false)
  const [requiresFigures, setRequiresFigures] = useState(false)
  const [requiresClaims, setRequiresClaims] = useState(true) // Default ON for Claim 1 anchoring
  const [requiresComponents, setRequiresComponents] = useState(false)

  const handleSubmit = async () => {
    if (!sectionKey || !label || !instruction) {
      setError('Section key, label, and instruction are required')
      return
    }

    // Validate key format
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(sectionKey)) {
      setError('Section key must start with a letter and contain only letters and numbers')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'createSupersetSection',
          sectionKey,
          label,
          displayOrder,
          description: description || null,
          instruction,
          constraints: [],
          isRequired,
          // Context injection flags
          requiresPriorArt,
          requiresFigures,
          requiresClaims,
          requiresComponents
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create section')
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create section')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalWrapper title="Add Superset Section" onClose={onClose}>
      <div className="space-y-4">
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Section Key *</label>
            <input
              type="text"
              value={sectionKey}
              onChange={(e) => setSectionKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="technicalProblem"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono placeholder-slate-500 focus:border-amber-500"
            />
            <p className="text-xs text-slate-500 mt-1">camelCase, no spaces</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Display Order *</label>
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 1)}
              min={1}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Label *</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Technical Problem"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this section's purpose"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Base Instruction *</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={6}
            placeholder="**Role:** Patent Drafting Expert...&#10;&#10;**Task:** Generate the technical problem section..."
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500 font-mono text-sm"
          />
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500"
          />
          <span className="text-slate-300">Required by default for all countries</span>
        </label>

        {/* Context Injection Defaults */}
        <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔧</span>
            <h4 className="text-white font-medium text-sm">Context Injection Defaults</h4>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            What data should be injected into this section&apos;s AI prompt?
          </p>
          
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 bg-slate-800/50 rounded p-2 cursor-pointer hover:bg-slate-800/70">
              <input
                type="checkbox"
                checked={requiresPriorArt}
                onChange={(e) => setRequiresPriorArt(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 text-emerald-500"
              />
              <span className="text-slate-300 text-sm">📚 Prior Art</span>
            </label>
            <label className="flex items-center gap-2 bg-slate-800/50 rounded p-2 cursor-pointer hover:bg-slate-800/70">
              <input
                type="checkbox"
                checked={requiresFigures}
                onChange={(e) => setRequiresFigures(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 text-emerald-500"
              />
              <span className="text-slate-300 text-sm">🖼️ Figures</span>
            </label>
            <label className="flex items-center gap-2 bg-slate-800/50 rounded p-2 cursor-pointer hover:bg-slate-800/70" title="Anchor section to Claim 1 terminology (NOT full claims)">
              <input
                type="checkbox"
                checked={requiresClaims}
                onChange={(e) => setRequiresClaims(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 text-emerald-500"
                defaultChecked={true}
              />
              <span className="text-slate-300 text-sm">🔗 C1 Anchor</span>
            </label>
            <label className="flex items-center gap-2 bg-slate-800/50 rounded p-2 cursor-pointer hover:bg-slate-800/70">
              <input
                type="checkbox"
                checked={requiresComponents}
                onChange={(e) => setRequiresComponents(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 text-emerald-500"
              />
              <span className="text-slate-300 text-sm">⚙️ Components</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Section'}
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}

function EditSectionModal({
  section,
  onClose,
  onSuccess
}: {
  section: SupersetSection
  onClose: () => void
  onSuccess: () => void
}) {
  const [label, setLabel] = useState(section.label)
  const [displayOrder, setDisplayOrder] = useState(section.displayOrder)
  const [description, setDescription] = useState(section.description || '')
  const [instruction, setInstruction] = useState(section.instruction)
  const [isRequired, setIsRequired] = useState(section.isRequired)
  const [isActive, setIsActive] = useState(section.isActive)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  
  // Context injection flags (base defaults for all countries)
  const [requiresPriorArt, setRequiresPriorArt] = useState(section.requiresPriorArt ?? false)
  const [requiresFigures, setRequiresFigures] = useState(section.requiresFigures ?? false)
  const [requiresClaims, setRequiresClaims] = useState(section.requiresClaims ?? false)
  const [requiresComponents, setRequiresComponents] = useState(section.requiresComponents ?? false)

  const handleSave = async () => {
    // Check if context injection flags changed
    const contextFlagsChanged = 
      requiresPriorArt !== (section.requiresPriorArt ?? false) ||
      requiresFigures !== (section.requiresFigures ?? false) ||
      requiresClaims !== (section.requiresClaims ?? false) ||
      requiresComponents !== (section.requiresComponents ?? false)

    // Warn if global defaults changed and there are mapped countries
    if (contextFlagsChanged && section.mappingCount > 0) {
      const changedFlags: string[] = []
      if (requiresPriorArt !== (section.requiresPriorArt ?? false)) {
        changedFlags.push(`Prior Art: ${requiresPriorArt ? 'ON' : 'OFF'}`)
      }
      if (requiresFigures !== (section.requiresFigures ?? false)) {
        changedFlags.push(`Figures: ${requiresFigures ? 'ON' : 'OFF'}`)
      }
      if (requiresClaims !== (section.requiresClaims ?? false)) {
        changedFlags.push(`Claims: ${requiresClaims ? 'ON' : 'OFF'}`)
      }
      if (requiresComponents !== (section.requiresComponents ?? false)) {
        changedFlags.push(`Components: ${requiresComponents ? 'ON' : 'OFF'}`)
      }

      const confirmed = confirm(
        `⚠️ GLOBAL CHANGE WARNING\n\n` +
        `You are changing context injection defaults for "${section.label}":\n` +
        `${changedFlags.map(f => `  • ${f}`).join('\n')}\n\n` +
        `This will affect up to ${section.mappingCount} country mapping(s) that don't have overrides.\n\n` +
        `Are you sure you want to proceed?`
      )

      if (!confirmed) {
        return
      }
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'updateSupersetSection',
          id: section.id,
          label,
          displayOrder,
          description: description || null,
          instruction,
          isRequired,
          isActive,
          // Context injection flags
          requiresPriorArt,
          requiresFigures,
          requiresClaims,
          requiresComponents
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update section')
      }

      // Show warning if API returned one
      if (result.warning) {
        alert(`✓ Section updated.\n\n⚠️ ${result.warning}`)
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update section')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete superset section "${section.label}"?\n\nThis cannot be undone. All country mappings must be removed first.`)) {
      return
    }

    setDeleting(true)
    setError('')

    try {
      const response = await fetch(
        `/api/super-admin/jurisdiction-config?action=deleteSupersetSection&sectionKey=${section.sectionKey}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        }
      )

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to delete section')
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete section')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ModalWrapper title={`Edit: ${section.label}`} onClose={onClose} wide>
      <div className="space-y-4">
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="bg-slate-700/50 rounded-lg p-3">
          <div className="text-xs text-slate-400">Section Key (read-only)</div>
          <div className="text-white font-mono">{section.sectionKey}</div>
          <div className="text-xs text-slate-500 mt-1">{section.mappingCount} country mappings</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Display Order</label>
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 1)}
              min={1}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Base Instruction</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-amber-500 font-mono text-sm"
          />
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-slate-300">Required by default</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-slate-300">Active</span>
          </label>
        </div>

        {/* Context Injection Defaults - applies to ALL countries */}
        <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🔧</span>
            <h4 className="text-white font-medium">Context Injection Defaults</h4>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Select what data should be injected into this section&apos;s AI prompt by default. 
            These apply to ALL countries unless overridden at the country level.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Prior Art */}
            <label className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-3 cursor-pointer hover:bg-slate-800/70 transition">
              <input
                type="checkbox"
                checked={requiresPriorArt}
                onChange={(e) => setRequiresPriorArt(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <div className="text-slate-200 text-sm font-medium">📚 Prior Art</div>
                <div className="text-xs text-slate-500">Related patents, manual prior art</div>
              </div>
            </label>

            {/* Figures */}
            <label className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-3 cursor-pointer hover:bg-slate-800/70 transition">
              <input
                type="checkbox"
                checked={requiresFigures}
                onChange={(e) => setRequiresFigures(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <div className="text-slate-200 text-sm font-medium">🖼️ Figures</div>
                <div className="text-xs text-slate-500">Figure plans, sketches, diagrams</div>
              </div>
            </label>

            {/* Claim 1 Anchoring */}
            <label className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-3 cursor-pointer hover:bg-slate-800/70 transition" title="Align section terminology with Claim 1 (not full claims)">
              <input
                type="checkbox"
                checked={requiresClaims}
                onChange={(e) => setRequiresClaims(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500"
              />
              <div>
                <div className="text-slate-200 text-sm font-medium">🔗 Claim 1 Anchoring</div>
                <div className="text-xs text-slate-500">Align terminology with Claim 1 (for drafting sections only)</div>
              </div>
            </label>

            {/* Components */}
            <label className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-3 cursor-pointer hover:bg-slate-800/70 transition">
              <input
                type="checkbox"
                checked={requiresComponents}
                onChange={(e) => setRequiresComponents(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <div className="text-slate-200 text-sm font-medium">⚙️ Components</div>
                <div className="text-xs text-slate-500">Component list with numerals</div>
              </div>
            </label>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-600 text-xs text-slate-500">
            💡 Countries can override these defaults in their individual mappings
          </div>
        </div>

        <div className="flex justify-between pt-4 border-t border-slate-700">
          <button
            onClick={handleDelete}
            disabled={deleting || section.mappingCount > 0}
            className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            title={section.mappingCount > 0 ? 'Remove all mappings first' : 'Delete this section'}
          >
            {deleting ? 'Deleting...' : '🗑️ Delete'}
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}

function MappingDetailsModal({
  countryCode,
  sectionKey,
  countries,
  matrix,
  onClose,
  onSuccess
}: {
  countryCode: string
  sectionKey: string
  countries: Record<string, CountryConfig>
  matrix: MatrixRow[]
  onClose: () => void
  onSuccess: () => void
}) {
  const country = countries[countryCode]
  const section = matrix.find(m => m.sectionKey === sectionKey)
  const existingMapping = country?.mappings.find(m => m.sectionKey === sectionKey)
  const existingPrompt = country?.prompts.find(p => p.sectionKey === sectionKey)

  // Mapping state
  const [heading, setHeading] = useState(existingMapping?.heading || section?.label || '')
  const [isRequired, setIsRequired] = useState(existingMapping?.isRequired ?? true)
  const [isEnabled, setIsEnabled] = useState(existingMapping?.isEnabled ?? true)
  const [countryDisplayOrder, setCountryDisplayOrder] = useState<number | null>(existingMapping?.displayOrder ?? null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Context override flags state (null = use superset default, true/false = override)
  const countryCell = section?.countries[countryCode]
  const [requiresPriorArtOverride, setRequiresPriorArtOverride] = useState<boolean | null>(
    countryCell?.requiresPriorArtOverride ?? null
  )
  const [requiresFiguresOverride, setRequiresFiguresOverride] = useState<boolean | null>(
    countryCell?.requiresFiguresOverride ?? null
  )
  const [requiresClaimsOverride, setRequiresClaimsOverride] = useState<boolean | null>(
    countryCell?.requiresClaimsOverride ?? null
  )
  const [requiresComponentsOverride, setRequiresComponentsOverride] = useState<boolean | null>(
    countryCell?.requiresComponentsOverride ?? null
  )
  
  // Prompt editing state
  const [activeTab, setActiveTab] = useState<'mapping' | 'prompt'>('mapping')
  const [promptInstruction, setPromptInstruction] = useState(existingPrompt?.instruction || '')
  const [promptConstraints, setPromptConstraints] = useState<string[]>(existingPrompt?.constraints || [])
  const [promptAdditions, setPromptAdditions] = useState<string[]>(existingPrompt?.additions || [])
  const [newConstraint, setNewConstraint] = useState('')
  const [newAddition, setNewAddition] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [archivingPrompt, setArchivingPrompt] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  const isNew = !existingMapping
  const hasPromptChanges = existingPrompt 
    ? (promptInstruction !== existingPrompt.instruction ||
       JSON.stringify(promptConstraints) !== JSON.stringify(existingPrompt.constraints || []) ||
       JSON.stringify(promptAdditions) !== JSON.stringify(existingPrompt.additions || []))
    : promptInstruction.trim() !== ''

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const action = isNew ? 'createMapping' : 'updateMapping'
      const response = await fetch('/api/super-admin/jurisdiction-config', {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action,
          countryCode,
          sectionKey,
          heading,
          isRequired,
          isEnabled,
          displayOrder: countryDisplayOrder ?? section?.displayOrder,
          // Context override flags
          requiresPriorArtOverride,
          requiresFiguresOverride,
          requiresClaimsOverride,
          requiresComponentsOverride
        })
      })

      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save mapping')
      }

      // Build success message with any warnings
      let successMsg = isNew 
        ? `✓ Mapping created successfully for ${country?.name || countryCode} → ${section?.label}`
        : `✓ Mapping updated successfully for ${country?.name || countryCode} → ${section?.label}`
      
      if (result.warnings && result.warnings.length > 0) {
        successMsg += `\n⚠️ Note: ${result.warnings.join('; ')}`
      }
      
      setSuccess(successMsg)
      
      // Auto-close after showing success (longer if warnings)
      setTimeout(() => onSuccess(), result.warnings?.length ? 3000 : 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Remove mapping for ${countryCode}/${sectionKey}?\n\nThe country will no longer include this section in drafting.`)) {
      return
    }

    setDeleting(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `/api/super-admin/jurisdiction-config?action=deleteMapping&countryCode=${countryCode}&sectionKey=${sectionKey}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        }
      )

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to delete mapping')
      }

      setSuccess(`✓ Mapping removed for ${country?.name || countryCode} → ${section?.label}`)
      
      // Auto-close after showing success
      setTimeout(() => onSuccess(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mapping')
    } finally {
      setDeleting(false)
    }
  }
  
  const handleSavePrompt = async () => {
    if (!changeReason.trim() && existingPrompt) {
      alert('Please provide a change reason for the audit log')
      return
    }
    
    setSavingPrompt(true)
    setError('')
    setSuccess('')
    
    try {
      const method = existingPrompt ? 'PUT' : 'POST'
      const body = existingPrompt 
        ? {
            id: existingPrompt.id,
            instruction: promptInstruction,
            constraints: promptConstraints,
            additions: promptAdditions,
            changeReason
          }
        : {
            countryCode,
            sectionKey,
            instruction: promptInstruction,
            constraints: promptConstraints,
            additions: promptAdditions
          }
      
      const response = await fetch('/api/super-admin/section-prompts', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(body)
      })
      
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to save prompt')
      }
      
      setSuccess(existingPrompt
        ? `✓ Top-up prompt updated successfully for ${country?.name || countryCode} → ${section?.label}`
        : `✓ Top-up prompt created successfully for ${country?.name || countryCode} → ${section?.label}`)
      
      // Auto-close after showing success
      setTimeout(() => onSuccess(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleArchivePrompt = async () => {
    if (!existingPrompt) return
    
    setArchivingPrompt(true)
    setError('')
    setSuccess('')
    
    try {
      const response = await fetch(
        `/api/super-admin/section-prompts?id=${existingPrompt.id}&reason=${encodeURIComponent(archiveReason || 'Archived to allow mapping removal')}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        }
      )
      
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to archive prompt')
      }
      
      setSuccess(`✓ Prompt archived successfully. You can now remove the mapping.`)
      setShowArchiveConfirm(false)
      setArchiveReason('')
      
      // Refresh to update the UI state
      setTimeout(() => onSuccess(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive prompt')
    } finally {
      setArchivingPrompt(false)
    }
  }
  
  const addConstraint = () => {
    if (newConstraint.trim()) {
      setPromptConstraints([...promptConstraints, newConstraint.trim()])
      setNewConstraint('')
    }
  }
  
  const addAddition = () => {
    if (newAddition.trim()) {
      setPromptAdditions([...promptAdditions, newAddition.trim()])
      setNewAddition('')
    }
  }

  return (
    <ModalWrapper 
      title={`${FLAGS[countryCode] || '🏳️'} ${country?.name || countryCode} → ${section?.label || sectionKey}`} 
      onClose={onClose}
      wide={activeTab === 'prompt'}
    >
      <div className="space-y-4">
        {/* Success Message */}
        {success && (
          <div className={`rounded-lg p-3 text-sm ${
            success.includes('⚠️') 
              ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
              : 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
          }`}>
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="whitespace-pre-line">{success}</div>
            </div>
          </div>
        )}
        
        {/* Error Message */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Section Info */}
        <div className="bg-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center text-sm font-bold text-slate-200">
              {section?.displayOrder}
            </span>
            <div>
              <div className="font-medium text-white">{section?.label}</div>
              <div className="text-xs text-slate-500 font-mono">{sectionKey}</div>
            </div>
          </div>
          {section?.description && (
            <p className="text-sm text-slate-400">{section.description}</p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('mapping')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'mapping'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Mapping Config
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'prompt'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📝 Top-Up Prompt
            {existingPrompt && <span className="ml-1 text-xs bg-emerald-500/30 px-1.5 py-0.5 rounded">v{existingPrompt.version}</span>}
            {!existingPrompt && <span className="ml-1 text-xs text-slate-500">(none)</span>}
          </button>
        </div>

        {/* Mapping Tab */}
        {activeTab === 'mapping' && (
          <div className="space-y-4">
            {/* Mapping Status */}
            <div className={`rounded-lg p-3 ${isNew ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-emerald-500/10 border border-emerald-500/30'}`}>
              <span className={`text-sm ${isNew ? 'text-amber-400' : 'text-emerald-400'}`}>
                {isNew ? '⚠️ Not mapped - Create new mapping' : '✓ Mapping exists'}
              </span>
            </div>

            {/* Mapping Form */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Country-Specific Heading
              </label>
              <input
                type="text"
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                placeholder={section?.label}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                The heading used in patent documents for this country
              </p>
            </div>

            {/* Country-Specific Display Order */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Section Order (Country-Specific)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={countryDisplayOrder ?? ''}
                  onChange={(e) => setCountryDisplayOrder(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder={String(section?.displayOrder || '')}
                  min={1}
                  className="w-24 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-amber-500"
                />
                <span className="text-sm text-slate-500">
                  Default: {section?.displayOrder || 'N/A'}
                </span>
                {countryDisplayOrder && countryDisplayOrder !== section?.displayOrder && (
                  <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded">
                    ⚠️ Custom order
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Position of this section in {country?.name || countryCode} drafts. Lower = appears earlier.
              </p>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-slate-300">Enabled for drafting</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 text-red-500 focus:ring-red-500"
                />
                <span className="text-slate-300">Required section</span>
              </label>
            </div>

            {/* Context Injection Overrides */}
            <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🔧</span>
                <h4 className="text-white font-medium">Context Injection Overrides</h4>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Override what data gets injected into this section for {country?.name || countryCode}. 
                Use &quot;Default&quot; to inherit from the superset section settings.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Prior Art Override */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-300 text-sm font-medium">📚 Prior Art</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      section?.requiresPriorArt ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'
                    }`}>
                      Base: {section?.requiresPriorArt ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <select
                    value={requiresPriorArtOverride === null ? 'default' : requiresPriorArtOverride ? 'true' : 'false'}
                    onChange={(e) => {
                      const val = e.target.value
                      setRequiresPriorArtOverride(val === 'default' ? null : val === 'true')
                    }}
                    className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-amber-500"
                  >
                    <option value="default">Default (use superset)</option>
                    <option value="true">✓ Inject Prior Art</option>
                    <option value="false">✗ Don&apos;t Inject</option>
                  </select>
                </div>

                {/* Figures Override */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-300 text-sm font-medium">🖼️ Figures</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      section?.requiresFigures ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'
                    }`}>
                      Base: {section?.requiresFigures ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <select
                    value={requiresFiguresOverride === null ? 'default' : requiresFiguresOverride ? 'true' : 'false'}
                    onChange={(e) => {
                      const val = e.target.value
                      setRequiresFiguresOverride(val === 'default' ? null : val === 'true')
                    }}
                    className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-amber-500"
                  >
                    <option value="default">Default (use superset)</option>
                    <option value="true">✓ Inject Figures</option>
                    <option value="false">✗ Don&apos;t Inject</option>
                  </select>
                </div>

                {/* Claim 1 Anchoring Override */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-300 text-sm font-medium">🔗 C1 Anchor</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      section?.requiresClaims ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600 text-slate-400'
                    }`}>
                      Base: {section?.requiresClaims ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <select
                    value={requiresClaimsOverride === null ? 'default' : requiresClaimsOverride ? 'true' : 'false'}
                    onChange={(e) => {
                      const val = e.target.value
                      setRequiresClaimsOverride(val === 'default' ? null : val === 'true')
                    }}
                    className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-amber-500"
                  >
                    <option value="default">Default (use superset)</option>
                    <option value="true">✓ Use Claim 1 Anchoring</option>
                    <option value="false">✗ No Anchoring</option>
                  </select>
                </div>

                {/* Components Override */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-300 text-sm font-medium">⚙️ Components</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      section?.requiresComponents ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'
                    }`}>
                      Base: {section?.requiresComponents ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <select
                    value={requiresComponentsOverride === null ? 'default' : requiresComponentsOverride ? 'true' : 'false'}
                    onChange={(e) => {
                      const val = e.target.value
                      setRequiresComponentsOverride(val === 'default' ? null : val === 'true')
                    }}
                    className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-amber-500"
                  >
                    <option value="default">Default (use superset)</option>
                    <option value="true">✓ Inject Components</option>
                    <option value="false">✗ Don&apos;t Inject</option>
                  </select>
                </div>
              </div>

              {/* Effective values summary */}
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400 mb-2">Effective values for this country/section:</div>
                <div className="flex flex-wrap gap-2">
                  {/* Prior Art - with override indicator */}
                  {(() => {
                    const baseVal = section?.requiresPriorArt ?? false
                    const effectiveVal = requiresPriorArtOverride ?? baseVal
                    const isOverridden = requiresPriorArtOverride !== null
                    return (
                      <span className={`text-xs px-2 py-1 rounded ${
                        effectiveVal ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
                      } ${isOverridden ? 'ring-1 ring-amber-500/50' : ''}`}
                        title={isOverridden ? `Override active (base: ${baseVal ? 'ON' : 'OFF'})` : 'Using superset default'}
                      >
                        📚 Prior Art: {effectiveVal ? 'YES' : 'NO'}
                        {isOverridden && <span className="ml-1 text-amber-400">*</span>}
                      </span>
                    )
                  })()}
                  
                  {/* Figures - with override indicator */}
                  {(() => {
                    const baseVal = section?.requiresFigures ?? false
                    const effectiveVal = requiresFiguresOverride ?? baseVal
                    const isOverridden = requiresFiguresOverride !== null
                    return (
                      <span className={`text-xs px-2 py-1 rounded ${
                        effectiveVal ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
                      } ${isOverridden ? 'ring-1 ring-amber-500/50' : ''}`}
                        title={isOverridden ? `Override active (base: ${baseVal ? 'ON' : 'OFF'})` : 'Using superset default'}
                      >
                        🖼️ Figures: {effectiveVal ? 'YES' : 'NO'}
                        {isOverridden && <span className="ml-1 text-amber-400">*</span>}
                      </span>
                    )
                  })()}
                  
                  {/* Claim 1 Anchoring - with override indicator */}
                  {(() => {
                    const baseVal = section?.requiresClaims ?? false
                    const effectiveVal = requiresClaimsOverride ?? baseVal
                    const isOverridden = requiresClaimsOverride !== null
                    return (
                      <span className={`text-xs px-2 py-1 rounded ${
                        effectiveVal ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-500'
                      } ${isOverridden ? 'ring-1 ring-amber-500/50' : ''}`}
                        title={isOverridden ? `Override active (base: ${baseVal ? 'ON' : 'OFF'})` : 'Using superset default'}
                      >
                        🔗 C1: {effectiveVal ? 'YES' : 'NO'}
                        {isOverridden && <span className="ml-1 text-amber-400">*</span>}
                      </span>
                    )
                  })()}
                  
                  {/* Components - with override indicator */}
                  {(() => {
                    const baseVal = section?.requiresComponents ?? false
                    const effectiveVal = requiresComponentsOverride ?? baseVal
                    const isOverridden = requiresComponentsOverride !== null
                    return (
                      <span className={`text-xs px-2 py-1 rounded ${
                        effectiveVal ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
                      } ${isOverridden ? 'ring-1 ring-amber-500/50' : ''}`}
                        title={isOverridden ? `Override active (base: ${baseVal ? 'ON' : 'OFF'})` : 'Using superset default'}
                      >
                        ⚙️ Components: {effectiveVal ? 'YES' : 'NO'}
                        {isOverridden && <span className="ml-1 text-amber-400">*</span>}
                      </span>
                    )
                  })()}
                </div>
                
                {/* Legend for override indicators */}
                {(requiresPriorArtOverride !== null || requiresFiguresOverride !== null || 
                  requiresClaimsOverride !== null || requiresComponentsOverride !== null) && (
                  <div className="text-xs text-amber-400/70 mt-2 flex items-center gap-1">
                    <span>*</span> = override active (differs from superset default)
                  </div>
                )}
              </div>
            </div>

            {/* Warning: Cannot delete mapping with active prompt */}
            {!isNew && existingPrompt && !showArchiveConfirm && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div className="flex-1">
                    <h4 className="font-medium text-amber-400">Cannot Remove Mapping</h4>
                    <p className="text-sm text-slate-300 mt-1">
                      This mapping has an active top-up prompt (v{existingPrompt.version}). 
                      You must archive the prompt first before removing the mapping.
                    </p>
                    <button
                      onClick={() => setShowArchiveConfirm(true)}
                      className="mt-3 px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 border border-amber-500/40 text-sm font-medium"
                    >
                      📦 Archive Prompt First
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Archive Confirmation */}
            {!isNew && existingPrompt && showArchiveConfirm && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🗃️</span>
                  <div className="flex-1">
                    <h4 className="font-medium text-red-400">Archive Top-Up Prompt</h4>
                    <p className="text-sm text-slate-300 mt-1">
                      Archiving will soft-delete the prompt for {country?.name || countryCode} → {section?.label}. 
                      The section will then use only the base superset prompt.
                    </p>
                    <div className="mt-3">
                      <label className="block text-sm text-slate-400 mb-1">Reason (optional):</label>
                      <input
                        type="text"
                        value={archiveReason}
                        onChange={(e) => setArchiveReason(e.target.value)}
                        placeholder="e.g., No longer needed, outdated guidance..."
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                      />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleArchivePrompt}
                        disabled={archivingPrompt}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium disabled:opacity-50"
                      >
                        {archivingPrompt ? 'Archiving...' : '🗃️ Confirm Archive'}
                      </button>
                      <button
                        onClick={() => { setShowArchiveConfirm(false); setArchiveReason('') }}
                        className="px-4 py-2 text-slate-300 hover:text-white text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-slate-700">
              {!isNew && !existingPrompt ? (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Remove mapping"
                >
                  {deleting ? 'Removing...' : '🗑️ Remove Mapping'}
                </button>
              ) : (
                <div></div>
              )}
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : isNew ? 'Create Mapping' : 'Save Mapping'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Prompt Tab */}
        {activeTab === 'prompt' && (
          <div className="space-y-4">
            {/* Prompt Status */}
            <div className={`rounded-lg p-3 ${existingPrompt ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-700/50 border border-slate-600'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${existingPrompt ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {existingPrompt 
                    ? `✓ Top-up prompt exists (v${existingPrompt.version})` 
                    : '○ No top-up prompt - Base superset prompt will be used'}
                </span>
                {existingPrompt && (
                  <span className="text-xs text-slate-500">
                    Updated: {new Date(existingPrompt.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            
            {/* Base Prompt Reference */}
            <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600">
              <div className="text-xs text-slate-400 mb-1 flex items-center gap-2">
                <span className="bg-slate-600 px-1.5 py-0.5 rounded">L1</span>
                Base Superset Prompt (inherited)
              </div>
              <p className="text-sm text-slate-300 line-clamp-2">
                {section?.baseInstruction?.substring(0, 150)}...
              </p>
            </div>

            {/* Instruction */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1 flex items-center gap-2">
                <span className="bg-emerald-600 px-1.5 py-0.5 rounded text-xs">L2</span>
                Country Top-Up Instruction
              </label>
              <textarea
                value={promptInstruction}
                onChange={(e) => setPromptInstruction(e.target.value)}
                placeholder={`Add ${country?.name || countryCode}-specific instructions...\nE.g., "Per Indian Patents Act Section 10(4)..." or "Per USPTO 37 CFR 1.71..."`}
                rows={4}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 text-sm font-mono"
              />
              <p className="text-xs text-slate-500 mt-1">
                This instruction is MERGED with the base superset prompt during drafting
              </p>
            </div>

            {/* Constraints */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Constraints ({promptConstraints.length})
              </label>
              <div className="space-y-2 mb-2">
                {promptConstraints.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 bg-slate-700/50 rounded px-3 py-2">
                    <span className="text-slate-400 text-xs mt-0.5">{i + 1}.</span>
                    <span className="text-slate-200 text-sm flex-1">{c}</span>
                    <button
                      onClick={() => setPromptConstraints(promptConstraints.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-300 text-xs"
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
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addConstraint())}
                  placeholder="Add constraint..."
                  className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm placeholder-slate-500"
                />
                <button
                  onClick={addConstraint}
                  className="px-3 py-1.5 bg-slate-600 text-slate-200 rounded hover:bg-slate-500 text-sm"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Additions */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Additions ({promptAdditions.length})
              </label>
              <div className="space-y-2 mb-2">
                {promptAdditions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 bg-slate-700/50 rounded px-3 py-2">
                    <span className="text-emerald-400 text-xs mt-0.5">+</span>
                    <span className="text-slate-200 text-sm flex-1">{a}</span>
                    <button
                      onClick={() => setPromptAdditions(promptAdditions.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-300 text-xs"
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
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addAddition())}
                  placeholder="Add additional guidance..."
                  className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm placeholder-slate-500"
                />
                <button
                  onClick={addAddition}
                  className="px-3 py-1.5 bg-slate-600 text-slate-200 rounded hover:bg-slate-500 text-sm"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Change Reason (for existing prompts) */}
            {existingPrompt && hasPromptChanges && (
              <div>
                <label className="block text-sm font-medium text-amber-400 mb-1">
                  ⚠️ Change Reason (required for audit)
                </label>
                <input
                  type="text"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Why are you making this change?"
                  className="w-full px-3 py-2 bg-slate-700 border border-amber-500/50 rounded-lg text-white placeholder-slate-500"
                />
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-slate-700">
              <div className="flex items-center gap-4">
                {existingPrompt && (
                  <button
                    onClick={() => {
                      if (confirm(`Archive this prompt?\n\nThis will soft-delete the top-up prompt for ${country?.name || countryCode} → ${section?.label}.\n\nThe section will then use only the base superset prompt.`)) {
                        handleArchivePrompt()
                      }
                    }}
                    disabled={archivingPrompt}
                    className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm disabled:opacity-50"
                    title="Archive this prompt (soft delete)"
                  >
                    {archivingPrompt ? 'Archiving...' : '🗃️ Archive Prompt'}
                  </button>
                )}
                <span className="text-xs text-slate-500">
                  {existingPrompt 
                    ? `Created: ${new Date(existingPrompt.createdAt).toLocaleDateString()}`
                    : 'No prompt yet - create one below'}
                </span>
              </div>
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">
                  Cancel
                </button>
                <button
                  onClick={handleSavePrompt}
                  disabled={savingPrompt || (!existingPrompt && !promptInstruction.trim()) || (existingPrompt && hasPromptChanges && !changeReason.trim())}
                  className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingPrompt ? 'Saving...' : existingPrompt ? 'Update Prompt' : 'Create Prompt'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalWrapper>
  )
}

function ModalWrapper({ 
  title, 
  children, 
  onClose,
  wide = false 
}: { 
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 ${wide ? 'w-full max-w-3xl' : 'w-full max-w-xl'} max-h-[90vh] overflow-hidden`}>
        <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {children}
        </div>
      </div>
    </div>
  )
}

