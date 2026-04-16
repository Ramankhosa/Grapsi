'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import KishoNormalizationLoader from '@/components/ui/kisho-normalization-loader'

type CountryOption = {
  code: string
  label: string
  description: string
  continent: string
  office: string
  applicationTypes: string[]
  languages: string[]
}

const areLanguageMapsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

// Language display names
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
  ja: 'Japanese (日本語)',
  zh: 'Chinese (中文)',
  ko: 'Korean (한국어)',
  de: 'German (Deutsch)',
  fr: 'French (Français)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  ru: 'Russian (Русский)',
  ar: 'Arabic (العربية)',
  it: 'Italian (Italiano)',
  nl: 'Dutch (Nederlands)',
  sv: 'Swedish (Svenska)',
}

interface Project {
  id: string
  name: string
  applicantProfile?: {
    applicantLegalName: string
  }
}

function NewPatentDraftPageContent() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialProjectId = searchParams?.get('projectId') || ''
  const ideaId = searchParams?.get('ideaId') || ''
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>(initialProjectId)
  const [patentTitle, setPatentTitle] = useState('')
  const [rawIdea, setRawIdea] = useState('')
  
  // Load content from URL params (for idea bank integration)
  useEffect(() => {
    const urlTitle = searchParams?.get('title')
    const urlRawIdea = searchParams?.get('rawIdea')
    if (urlTitle) setPatentTitle(urlTitle)
    if (urlRawIdea) setRawIdea(urlRawIdea)
  }, [searchParams])
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [loadingCountries, setLoadingCountries] = useState<boolean>(true)
  const [allowRefine, setAllowRefine] = useState<boolean>(true)

  // ============================================================================
  // LANGUAGE CONFIGURATION STATE
  // ============================================================================
  // Language Mode:
  // - 'common': All content + figures in one language (requires common language across jurisdictions)
  // - 'individual_english_figures': Each jurisdiction in its own language, figures always English
  // Future: 'full_individual' - per-jurisdiction figures as well
  type LanguageMode = 'common' | 'individual_english_figures'
  
  const [languageMode, setLanguageMode] = useState<LanguageMode>('common')
  const [languageByJurisdiction, setLanguageByJurisdiction] = useState<Record<string, string>>({})
  const [figuresLanguage, setFiguresLanguage] = useState<string>('en') // Primary language for diagrams/sketches
  const [commonLanguage, setCommonLanguage] = useState<string>('en') // Used when mode='common'

  // Derived: currently selected project object from list
  const selectedProjectObj = projects.find(p => p.id === selectedProject)

  // ============================================================================
  // COMPUTED LANGUAGE PROPERTIES
  // ============================================================================
  
  // Selected country objects
  const selectedCountryObjects = selectedCodes.map(code => availableCountries.find(c => c.code === code)).filter(Boolean) as CountryOption[]
  
  // Get unique languages across all selected jurisdictions (union)
  const allLanguagesSet = new Set<string>()
  selectedCountryObjects.forEach(country => {
    (country.languages || []).forEach(lang => allLanguagesSet.add(lang))
  })
  const allLanguages = Array.from(allLanguagesSet)

  // Get common languages (intersection - supported by ALL selected jurisdictions)
  const commonLanguages = selectedCountryObjects.length > 0
    ? allLanguages.filter(lang => selectedCountryObjects.every(c => (c.languages || []).includes(lang)))
    : []

  // Check if all jurisdictions support English
  const allSupportEnglish = selectedCountryObjects.every(c => (c.languages || []).includes('en'))
  
  // Check if there are non-English languages available
  const hasNonEnglishLanguages = allLanguages.some(lang => lang !== 'en')
  
  // Check if common language mode is available (at least one shared language)
  const canUseCommonMode = commonLanguages.length > 0 || selectedCodes.length <= 1
  
  // Determine if we're in a multi-jurisdiction scenario
  const isMultiJurisdiction = selectedCodes.length > 1

  // ============================================================================
  // LANGUAGE CONFIGURATION EFFECT
  // ============================================================================
  
  // Helper: Get safe language array with fallback to English
  const getSafeLanguages = (country: CountryOption | undefined): string[] => {
    const langs = country?.languages || []
    // If no languages defined (data error), fallback to English
    return langs.length > 0 ? langs : ['en']
  }

  // Effect 1: Initialize/update language defaults when jurisdictions change
  useEffect(() => {
    if (selectedCodes.length === 0) return

    // Update per-jurisdiction language defaults
    setLanguageByJurisdiction(prev => {
      const next: Record<string, string> = {}
      selectedCodes.forEach(code => {
        const country = availableCountries.find(c => c.code === code)
        const langs = getSafeLanguages(country)
        // Default to English if available, otherwise first language
        const defaultLang = langs.includes('en') ? 'en' : langs[0]
        // Preserve existing selection if valid, otherwise use default
        const existingLang = prev[code]
        next[code] = (existingLang && langs.includes(existingLang)) ? existingLang : defaultLang
      })
      return areLanguageMapsEqual(prev, next) ? prev : next
    })

    // Single jurisdiction: ALWAYS force common mode (no choice)
    if (selectedCodes.length === 1) {
      const country = availableCountries.find(c => c.code === selectedCodes[0])
      const langs = getSafeLanguages(country)
      const defaultLang = langs.includes('en') ? 'en' : langs[0]
      setLanguageMode('common')
      setCommonLanguage(defaultLang)
      setFiguresLanguage(defaultLang)
      return
    }

    // Multi-jurisdiction: smart defaults based on shared languages
    const countriesSelected = selectedCodes.map(code => availableCountries.find(c => c.code === code)).filter(Boolean) as CountryOption[]
    const sharedLanguages = allLanguages.filter(lang => countriesSelected.every(c => getSafeLanguages(c).includes(lang)))
    
    if (sharedLanguages.length > 0) {
      // There's at least one common language - default to common mode with English (if available)
      const preferredCommon = sharedLanguages.includes('en') ? 'en' : sharedLanguages[0]
      // Only set defaults if not already configured (avoid overwriting user choices)
      if (!commonLanguages.includes(commonLanguage)) {
        setLanguageMode('common')
        setCommonLanguage(preferredCommon)
        setFiguresLanguage(preferredCommon)
      }
    } else {
      // No common language - MUST use individual mode with English figures
      setLanguageMode('individual_english_figures')
      setFiguresLanguage('en') // Figures always English when no common language
    }
  }, [selectedCodes, availableCountries, allLanguages, commonLanguage, commonLanguages])

  // Effect 2: Sync figures language when mode or common language changes
  useEffect(() => {
    if (languageMode === 'common') {
      setFiguresLanguage(commonLanguage || 'en')
    } else {
      // Individual mode: figures always in English
      setFiguresLanguage('en')
    }
  }, [languageMode, commonLanguage])

  // Effect 3: Sync per-jurisdiction languages when mode changes to common
  // This ensures all jurisdictions use the common language in common mode
  useEffect(() => {
    if (languageMode === 'common' && selectedCodes.length > 0 && commonLanguage) {
      setLanguageByJurisdiction(prev => {
        const synced: Record<string, string> = {}
        selectedCodes.forEach(code => {
          const country = availableCountries.find(c => c.code === code)
          const langs = getSafeLanguages(country)
          // In common mode, set all to common language if supported, else keep existing
          synced[code] = langs.includes(commonLanguage) ? commonLanguage : prev[code] || langs[0]
        })
        return areLanguageMapsEqual(prev, synced) ? prev : synced
      })
    }
  }, [languageMode, commonLanguage, selectedCodes, availableCountries])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      const fetchProjects = async () => {
        try {
          const response = await fetch('/api/projects', {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })

          if (response.ok) {
            const data = await response.json()
            const list: Project[] = data.projects || []
            setProjects(list)

            // If coming from dashboard, find and select the "Default Project"
            if (!initialProjectId && list.length > 0) {
              const defaultProject = list.find(p => p.name === 'Default Project');
              if (defaultProject) {
                setSelectedProject(defaultProject.id);
              } else {
                // Fallback to the first project if "Default Project" is not found
                setSelectedProject(list[0].id);
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch projects:', error)
        } finally {
          setIsLoading(false)
        }
      }
      fetchProjects()
    }
  }, [authLoading, user, router, initialProjectId])

  // Preselect project if provided via query param
  useEffect(() => {
    if (initialProjectId) {
      setSelectedProject(initialProjectId)
    }
  }, [initialProjectId])

  // Load country profiles for jurisdiction selection
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setLoadingCountries(true)
        const res = await fetch('/api/country-profiles', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
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
        countries.sort((a, b) => {
          if (a.continent !== b.continent) return a.continent.localeCompare(b.continent)
          return a.label.localeCompare(b.label)
        })
        setAvailableCountries(countries)
        if (countries.length > 0) {
          const defaultSel = countries.find(c => c.code === 'US')?.code || countries.find(c => c.code === 'PCT')?.code || countries[0].code
          setSelectedCodes([defaultSel])
        }
      } catch (e) {
        console.error('Failed to load country profiles:', e)
        setError('Failed to load country profiles. Please try again.')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [])


  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['text/plain']
    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.txt')) {
      setError('Please upload a plain text (.txt) file. Word documents (.docx) are not supported yet.')
      return
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string

        if (!content) {
          setError('File appears to be empty')
          return
        }

        // Clean the content to remove BOM and normalize line endings
        const cleanContent = content
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/\r\n/g, '\n') // Normalize Windows line endings
          .replace(/\r/g, '\n')   // Normalize Mac line endings
          .trim() // Remove leading/trailing whitespace

        if (cleanContent.length === 0) {
          setError('File appears to be empty or contains no readable text')
          return
        }

    if (cleanContent.length > 5000) {
      setError('File content exceeds 5,000 characters. Please reduce the file size or split into smaller sections.')
      return
    }

        // Basic validation - check if content looks like text
        const nonPrintableChars = (cleanContent.match(/[^\x20-\x7E\n\t]/g) || []).length
        const nonPrintableRatio = nonPrintableChars / cleanContent.length

        if (nonPrintableRatio > 0.1 && cleanContent.length > 100) {
          setError('File appears to contain binary data or is not a plain text file. Please use a .txt file.')
          return
        }

        setRawIdea(cleanContent)
        setError(null)

      } catch (error) {
        console.error('File processing error:', error)
        setError('Failed to process file. Please check the file format and try again.')
      }
    }

    reader.onerror = () => {
      setError('Failed to read file. Please check the file format and try again.')
    }

    reader.onabort = () => {
      setError('File reading was aborted. Please try again.')
    }

    // Read as text with UTF-8 encoding
    reader.readAsText(file, 'UTF-8')
  }

  const handleCreateDraft = async () => {
    if (!selectedProject) {
      setError('Please select a project')
      return
    }

    if (!patentTitle.trim()) {
      setError('Please enter a patent title')
      return
    }

    if (!rawIdea.trim()) {
      setError('Please provide an invention description or upload a file')
      return
    }

    if (rawIdea.length > 5000) {
      setError('Description exceeds 5,000 character limit. Please shorten your text.')
      return
    }

    // Validate title length
    const titleWords = patentTitle.trim().split(/\s+/).length
    if (titleWords > 15) {
      setError('Title must be 15 words or less')
      return
    }

    const normalizedCodes = selectedCodes.map(c => c.toUpperCase())
    const finalSelection = mode === 'single' ? normalizedCodes.slice(0, 1) : normalizedCodes
    if (finalSelection.length === 0) {
      setError('Please select at least one jurisdiction')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      // First create a basic patent record
      const patentResponse = await fetch(`/api/projects/${selectedProject}/patents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          title: patentTitle.trim(),
          description: 'Created for patent drafting workflow'
        })
      })

      if (!patentResponse.ok) {
        const errorData = await patentResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create patent')
      }

      const patentData = await patentResponse.json()
      const patentId = patentData.patent.id

      // Start drafting session and normalize idea
      const draftingResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'start_session'
        })
      })

      if (!draftingResponse.ok) {
        const errorData = await draftingResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to start drafting session')
      }

      const draftSessionData = await draftingResponse.json()
      const sessionId = draftSessionData.session.id

      // Persist jurisdiction choice and language preferences
      const setStageResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'set_stage',
          sessionId,
          // Keep the session in the initial stage while persisting jurisdiction choice
          stage: 'IDEA_ENTRY',
          draftingJurisdictions: finalSelection,
          activeJurisdiction: finalSelection[0],
          // Language configuration
          languageMode: languageMode,
          languageByJurisdiction: languageByJurisdiction,
          figuresLanguage: figuresLanguage,
          commonLanguage: languageMode === 'common' ? commonLanguage : null
        })
      })

      if (!setStageResponse.ok) {
        const errorData = await setStageResponse.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to persist jurisdiction selection')
      }

      // Normalize the idea
        const normalizeResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'normalize_idea',
            sessionId,
            rawIdea: rawIdea.trim(),
            title: patentTitle.trim(),
            allowRefine
          })
        })

      if (!normalizeResponse.ok) {
        // Parse the actual error from the API response
        const errorData = await normalizeResponse.json().catch(() => ({}))
        const errorMessage = errorData.error || 'Failed to normalize idea'
        throw new Error(errorMessage)
      }

      // Redirect to the drafting page (already on component planner stage)
      router.push(`/patents/${patentId}/draft`)

    } catch (error) {
      console.error('Failed to create patent draft:', error)
      setError(error instanceof Error ? error.message : 'Failed to start patent draft. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Start Patent Drafting</h1>
            <p className="text-lg text-gray-600">
              Enter your invention details and let AI create a complete patent draft
            </p>
          </div>
        </div>

        {/* Main Form */}
        <div className="bg-white rounded-lg shadow-sm p-8">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Idea Bank Banner */}
          {ideaId && (
            <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-indigo-500" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm text-indigo-800">
                    <span className="font-semibold">Loaded from Idea Bank</span> — The title and description have been pre-filled from your reserved idea. You can edit them before starting the draft.
                  </p>
                </div>
                <Link
                  href="/idea-bank"
                  className="ml-4 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                >
                  Back to Idea Bank →
                </Link>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* Jurisdiction Selection */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Jurisdiction & Mode</div>
                  <p className="text-xs text-gray-600">Choose single or multiple jurisdictions; this controls downstream prompts, figures, and rules.</p>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-700">
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'single'} onChange={() => {
                      setMode('single')
                      if (selectedCodes.length > 1) setSelectedCodes([selectedCodes[0]])
                    }} />
                    Single
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'multi'} onChange={() => setMode('multi')} />
                    Multiple
                  </label>
                </div>
              </div>
              {loadingCountries ? (
                <div className="text-sm text-gray-500">Loading jurisdictions...</div>
              ) : availableCountries.length === 0 ? (
                <div className="text-sm text-red-600">No country profiles available. Please ask an admin to add them.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 max-h-56 overflow-auto">
                  {availableCountries.map(c => (
                    <label key={c.code} className="flex items-start gap-2 p-2 border border-gray-200 rounded hover:bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        checked={selectedCodes.includes(c.code)}
                        onChange={() => {
                          if (mode === 'single') {
                            setSelectedCodes([c.code])
                          } else {
                            setSelectedCodes(prev => prev.includes(c.code) ? prev.filter(x => x !== c.code) : [...prev, c.code])
                          }
                        }}
                        disabled={false}
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{c.label}</div>
                        <div className="text-xs text-gray-600">{c.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Your chosen active jurisdiction will drive figures and validation; you can generate other jurisdictions later.
              </p>

              {/* ================================================================
                   LANGUAGE CONFIGURATION SECTION
                   ================================================================ */}
              {selectedCodes.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Language Configuration</div>
                      <p className="text-xs text-gray-600">Configure drafting language for content and figures</p>
                    </div>
                    {!canUseCommonMode && isMultiJurisdiction && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        No Common Language
                      </span>
                    )}
                  </div>

                  {/* ============ SINGLE JURISDICTION ============ */}
                  {!isMultiJurisdiction && (
                    <div className="space-y-3">
                      {(() => {
                        const country = availableCountries.find(c => c.code === selectedCodes[0])
                        const langs = country?.languages || []
                        return (
                          <div>
                            <label className="text-xs text-gray-600 block mb-1">
                              Drafting language for {country?.label || selectedCodes[0]}:
                            </label>
                            <select
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              value={commonLanguage}
                              onChange={(e) => {
                                setCommonLanguage(e.target.value)
                                setLanguageByJurisdiction(prev => ({ ...prev, [selectedCodes[0]]: e.target.value }))
                              }}
                            >
                              {langs.map(lang => (
                                <option key={lang} value={lang}>
                                  {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                              Both content and figures will be generated in {LANGUAGE_LABELS[commonLanguage] || commonLanguage}.
                            </p>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* ============ MULTI-JURISDICTION ============ */}
                  {isMultiJurisdiction && (
                    <div className="space-y-4">
                      {/* Language Mode Selection */}
                      <div className="bg-gray-100 rounded-lg p-3">
                        <div className="text-xs font-medium text-gray-700 mb-2">Language Mode</div>
                        <div className="space-y-2">
                          {/* Common Language Mode */}
                          <label className={`flex items-start gap-3 p-2 rounded border cursor-pointer transition-colors ${
                            languageMode === 'common' 
                              ? 'bg-indigo-50 border-indigo-300' 
                              : canUseCommonMode ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                          }`}>
                            <input
                              type="radio"
                              className="mt-1 h-4 w-4 text-indigo-600"
                              checked={languageMode === 'common'}
                              onChange={() => setLanguageMode('common')}
                              disabled={!canUseCommonMode}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Common Language</div>
                              <div className="text-xs text-gray-600">
                                All content and figures in one shared language
                                {!canUseCommonMode && <span className="text-amber-600 ml-1">(No common language available)</span>}
                              </div>
                              {commonLanguages.length > 0 && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Available: {commonLanguages.map(l => LANGUAGE_LABELS[l] || l).join(', ')}
                                </div>
                              )}
                            </div>
                          </label>

                          {/* Individual Languages Mode */}
                          <label className={`flex items-start gap-3 p-2 rounded border cursor-pointer transition-colors ${
                            languageMode === 'individual_english_figures' 
                              ? 'bg-indigo-50 border-indigo-300' 
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}>
                            <input
                              type="radio"
                              className="mt-1 h-4 w-4 text-indigo-600"
                              checked={languageMode === 'individual_english_figures'}
                              onChange={() => setLanguageMode('individual_english_figures')}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">Individual Languages (English Figures)</div>
                              <div className="text-xs text-gray-600">
                                Each jurisdiction in its own language; figures/sketches always in English
                              </div>
                              <div className="text-xs text-indigo-600 mt-1">
                                ✓ Recommended for international filings with diverse language requirements
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Common Language Selector */}
                      {languageMode === 'common' && canUseCommonMode && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <label className="text-xs font-medium text-green-800 block mb-2">
                            Select common language:
                          </label>
                          <select
                            className="w-full border border-green-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                            value={commonLanguage}
                            onChange={(e) => setCommonLanguage(e.target.value)}
                          >
                            {commonLanguages.map(lang => (
                              <option key={lang} value={lang}>
                                {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-green-700 mt-2">
                            <span className="font-medium">✓</span> All content and figures will be generated in {LANGUAGE_LABELS[commonLanguage] || commonLanguage}.
                          </p>
                        </div>
                      )}

                      {/* Individual Language Configuration */}
                      {languageMode === 'individual_english_figures' && (
                        <div className="space-y-3">
                          {/* Figures Language Notice */}
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <div className="text-sm text-blue-800">
                                <p className="font-medium">Figures & Sketches: English Only</p>
                                <p className="text-xs mt-1">
                                  All diagrams, flowcharts, and technical sketches will be generated in English for universal compatibility across jurisdictions.
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Per-Jurisdiction Content Language */}
                          <div className="border border-gray-200 rounded-lg p-3 bg-white">
                            <label className="text-xs font-medium text-gray-700 block mb-2">
                              Content language per jurisdiction:
                            </label>
                            <div className="space-y-2">
                              {selectedCodes.map(code => {
                                const country = availableCountries.find(c => c.code === code)
                                // Safe languages with fallback to English if none defined
                                const rawLangs = country?.languages || []
                                const langs = rawLangs.length > 0 ? rawLangs : ['en']
                                const hasNoDefinedLanguages = rawLangs.length === 0
                                return (
                                  <div key={code} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                                    <span className="text-sm font-medium text-gray-800 w-20 flex-shrink-0">{code}</span>
                                    <select
                                      className={`flex-1 border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${hasNoDefinedLanguages ? 'border-amber-300 bg-amber-50' : 'border-gray-300'}`}
                                      value={languageByJurisdiction[code] || langs[0] || 'en'}
                                      onChange={(e) => setLanguageByJurisdiction(prev => ({ ...prev, [code]: e.target.value }))}
                                    >
                                      {langs.map(lang => (
                                        <option key={lang} value={lang}>
                                          {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                                        </option>
                                      ))}
                                    </select>
                                    <span className={`text-xs w-28 flex-shrink-0 ${hasNoDefinedLanguages ? 'text-amber-600' : 'text-gray-500'}`}>
                                      {hasNoDefinedLanguages ? '⚠️ Default' : `${rawLangs.length} lang${rawLangs.length !== 1 ? 's' : ''}`}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs">
                        <div className="font-medium text-gray-700 mb-1">Configuration Summary</div>
                        <div className="text-gray-600 space-y-1">
                          <div>• <span className="font-medium">Mode:</span> {languageMode === 'common' ? 'Common Language' : 'Individual Languages'}</div>
                          <div>• <span className="font-medium">Figures/Sketches:</span> {LANGUAGE_LABELS[figuresLanguage] || figuresLanguage}</div>
                          {languageMode === 'individual_english_figures' && (
                            <div>• <span className="font-medium">Content:</span> Per-jurisdiction (see above)</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Project Display / Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Project
              </label>
              {initialProjectId ? (
                <>
                  <div className="flex items-center space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{selectedProjectObj?.name || 'Project'}</div>
                      <div className="text-xs text-gray-500">Linked from project context</div>
                    </div>
                    <Badge variant="secondary" className="text-xs">Locked</Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    This draft will be saved to {selectedProjectObj?.name || 'the selected project'}.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    Choose a project to store this draft. Select “Default Project” for quick drafts.
                  </p>
                </div>
              )}
            </div>

            {/* Patent Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Patent Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={patentTitle}
                onChange={(e) => setPatentTitle(e.target.value)}
                placeholder="Enter a descriptive title for your patent"
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                {patentTitle.trim().split(/\s+/).length} words (max 15) • This will be the title of your patent application
              </p>
            </div>
            {/* Invention Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Invention Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={rawIdea}
                onChange={(e) => setRawIdea(e.target.value)}
                rows={8}
                placeholder="Describe your invention in detail. Include the problem it solves, how it works, key components, advantages, and any specific embodiments..."
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-vertical"
                required
              />
              <p className={`mt-1 text-sm ${rawIdea.length > 5000 ? 'text-red-600' : rawIdea.length > 4500 ? 'text-orange-600' : 'text-gray-500'}`}>
                {rawIdea.length} characters (max 5,000)
                {rawIdea.length > 4500 && rawIdea.length <= 5000 && ' - Approaching limit'}
                {rawIdea.length > 5000 && ' - Exceeds limit!'}
              </p>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or upload a text file
              </label>
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <p className="mt-1 text-sm text-gray-500">
                Supported format: .txt files only (max 5MB, 5,000 characters)
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Note: Word documents (.docx) and PDFs are not supported yet. To convert:
              </p>
              <ul className="mt-1 text-xs text-gray-400 list-disc list-inside">
                <li>In Word: File &rarr; Save As &rarr; Plain Text (.txt)</li>
                <li>In Google Docs: File &rarr; Download &rarr; Plain text (.txt)</li>
              </ul>
              <p className="mt-1 text-xs text-blue-600">
                Tip: Uploading a file replaces any text you&apos;ve entered above
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
                <span className="font-medium text-gray-900">Idea handling:</span>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    className="h-4 w-4"
                    checked={allowRefine === true}
                    onChange={() => setAllowRefine(true)}
                  />
                  Let Kisho improve/structure my idea
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    className="h-4 w-4"
                    checked={allowRefine === false}
                    onChange={() => setAllowRefine(false)}
                  />
                  Keep exactly what I provided
                </label>
              </div>

              {isCreating && (
                <KishoNormalizationLoader mode={allowRefine ? 'enhance' : 'preserve'} className="mb-0" />
              )}

              <div className="flex justify-end space-x-4">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </Link>
                <button
                  onClick={handleCreateDraft}
                  disabled={isCreating || !selectedProject || !patentTitle.trim()}
                  className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-3"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Initiate Patent Drafting
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Projects List */}
        {projects.length === 0 && (
          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">
              You need to create a project first before starting patent drafting.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Create Project
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function NewPatentDraftPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    }>
      <NewPatentDraftPageContent />
    </Suspense>
  )
}
