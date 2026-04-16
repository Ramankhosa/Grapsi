'use client'

import { useState, useEffect } from 'react'

interface CountryWiseDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface CountryOption {
  code: string
  label: string
  description: string
  continent: string
  office: string
  applicationTypes: string[]
  languages: string[]
}

export default function CountryWiseDraftStage({ session, patent, onComplete, onRefresh }: CountryWiseDraftStageProps) {
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [languageByCode, setLanguageByCode] = useState<Record<string, string>>({})
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'single' | 'multi'>(() => {
    const existing = Array.isArray(session?.draftingJurisdictions) ? session.draftingJurisdictions.length : 0
    return existing > 1 ? 'multi' : 'single'
  })
  const relatedCount = Array.isArray(session?.relatedArtSelections) ? session.relatedArtSelections.length : 0

  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/country-names', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })

        if (!res.ok) {
          throw new Error(`Failed to load countries (${res.status})`)
        }

        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          continent: meta.continent || 'Unknown',
          office: meta.office || 'Patent Office',
          applicationTypes: meta.applicationTypes || [],
          languages: meta.languages || []
        })) : []

        // Sort by continent, then by name
        countries.sort((a, b) => {
          if (a.continent !== b.continent) {
            return a.continent.localeCompare(b.continent)
          }
          return a.label.localeCompare(b.label)
        })

        // Add a test-only superset option to draft all base sections (falls back when no profile)
        const supersetOption: CountryOption = {
          code: 'SUPERSET',
          label: 'Superset (All Sections)',
          description: 'Test mode: drafts against the full superset with default prompts (no country profile).',
          continent: 'Test',
          office: 'Test Harness',
          applicationTypes: [],
          languages: ['en']
        }

        setAvailableCountries([...countries, supersetOption])

        // Default selection - use saved selections or prefer IN (India) as default
        const preset = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
          ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
          : []
        const fallback = session?.activeJurisdiction
          ? [String(session.activeJurisdiction).toUpperCase()]
          : []
        // Default to IN (India) if no selections exist
        const defaultSelection = preset.length > 0
          ? preset
          : (fallback.length > 0 
              ? fallback 
              : (countries.find(c => c.code === 'IN')?.code 
                  ? ['IN'] 
                  : (countries[0]?.code ? [countries[0].code] : [])))

        if (defaultSelection.length > 0) {
          setSelectedCodes(defaultSelection)
          setLanguageByCode(prev => {
            const next = { ...prev }
            const saved = (session as any)?.jurisdictionDraftStatus || {}
            for (const code of defaultSelection) {
              const country = countries.find(c => c.code === code)
              const langs = country?.languages || []
              const savedLang = saved?.[code]?.language
              const chosen = (savedLang && langs.includes(savedLang)) ? savedLang : (langs[0] || '')
              if (chosen) next[code] = chosen
            }
            return next
          })
        }

      } catch (err) {
        console.error('Error fetching countries:', err)
        setError('Failed to load countries. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchCountries()
  }, [session?.draftingJurisdictions, session?.activeJurisdiction])

  const toggleCode = (code: string) => {
    setSelectedCodes(prev => {
      const exists = prev.includes(code)
      const next = exists ? prev.filter(c => c !== code) : [...prev, code]
      setLanguageByCode(prevLangs => {
        const updated = { ...prevLangs }
        if (exists) {
          delete updated[code]
        } else {
          const country = availableCountries.find(c => c.code === code)
          const langs = country?.languages || []
          updated[code] = prevLangs[code] || langs[0] || ''
        }
        return updated
      })
      return next
    })
  }

  const handleContinue = async () => {
    if (!session?.id) return
    const normalized = selectedCodes.map(c => c.toUpperCase())
    const finalSelection = mode === 'single' ? (normalized.slice(0, 1)) : normalized
    if (finalSelection.length === 0 && availableCountries[0]?.code) {
      finalSelection.push(availableCountries[0].code.toUpperCase())
    }
    const languageByJurisdiction: Record<string, string> = {}
    for (const code of finalSelection) {
      const country = availableCountries.find(c => c.code === code)
      const langs = country?.languages || []
      const chosen = languageByCode[code] && langs.includes(languageByCode[code])
        ? languageByCode[code]
        : (langs[0] || '')
      if (chosen) languageByJurisdiction[code] = chosen
    }
    
    // Determine if multi-jurisdiction mode
    const isMultiJurisdiction = mode === 'multi' && finalSelection.length > 1
    
    try {
      setSaving(true)
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'IDEA_ENTRY',
        draftingJurisdictions: finalSelection,
        activeJurisdiction: finalSelection[0],
        languageByJurisdiction,
        isMultiJurisdiction // Pass multi-jurisdiction flag
      })
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
        <span className="text-gray-600">Loading country profiles...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800 font-medium">{error}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Jurisdiction & Language</h2>
        <p className="text-gray-600">
          Choose the country/countries and preferred language before drafting so downstream prompts, figures, and exports follow the correct rules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="border rounded-lg bg-white p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Drafting mode</h3>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="radio" className="h-4 w-4" checked={mode === 'single'} onChange={() => {
                    setMode('single')
                    if (selectedCodes.length > 1) setSelectedCodes([selectedCodes[0]])
                  }} />
                  Single jurisdiction
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" className="h-4 w-4" checked={mode === 'multi'} onChange={() => setMode('multi')} />
                  Multiple jurisdictions
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                You can generate one country or iterate through several. Figures may be regenerated later if rules differ.
              </p>
            </div>

            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Available Jurisdictions ({availableCountries.length})
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Pick the country/countries now. This choice controls figures, prompts, validation, and exports.
            </p>

            {availableCountries.length === 0 ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No country profiles available</h3>
                <p className="text-gray-600">
                  Please contact your super-admin to configure jurisdiction profiles for patent drafting.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(
                  availableCountries.reduce<Record<string, CountryOption[]>>((acc, c) => {
                    const key = c.continent || 'Unknown'
                    acc[key] = acc[key] || []
                    acc[key].push(c)
                    return acc
                  }, {})
                ).sort(([a], [b]) => a.localeCompare(b)).map(([continent, list]) => (
                  <div key={continent} className="space-y-2">
                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{continent}</div>
                    <div className="space-y-3">
                      {list.map(c => (
                        <label
                          key={c.code}
                          className="flex items-start gap-3 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                            checked={selectedCodes.includes(c.code)}
                            onChange={() => {
                              if (mode === 'single') {
                                setSelectedCodes([c.code])
                              } else {
                                toggleCode(c.code)
                              }
                            }}
                            disabled={false}
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{c.label}</div>
                            <div className="text-xs text-gray-600">{c.description}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              Languages: {c.languages?.length ? c.languages.join(', ') : 'N/A'}
                            </div>
                            {Array.isArray(c.languages) && c.languages.length > 1 && (
                              <div className="mt-2">
                                <label className="text-xs text-gray-700 mr-2">Preferred language</label>
                                <select
                                  value={languageByCode[c.code] || c.languages[0]}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setLanguageByCode(prev => ({ ...prev, [c.code]: val }))
                                  }}
                                  className="text-xs border rounded px-2 py-1"
                                >
                                  {c.languages.map(lang => (
                                    <option key={lang} value={lang}>{lang}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {Array.isArray(c.languages) && c.languages.length === 1 && (
                              <div className="mt-2 text-xs text-gray-700">
                                Preferred language: {c.languages[0]}
                              </div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              {c.continent} • {c.office}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border rounded-lg bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Context from feature analysis</h3>
            <p className="text-sm text-gray-600 mb-3">
              You have {relatedCount} prior-art references associated with this drafting session.
              These will continue to inform the background and comparative sections for each selected jurisdiction.
            </p>
            <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
              <li>Prior-art selections remain unchanged when you adjust country-wise drafting settings.</li>
              <li>Downstream stages (Annexure Draft, Review & Export) can adapt prompts per jurisdiction.</li>
              <li>You can return to the Related Art stage at any time to refine the prior-art pool.</li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="border rounded-lg bg-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Next steps</h3>
            <p className="text-xs text-gray-600">
              When you continue, the workflow will move to the Annexure Draft stage. Existing behaviour is preserved;
              this step simply captures your intent to draft for multiple countries.
            </p>
            <div className="space-y-2 text-xs text-gray-600">
              <div><span className="font-medium">Patent:</span> {patent?.title || 'Untitled'}</div>
              <div><span className="font-medium">Session:</span> {session?.id || 'N/A'}</div>
              <div>
                <span className="font-medium">Selected jurisdictions:</span>{' '}
                {selectedCodes.length === 0
                  ? 'None'
                  : selectedCodes
                      .map(code => {
                        const lang = languageByCode[code]
                        return lang ? `${code} (${lang})` : code
                      })
                      .join(', ')}
              </div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              disabled={selectedCodes.length === 0 || saving}
              className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Continue to Annexure Draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
