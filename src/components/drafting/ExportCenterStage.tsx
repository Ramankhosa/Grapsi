'use client'

import React, { useEffect, useState } from 'react'

// Country-specific paragraph numbering format display
const NUMBERING_FORMATS: Record<string, string> = {
  JP: '【0001】',
  DEFAULT: '[0001]'
}

const getNumberingFormatLabel = (jurisdiction: string): string => {
  const code = (jurisdiction || 'US').toUpperCase()
  return NUMBERING_FORMATS[code] || NUMBERING_FORMATS.DEFAULT
}

interface ExportCenterStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function ExportCenterStage({ session, patent, onComplete, onRefresh }: ExportCenterStageProps) {
  const [issues, setIssues] = useState<string[]>([])
  const [wordLimitIssues, setWordLimitIssues] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [rich, setRich] = useState<any>(null)
  const [sections, setSections] = useState<any[] | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const availableJurisdictions = (Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0 ? session.draftingJurisdictions : ['IN']).map((c: string) => (c || '').toUpperCase())
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>(() => (session?.activeJurisdiction || availableJurisdictions[0] || 'IN'))
  // Export config loaded from country profile (database)
  const [countryExportConfig, setCountryExportConfig] = useState<{
    addParagraphNumbers?: boolean
    addPageNumbers?: boolean
    fontFamily?: string
    fontSizePt?: number
    lineSpacing?: number
    marginTopCm?: number
    marginBottomCm?: number
    marginLeftCm?: number
    marginRightCm?: number
    pageSize?: string
    source?: string
  } | null>(null)
  // User-overridable export options - null means "use country default"
  const [exportOptions, setExportOptions] = useState<{
    autoNumberParagraphs: boolean | null
  }>({
    autoNumberParagraphs: null // null = use country default
  })
  const jurisdictionKey = availableJurisdictions.join(',')

  useEffect(() => {
    const next = (session?.activeJurisdiction || availableJurisdictions[0] || 'IN').toUpperCase()
    setSelectedJurisdiction(next)
  }, [session?.activeJurisdiction, jurisdictionKey])

  const loadPreview = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ action: 'preview_export', sessionId: session?.id, jurisdiction: selectedJurisdiction })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Preview failed')
      setIssues(data.issues || [])
      setWordLimitIssues(data.wordLimitIssues || [])
    } catch (e:any) {
      setIssues([e?.message || 'Preview failed'])
      setWordLimitIssues([])
    } finally {
      setLoading(false)
    }
  }

  const loadRich = async () => {
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ action: 'get_export_preview', sessionId: session?.id, jurisdiction: selectedJurisdiction })
      })
      const data = await res.json()
      if (res.ok) {
        setRich(data)
        setSections(Array.isArray(data.sections) ? data.sections : null)
        // Load country export config from backend
        if (data.exportConfig) {
          setCountryExportConfig(data.exportConfig)
          // Reset user override to null so country default is used
          setExportOptions({ autoNumberParagraphs: null })
        }
      }
    } catch {}
  }

  useEffect(() => { loadPreview(); loadRich() }, [selectedJurisdiction])

  const handleExport = async () => {
    if (!showExportModal) {
      setShowExportModal(true)
      return
    }

    setExporting(true)

    try {
      // Build request body - only include autoNumberParagraphs if user explicitly set it
      const requestBody: any = {
        action: 'export_docx',
        sessionId: session?.id,
        jurisdiction: selectedJurisdiction
      }
      // Only send autoNumberParagraphs if user explicitly toggled it (not null)
      if (exportOptions.autoNumberParagraphs !== null) {
        requestBody.autoNumberParagraphs = exportOptions.autoNumberParagraphs
      }
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(requestBody)
      })
      if (!res.ok) {
        const data = await res.json().catch(()=>({ error: 'Export failed' }))
        alert(data?.error || 'Export failed')
        setShowExportModal(false)
        setExporting(false)
        return
      }
      const disp = res.headers.get('Content-Disposition') || ''
      const filename = /filename="?([^";]+)"?/i.test(disp) ? RegExp.$1 : `annexure_${session?.id}.docx`
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      setShowExportModal(false)
    } catch (e) {
      alert('Export failed')
      setShowExportModal(false)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-8">
      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Export Options</h3>

            <div className="space-y-4">
              {/* Jurisdiction Selector */}
              {availableJurisdictions.length > 1 && (
                <div className="flex items-center">
                  <label htmlFor="jurisdiction" className="mr-3 text-sm text-gray-900 font-medium">Jurisdiction</label>
                  <select
                    id="jurisdiction"
                    className="border rounded px-3 py-2 text-sm text-gray-900 bg-white"
                    value={selectedJurisdiction}
                    onChange={(e) => setSelectedJurisdiction(e.target.value.toUpperCase())}
                  >
                    {availableJurisdictions.map((code: string) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Paragraph Numbering */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="autoNumber"
                  checked={exportOptions.autoNumberParagraphs !== null 
                    ? exportOptions.autoNumberParagraphs 
                    : (countryExportConfig?.addParagraphNumbers ?? false)}
                  onChange={(e) => setExportOptions(prev => ({ ...prev, autoNumberParagraphs: e.target.checked }))}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="autoNumber" className="ml-2 text-sm text-gray-900">
                  Auto-number paragraphs
                  <span className="ml-1 text-gray-500 font-mono text-xs">
                    ({getNumberingFormatLabel(selectedJurisdiction)} style)
                  </span>
                  {countryExportConfig?.addParagraphNumbers && exportOptions.autoNumberParagraphs === null && (
                    <span className="ml-1 text-green-600 text-xs">(country default: ON)</span>
                  )}
                </label>
              </div>
              {(exportOptions.autoNumberParagraphs === true || 
                (exportOptions.autoNumberParagraphs === null && countryExportConfig?.addParagraphNumbers)) && (
                <p className="text-xs text-gray-500 ml-6">
                  {selectedJurisdiction === 'JP' 
                    ? 'Japan format: 【0001】, 【0002】, ...' 
                    : 'Standard format: [0001], [0002], ...'}
                </p>
              )}

              {/* Country Export Settings Info */}
              {countryExportConfig && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-2">
                  <p className="text-xs font-medium text-blue-800 mb-1">
                    {selectedJurisdiction} Export Settings {countryExportConfig.source === 'country' && '(from database)'}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-700">
                    <span>Font: {countryExportConfig.fontFamily}, {countryExportConfig.fontSizePt}pt</span>
                    <span>Line Spacing: {countryExportConfig.lineSpacing}</span>
                    <span>Page: {countryExportConfig.pageSize}</span>
                    <span>Margins: {countryExportConfig.marginTopCm}cm / {countryExportConfig.marginBottomCm}cm / {countryExportConfig.marginLeftCm}cm / {countryExportConfig.marginRightCm}cm</span>
                    <span>Page Numbers: {countryExportConfig.addPageNumbers ? 'Yes' : 'No'}</span>
                    <span>Paragraph Numbers: {countryExportConfig.addParagraphNumbers ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              )}

              {/* Word Limit Warnings */}
              {wordLimitIssues.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                  <div className="flex items-start">
                    <span className="text-amber-500 mr-2">⚠️</span>
                    <div>
                      <p className="text-sm font-medium text-amber-800">Word Limit Warnings</p>
                      <ul className="mt-1 text-xs text-amber-700 list-disc ml-4">
                        {wordLimitIssues.slice(0, 3).map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                        {wordLimitIssues.length > 3 && (
                          <li>...and {wordLimitIssues.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleExport()}
                disabled={exporting}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 flex items-center"
              >
                {exporting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Exporting...
                  </>
                ) : (
                  'Export DOCX'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Export Center</h2>
          <div className="flex items-center gap-2">
            {availableJurisdictions.length > 1 && (
              <select
                className="border rounded px-3 py-2 text-sm text-gray-900 bg-white"
                value={selectedJurisdiction}
                onChange={(e) => setSelectedJurisdiction(e.target.value.toUpperCase())}
                aria-label="Select jurisdiction to export"
              >
                {availableJurisdictions.map((code: string) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            )}
            <button onClick={loadPreview} className="px-4 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Refresh Preview</button>
            <button onClick={() => handleExport()} className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">Export Options</button>
          </div>
        </div>
        <p className="text-gray-600">
          Export your complete patent annexure in various formats.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Export Annexure</h3>
          <button 
            onClick={() => handleExport()} 
            className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Export DOCX
          </button>
        </div>
        <p className="text-sm text-gray-600">
          Export includes all sections formatted per {selectedJurisdiction} jurisdiction requirements.
          {' '}Options include paragraph numbering ({getNumberingFormatLabel(selectedJurisdiction)} format for {selectedJurisdiction === 'JP' ? 'Japan' : 'standard'}).
        </p>
        
        {/* Word Limit Status */}
        {wordLimitIssues.length > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-3">
            <div className="flex items-start">
              <span className="text-amber-500 mr-2 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-medium text-amber-800">Word/Character Limit Warnings for {selectedJurisdiction}</p>
                <ul className="mt-1 text-xs text-amber-700 space-y-1">
                  {wordLimitIssues.map((issue, idx) => (
                    <li key={idx} className="flex items-start">
                      <span className="mr-1">•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-600 italic">Consider reviewing these sections before filing.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="mt-6">
        {/* Rich preview with images only */}
        <div className="border rounded-lg bg-white">
          <div className="flex items-center justify-between p-4 border-b">
            <h4 className="font-semibold text-gray-900">Preview (rich layout with images)</h4>
            <div className="flex items-center gap-2">
              <button onClick={loadPreview} className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Run Guards</button>
              <button onClick={loadRich} className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Refresh</button>
            </div>
          </div>
          {issues.length>0 && (
            <div className="p-4 bg-yellow-50 text-yellow-800 text-sm border-b">
              <div className="font-medium mb-1">Pre-export issues:</div>
              <ul className="list-disc ml-5">
                {issues.map((i,idx)=>(<li key={idx}>{i}</li>))}
              </ul>
            </div>
          )}
          <div className="p-4 space-y-6">
            {rich ? (
              <div className="prose max-w-none">
                {/* Title - always at top */}
                <h2 className="text-xl font-bold">{String(rich.title||'').toUpperCase()}</h2>
                
                {/* Render sections in database-defined order (from API response) */}
                {sections && sections.length > 0 ? (
                  <>
                    {/* Body sections in jurisdiction-specific order (excludes title, abstract shown after figures) */}
                    {sections
                      .filter(s => s.key !== 'title' && s.key !== 'abstract')
                      .map(sec => {
                        const content = rich[sec.key]
                        // Only render sections that have content
                        if (!content || !String(content).trim()) return null
                        return (
                          <div key={sec.key}>
                            <h3 className="font-semibold text-gray-900">{String(sec.label || sec.key).toUpperCase()}</h3>
                            <p className="whitespace-pre-wrap">{content}</p>
                          </div>
                        )
                      })}

                    {/* Figures section */}
                    {(rich.figures && rich.figures.length > 0) && (
                      <>
                        <h3 className="font-semibold text-gray-900">DRAWINGS / FIGURES</h3>
                        <div className="space-y-6">
                          {rich.figures.map((f:any)=>(
                            <div key={f.figureNo} className="border rounded p-3">
                              <div className="text-sm font-medium mb-2">{`Fig. ${f.figureNo} — ${f.caption}`}</div>
                              {f.imageUrl ? (
                                <img src={`/api/patents/${patent.id}/drafting?image=figure&sessionId=${session?.id}&figureNo=${f.figureNo}`} alt={`Figure ${f.figureNo}`} className="max-w-full h-auto border" />
                              ) : (
                                <div className="text-xs text-gray-500">No image available</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Abstract - shown at end per patent document convention */}
                    {sections.find(s => s.key === 'abstract') && rich.abstract && (
                      <>
                        <h3 className="font-semibold text-gray-900">
                          {String(sections.find(s => s.key === 'abstract')?.label || 'ABSTRACT').toUpperCase()}
                        </h3>
                        <p className="whitespace-pre-wrap">{rich.abstract}</p>
                      </>
                    )}
                  </>
                ) : (
                  <div className="text-amber-600 text-sm p-3 bg-amber-50 rounded">
                    ⚠️ No section configuration found for jurisdiction {selectedJurisdiction}. 
                    Please configure sections via /super-admin/jurisdiction-config.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">No visual preview yet. Click Refresh.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-center">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Drafting Complete!</h3>
            <p className="text-gray-600 mb-4">You can export your annexure now.</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button onClick={loadPreview} className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50">
                Refresh Preview
              </button>
              <button 
                onClick={() => handleExport()} 
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Export DOCX
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
