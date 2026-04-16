'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

// ============================================================================
// Types
// ============================================================================

interface DiagramConfig {
  id: string
  countryCode: string
  requiredWhenApplicable: boolean
  supportedDiagramTypes: string[]
  figureLabelFormat: string
  autoGenerateReferenceTable: boolean
  paperSize: string
  colorAllowed: boolean
  colorUsageNote: string | null
  lineStyle: string
  referenceNumeralsMandatory: boolean
  minReferenceTextSizePt: number
  drawingMarginTopCm: number
  drawingMarginBottomCm: number
  drawingMarginLeftCm: number
  drawingMarginRightCm: number
  defaultDiagramCount: number
  maxDiagramsRecommended: number
  version: number
  hints: DiagramHint[]
}

interface DiagramHint {
  id: string
  diagramType: string
  hint: string
  preferredSyntax: string | null
  exampleCode: string | null
}

interface ExportConfig {
  id: string
  countryCode: string
  documentTypeId: string
  label: string
  pageSize: string
  marginTopCm: number
  marginBottomCm: number
  marginLeftCm: number
  marginRightCm: number
  fontFamily: string
  fontSizePt: number
  lineSpacing: number
  headingFontFamily: string | null
  headingFontSizePt: number | null
  addPageNumbers: boolean
  addParagraphNumbers: boolean
  pageNumberFormat: string
  pageNumberPosition: string
  includesSections: string[]
  version: number
  sectionHeadings: Record<string, string>
}

interface SectionValidation {
  id: string
  countryCode: string
  sectionKey: string
  maxWords: number | null
  minWords: number | null
  maxChars: number | null
  minChars: number | null
  maxCount: number | null
  maxIndependent: number | null
  wordLimitSeverity: string | null
  charLimitSeverity: string | null
  countLimitSeverity: string | null
  wordLimitMessage: string | null
  charLimitMessage: string | null
  countLimitMessage: string | null
  legalReference: string | null
  version: number
}

interface CrossValidation {
  id: string
  countryCode: string
  checkId: string
  checkType: string
  fromSection: string
  toSections: string[]
  severity: string
  message: string
  reviewPrompt: string | null
  legalBasis: string | null
  isEnabled: boolean
}

const FLAGS: Record<string, string> = {
  'IN': '🇮🇳', 'US': '🇺🇸', 'AU': '🇦🇺', 'CA': '🇨🇦', 'JP': '🇯🇵',
  'CN': '🇨🇳', 'EP': '🇪🇺', 'PCT': '🌐', 'UK': '🇬🇧', 'DE': '🇩🇪',
  'FR': '🇫🇷', 'KR': '🇰🇷', 'BR': '🇧🇷', 'CANADA': '🇨🇦'
}

const DIAGRAM_TYPES = ['block', 'flowchart', 'schematic', 'perspective_view', 'cross_section', 'graph', 'table', 'exploded_view']
const PAPER_SIZES = ['A4', 'LETTER']
const LINE_STYLES = ['black_and_white_solid', 'solid', 'dashed_allowed']
const SEVERITY_LEVELS = ['error', 'warning', 'info']

// ============================================================================
// Main Component
// ============================================================================

export default function JurisdictionStylesPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'diagrams' | 'export' | 'validation' | 'cross-validation'>('diagrams')
  
  // Data
  const [countries, setCountries] = useState<string[]>([])
  const [countryNames, setCountryNames] = useState<Record<string, string>>({})
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  
  // Diagram data
  const [diagramConfigs, setDiagramConfigs] = useState<Record<string, DiagramConfig>>({})
  const [editingDiagram, setEditingDiagram] = useState<DiagramConfig | null>(null)
  const [editingHint, setEditingHint] = useState<{ configId: string; hint: DiagramHint | null; diagramType: string } | null>(null)
  
  // Export data
  const [exportConfigs, setExportConfigs] = useState<Record<string, ExportConfig[]>>({})
  const [editingExport, setEditingExport] = useState<ExportConfig | null>(null)
  
  // Validation data
  const [validations, setValidations] = useState<Record<string, SectionValidation[]>>({})
  const [editingValidation, setEditingValidation] = useState<SectionValidation | null>(null)
  
  // Cross-validation data
  const [crossValidations, setCrossValidations] = useState<Record<string, CrossValidation[]>>({})
  const [editingCrossValidation, setEditingCrossValidation] = useState<CrossValidation | null>(null)

  // Country sections (from jurisdiction config)
  const [countrySections, setCountrySections] = useState<Record<string, { key: string; label: string }[]>>({})

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      console.log('[JurisdictionStyles UI] Fetching data...')
      
      // Fetch jurisdiction styles data
      const response = await fetch('/api/super-admin/jurisdiction-styles', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      console.log('[JurisdictionStyles UI] Response status:', response.status)
      
      // Also fetch jurisdiction config to get available sections per country
      const configResponse = await fetch('/api/super-admin/jurisdiction-config', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      
      if (response.ok) {
        const data = await response.json()
        console.log('[JurisdictionStyles UI] Received data:', {
          countries: data.countries?.length || 0,
          diagramConfigs: Object.keys(data.diagramConfigs || {}).length,
          exportConfigs: Object.keys(data.exportConfigs || {}).length,
          validations: Object.keys(data.validations || {}).length
        })
        setCountries(data.countries || [])
        setCountryNames(data.countryNames || {})
        setDiagramConfigs(data.diagramConfigs || {})
        setExportConfigs(data.exportConfigs || {})
        setValidations(data.validations || {})
        setCrossValidations(data.crossValidations || {})
        
        if (data.countries?.length > 0 && !selectedCountry) {
          setSelectedCountry(data.countries[0])
        }
      } else {
        const errorData = await response.json()
        console.error('[JurisdictionStyles UI] API error:', errorData)
        showToast('error', errorData.error || 'Failed to fetch data')
      }
      
      // Process jurisdiction config to extract sections per country
      if (configResponse.ok) {
        const configData = await configResponse.json()
        const sectionsByCountry: Record<string, { key: string; label: string }[]> = {}
        
        // Get superset sections as base
        const supersetSections = configData.supersetSections || []
        
        // For each country, get their mapped sections
        const countries = configData.countries || {}
        for (const [code, countryData] of Object.entries(countries) as [string, any][]) {
          const mappings = countryData.mappings || []
          const enabledSections = mappings
            .filter((m: any) => m.isEnabled)
            .map((m: any) => {
              const supersetSection = supersetSections.find((s: any) => s.sectionKey === m.sectionKey)
              return {
                key: m.sectionKey,
                label: m.heading || supersetSection?.label || m.sectionKey
              }
            })
          sectionsByCountry[code] = enabledSections
        }
        
        setCountrySections(sectionsByCountry)
        console.log('[JurisdictionStyles UI] Country sections loaded:', Object.keys(sectionsByCountry).length)
      }
    } catch (err) {
      console.error('[JurisdictionStyles UI] Failed to fetch:', err)
      showToast('error', 'Failed to fetch data')
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

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-cyan-500 border-t-transparent mx-auto"></div>
          <p className="mt-6 text-slate-300 font-medium">Loading jurisdiction styles...</p>
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
                <span className="text-3xl">🎨</span>
                Jurisdiction Styles
              </h1>
              <p className="text-slate-400 mt-1">
                Manage diagram, export, and validation configurations per jurisdiction
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* Country Selector */}
              <select
                value={selectedCountry || ''}
                onChange={(e) => setSelectedCountry(e.target.value || null)}
                className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-cyan-500"
              >
                <option value="">Select Country</option>
                {countries.map(code => (
                  <option key={code} value={code}>
                    {FLAGS[code] || '🏳️'} {countryNames[code] || code}
                  </option>
                ))}
              </select>
              
              <button
                onClick={fetchData}
                className="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600"
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-[1920px] mx-auto px-6">
          <div className="flex gap-1">
            {[
              { key: 'diagrams', label: '📊 Diagram Config', color: 'cyan' },
              { key: 'export', label: '📄 Export Config', color: 'emerald' },
              { key: 'validation', label: '✅ Section Limits', color: 'amber' },
              { key: 'cross-validation', label: '🔗 Cross Validation', color: 'purple' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`px-6 py-3 font-medium transition border-b-2 ${
                  activeTab === tab.key
                    ? `border-${tab.color}-500 text-${tab.color}-400 bg-slate-700/50`
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-6">
        {!selectedCountry ? (
          <div className="text-center py-20">
            <span className="text-6xl mb-4 block">🌍</span>
            <p className="text-slate-400 text-lg">Select a country to manage its style configurations</p>
          </div>
        ) : activeTab === 'diagrams' ? (
          <DiagramConfigPanel
            countryCode={selectedCountry}
            config={diagramConfigs[selectedCountry]}
            countryName={countryNames[selectedCountry] || selectedCountry}
            onEdit={setEditingDiagram}
            onEditHint={(configId, hint, type) => setEditingHint({ configId, hint, diagramType: type })}
            onRefresh={fetchData}
            showToast={showToast}
          />
        ) : activeTab === 'export' ? (
          <ExportConfigPanel
            countryCode={selectedCountry}
            configs={exportConfigs[selectedCountry] || []}
            countryName={countryNames[selectedCountry] || selectedCountry}
            onEdit={setEditingExport}
            onRefresh={fetchData}
            showToast={showToast}
          />
        ) : activeTab === 'validation' ? (
          <ValidationPanel
            countryCode={selectedCountry}
            validations={validations[selectedCountry] || []}
            countryName={countryNames[selectedCountry] || selectedCountry}
            availableSections={countrySections[selectedCountry] || []}
            onEdit={setEditingValidation}
            onRefresh={fetchData}
            showToast={showToast}
          />
        ) : (
          <CrossValidationPanel
            countryCode={selectedCountry}
            crossValidations={crossValidations[selectedCountry] || []}
            countryName={countryNames[selectedCountry] || selectedCountry}
            onEdit={setEditingCrossValidation}
            onRefresh={fetchData}
            showToast={showToast}
          />
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-6 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
        } text-white font-medium z-50`}>
          {toast.message}
        </div>
      )}

      {/* Modals */}
      {editingDiagram && (
        <DiagramConfigModal
          config={editingDiagram}
          countryCode={selectedCountry!}
          onClose={() => setEditingDiagram(null)}
          onSave={async (data) => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: 'updateDiagramConfig', ...data })
              })
              if (response.ok) {
                showToast('success', 'Diagram config updated')
                setEditingDiagram(null)
                fetchData()
              } else {
                const err = await response.json()
                showToast('error', err.error || 'Failed to update')
              }
            } catch {
              showToast('error', 'Failed to update')
            }
          }}
        />
      )}

      {editingHint && (
        <DiagramHintModal
          configId={editingHint.configId}
          hint={editingHint.hint}
          diagramType={editingHint.diagramType}
          countryCode={selectedCountry!}
          onClose={() => setEditingHint(null)}
          onSave={async (data) => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: editingHint.hint ? 'PUT' : 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: editingHint.hint ? 'updateDiagramHint' : 'createDiagramHint', ...data })
              })
              if (response.ok) {
                showToast('success', 'Diagram hint saved')
                setEditingHint(null)
                fetchData()
              } else {
                const err = await response.json()
                showToast('error', err.error || 'Failed to save')
              }
            } catch {
              showToast('error', 'Failed to save')
            }
          }}
        />
      )}

      {editingValidation && (
        <ValidationModal
          validation={editingValidation}
          countryCode={selectedCountry!}
          onClose={() => setEditingValidation(null)}
          onSave={async (data) => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: 'updateValidation', ...data })
              })
              if (response.ok) {
                showToast('success', 'Validation rules updated')
                setEditingValidation(null)
                fetchData()
              } else {
                const err = await response.json()
                showToast('error', err.error || 'Failed to update')
              }
            } catch {
              showToast('error', 'Failed to update')
            }
          }}
        />
      )}

      {editingExport && (
        <ExportConfigModal
          config={editingExport}
          countryCode={selectedCountry!}
          onClose={() => setEditingExport(null)}
          onSave={async (data) => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: 'updateExportConfig', ...data })
              })
              if (response.ok) {
                showToast('success', 'Export config updated')
                setEditingExport(null)
                fetchData()
              } else {
                const err = await response.json()
                showToast('error', err.error || 'Failed to update')
              }
            } catch {
              showToast('error', 'Failed to update')
            }
          }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Diagram Config Panel
// ============================================================================

function DiagramConfigPanel({
  countryCode,
  config,
  countryName,
  onEdit,
  onEditHint,
  onRefresh,
  showToast
}: {
  countryCode: string
  config: DiagramConfig | undefined
  countryName: string
  onEdit: (config: DiagramConfig) => void
  onEditHint: (configId: string, hint: DiagramHint | null, type: string) => void
  onRefresh: () => void
  showToast: (type: 'success' | 'error', message: string) => void
}) {
  if (!config) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
        <span className="text-5xl mb-4 block">📊</span>
        <p className="text-slate-400 mb-4">No diagram configuration for {countryName}</p>
        <button
          onClick={async () => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: 'createDiagramConfig', countryCode })
              })
              if (response.ok) {
                showToast('success', 'Diagram config created')
                onRefresh()
              }
            } catch {
              showToast('error', 'Failed to create config')
            }
          }}
          className="px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-400"
        >
          Create Diagram Config
        </button>
      </div>
    )
  }

  const hintsByType = config.hints?.reduce((acc, h) => {
    acc[h.diagramType] = h
    return acc
  }, {} as Record<string, DiagramHint>) || {}

  return (
    <div className="space-y-6">
      {/* Main Config Card */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              {FLAGS[countryCode]} {countryName} - Diagram Configuration
            </h2>
            <p className="text-slate-400 text-sm">v{config.version}</p>
          </div>
          <button
            onClick={() => onEdit(config)}
            className="px-4 py-2 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-400"
          >
            ✏️ Edit Config
          </button>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <ConfigItem label="Figure Label Format" value={config.figureLabelFormat} />
            <ConfigItem label="Paper Size" value={config.paperSize} />
            <ConfigItem label="Color Allowed" value={config.colorAllowed ? '✅ Yes' : '❌ No'} />
            <ConfigItem label="Line Style" value={config.lineStyle} />
            <ConfigItem label="Reference Numerals" value={config.referenceNumeralsMandatory ? 'Mandatory' : 'Optional'} />
            <ConfigItem label="Min Text Size" value={`${config.minReferenceTextSizePt}pt`} />
            <ConfigItem label="Default Diagram Count" value={String(config.defaultDiagramCount)} />
            <ConfigItem label="Max Recommended" value={String(config.maxDiagramsRecommended)} />
          </div>
          
          {config.colorUsageNote && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-amber-400 text-sm">
                <strong>Color Note:</strong> {config.colorUsageNote}
              </p>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-sm text-slate-400">
              <strong>Margins:</strong> Top {config.drawingMarginTopCm}cm, Bottom {config.drawingMarginBottomCm}cm, 
              Left {config.drawingMarginLeftCm}cm, Right {config.drawingMarginRightCm}cm
            </p>
            <p className="text-sm text-slate-400 mt-1">
              <strong>Supported Types:</strong> {config.supportedDiagramTypes?.join(', ') || 'None'}
            </p>
          </div>
        </div>
      </div>

      {/* Diagram Hints */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600">
          <h3 className="text-white font-semibold">📝 Diagram Type Instructions (LLM Hints)</h3>
          <p className="text-slate-400 text-sm">These instructions are injected into LLM prompts when generating each diagram type</p>
        </div>
        
        <div className="divide-y divide-slate-700">
          {DIAGRAM_TYPES.map(type => {
            const hint = hintsByType[type]
            const isSupported = config.supportedDiagramTypes?.includes(type)
            
            return (
              <div 
                key={type} 
                className={`px-6 py-4 flex items-start justify-between gap-4 ${!isSupported ? 'opacity-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white capitalize">{type.replace(/_/g, ' ')}</span>
                    {!isSupported && (
                      <span className="text-xs px-2 py-0.5 bg-slate-600 text-slate-400 rounded">Not Supported</span>
                    )}
                    {hint && (
                      <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Has Hint</span>
                    )}
                  </div>
                  {hint ? (
                    <p className="text-slate-400 text-sm mt-1 line-clamp-2">{hint.hint}</p>
                  ) : (
                    <p className="text-slate-500 text-sm mt-1 italic">No hint configured</p>
                  )}
                </div>
                <button
                  onClick={() => onEditHint(config.id, hint || null, type)}
                  className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 text-sm flex-shrink-0"
                >
                  {hint ? '✏️ Edit' : '➕ Add'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-white font-medium">{value}</div>
    </div>
  )
}

// ============================================================================
// Export Config Panel
// ============================================================================

function ExportConfigPanel({
  countryCode,
  configs,
  countryName,
  onEdit,
  onRefresh,
  showToast
}: {
  countryCode: string
  configs: ExportConfig[]
  countryName: string
  onEdit: (config: ExportConfig) => void
  onRefresh: () => void
  showToast: (type: 'success' | 'error', message: string) => void
}) {
  if (configs.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
        <span className="text-5xl mb-4 block">📄</span>
        <p className="text-slate-400 mb-4">No export configuration for {countryName}</p>
        <button
          onClick={async () => {
            try {
              const response = await fetch('/api/super-admin/jurisdiction-styles', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ action: 'createExportConfig', countryCode, documentTypeId: 'spec_pdf' })
              })
              if (response.ok) {
                showToast('success', 'Export config created')
                onRefresh()
              }
            } catch {
              showToast('error', 'Failed to create config')
            }
          }}
          className="px-6 py-3 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400"
        >
          Create Export Config
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {configs.map(config => (
        <div key={config.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600 flex justify-between items-center">
            <div>
              <h3 className="text-white font-semibold">{config.label}</h3>
              <p className="text-slate-400 text-sm">Document Type: {config.documentTypeId} • v{config.version}</p>
            </div>
            <button
              onClick={() => onEdit(config)}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400"
            >
              ✏️ Edit
            </button>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <ConfigItem label="Page Size" value={config.pageSize} />
              <ConfigItem label="Font" value={`${config.fontFamily} ${config.fontSizePt}pt`} />
              <ConfigItem label="Line Spacing" value={String(config.lineSpacing)} />
              <ConfigItem label="Page Numbers" value={config.addPageNumbers ? '✅ Yes' : '❌ No'} />
            </div>
            
            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-sm text-slate-400">
                <strong>Margins:</strong> Top {config.marginTopCm}cm, Bottom {config.marginBottomCm}cm, 
                Left {config.marginLeftCm}cm, Right {config.marginRightCm}cm
              </p>
              <p className="text-sm text-slate-400 mt-1">
                <strong>Sections:</strong> {config.includesSections?.join(', ') || 'Default'}
              </p>
            </div>

            {Object.keys(config.sectionHeadings || {}).length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700">
                <p className="text-sm text-slate-400 font-semibold mb-2">Section Headings:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(config.sectionHeadings || {}).map(([key, heading]) => (
                    <span key={key} className="text-xs px-2 py-1 bg-slate-700 text-slate-300 rounded">
                      {key}: {heading}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Validation Panel
// ============================================================================

function ValidationPanel({
  countryCode,
  validations,
  countryName,
  availableSections,
  onEdit,
  onRefresh,
  showToast
}: {
  countryCode: string
  validations: SectionValidation[]
  countryName: string
  availableSections: { key: string; label: string }[]
  onEdit: (validation: SectionValidation) => void
  onRefresh: () => void
  showToast: (type: 'success' | 'error', message: string) => void
}) {
  const [newSectionKey, setNewSectionKey] = useState('')

  // Filter out sections that already have validation rules
  const existingKeys = validations.map(v => v.sectionKey)
  const sectionsWithoutValidation = availableSections.filter(s => !existingKeys.includes(s.key))

  const handleCreate = async () => {
    if (!newSectionKey) return
    try {
      const response = await fetch('/api/super-admin/jurisdiction-styles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ action: 'createValidation', countryCode, sectionKey: newSectionKey })
      })
      if (response.ok) {
        showToast('success', 'Validation rule created')
        setNewSectionKey('')
        onRefresh()
      }
    } catch {
      showToast('error', 'Failed to create')
    }
  }

  const handleDelete = async (validationId: string, sectionKey: string) => {
    if (!confirm(`Delete validation rules for "${sectionKey}"?\n\nThis will remove all word/character limits for this section.`)) {
      return
    }
    try {
      const response = await fetch(`/api/super-admin/jurisdiction-styles?action=deleteValidation&id=${validationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (response.ok) {
        showToast('success', 'Validation rule deleted')
        onRefresh()
      } else {
        showToast('error', 'Failed to delete')
      }
    } catch {
      showToast('error', 'Failed to delete')
    }
  }

  return (
    <div className="space-y-6">
      {/* Add new validation */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center gap-4">
          <select
            value={newSectionKey}
            onChange={(e) => setNewSectionKey(e.target.value)}
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="">Select a section to add validation...</option>
            {sectionsWithoutValidation.map(section => (
              <option key={section.key} value={section.key}>
                {section.label} ({section.key})
              </option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={!newSectionKey}
            className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50"
          >
            ➕ Add Validation Rule
          </button>
        </div>
        {sectionsWithoutValidation.length === 0 && availableSections.length > 0 && (
          <p className="text-emerald-400 text-sm mt-2">✓ All sections have validation rules configured</p>
        )}
        {availableSections.length === 0 && (
          <p className="text-amber-400 text-sm mt-2">⚠️ No sections mapped for this country in Jurisdiction Config</p>
        )}
      </div>

      {/* Validation list */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600">
          <h3 className="text-white font-semibold">✅ Section Validation Rules - {countryName}</h3>
          <p className="text-slate-400 text-sm">Word limits, character limits, and claim counts per section</p>
        </div>
        
        {validations.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No validation rules configured. Add one above.
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {validations.map(v => (
              <div key={v.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-white capitalize">{v.sectionKey.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-slate-500 font-mono">{v.sectionKey}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {v.maxWords && (
                      <LimitBadge 
                        label="Max Words" 
                        value={v.maxWords} 
                        severity={v.wordLimitSeverity} 
                      />
                    )}
                    {v.maxChars && (
                      <LimitBadge 
                        label="Max Chars" 
                        value={v.maxChars} 
                        severity={v.charLimitSeverity} 
                      />
                    )}
                    {v.maxCount && (
                      <LimitBadge 
                        label="Max Count" 
                        value={v.maxCount} 
                        severity={v.countLimitSeverity} 
                      />
                    )}
                    {v.legalReference && (
                      <span className="text-xs px-2 py-1 bg-slate-700 text-slate-400 rounded">
                        📜 {v.legalReference}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(v)}
                    className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 text-sm"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDelete(v.id, v.sectionKey)}
                    className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 text-sm"
                    title="Delete validation rule"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LimitBadge({ label, value, severity }: { label: string; value: number; severity: string | null }) {
  const colors = {
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    info: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  }
  const color = colors[severity as keyof typeof colors] || colors.warning
  
  return (
    <span className={`text-xs px-2 py-1 rounded border ${color}`}>
      {label}: {value}
    </span>
  )
}

// ============================================================================
// Cross Validation Panel
// ============================================================================

function CrossValidationPanel({
  countryCode,
  crossValidations,
  countryName,
  onEdit,
  onRefresh,
  showToast
}: {
  countryCode: string
  crossValidations: CrossValidation[]
  countryName: string
  onEdit: (cv: CrossValidation) => void
  onRefresh: () => void
  showToast: (type: 'success' | 'error', message: string) => void
}) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="bg-slate-700/50 px-6 py-4 border-b border-slate-600">
        <h3 className="text-white font-semibold">🔗 Cross-Section Validation - {countryName}</h3>
        <p className="text-slate-400 text-sm">Rules for AI reviewer to check consistency between sections</p>
      </div>
      
      {crossValidations.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          No cross-validation rules configured.
        </div>
      ) : (
        <div className="divide-y divide-slate-700">
          {crossValidations.map(cv => (
            <div key={cv.id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cv.isEnabled ? 'bg-emerald-400' : 'bg-slate-600'}`}></span>
                    <span className="font-medium text-white">{cv.checkId}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      cv.severity === 'error' ? 'bg-red-500/20 text-red-400' :
                      cv.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {cv.severity}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">{cv.message}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                    <span className="px-2 py-0.5 bg-slate-700 rounded">{cv.fromSection}</span>
                    <span>→</span>
                    <span className="px-2 py-0.5 bg-slate-700 rounded">{cv.toSections?.join(', ')}</span>
                  </div>
                  {cv.reviewPrompt && (
                    <p className="text-slate-500 text-xs mt-2 italic line-clamp-1">
                      AI Prompt: {cv.reviewPrompt}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onEdit(cv)}
                  className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 text-sm flex-shrink-0"
                >
                  ✏️ Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Modals
// ============================================================================

function DiagramConfigModal({
  config,
  countryCode,
  onClose,
  onSave
}: {
  config: DiagramConfig
  countryCode: string
  onClose: () => void
  onSave: (data: any) => void
}) {
  const [form, setForm] = useState({
    figureLabelFormat: config.figureLabelFormat,
    paperSize: config.paperSize,
    colorAllowed: config.colorAllowed,
    colorUsageNote: config.colorUsageNote || '',
    lineStyle: config.lineStyle,
    referenceNumeralsMandatory: config.referenceNumeralsMandatory,
    minReferenceTextSizePt: config.minReferenceTextSizePt,
    defaultDiagramCount: config.defaultDiagramCount,
    maxDiagramsRecommended: config.maxDiagramsRecommended,
    supportedDiagramTypes: config.supportedDiagramTypes || [],
    drawingMarginTopCm: config.drawingMarginTopCm,
    drawingMarginBottomCm: config.drawingMarginBottomCm,
    drawingMarginLeftCm: config.drawingMarginLeftCm,
    drawingMarginRightCm: config.drawingMarginRightCm
  })

  const toggleDiagramType = (type: string) => {
    setForm(prev => ({
      ...prev,
      supportedDiagramTypes: prev.supportedDiagramTypes.includes(type)
        ? prev.supportedDiagramTypes.filter(t => t !== type)
        : [...prev.supportedDiagramTypes, type]
    }))
  }

  return (
    <Modal title={`Edit Diagram Config - ${countryCode}`} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Figure Label Format</label>
            <input
              type="text"
              value={form.figureLabelFormat}
              onChange={(e) => setForm({ ...form, figureLabelFormat: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Paper Size</label>
            <select
              value={form.paperSize}
              onChange={(e) => setForm({ ...form, paperSize: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            >
              {PAPER_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Line Style</label>
            <select
              value={form.lineStyle}
              onChange={(e) => setForm({ ...form, lineStyle: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            >
              {LINE_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Min Text Size (pt)</label>
            <input
              type="number"
              value={form.minReferenceTextSizePt}
              onChange={(e) => setForm({ ...form, minReferenceTextSizePt: parseInt(e.target.value) || 8 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.colorAllowed}
              onChange={(e) => setForm({ ...form, colorAllowed: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-slate-300">Color Allowed</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.referenceNumeralsMandatory}
              onChange={(e) => setForm({ ...form, referenceNumeralsMandatory: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-slate-300">Reference Numerals Mandatory</span>
          </label>
        </div>

        {form.colorAllowed && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Color Usage Note</label>
            <textarea
              value={form.colorUsageNote}
              onChange={(e) => setForm({ ...form, colorUsageNote: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Supported Diagram Types</label>
          <div className="flex flex-wrap gap-2">
            {DIAGRAM_TYPES.map(type => (
              <button
                key={type}
                onClick={() => toggleDiagramType(type)}
                className={`px-3 py-1.5 rounded text-sm ${
                  form.supportedDiagramTypes.includes(type)
                    ? 'bg-cyan-500 text-white'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {type.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Margin Top (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.drawingMarginTopCm}
              onChange={(e) => setForm({ ...form, drawingMarginTopCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Margin Bottom (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.drawingMarginBottomCm}
              onChange={(e) => setForm({ ...form, drawingMarginBottomCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Margin Left (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.drawingMarginLeftCm}
              onChange={(e) => setForm({ ...form, drawingMarginLeftCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Margin Right (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.drawingMarginRightCm}
              onChange={(e) => setForm({ ...form, drawingMarginRightCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button
            onClick={() => onSave({ id: config.id, countryCode, ...form })}
            className="px-4 py-2 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-400"
          >
            Save Changes
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DiagramHintModal({
  configId,
  hint,
  diagramType,
  countryCode,
  onClose,
  onSave
}: {
  configId: string
  hint: DiagramHint | null
  diagramType: string
  countryCode: string
  onClose: () => void
  onSave: (data: any) => void
}) {
  const [form, setForm] = useState({
    hint: hint?.hint || '',
    preferredSyntax: hint?.preferredSyntax || 'plantuml',
    exampleCode: hint?.exampleCode || ''
  })

  return (
    <Modal title={`${hint ? 'Edit' : 'Add'} ${diagramType} Hint - ${countryCode}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            LLM Instruction for {diagramType.replace(/_/g, ' ')} diagrams
          </label>
          <textarea
            value={form.hint}
            onChange={(e) => setForm({ ...form, hint: e.target.value })}
            rows={6}
            placeholder="E.g., Use rectangles for components and arrows for data flow..."
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Preferred Syntax</label>
          <select
            value={form.preferredSyntax}
            onChange={(e) => setForm({ ...form, preferredSyntax: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="plantuml">PlantUML</option>
            <option value="mermaid">Mermaid</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Example Code (optional)</label>
          <textarea
            value={form.exampleCode}
            onChange={(e) => setForm({ ...form, exampleCode: e.target.value })}
            rows={4}
            placeholder="@startuml&#10;...&#10;@enduml"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm placeholder-slate-500"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button
            onClick={() => onSave({ 
              id: hint?.id, 
              configId, 
              diagramType, 
              ...form 
            })}
            className="px-4 py-2 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-400"
          >
            {hint ? 'Update' : 'Create'} Hint
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ValidationModal({
  validation,
  countryCode,
  onClose,
  onSave
}: {
  validation: SectionValidation
  countryCode: string
  onClose: () => void
  onSave: (data: any) => void
}) {
  const [form, setForm] = useState({
    maxWords: validation.maxWords || '',
    minWords: validation.minWords || '',
    maxChars: validation.maxChars || '',
    minChars: validation.minChars || '',
    maxCount: validation.maxCount || '',
    maxIndependent: validation.maxIndependent || '',
    wordLimitSeverity: validation.wordLimitSeverity || 'warning',
    charLimitSeverity: validation.charLimitSeverity || 'warning',
    countLimitSeverity: validation.countLimitSeverity || 'warning',
    wordLimitMessage: validation.wordLimitMessage || '',
    charLimitMessage: validation.charLimitMessage || '',
    countLimitMessage: validation.countLimitMessage || '',
    legalReference: validation.legalReference || ''
  })

  return (
    <Modal title={`Edit Validation - ${validation.sectionKey} (${countryCode})`} onClose={onClose} wide>
      <div className="space-y-6">
        {/* Word Limits */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-white font-medium mb-3">📝 Word Limits</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Min Words</label>
              <input
                type="number"
                value={form.minWords}
                onChange={(e) => setForm({ ...form, minWords: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Words</label>
              <input
                type="number"
                value={form.maxWords}
                onChange={(e) => setForm({ ...form, maxWords: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Severity</label>
              <select
                value={form.wordLimitSeverity}
                onChange={(e) => setForm({ ...form, wordLimitSeverity: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-sm text-slate-400 mb-1">Validation Message</label>
            <input
              type="text"
              value={form.wordLimitMessage}
              onChange={(e) => setForm({ ...form, wordLimitMessage: e.target.value })}
              placeholder="e.g., Abstract exceeds the 150 word limit under Rule 13(7)(b)"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500"
            />
          </div>
        </div>

        {/* Character Limits */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-white font-medium mb-3">🔤 Character Limits</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Min Chars</label>
              <input
                type="number"
                value={form.minChars}
                onChange={(e) => setForm({ ...form, minChars: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Chars</label>
              <input
                type="number"
                value={form.maxChars}
                onChange={(e) => setForm({ ...form, maxChars: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Severity</label>
              <select
                value={form.charLimitSeverity}
                onChange={(e) => setForm({ ...form, charLimitSeverity: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-sm text-slate-400 mb-1">Validation Message</label>
            <input
              type="text"
              value={form.charLimitMessage}
              onChange={(e) => setForm({ ...form, charLimitMessage: e.target.value })}
              placeholder="e.g., Title exceeds 500 characters"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500"
            />
          </div>
        </div>

        {/* Count Limits (for claims) */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-white font-medium mb-3">#️⃣ Count Limits (Claims)</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Total</label>
              <input
                type="number"
                value={form.maxCount}
                onChange={(e) => setForm({ ...form, maxCount: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Independent</label>
              <input
                type="number"
                value={form.maxIndependent}
                onChange={(e) => setForm({ ...form, maxIndependent: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Severity</label>
              <select
                value={form.countLimitSeverity}
                onChange={(e) => setForm({ ...form, countLimitSeverity: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-sm text-slate-400 mb-1">Validation Message</label>
            <input
              type="text"
              value={form.countLimitMessage}
              onChange={(e) => setForm({ ...form, countLimitMessage: e.target.value })}
              placeholder="e.g., Number of claims exceeds 20"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500"
            />
          </div>
        </div>

        {/* Legal Reference */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            📜 Legal Reference
          </label>
          <input
            type="text"
            value={form.legalReference}
            onChange={(e) => setForm({ ...form, legalReference: e.target.value })}
            placeholder="e.g., Rule 13(7)(b), 37 CFR 1.72(a), Section 10(4)"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button
            onClick={() => onSave({ 
              id: validation.id, 
              countryCode,
              sectionKey: validation.sectionKey,
              maxWords: form.maxWords ? parseInt(form.maxWords as string) : null,
              minWords: form.minWords ? parseInt(form.minWords as string) : null,
              maxChars: form.maxChars ? parseInt(form.maxChars as string) : null,
              minChars: form.minChars ? parseInt(form.minChars as string) : null,
              maxCount: form.maxCount ? parseInt(form.maxCount as string) : null,
              maxIndependent: form.maxIndependent ? parseInt(form.maxIndependent as string) : null,
              wordLimitSeverity: form.wordLimitSeverity,
              charLimitSeverity: form.charLimitSeverity,
              countLimitSeverity: form.countLimitSeverity,
              wordLimitMessage: form.wordLimitMessage || null,
              charLimitMessage: form.charLimitMessage || null,
              countLimitMessage: form.countLimitMessage || null,
              legalReference: form.legalReference || null
            })}
            className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg font-medium hover:bg-amber-400"
          >
            Save Changes
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ExportConfigModal({
  config,
  countryCode,
  onClose,
  onSave
}: {
  config: ExportConfig
  countryCode: string
  onClose: () => void
  onSave: (data: any) => void
}) {
  const [form, setForm] = useState({
    label: config.label,
    pageSize: config.pageSize,
    fontFamily: config.fontFamily,
    fontSizePt: config.fontSizePt,
    lineSpacing: config.lineSpacing,
    marginTopCm: config.marginTopCm,
    marginBottomCm: config.marginBottomCm,
    marginLeftCm: config.marginLeftCm,
    marginRightCm: config.marginRightCm,
    headingFontFamily: config.headingFontFamily || '',
    headingFontSizePt: config.headingFontSizePt || 14,
    addPageNumbers: config.addPageNumbers,
    addParagraphNumbers: config.addParagraphNumbers,
    pageNumberFormat: config.pageNumberFormat || 'Page {page} of {total}',
    pageNumberPosition: config.pageNumberPosition || 'header-right'
  })

  return (
    <Modal title={`Edit Export Config - ${countryCode}`} onClose={onClose} wide>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Label</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Page Size</label>
            <select
              value={form.pageSize}
              onChange={(e) => setForm({ ...form, pageSize: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            >
              {PAPER_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Body Font Family</label>
            <input
              type="text"
              value={form.fontFamily}
              onChange={(e) => setForm({ ...form, fontFamily: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder="Times New Roman"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Body Font Size (pt)</label>
            <input
              type="number"
              value={form.fontSizePt}
              onChange={(e) => setForm({ ...form, fontSizePt: parseInt(e.target.value) || 12 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Heading Font Family</label>
            <input
              type="text"
              value={form.headingFontFamily}
              onChange={(e) => setForm({ ...form, headingFontFamily: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder="(same as body)"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Heading Font Size (pt)</label>
            <input
              type="number"
              value={form.headingFontSizePt}
              onChange={(e) => setForm({ ...form, headingFontSizePt: parseInt(e.target.value) || 14 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Line Spacing</label>
            <input
              type="number"
              step="0.1"
              value={form.lineSpacing}
              onChange={(e) => setForm({ ...form, lineSpacing: parseFloat(e.target.value) || 1.5 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Top (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.marginTopCm}
              onChange={(e) => setForm({ ...form, marginTopCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Bottom (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.marginBottomCm}
              onChange={(e) => setForm({ ...form, marginBottomCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Left (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.marginLeftCm}
              onChange={(e) => setForm({ ...form, marginLeftCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Right (cm)</label>
            <input
              type="number"
              step="0.1"
              value={form.marginRightCm}
              onChange={(e) => setForm({ ...form, marginRightCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.addPageNumbers}
              onChange={(e) => setForm({ ...form, addPageNumbers: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-slate-300">Add Page Numbers</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.addParagraphNumbers}
              onChange={(e) => setForm({ ...form, addParagraphNumbers: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-slate-300">Add Paragraph Numbers</span>
          </label>
        </div>

        {form.addPageNumbers && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-700/30 rounded-lg">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Page Number Format</label>
              <input
                type="text"
                value={form.pageNumberFormat}
                onChange={(e) => setForm({ ...form, pageNumberFormat: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                placeholder="Page {page} of {total}"
              />
              <p className="text-xs text-slate-500 mt-1">Use {'{page}'} and {'{total}'} placeholders</p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Page Number Position</label>
              <select
                value={form.pageNumberPosition}
                onChange={(e) => setForm({ ...form, pageNumberPosition: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                <option value="header-right">Header - Right</option>
                <option value="header-center">Header - Center</option>
                <option value="header-left">Header - Left</option>
                <option value="footer-right">Footer - Right</option>
                <option value="footer-center">Footer - Center</option>
                <option value="footer-left">Footer - Left</option>
              </select>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button
            onClick={() => onSave({ id: config.id, countryCode, documentTypeId: config.documentTypeId, ...form })}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400"
          >
            Save Changes
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose, wide = false }: { 
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

