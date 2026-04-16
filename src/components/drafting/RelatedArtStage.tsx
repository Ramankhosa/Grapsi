'use client'

import React, { useEffect, useMemo, useState, Fragment, useRef, memo } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/20/solid'

interface RelatedArtStageProps {
  session: {
    id: string
    relatedArtRuns?: Array<{
      id: string
      resultsJson: any[]
      ranAt: string
    }>
    relatedArtSelections?: Array<{
      patentNumber: string
      title?: string
      snippet?: string
      score?: number
      tags?: string[]
      publicationDate?: string
      cpcCodes?: string[]
      ipcCodes?: string[]
      inventors?: string[]
      assignees?: string[]
      runId?: string // Added runId to selection
    }>
    ideaRecord?: any
    manualPriorArt?: {
      manualPriorArtText: string
      useOnlyManualPriorArt: boolean
      useManualAndAISearch: boolean
    }
    aiAnalysisData?: Record<string, any>
  }
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ResultItem = {
  title: string
  pn: string
  snippet?: string
  publication_date?: string
  score?: number
  inventors?: string[] | string
  assignees?: string[] | string
}

const RelatedArtStage = React.memo(function RelatedArtStage({ session, patent, onComplete, onRefresh }: RelatedArtStageProps) {
  // DEBUG: Check if component is being remounted
  console.log('🔄 RelatedArtStage component instance created/rendered')

  const idea = session?.ideaRecord || {}
  const searchQuery = idea?.searchQuery || ''
  const abstract = idea?.abstract || ''
  const cpcCodes: string[] = Array.isArray(idea?.cpcCodes) ? idea.cpcCodes : []
  const ipcCodes: string[] = Array.isArray(idea?.ipcCodes) ? idea.ipcCodes : []

  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, { aiSummary?: string; noveltyThreat?: string; relevantParts?: string[]; irrelevantParts?: string[]; noveltyComparison?: string }>>({})
  const [hasLoadedSelections, setHasLoadedSelections] = useState(false)
  const [limit, setLimit] = useState(25)
  const [afterDate, setAfterDate] = useState('')
  const [customQuery, setCustomQuery] = useState('')
  const [showCustomQuery, setShowCustomQuery] = useState(false)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  // AI review states
  const [reviewing, setReviewing] = useState(false)
  const [reviewInfo, setReviewInfo] = useState<string>('')
  const [ideaBankOpen, setIdeaBankOpen] = useState(false)
  const [ideaBank, setIdeaBank] = useState<Array<{ title: string; core_principle: string; expected_advantage: string; tags: string[]; non_obvious_extension: string }>>([])
  const [hasRestoredFromStorage, setHasRestoredFromStorage] = useState(false)
  const [ideaBankVersion, setIdeaBankVersion] = useState(0) // Force re-renders

  // ============= MAIN WORKFLOW NAVIGATION =============
  // Primary tab navigation: search → analyze → select
  const [mainTab, setMainTab] = useState<'search' | 'analyze' | 'select'>('search')

  // ============= TAB-BASED WORKFLOW STATES =============
  // Active tab: 'prior-art' = for drafting references, 'claim-refinement' = for claim comparison
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<'prior-art' | 'claim-refinement'>('prior-art')

  // WORKFLOW A: Prior Art for Patent Drafting
  // These patents/text will be cited in the patent draft (background, etc.)
  const [priorArtMode, setPriorArtMode] = useState<'ai' | 'manual' | 'hybrid'>('ai')
  const [priorArtSelected, setPriorArtSelected] = useState<Record<string, any>>({})
  const [priorArtManualText, setPriorArtManualText] = useState('')

  // WORKFLOW B: Patents for Claim Refinement
  // These patents will be compared against claims to ensure novelty
  const [claimRefMode, setClaimRefMode] = useState<'ai' | 'manual' | 'hybrid'>('ai')
  const [claimRefSelected, setClaimRefSelected] = useState<Record<string, any>>({})
  const [claimRefManualText, setClaimRefManualText] = useState('')

  // Skip Claim Refinement option - user confident in their claims
  const [skipClaimRefinement, setSkipClaimRefinement] = useState(false)

  // Quick View panel states
  const [showAbstractPanel, setShowAbstractPanel] = useState(false)
  const [showAIAnalysisPanel, setShowAIAnalysisPanel] = useState(false)
  const [showRawResultsPanel, setShowRawResultsPanel] = useState(false)

  // Track which patents have expanded details (on-demand loading)
  const [expandedPatentDetails, setExpandedPatentDetails] = useState<Set<string>>(new Set())

  // Track which sections within expanded patents are visible
  const [expandedSections, setExpandedSections] = useState<{
    [patentKey: string]: {
      metadata: boolean
      abstract: boolean
      aiSummary: boolean
      relevantParts: boolean
      irrelevantParts: boolean
      noveltyComparison: boolean
    }
  }>({})

  // Legacy state for backward compatibility
  const [selected, setSelected] = useState<Record<string, { title?: string; snippet?: string; score?: number; tags?: string[]; publication_date?: string; inventors?: any; assignees?: any; aiSummary?: string; noveltyThreat?: string; relevantParts?: string[]; irrelevantParts?: string[]; noveltyComparison?: string }>>({})

  // Legacy manual prior art states (kept for backward compatibility with saved sessions)
  const [manualPriorArtText, setManualPriorArtText] = useState('')
  const [isManualPriorArtSaved, setIsManualPriorArtSaved] = useState(false)
  const [useOnlyManualPriorArt, setUseOnlyManualPriorArt] = useState(false)
  const [useManualAndAISearch, setUseManualAndAISearch] = useState(false)
  const [savingManualPriorArt, setSavingManualPriorArt] = useState(false)
  const [useAutoPriorArt, setUseAutoPriorArt] = useState(true)
  const [useManualPriorArtToggle, setUseManualPriorArtToggle] = useState(false)

  // Saving states
  const [savingPriorArt, setSavingPriorArt] = useState(false)
  const [savingClaimRef, setSavingClaimRef] = useState(false)

  // UI control states
  const [relevanceFilters, setRelevanceFilters] = useState<string[]>([])
  const [noveltyThreatFilters, setNoveltyThreatFilters] = useState<string[]>([])
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [autoSelectWarning, setAutoSelectWarning] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'warning'; text: string } | null>(null)
  // Selection tab filters
  const [priorArtThreatFilter, setPriorArtThreatFilter] = useState<string | null>(null)
  const [claimRefThreatFilter, setClaimRefThreatFilter] = useState<string | null>(null)

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualPriorArtRef = useRef<HTMLDivElement | null>(null)
  const lastLoadedRunIdRef = useRef<string | null>(null)
  // Track the current session ID to detect when it changes (new patent)
  const currentSessionIdRef = useRef<string | null>(null)

  // DEBUG: Log renders
  console.log('RelatedArtStage render - ideaBank:', ideaBank.length, 'ideaBankOpen:', ideaBankOpen, 'version:', ideaBankVersion)

  // DEBUG: Check for component mounting
  useEffect(() => {
    console.log('🏗️ RelatedArtStage component mounted')
    return () => {
      console.log('🏗️ RelatedArtStage component unmounting')
    }
  }, [])

  // Restore ideaBank from sessionStorage once session is available
  useEffect(() => {
    if (session?.id && !hasRestoredFromStorage && ideaBank.length === 0) {
      try {
        const storageKey = `ideaBank_${session.id}`
        const saved = sessionStorage.getItem(storageKey)
        console.log('🔍 Checking sessionStorage for key:', storageKey, 'found:', !!saved)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('💾 Restored ideaBank from sessionStorage:', parsed.length, 'ideas')
            console.log('💾 First restored idea:', parsed[0]?.title?.substring(0, 50))
            setIdeaBank(parsed)
            setIdeaBankVersion(prev => prev + 1)
            setHasRestoredFromStorage(true)
          } else {
            console.log('💾 sessionStorage had data but no valid ideas array')
          }
        } else {
          console.log('💾 No saved ideaBank found in sessionStorage')
        }
      } catch (e) {
        console.warn('Failed to restore ideaBank from sessionStorage:', e)
      }
    }
  }, [session?.id, hasRestoredFromStorage, ideaBank.length])

  // DEBUG: Log ideaBank changes and persist to sessionStorage
  useEffect(() => {
    console.log('💡 ideaBank state changed:', ideaBank.length, 'ideas, version:', ideaBankVersion)
    if (ideaBank.length > 0) {
      console.log('💡 First idea title:', ideaBank[0]?.title)
    }

    // Persist ideaBank to sessionStorage to survive component remounts
    if (typeof window !== 'undefined' && session?.id) {
      try {
        if (ideaBank.length > 0) {
          sessionStorage.setItem(`ideaBank_${session.id}`, JSON.stringify(ideaBank))
          console.log('💾 Saved ideaBank to sessionStorage:', ideaBank.length, 'ideas')
        } else if (hasRestoredFromStorage) {
          // Only clear sessionStorage if we've already restored and now have 0 items
          sessionStorage.removeItem(`ideaBank_${session.id}`)
        }
      } catch (e) {
        console.warn('Failed to save ideaBank to sessionStorage:', e)
      }
    }
  }, [ideaBank, session?.id, hasRestoredFromStorage])

  // Display control settings (saved in localStorage)
  const [displaySettings, setDisplaySettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('patentDisplaySettings')
      return saved ? JSON.parse(saved) : {
        showTitle: true,
        showPatentNumber: true,
        showAbstract: true,
        showInventors: true,
        showAssignees: false,
        showPublicationDate: true,
        showRelevanceScore: true
      }
    }
    return {
      showTitle: true,
      showPatentNumber: true,
      showAbstract: true,
      showInventors: true,
      showAssignees: false,
      showPublicationDate: true,
      showRelevanceScore: true
    }
  })

  const [showDisplayControls, setShowDisplayControls] = useState(false)

  // Save display settings to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('patentDisplaySettings', JSON.stringify(displaySettings))
    }
  }, [displaySettings])

  // Track whether initial hydration has been done to avoid overwriting user changes
  const hasInitializedRef = useRef(false)

  // CRITICAL FIX: Reset all state when session ID changes (navigating to a different patent)
  // This prevents stale data from a previous patent from being shown
  useEffect(() => {
    const newSessionId = session?.id || null
    const previousSessionId = currentSessionIdRef.current
    
    // Only reset if this is a genuine session change (not initial mount)
    if (previousSessionId !== null && newSessionId !== previousSessionId) {
      console.log('🔄 Session ID changed from', previousSessionId, 'to', newSessionId, '- Resetting all prior art state')
      
      // Reset all refs
      hasInitializedRef.current = false
      lastLoadedRunIdRef.current = null
      
      // Reset all state to initial values
      setResults([])
      setRunId(null)
      setAiAnalysis({})
      setHasLoadedSelections(false)
      setCustomQuery('')
      setShowCustomQuery(false)
      setShowAdvancedSettings(false)
      setReviewing(false)
      setReviewInfo('')
      setIdeaBank([])
      setIdeaBankVersion(0)
      setHasRestoredFromStorage(false)
      setError(null)
      
      // Reset workflow states
      setPriorArtMode('ai')
      setPriorArtSelected({})
      setPriorArtManualText('')
      setPriorArtThreatFilter(null)
      setClaimRefMode('ai')
      setClaimRefSelected({})
      setClaimRefManualText('')
      setClaimRefThreatFilter(null)
      setSkipClaimRefinement(false)
      
      // Reset UI states
      setExpandedPatentDetails(new Set())
      setExpandedSections({})
      setSelected({})
      setManualPriorArtText('')
      setIsManualPriorArtSaved(false)
      setUseOnlyManualPriorArt(false)
      setUseManualAndAISearch(false)
      setUseAutoPriorArt(true)
      setUseManualPriorArtToggle(false)
      setRelevanceFilters([])
      setNoveltyThreatFilters([])
      setCurrentPage(1)
      setAutoSelectWarning(null)
      setStatusMessage(null)
      
      // Clear sessionStorage for the old session
      if (typeof window !== 'undefined' && previousSessionId) {
        sessionStorage.removeItem(`ideaBank_${previousSessionId}`)
        console.log('🗑️ Cleared sessionStorage for old session:', previousSessionId)
      }
    }
    
    // Update the ref to track the current session ID
    currentSessionIdRef.current = newSessionId
  }, [session?.id])

  // Load stored results and AI analysis on mount/session change
  useEffect(() => {
    if (!session) return

    const latestRun = session.relatedArtRuns?.[0]
    const latestRunId = latestRun?.id || null

    console.log('🔄 useEffect running - session changed. runId:', latestRunId, 'ideaBank.length:', ideaBank.length, 'results.length:', results.length, 'hasInitialized:', hasInitializedRef.current)

    const hasStoredResults = latestRun?.resultsJson && Array.isArray(latestRun.resultsJson) && latestRun.resultsJson.length > 0

    // Check if the run ID changed (new search was performed)
    const runIdChanged = latestRunId && lastLoadedRunIdRef.current !== latestRunId

    // Hydrate results from DB on first load or when run ID changes
    if (latestRun && (runIdChanged || (!hasInitializedRef.current && latestRunId && hasStoredResults && results.length === 0))) {
      lastLoadedRunIdRef.current = latestRunId
      setResults(latestRun.resultsJson)
      setRunId(latestRun.id)
      console.log('Hydrated prior-art results from DB:', latestRun.resultsJson.length, 'items from run:', latestRun.id)
    } else if (latestRunId && !runId) {
      // Preserve runId hint even if resultsJson was not persisted (avoid losing AI review CTA)
      setRunId(latestRunId)
    }

    // NOTE: Idea bank suggestions are stored in the main idea bank table, not in the run record
    // The local ideaBank state is only populated by AI review and should persist until component unmount
    // No loading from stored data needed here

    // Load manual prior art data if it exists (only on first initialization to avoid overwriting user edits)
    if (!hasInitializedRef.current && session?.manualPriorArt) {
      const manualData = session.manualPriorArt
      setManualPriorArtText(manualData.manualPriorArtText || '')
      setUseOnlyManualPriorArt(manualData.useOnlyManualPriorArt || false)
      setUseManualAndAISearch(manualData.useManualAndAISearch !== false) // Default to true
      setIsManualPriorArtSaved(true)
      setUseManualPriorArtToggle(!!(manualData.manualPriorArtText || manualData.useOnlyManualPriorArt || manualData.useManualAndAISearch))
      console.log('Loaded stored manual prior art data')
    }

    // CRITICAL: Always load AI analysis data from session if not already in state
    // This ensures AI review results persist across stage navigation
    if ((session as any)?.aiAnalysisData && Object.keys(aiAnalysis).length === 0) {
      const storedAiAnalysis = (session as any).aiAnalysisData
      if (storedAiAnalysis && typeof storedAiAnalysis === 'object' && Object.keys(storedAiAnalysis).length > 0) {
      setAiAnalysis(storedAiAnalysis)
        console.log('✅ Loaded stored AI analysis data:', Object.keys(storedAiAnalysis).length, 'entries')
      }
    }

    // Load saved workflow configurations from priorArtConfig
    if (!hasInitializedRef.current && (session as any)?.priorArtConfig) {
      const config = (session as any).priorArtConfig
      
      // Load Prior Art for Drafting configuration
      if (config.priorArtForDrafting) {
        const draftConfig = config.priorArtForDrafting
        if (draftConfig.mode) setPriorArtMode(draftConfig.mode)
        if (draftConfig.manualText) setPriorArtManualText(draftConfig.manualText)
        if (draftConfig.selectedPatents && Array.isArray(draftConfig.selectedPatents)) {
          const selectedMap: Record<string, any> = {}
          draftConfig.selectedPatents.forEach((p: any) => {
            if (p.patentNumber) selectedMap[p.patentNumber] = p
          })
          setPriorArtSelected(selectedMap)
        }
        console.log('✅ Loaded Prior Art for Drafting config:', draftConfig.mode, Object.keys(draftConfig.selectedPatents || {}).length, 'patents')
      }
      
      // Load Claim Refinement configuration
      if (config.claimRefinementConfig) {
        const claimConfig = config.claimRefinementConfig
        if (claimConfig.mode) setClaimRefMode(claimConfig.mode)
        if (claimConfig.manualText) setClaimRefManualText(claimConfig.manualText)
        if (claimConfig.selectedPatents && Array.isArray(claimConfig.selectedPatents)) {
          const selectedMap: Record<string, any> = {}
          claimConfig.selectedPatents.forEach((p: any) => {
            if (p.patentNumber) selectedMap[p.patentNumber] = p
          })
          setClaimRefSelected(selectedMap)
        }
        console.log('✅ Loaded Claim Refinement config:', claimConfig.mode, Object.keys(claimConfig.selectedPatents || {}).length, 'patents')
      }
      
      // Load skip claim refinement flag
      if (config.skippedClaimRefinement) {
        setSkipClaimRefinement(true)
        console.log('✅ Loaded skipClaimRefinement: true')
      }
    }

    // Load user's saved selections (only on first initialization or when run changes)
    if (!hasInitializedRef.current || runIdChanged) {
    const selectionsMap: Record<string, any> = {}

    if (latestRunId && session?.relatedArtSelections && session.relatedArtSelections.length > 0) {
      const allRunSelections = session.relatedArtSelections.filter((sel: any) => sel.runId === latestRunId)

      // Prefer only user-confirmed selections (USER_SELECTED tag); if none, load none
      const userConfirmed = allRunSelections.filter((sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED'))
      const currentRunSelections = userConfirmed.length > 0 ? userConfirmed : []

      console.log(`Filtering ${session.relatedArtSelections.length} total selections down to ${currentRunSelections.length} for runId: ${latestRunId} (user-confirmed: ${userConfirmed.length})`)

      currentRunSelections.forEach((sel: any) => {
        const key = sel.patentNumber && sel.patentNumber !== 'N/A' ? sel.patentNumber : sel.title || 'Untitled'

        // Parse AI analysis from the saved selection
        let aiSummary = '', relevantParts: string[] = [], irrelevantParts: string[] = [], noveltyComparison = ''
        if (sel.userNotes) {
          try {
            const parsedAnalysis = JSON.parse(sel.userNotes)
            aiSummary = parsedAnalysis.summary || ''
            relevantParts = parsedAnalysis.relevant_parts || []
            irrelevantParts = parsedAnalysis.irrelevant_parts || []
            noveltyComparison = parsedAnalysis.novelty_comparison || ''
          } catch (e) {
            // Fallback for old format or plain text
            aiSummary = sel.userNotes
          }
        }

        const noveltyThreat = sel.tags?.includes('AI_ANTICIPATES') ? 'anticipates' :
                              sel.tags?.includes('AI_OBVIOUS') ? 'obvious' :
                              sel.tags?.includes('AI_ADJACENT') ? 'adjacent' :
                              sel.tags?.includes('AI_REMOTE') ? 'remote' : 'unknown'

        // Load user's saved selections for the current run
        selectionsMap[key] = {
          title: sel.title,
          snippet: sel.snippet,
          score: sel.score,
          tags: sel.tags || [],
          publication_date: sel.publicationDate,
          inventors: sel.inventors,
          assignees: sel.assignees,
          aiSummary,
          relevantParts,
          irrelevantParts,
          noveltyComparison,
          noveltyThreat
        }
      })
    }

    setSelected(selectionsMap) // Load only user's saved selections for the current run
    console.log('Loaded selections for current run:', Object.keys(selectionsMap).length, 'patents')
    }

    // Mark initialization complete
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      setHasLoadedSelections(true)
    }
  }, [session])

  // Auto-persist checkbox selections without refreshing the whole page
  useEffect(() => {
    if (!hasLoadedSelections) return
    if (!runId || !session?.id) return

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      // Skip manual prior art to avoid noisy saves while the user types
      // Errors are logged but do not interrupt the UX
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      saveSelections({ skipManual: true }).catch(err => {
        console.error('Auto-save of related art selections failed:', err)
      })
    }, 800)

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [selected, runId, session?.id, hasLoadedSelections])

  // Check if AI review has been done FOR CURRENT RESULTS
  const hasAIReview = useMemo(() => {
    if (results.length === 0) return false;
    // Check if at least one result in the current list has been analyzed
    return results.some(r => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      return !!aiAnalysis[pn];
    });
  }, [results, aiAnalysis]);

  // Calculate AI analysis summary stats for Quick View panels
  const analysisSummary = useMemo(() => {
    const total = Object.keys(aiAnalysis).length
    const anticipates = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'anticipates').length
    const obvious = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'obvious').length
    const adjacent = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'adjacent').length
    const remote = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'remote').length
    return { total, anticipates, obvious, adjacent, remote }
  }, [aiAnalysis])

  // Get section visibility for a patent (defaults to all visible)
  const getSectionVisibility = (patentKey: string) => {
    return expandedSections[patentKey] || {
      metadata: true,
      abstract: true,
      aiSummary: true,
      relevantParts: true,
      irrelevantParts: true,
      noveltyComparison: true
    }
  }

  // Toggle section visibility
  const toggleSection = (patentKey: string, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [patentKey]: {
        ...getSectionVisibility(patentKey),
        [section]: !getSectionVisibility(patentKey)[section as keyof typeof getSectionVisibility]
      }
    }))
  }

  const handleRelevanceFilterChange = (range: string) => {
    setRelevanceFilters(prev =>
      prev.includes(range) ? prev.filter(r => r !== range) : [...prev, range]
    )
    setCurrentPage(1) // Reset to first page on filter change
  }

  const handleNoveltyThreatFilterChange = (threat: string) => {
    setNoveltyThreatFilters(prev =>
      prev.includes(threat) ? prev.filter(t => t !== threat) : [...prev, threat]
    )
    setCurrentPage(1) // Reset to first page on filter change
  }

  const handleAutoSelectAdjacent = () => {
    if (!hasAIReview) return

    const candidates = results
      .map((r, index) => {
        const pn =
          r.pn ||
          (r as any).patent_number ||
          (r as any).publication_number ||
          (r as any).publication_id ||
          (r as any).publicationId ||
          (r as any).patentId ||
          (r as any).patent_id ||
          (r as any).id ||
          'N/A'
        const analysis = aiAnalysis[pn]
        if (!pn || pn === 'N/A' || !analysis || analysis.noveltyThreat !== 'adjacent') return null

        const relevance =
          typeof (r as any).score === 'number'
            ? (r as any).score
            : typeof (r as any).relevance === 'number'
              ? (r as any).relevance
              : 0

        return { r, pn, relevance, index }
      })
      .filter(Boolean) as Array<{ r: ResultItem | any; pn: string; relevance: number; index: number }>

    if (candidates.length === 0) {
      setAutoSelectWarning('⚠️ No adjacent-category patents found. Automatic selection may reduce novelty quality. Manual selection is recommended.')
      setStatusMessage({
        type: 'warning',
        text: '⚠️ No adjacent-category patents found. Try selecting patents manually.'
      })
      return
    }

    // Sort by relevance (desc), then by stable index
    candidates.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance
      return a.index - b.index
    })

    const top = candidates.slice(0, 10)
    const nextSelected: Record<string, any> = { ...priorArtSelected }

    top.forEach(({ r, pn }) => {
      const title = (r as any).title || (r as any).invention_title || pn || 'Untitled'
      const snippet = (r as any).snippet || (r as any).abstract || (r as any).summary || (r as any).description || ''
      const publication_date = (r as any).publication_date
      const score =
        typeof (r as any).score === 'number'
          ? (r as any).score
          : typeof (r as any).relevance === 'number'
            ? (r as any).relevance
            : undefined
      const inventors = (r as any).inventors || (r as any).inventor_names || []
      const assignees = (r as any).assignees || (r as any).assignee_names || []

      const existing = nextSelected[pn] || {}

      nextSelected[pn] = {
        ...existing,
        ...r,
        title,
        snippet,
        score,
        publication_date,
        inventors,
        assignees,
        aiSummary: aiAnalysis[pn]?.aiSummary || existing.aiSummary,
        noveltyThreat: aiAnalysis[pn]?.noveltyThreat || existing.noveltyThreat,
        relevantParts: aiAnalysis[pn]?.relevantParts || existing.relevantParts || [],
        irrelevantParts: aiAnalysis[pn]?.irrelevantParts || existing.irrelevantParts || [],
        noveltyComparison: aiAnalysis[pn]?.noveltyComparison || existing.noveltyComparison,
        tags: Array.from(new Set([...(existing.tags || []), 'AI_REVIEWED', 'AI_ADJACENT']))
      }
    })

    setPriorArtSelected(nextSelected)
    setAutoSelectWarning(null)
    setStatusMessage({
      type: 'success',
      text: `✓ Auto-selected ${top.length} adjacent patents for drafting`
    })
  }


  // Calculate patent counts for each relevance range
  const relevanceRangeCounts = useMemo(() => {
    return results.reduce((acc, r) => {
      const score = (r.score || 0) * 100
      if (score >= 90 && score <= 100) acc['90-100'] = (acc['90-100'] || 0) + 1
      else if (score >= 80 && score < 90) acc['80-90'] = (acc['80-90'] || 0) + 1
      else if (score >= 70 && score < 80) acc['70-80'] = (acc['70-80'] || 0) + 1
      else if (score >= 60 && score < 70) acc['60-70'] = (acc['60-70'] || 0) + 1
      else if (score >= 50 && score < 60) acc['50-60'] = (acc['50-60'] || 0) + 1
      else if (score < 50) acc['<50'] = (acc['<50'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [results])

  // First, filter results by relevance only (not threat)
  const relevanceFilteredResults = useMemo(() => {
    if (relevanceFilters.length === 0) return results
    return results.filter(r => {
      const score = (r.score || 0) * 100
      return relevanceFilters.some(filter => {
        if (filter === '90-100') return score >= 90 && score <= 100
        if (filter === '80-90') return score >= 80 && score < 90
        if (filter === '70-80') return score >= 70 && score < 80
        if (filter === '60-70') return score >= 60 && score < 70
        if (filter === '50-60') return score >= 50 && score < 60
        if (filter === '<50') return score < 50
        return false
      })
    })
  }, [results, relevanceFilters])

  // Calculate patent counts for each novelty threat level (based on relevance-filtered results)
  const noveltyThreatCounts = useMemo(() => {
    return relevanceFilteredResults.reduce((acc, r) => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      const threat = aiAnalysis[pn]?.noveltyThreat || 'unknown'
      acc[threat] = (acc[threat] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [relevanceFilteredResults, aiAnalysis])

  // Then apply threat filter to get final filtered results
  const filteredResults = useMemo(() => {
    if (noveltyThreatFilters.length === 0) return relevanceFilteredResults
    return relevanceFilteredResults.filter(r => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      const threat = aiAnalysis[pn]?.noveltyThreat || 'unknown'
      return noveltyThreatFilters.includes(threat)
    })
  }, [relevanceFilteredResults, noveltyThreatFilters, aiAnalysis])

  // Calculate total analyzed results (excluding unknown)
  const analyzedResultsCount = useMemo(() => {
    return (noveltyThreatCounts.anticipates || 0) + (noveltyThreatCounts.obvious || 0) + (noveltyThreatCounts.adjacent || 0) + (noveltyThreatCounts.remote || 0)
  }, [noveltyThreatCounts])


  const totalPages = Math.ceil(filteredResults.length / itemsPerPage)
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const defaultQuery = useMemo(() => {
    // Use only the searchQuery from Stage 1 (LLM-generated, compact and optimized)
    return searchQuery
  }, [searchQuery])

  const q = defaultQuery

  const getPatentKey = (item: any, index?: number) => {
    const pn =
      item.pn ||
      (item as any).patent_number ||
      (item as any).publication_number ||
      (item as any).publication_id ||
      (item as any).publicationId ||
      (item as any).patentId ||
      (item as any).patent_id ||
      (item as any).id ||
      'N/A'
    const ttl = item.title || (item as any).invention_title || pn || 'Untitled'
    const idx = typeof index === 'number' ? index : 0
    return pn !== 'N/A' ? pn : `${ttl}-${idx}`
  }

  // Generate consistent key for selection (must match the key used in render)
  const generateSelectionKey = (item: any, index?: number) => {
    return getPatentKey(item, index)
  }

  const toggleSelect = (item: any, index?: number) => {
    const key = getPatentKey(item, index)
    setSelected(prev => {
      const next = { ...prev }
      if (next[key]) {
        delete next[key]
      } else {
        next[key] = {
          title: item.title || (item as any).invention_title || (item as any).patent_number || 'Untitled',
          snippet: item.snippet || (item as any).abstract || (item as any).summary || (item as any).description || '',
          score: item.score || (item as any).relevance || 0,
          tags: [],
          publication_date: (item as any).publication_date || (item as any).filing_date || (item as any).date || '',
          inventors: (item as any).inventors || (item as any).inventor_names || [],
          assignees: (item as any).assignees || (item as any).assignee_names || []
        }
      }
      return next
    })
  }

  const scrollToManualPriorArt = () => {
    if (manualPriorArtRef.current) {
      manualPriorArtRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const manualPriorArtEnabled = useMemo(() => {
    return manualPriorArtText.trim().length > 0 || useOnlyManualPriorArt || useManualAndAISearch
  }, [manualPriorArtText, useOnlyManualPriorArt, useManualAndAISearch])

  const clearAllSelections = async () => {
    setSelected({})
    try {
      if (session?.id && runId) {
        await onComplete({ action: 'clear_related_art_selections', sessionId: session.id, runId })
      }
      setStatusMessage({
        type: 'warning',
        text: 'All patent selections cleared.'
      })
    } catch (e) {
      console.error('Failed to clear selections:', e)
      setError('Failed to clear selections.')
    }
  }

  const runSearch = async () => {
    console.log('🚀 runSearch called - customQuery:', customQuery, 'q:', q)
    try {
      setBusy(true)
      setSearching(true)
      setError(null)

      const searchQuery = customQuery.trim() || q

      // Debug logging
      console.log('🔍 Search Query Debug:')
      console.log('  - Custom Query (raw):', customQuery)
      console.log('  - Custom Query (trimmed):', customQuery.trim())
      console.log('  - Default Query (q):', q)
      console.log('  - Final Search Query:', searchQuery)
      console.log('  - Using custom query?', customQuery.trim().length > 0)

      // Sophisticated search progress simulation
      const progressSteps = [
        '🔍 Scanning through 12M+ global patent database...',
        '🎯 Applying advanced semantic analysis to your invention...',
        '🧠 Using proprietary AI algorithms for relevance matching...',
        '📊 Calculating multi-dimensional similarity scores...',
        '🔬 Cross-referencing with CPC/IPC classification systems...',
        '⚡ Filtering results through novelty assessment engine...',
        '✨ Ranking patents by technical relevance and impact...',
        '📋 Preparing final results with comprehensive metadata...'
      ]

      // Show progress with artificial delays to impress the user
      for (let i = 0; i < progressSteps.length; i++) {
        setSearchProgress(progressSteps[i])
        await new Promise(resolve => setTimeout(resolve, 1800)) // 1.8 seconds per step
      }

      // Execute actual search
      setSearchProgress('💡 Finalizing patent analysis and generating comprehensive report...')
      const resp = await onComplete({ action: 'related_art_search', sessionId: session?.id, limit, queryOverride: searchQuery, afterDate: afterDate || undefined })

      const items = Array.isArray(resp?.results) ? resp.results : []

      // Show final result count
      setSearchProgress(`✨ Analysis complete! Found ${items.length} highly relevant patent${items.length !== 1 ? 's' : ''} from millions of global records.`)

      // Brief pause to show the result
      await new Promise(resolve => setTimeout(resolve, 2500))

      // Reset AI analysis and selections for new search to ensure fresh workflow
      setAiAnalysis({})
      setSelected({})
      setIdeaBank([])
      setIdeaBankVersion(prev => prev + 1) // Force re-render
      setHasRestoredFromStorage(false) // Reset restoration flag

      // Clear persisted ideaBank for this session
      if (typeof window !== 'undefined' && session?.id) {
        sessionStorage.removeItem(`ideaBank_${session.id}`)
        console.log('🗑️ Cleared persisted ideaBank for new search')
      }

      setResults(items)
      setRunId(resp?.runId || null)

    } catch (e) {
      console.log('Search error:', e)
      const errorData = (e as any)?.response?.data || e
      if ((errorData as any)?.showMockOption) {
        setError(`${(errorData as any).error || 'Search failed'}. Try using "Mock Search" for testing.`)
      } else {
        setError((errorData as any)?.error || 'Search failed. Please try again.')
      }
    } finally {
      setBusy(false)
      setSearching(false)
      setSearchProgress('')
    }
  }

  const runAIReview = async () => {
    if (!runId) { setError('Run a search first.'); return }
    if (results.length === 0) { setError('No results to review.'); return }
    try {
      setError(null)
      setReviewing(true)
      setReviewInfo('Analyzing patents with AI…')
      
      // Get frozen claims from session for claim-aware prior art analysis
      const normalizedData = (session?.ideaRecord?.normalizedData || {}) as any
      const frozenClaims = normalizedData.claimsStructured || []
      const claimsText = normalizedData.claims || ''
      const claimsApprovedAt = normalizedData.claimsApprovedAt
      
      // Pass claims context to the AI review for deeper analysis
      const resp = await onComplete({
        action: 'related_art_llm_review',
        sessionId: session?.id,
        runId,
        // Include frozen claims for claim-aware analysis
        claimsContext: claimsApprovedAt ? {
          claims: frozenClaims.length > 0 ? frozenClaims : claimsText,
          jurisdiction: normalizedData.claimsJurisdiction,
          frozenAt: claimsApprovedAt
        } : null
      })

      console.log('=== AI REVIEW RESPONSE DEBUG ===')
      console.log('AI Review Response received:', !!resp)
      console.log('Response type:', typeof resp)

      // Check if response is null or undefined
      if (!resp) {
        console.error('❌ AI Review API returned null/undefined response')
        setError('AI review failed: No response from server. Please try again.')
        setReviewing(false)
        return
      }

      console.log('Response keys:', Object.keys(resp))
      console.log('Response has decisions:', Array.isArray(resp.decisions))
      console.log('Response has ideaBankSuggestions:', Array.isArray(resp.ideaBankSuggestions))
      console.log('Decisions count:', resp.decisions?.length || 0)
      console.log('IdeaBankSuggestions count:', resp.ideaBankSuggestions?.length || 0)

      const decisions: Array<{ pn: string; title: string; relevance: number; decision: string; summary: string }> = Array.isArray(resp?.decisions) ? resp.decisions : []
      const auto: string[] = Array.isArray(resp?.autoSelect) ? resp.autoSelect : []

      // Try multiple ways to extract ideas
      let ideas: any[] = []
      if (Array.isArray(resp?.ideaBankSuggestions)) {
        ideas = resp.ideaBankSuggestions
        console.log('✅ Found ideas in resp.ideaBankSuggestions')
      } else if (Array.isArray(resp?.data?.ideaBankSuggestions)) {
        ideas = resp.data.ideaBankSuggestions
        console.log('✅ Found ideas in resp.data.ideaBankSuggestions')
      } else if (resp?.data && Array.isArray(resp.data.ideaBankSuggestions)) {
        ideas = resp.data.ideaBankSuggestions
        console.log('✅ Found ideas in resp.data (nested)')
      } else {
        console.log('❌ No ideas found in any expected location')
      }

      console.log('Final Idea Bank Ideas:', ideas)
      console.log('Ideas length:', ideas.length)
      console.log('=== END AI REVIEW RESPONSE DEBUG ===')

      // Always set ideaBank, even if empty, to ensure UI updates
      console.log('🚀 About to call setIdeaBank with:', ideas.length, 'ideas')
      console.log('🚀 Ideas array content:', ideas)

      // Store ideas in a way that survives re-renders
      const ideasToSet = [...ideas] // Create a copy

      // Update both states to force re-render
      setIdeaBank(ideasToSet)
      setIdeaBankVersion(prev => prev + 1) // Force re-render
      console.log('✅ Idea Bank setIdeaBank called with', ideasToSet.length, 'ideas, new version will be:', ideaBankVersion + 1)

      // Force an immediate state check
      setTimeout(() => {
        console.log('🔄 Immediate check after setIdeaBank:', ideaBank.length, 'ideas, version:', ideaBankVersion)
        if (ideasToSet.length > 0) {
          console.log('🔄 Immediate check - first idea:', ideasToSet[0]?.title)
        }
      }, 0)

      // Update review info
      setReviewInfo('Analysis complete - ' + ideasToSet.length + ' ideas generated')

      // Force a re-render check
      setTimeout(() => {
        console.log('🔄 Re-checking ideaBank state after setState:', ideaBank.length, 'ideas, version:', ideaBankVersion)
        console.log('🔄 Current ideaBank content:', ideaBank)
      }, 100)
      const byPn: Record<string, { relevance: number; novelty_threat: string; summary: string; title: string; relevant_parts?: string[]; irrelevant_parts?: string[]; novelty_comparison?: string }> = {}
      for (const d of decisions) {
        if (!d?.pn) continue
        byPn[d.pn] = {
          relevance: typeof d.relevance === 'number' ? d.relevance : 0,
          novelty_threat: String((d as any).novelty_threat||'remote'),
          summary: String(d.summary||'').slice(0,260),
          title: d.title || '',
          relevant_parts: (d as any).detailedAnalysis?.relevant_parts || [],
          irrelevant_parts: (d as any).detailedAnalysis?.irrelevant_parts || [],
          novelty_comparison: (d as any).detailedAnalysis?.novelty_comparison || ''
        }
      }
      // Store AI analysis results separately from manual selections
      const newAiAnalysis: Record<string, any> = {}
      results.forEach((r, i) => {
        const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
        if (!pn || pn === 'N/A') return
        const dec = byPn[pn]
        if (!dec) return

        newAiAnalysis[pn] = {
          aiSummary: dec.summary,
          noveltyThreat: dec.novelty_threat,
          relevantParts: Array.isArray(dec.relevant_parts) ? dec.relevant_parts : [],
          irrelevantParts: Array.isArray(dec.irrelevant_parts) ? dec.irrelevant_parts : [],
          noveltyComparison: String(dec.novelty_comparison || '').trim()
        }
      })

      setAiAnalysis(newAiAnalysis)

      // Save AI analysis data to database
      try {
        await onComplete({ action: 'save_ai_analysis', sessionId: session?.id, aiAnalysisData: newAiAnalysis })
        console.log('AI analysis data saved to database')
      } catch (e) {
        console.error('Failed to save AI analysis data:', e)
      }

      // Only update selected items (manually selected patents) with AI data
      setSelected(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(key => {
          const dec = byPn[key]
          if (dec) {
            // Update existing selected patent with AI data
            next[key] = {
              ...next[key],
              aiSummary: dec.summary,
              noveltyThreat: dec.novelty_threat,
              tags: ['AI_REVIEWED'].concat(
                dec.novelty_threat === 'anticipates' ? ['AI_ANTICIPATES'] :
                dec.novelty_threat === 'obvious' ? ['AI_OBVIOUS'] :
                dec.novelty_threat === 'adjacent' ? ['AI_ADJACENT'] :
                ['AI_REMOTE']
              )
            }
          }
        })
        return next
      })
      setReviewInfo(`AI reviewed ${decisions.length} items${resp?.batches ? ` in ${resp.batches} batch(es)` : ''}.`)
    } catch (e) {
      setError('AI review failed. Please try again.')
    } finally {
      setReviewing(false)
    }
  }

  const saveManualPriorArt = async () => {
    if (!session?.id) {
      setError('Cannot save manual prior art: missing session ID.')
      return false
    }

    try {
      setSavingManualPriorArt(true)
      if (!manualPriorArtEnabled) {
        await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: null })
        setIsManualPriorArtSaved(false)
        return true
      }
      const manualPriorArtData = {
        manualPriorArtText,
        useOnlyManualPriorArt,
        useManualAndAISearch
      }
      await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: manualPriorArtData })
      setIsManualPriorArtSaved(true)
      console.log('Manual prior art saved successfully:', manualPriorArtData)
      setUseManualPriorArtToggle(true)
      return true
    } catch (e) {
      console.error('Failed to save manual prior art:', e)
      setError('Failed to save manual prior art.')
      return false
    } finally {
      setSavingManualPriorArt(false)
    }
  }

  const clearManualPriorArt = async () => {
    setManualPriorArtText('')
    setUseOnlyManualPriorArt(false)
    setUseManualAndAISearch(false)
    setIsManualPriorArtSaved(false)
    setUseManualPriorArtToggle(false)
    try {
      if (session?.id) {
        await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: null })
      }
      setStatusMessage({
        type: 'warning',
        text: 'Manual prior art removed. Drafting will not use manual prior art unless re-enabled.'
      })
    } catch (e) {
      console.error('Failed to clear manual prior art:', e)
      setError('Failed to remove manual prior art.')
    }
  }

  const saveSelections = async (options?: { skipManual?: boolean }) => {
    if (!runId || !session?.id) {
      setError('Cannot save selections: missing run or session ID.')
      return
    }

    // First, clear all existing user selections for this session/run
    // This ensures we only keep the current selections
    try {
      await onComplete({ action: 'clear_related_art_selections', sessionId: session?.id, runId })
    } catch (e) {
      console.warn('Failed to clear existing selections:', e)
      // Continue anyway - not a critical error
    }

    const selections = Object.entries(selected).map(([k, v]) => {
      const baseTags = Array.isArray(v.tags) ? v.tags : []
      const tags = baseTags.includes('USER_SELECTED') ? baseTags : [...baseTags, 'USER_SELECTED']
      return {
        patent_number: k,
        title: v.title,
        snippet: v.snippet,
        score: v.score,
        tags,
        publication_date: v.publication_date,
        inventors: v.inventors,
        assignees: v.assignees,
        user_notes: v.aiSummary || undefined
      }
    })

    // Save current selections if any exist
    if (selections.length > 0) {
      await onComplete({ action: 'related_art_select', sessionId: session?.id, runId, selections })
    }

    // Save manual prior art data unless explicitly skipped (auto-save path)
    if (!options?.skipManual) {
      await saveManualPriorArt()
    }
  }

  // Determine which tabs should be enabled based on workflow progress
  const canAccessAnalyze = results.length > 0
  const canAccessSelect = hasAIReview

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      {/* ============= HEADER WITH PROGRESS STEPS ============= */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          {/* Title */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Prior Art Analysis</h2>
              <p className="text-sm text-gray-500">Discover, analyze, and select relevant patents for your invention</p>
            </div>
            {/* Quick Stats */}
            <div className="flex items-center gap-4 text-sm">
              {results.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
                  <span className="text-blue-600 font-medium">{results.length}</span>
                  <span className="text-blue-500">patents found</span>
                </div>
              )}
              {hasAIReview && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                  <span className="text-emerald-600 font-medium">{analysisSummary.total}</span>
                  <span className="text-emerald-500">analyzed</span>
                </div>
              )}
            </div>
          </div>

          {/* Step Navigation Tabs */}
          <div className="flex items-center gap-2">
            {/* Step 1: Search */}
            <button
              onClick={() => setMainTab('search')}
              className={`flex items-center gap-3 px-5 py-3 rounded-xl font-medium transition-all ${
                mainTab === 'search'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                mainTab === 'search' ? 'bg-white/20' : results.length > 0 ? 'bg-green-100 text-green-600' : 'bg-gray-100'
              }`}>
                {results.length > 0 ? '✓' : '1'}
              </div>
              <div className="text-left">
                <div className="font-semibold">Search</div>
                <div className={`text-xs ${mainTab === 'search' ? 'text-indigo-200' : 'text-gray-400'}`}>
                  Find prior art
                </div>
              </div>
            </button>

            {/* Arrow */}
            <svg className={`w-5 h-5 ${canAccessAnalyze ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* Step 2: Analyze */}
            <button
              onClick={() => canAccessAnalyze && setMainTab('analyze')}
              disabled={!canAccessAnalyze}
              className={`flex items-center gap-3 px-5 py-3 rounded-xl font-medium transition-all ${
                mainTab === 'analyze'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200'
                  : canAccessAnalyze
                    ? 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                    : 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-100'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                mainTab === 'analyze' ? 'bg-white/20' : hasAIReview ? 'bg-green-100 text-green-600' : canAccessAnalyze ? 'bg-gray-100' : 'bg-gray-50 text-gray-300'
              }`}>
                {hasAIReview ? '✓' : '2'}
              </div>
              <div className="text-left">
                <div className="font-semibold">Analyze</div>
                <div className={`text-xs ${mainTab === 'analyze' ? 'text-emerald-200' : canAccessAnalyze ? 'text-gray-400' : 'text-gray-300'}`}>
                  AI review
                </div>
              </div>
            </button>

            {/* Arrow */}
            <svg className={`w-5 h-5 ${canAccessSelect ? 'text-gray-400' : 'text-gray-200'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* Step 3: Select */}
            <button
              onClick={() => canAccessSelect && setMainTab('select')}
              disabled={!canAccessSelect}
              className={`flex items-center gap-3 px-5 py-3 rounded-xl font-medium transition-all ${
                mainTab === 'select'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-200'
                  : canAccessSelect
                    ? 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                    : 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-100'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                mainTab === 'select' ? 'bg-white/20' : canAccessSelect ? 'bg-gray-100' : 'bg-gray-50 text-gray-300'
              }`}>
                3
              </div>
              <div className="text-left">
                <div className="font-semibold">Select</div>
                <div className={`text-xs ${mainTab === 'select' ? 'text-purple-200' : canAccessSelect ? 'text-gray-400' : 'text-gray-300'}`}>
                  Choose patents
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ============= MAIN CONTENT AREA ============= */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-500 text-xl">⚠️</span>
            <div>
              <div className="font-medium text-red-800">Error</div>
              <div className="text-sm text-red-600">{error}</div>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* ============= TAB 1: SEARCH ============= */}
        {mainTab === 'search' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Your Invention Context Card */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-2xl">💡</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">Your Invention</h3>
                  <p className="text-lg text-indigo-900 font-medium">{idea?.title || 'Untitled'}</p>
                  {idea?.abstract && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{idea.abstract}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Search Configuration */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <span className="text-xl">🔍</span> Global Patent Search
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Search through 12M+ patents worldwide using our AI-optimized query
                </p>
              </div>

              <div className="p-6 space-y-6">
                {/* Search Query Display */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">AI-Optimized Search Query</label>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <code className="text-sm text-gray-700 break-all">{searchQuery || 'No search query available'}</code>
                  </div>
                </div>

                {/* Custom Query Option */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCustomQuery}
                      onChange={(e) => setShowCustomQuery(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Use custom search query instead</span>
                  </label>

                  {showCustomQuery && (
                    <textarea
                      className="w-full border border-gray-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      rows={3}
                      value={customQuery}
                      onChange={(e) => setCustomQuery(e.target.value)}
                      placeholder="Enter your custom Boolean search query..."
                    />
                  )}
                </div>

                {/* Advanced Settings */}
                <div className="border-t border-gray-100 pt-4">
                  <button
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                  >
                    {showAdvancedSettings ? '▼' : '▶'} Advanced Settings
                  </button>
                  
                  {showAdvancedSettings && (
                    <div className="mt-4 grid md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Results Limit</label>
                        <select
                          value={limit}
                          onChange={(e) => setLimit(parseInt(e.target.value))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value={10}>10 results</option>
                          <option value={25}>25 results</option>
                          <option value={50}>50 results</option>
                          <option value={100}>100 results</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Published After</label>
                        <input
                          type="date"
                          value={afterDate}
                          onChange={(e) => setAfterDate(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Search Button */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={runSearch}
                    disabled={busy}
                    className={`flex-1 md:flex-none px-8 py-4 rounded-xl text-base font-semibold transition-all shadow-lg ${
                      searching
                        ? 'bg-indigo-100 text-indigo-700 cursor-wait'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200'
                    } disabled:opacity-50`}
                  >
                    {searching ? (
                      <span className="flex items-center gap-3">
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Searching...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {results.length > 0 ? 'Search Again' : 'Search Prior Art'}
                      </span>
                    )}
                  </button>

                  {results.length > 0 && (
                    <button
                      onClick={() => setMainTab('analyze')}
                      className="px-6 py-4 rounded-xl text-base font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-lg hover:shadow-emerald-200 flex items-center gap-2"
                    >
                      Continue to Analysis
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Search Progress */}
                {searching && searchProgress && (
                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                    <div className="flex items-center gap-3">
                      <div className="animate-pulse w-3 h-3 rounded-full bg-indigo-500"></div>
                      <span className="text-sm text-indigo-700">{searchProgress}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Results Preview (if any) */}
            {results.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <span className="text-xl">📋</span> Search Results
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Found {results.length} potentially relevant patents
                    </p>
                  </div>
                  <span className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                    ✓ Ready for Analysis
                  </span>
                </div>

                <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                  {results.slice(0, 5).map((r, i) => {
                    const pn = r.pn || (r as any).patent_number || 'N/A'
                    const score = (r.score || 0) * 100
                    return (
                      <div key={i} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-4">
                          <div className="text-sm text-gray-400 w-6">{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{r.title}</div>
                            <div className="text-xs text-gray-500 mt-1">{pn}</div>
                          </div>
                          <div className={`px-2 py-1 rounded text-xs font-medium ${
                            score >= 80 ? 'bg-indigo-100 text-indigo-700' :
                            score >= 60 ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {score.toFixed(0)}% match
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {results.length > 5 && (
                    <div className="p-4 text-center text-sm text-gray-500 bg-gray-50">
                      +{results.length - 5} more patents
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============= TAB 2: ANALYZE ============= */}
        {mainTab === 'analyze' && (
          <div className="space-y-6 animate-fadeIn">
            {/* AI Analysis CTA */}
            {!hasAIReview && (
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-8 text-white shadow-xl">
                <div className="flex items-start gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-4xl">🧠</div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold mb-2">Run AI Analysis</h3>
                    <p className="text-emerald-100 mb-4">
                      Our AI will analyze {results.length} patents against your invention to identify novelty threats, 
                      extract relevant disclosures, and provide actionable insights.
                    </p>
                    <button
                      onClick={runAIReview}
                      disabled={reviewing || !runId}
                      className="px-8 py-3 bg-white text-emerald-700 rounded-xl font-semibold hover:bg-emerald-50 transition-colors shadow-lg disabled:opacity-50"
                    >
                      {reviewing ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          {reviewInfo || 'Analyzing...'}
                        </span>
                      ) : (
                        'Start AI Analysis'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis Complete - Summary */}
            {hasAIReview && (
              <>
                {/* Threat Level Summary Cards */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-red-50 rounded-2xl p-6 border border-red-100">
                    <div className="text-4xl font-bold text-red-600">{analysisSummary.anticipates}</div>
                    <div className="text-sm font-medium text-red-800 mt-1">🛑 Anticipates</div>
                    <div className="text-xs text-red-600 mt-0.5">High Risk</div>
                  </div>
                  <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100">
                    <div className="text-4xl font-bold text-amber-600">{analysisSummary.obvious}</div>
                    <div className="text-sm font-medium text-amber-800 mt-1">⚠️ Obvious</div>
                    <div className="text-xs text-amber-600 mt-0.5">Medium Risk</div>
                  </div>
                  <div className="bg-green-50 rounded-2xl p-6 border border-green-100">
                    <div className="text-4xl font-bold text-green-600">{analysisSummary.adjacent}</div>
                    <div className="text-sm font-medium text-green-800 mt-1">✅ Adjacent</div>
                    <div className="text-xs text-green-600 mt-0.5">Low Risk</div>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                    <div className="text-4xl font-bold text-gray-600">{analysisSummary.remote}</div>
                    <div className="text-sm font-medium text-gray-800 mt-1">⚪ Remote</div>
                    <div className="text-xs text-gray-500 mt-0.5">Safe</div>
                  </div>
                </div>

                {/* Filter Bar */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-gray-500">Filter by threat level:</span>
                  {['anticipates', 'obvious', 'adjacent', 'remote'].map(threat => (
                    <button
                      key={threat}
                      onClick={() => handleNoveltyThreatFilterChange(threat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        noveltyThreatFilters.includes(threat)
                          ? threat === 'anticipates' ? 'bg-red-100 text-red-700 border border-red-300' :
                            threat === 'obvious' ? 'bg-amber-100 text-amber-700 border border-amber-300' :
                            threat === 'adjacent' ? 'bg-green-100 text-green-700 border border-green-300' :
                            'bg-gray-200 text-gray-700 border border-gray-300'
                          : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {threat === 'anticipates' ? '🛑' : threat === 'obvious' ? '⚠️' : threat === 'adjacent' ? '✅' : '⚪'} {threat}
                      <span className="ml-1 opacity-70">({noveltyThreatCounts[threat] || 0})</span>
                    </button>
                  ))}
                  {noveltyThreatFilters.length > 0 && (
                    <button
                      onClick={() => setNoveltyThreatFilters([])}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Patent Analysis Results */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">Detailed Analysis Results</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Click on any patent to see the full analysis including abstract comparison
                    </p>
                  </div>

                  <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                    {filteredResults.slice(0, 20).map((r, i) => {
                      const pn = getPatentKey(r, i)
                      const analysis = aiAnalysis[pn]
                      const isExpanded = expandedPatentDetails.has(`analyze-${pn}`)
                      const patentAbstract = (r as any).abstract || (r as any).snippet || ''

                      return (
                        <div key={pn} className="border-b border-gray-100 last:border-b-0">
                          <div 
                            className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => {
                              setExpandedPatentDetails(prev => {
                                const next = new Set(prev)
                                const key = `analyze-${pn}`
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }}
                          >
                            <div className="flex items-center gap-4">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                analysis?.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-700' :
                                analysis?.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-700' :
                                analysis?.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {analysis?.noveltyThreat || 'unknown'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 truncate">{r.title}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{pn}</div>
                              </div>
                              <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>

                          {/* Expanded Analysis - Side by Side View */}
                          {isExpanded && (
                            <div className="px-4 pb-4">
                              <div className="bg-gradient-to-r from-slate-50 to-indigo-50/50 rounded-xl border border-gray-200 p-5">
                                <div className="grid md:grid-cols-2 gap-6">
                                  {/* Left: Patent Abstract */}
                                  <div>
                                    <h4 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                                      <span>📄</span> Patent Abstract
                                    </h4>
                                    <div className="bg-white rounded-lg p-4 border border-gray-200 text-sm text-gray-700 leading-relaxed">
                                      {patentAbstract || 'No abstract available'}
                                    </div>
                                  </div>

                                  {/* Right: AI Analysis */}
                                  <div>
                                    <h4 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
                                      <span>🤖</span> AI Analysis
                                    </h4>
                                    {analysis ? (
                                      <div className="space-y-3">
                                        {analysis.aiSummary && (
                                          <div className="bg-white rounded-lg p-4 border border-gray-200">
                                            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Summary</div>
                                            <div className="text-sm text-gray-700">{analysis.aiSummary}</div>
                                          </div>
                                        )}
                                        {analysis.relevantParts && analysis.relevantParts.length > 0 && (
                                          <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                                            <div className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">⚠️ Overlaps</div>
                                            <ul className="text-sm text-red-800 space-y-1">
                                              {analysis.relevantParts.map((part, idx) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                  <span className="text-red-400">•</span>
                                                  <span>{part}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {analysis.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                          <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                                            <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">✅ Differences</div>
                                            <ul className="text-sm text-green-800 space-y-1">
                                              {analysis.irrelevantParts.map((part, idx) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                  <span className="text-green-400">•</span>
                                                  <span>{part}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {analysis.noveltyComparison && (
                                          <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                                            <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">⚖️ Novelty Assessment</div>
                                            <div className="text-sm text-purple-800">{analysis.noveltyComparison}</div>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="bg-white rounded-lg p-4 border border-gray-200 text-sm text-gray-500">
                                        No AI analysis available for this patent
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Threat Level Badge */}
                                {analysis?.noveltyThreat && (
                                  <div className={`mt-4 pt-4 border-t border-gray-200 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${
                                    analysis.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-800' :
                                    analysis.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-800' :
                                    analysis.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-800' :
                                    'bg-gray-100 text-gray-700'
                                  }`}>
                                    {analysis.noveltyThreat === 'anticipates' ? '🛑 High Risk: May anticipate your invention' :
                                     analysis.noveltyThreat === 'obvious' ? '⚠️ Medium Risk: May raise obviousness concerns' :
                                     analysis.noveltyThreat === 'adjacent' ? '✅ Low Risk: Related but differentiable' :
                                     '⚪ Safe: Remotely related'}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Continue Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => setMainTab('select')}
                    className="px-8 py-4 rounded-xl text-base font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all shadow-lg hover:shadow-purple-200 flex items-center gap-2"
                  >
                    Continue to Selection
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ============= TAB 3: SELECT ============= */}
        {mainTab === 'select' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Purpose Explanation */}
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-6 border border-purple-100">
              <h3 className="font-semibold text-gray-900 text-lg mb-2">Configure Prior Art Usage</h3>
              <p className="text-gray-600">
                Select which patents to use for drafting your patent application and for refining your claims.
              </p>
            </div>

            {/* Selection Workflow Tabs */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Sub-Tab Navigation */}
              <div className="border-b border-gray-200 px-6 pt-4">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveWorkflowTab('prior-art')}
                    className={`pb-3 px-1 border-b-2 transition-colors ${
                      activeWorkflowTab === 'prior-art'
                        ? 'border-indigo-600 text-indigo-600 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>📚</span> Prior Art for Drafting
                      {Object.keys(priorArtSelected).length > 0 && (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs">
                          {Object.keys(priorArtSelected).length}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveWorkflowTab('claim-refinement')}
                    className={`pb-3 px-1 border-b-2 transition-colors ${
                      activeWorkflowTab === 'claim-refinement'
                        ? 'border-amber-600 text-amber-600 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>⚖️</span> Claim Refinement
                      {Object.keys(claimRefSelected).length > 0 && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
                          {Object.keys(claimRefSelected).length}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-6">
                {/* Prior Art for Drafting Tab Content */}
                {activeWorkflowTab === 'prior-art' && (
                  <div className="space-y-6">
                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                      <h4 className="font-medium text-indigo-900 mb-1">📚 Purpose: Background Section</h4>
                      <p className="text-sm text-indigo-700">
                        These patents will be cited in your patent's background section to establish the prior art landscape.
                        Recommended: Select "adjacent" and "remote" patents that provide good context.
                      </p>
                    </div>

                    {/* Threat Level Filter Badges */}
                    {hasAIReview && (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-medium text-gray-600">Filter by threat:</span>
                        {[
                          { level: null, label: 'All', icon: '📋' },
                          { level: 'anticipates', label: 'Anticipates', icon: '🛑' },
                          { level: 'obvious', label: 'Obvious', icon: '⚠️' },
                          { level: 'adjacent', label: 'Adjacent', icon: '✅' },
                          { level: 'remote', label: 'Remote', icon: '⚪' }
                        ].map(({ level, label, icon }) => {
                          const count = level === null 
                            ? results.length 
                            : results.filter(r => aiAnalysis[getPatentKey(r)]?.noveltyThreat === level).length
                          const isActive = priorArtThreatFilter === level
                          
                          return (
                            <button
                              key={label}
                              onClick={() => setPriorArtThreatFilter(level)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                isActive 
                                  ? level === 'anticipates' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' :
                                    level === 'obvious' ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300' :
                                    level === 'adjacent' ? 'bg-green-100 text-green-800 ring-2 ring-green-300' :
                                    level === 'remote' ? 'bg-gray-200 text-gray-800 ring-2 ring-gray-400' :
                                    'bg-indigo-100 text-indigo-800 ring-2 ring-indigo-300'
                                  : level === 'anticipates' ? 'bg-red-50 text-red-700 hover:bg-red-100' :
                                    level === 'obvious' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
                                    level === 'adjacent' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
                                    level === 'remote' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' :
                                    'bg-gray-50 text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              <span>{icon}</span>
                              <span>{label}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                isActive ? 'bg-white/50' : 'bg-white/70'
                              }`}>
                                {count}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Mode Selection */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { mode: 'ai' as const, icon: '🤖', label: 'AI-Selected', desc: 'Use AI-recommended patents' },
                        { mode: 'manual' as const, icon: '✍️', label: 'Manual Only', desc: 'Enter your own prior art' },
                        { mode: 'hybrid' as const, icon: '🔀', label: 'Hybrid', desc: 'AI patents + your notes' }
                      ].map(({ mode, icon, label, desc }) => (
                        <label
                          key={mode}
                          className={`relative flex flex-col items-center p-4 border-2 rounded-xl cursor-pointer transition-all ${
                            priorArtMode === mode ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="priorArtMode"
                            value={mode}
                            checked={priorArtMode === mode}
                            onChange={() => setPriorArtMode(mode)}
                            className="sr-only"
                          />
                          <span className="text-2xl mb-2">{icon}</span>
                          <span className="font-medium text-sm">{label}</span>
                          <span className="text-xs text-gray-500 text-center mt-1">{desc}</span>
                          {priorArtMode === mode && (
                            <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-indigo-600" />
                          )}
                        </label>
                      ))}
                    </div>

                    {/* Manual Text Input */}
                    {(priorArtMode === 'manual' || priorArtMode === 'hybrid') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Manual Prior Art Text</label>
                        <textarea
                          className="w-full border border-gray-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[120px]"
                          placeholder="Enter prior art references or descriptions..."
                          value={priorArtManualText}
                          onChange={(e) => setPriorArtManualText(e.target.value)}
                        />
                      </div>
                    )}

                    {/* AI Patent Selection */}
                    {(priorArtMode === 'ai' || priorArtMode === 'hybrid') && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-sm font-medium text-gray-700">Select Patents for Background Section</label>
                          <div className="flex gap-2">
                            <button
                              onClick={handleAutoSelectAdjacent}
                              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                              ✨ Auto-select Adjacent
                            </button>
                            <button
                              onClick={() => setPriorArtSelected({})}
                              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                        
                        {/* Patent list with expandable details */}
                        <div className="border border-gray-200 rounded-xl overflow-hidden">
                          <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-100">
                            {results.filter(r => {
                              const pn = getPatentKey(r)
                              const threat = aiAnalysis[pn]?.noveltyThreat
                              // Apply threat filter if set, otherwise show all patents
                              if (priorArtThreatFilter !== null) {
                                return threat === priorArtThreatFilter
                              }
                              // Default: show all patents when no filter (removed adjacent/remote only restriction)
                              return true
                            }).map((r, i) => {
                              const pn = getPatentKey(r, i)
                              const analysis = aiAnalysis[pn]
                              const isSelected = !!priorArtSelected[pn]
                              const isExpanded = expandedPatentDetails.has(`priorArt-select-${pn}`)
                              const patentAbstract = (r as any).abstract || (r as any).snippet || ''
                              
                              return (
                                <div key={pn} className={`${isSelected ? 'bg-indigo-50/50' : ''}`}>
                                  {/* Patent header row */}
                                  <div className="flex items-start gap-3 p-4">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setPriorArtSelected(prev => {
                                          if (prev[pn]) {
                                            const { [pn]: _, ...rest } = prev
                                            return rest
                                          }
                                          return { 
                                            ...prev, 
                                            [pn]: { 
                                              ...r, 
                                              noveltyThreat: analysis?.noveltyThreat,
                                              aiSummary: analysis?.aiSummary,
                                              relevantParts: analysis?.relevantParts,
                                              irrelevantParts: analysis?.irrelevantParts,
                                              noveltyComparison: analysis?.noveltyComparison
                                            } 
                                          }
                                        })
                                      }}
                                      className="mt-1 w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm text-gray-900">{r.title}</span>
                                        <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${
                                          analysis?.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-700' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>
                                          {analysis?.noveltyThreat || 'unknown'}
                                        </span>
                                      </div>
                                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                        <span className="font-mono">{pn}</span>
                                        <span>•</span>
                                        <button
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setExpandedPatentDetails(prev => {
                                              const next = new Set(prev)
                                              const key = `priorArt-select-${pn}`
                                              if (next.has(key)) next.delete(key)
                                              else next.add(key)
                                              return next
                                            })
                                          }}
                                          className="text-indigo-600 hover:text-indigo-700 font-medium"
                                        >
                                          {isExpanded ? 'Hide Details' : 'View Details'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Expandable details */}
                                  {isExpanded && (
                                    <div className="px-4 pb-4">
                                      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-4 space-y-4">
                                        {/* Patent Abstract */}
                                        {patentAbstract && (
                                          <div>
                                            <h5 className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                              📄 Patent Abstract
                                            </h5>
                                            <div className="text-sm text-gray-700 bg-white/60 rounded-lg p-3 border border-indigo-100">
                                              {patentAbstract}
                                            </div>
                                          </div>
                                        )}

                                        {/* AI Summary */}
                                        {analysis?.aiSummary && (
                                          <div>
                                            <h5 className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                              🤖 AI Summary
                                            </h5>
                                            <div className="text-sm text-gray-700 bg-white/60 rounded-lg p-3 border border-indigo-100">
                                              {analysis.aiSummary}
                                            </div>
                                          </div>
                                        )}

                                        {/* Matching Parts */}
                                        {analysis?.relevantParts && analysis.relevantParts.length > 0 && (
                                          <div>
                                            <h5 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                              ✅ Matching Parts (Relevant)
                                            </h5>
                                            <ul className="text-sm text-gray-700 bg-green-50/50 rounded-lg p-3 border border-green-100 space-y-1">
                                              {analysis.relevantParts.map((part, idx) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                  <span className="text-green-500 mt-0.5">•</span>
                                                  <span>{part}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}

                                        {/* Non-matching Parts */}
                                        {analysis?.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                          <div>
                                            <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                                              ❌ Non-matching Parts (Differences)
                                            </h5>
                                            <ul className="text-sm text-gray-600 bg-gray-50/50 rounded-lg p-3 border border-gray-200 space-y-1">
                                              {analysis.irrelevantParts.map((part, idx) => (
                                                <li key={idx} className="flex items-start gap-2">
                                                  <span className="text-gray-400 mt-0.5">•</span>
                                                  <span>{part}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}

                                        {/* Novelty Comparison */}
                                        {analysis?.noveltyComparison && (
                                          <div>
                                            <h5 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                              ⚖️ Novelty Assessment
                                            </h5>
                                            <div className="text-sm text-gray-700 bg-purple-50/50 rounded-lg p-3 border border-purple-100">
                                              {analysis.noveltyComparison}
                                            </div>
                                          </div>
                                        )}

                                        {/* Threat Level Badge */}
                                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                                          analysis?.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-800' :
                                          analysis?.noveltyThreat === 'remote' ? 'bg-gray-100 text-gray-700' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>
                                          {analysis?.noveltyThreat === 'adjacent' ? '✅ Low Risk: Related but differentiable' :
                                           analysis?.noveltyThreat === 'remote' ? '⚪ Safe: Remotely related' :
                                           'Risk level unknown'}
                                        </div>
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

                    {/* Summary */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <div className="text-sm font-medium text-gray-700">
                        {priorArtMode === 'ai' && `${Object.keys(priorArtSelected).length} patents selected for drafting`}
                        {priorArtMode === 'manual' && (priorArtManualText.trim() ? 'Manual prior art text provided' : 'No manual text entered')}
                        {priorArtMode === 'hybrid' && `${Object.keys(priorArtSelected).length} patents + ${priorArtManualText.trim() ? 'manual text' : 'no manual text'}`}
                      </div>
                    </div>
                  </div>
                )}

                {/* Claim Refinement Tab Content */}
                {activeWorkflowTab === 'claim-refinement' && (
                  <div className="space-y-6">
                    {/* Skip Option */}
                    <label className="flex items-center gap-3 p-4 bg-purple-50 rounded-xl border border-purple-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipClaimRefinement}
                        onChange={(e) => setSkipClaimRefinement(e.target.checked)}
                        className="w-4 h-4 rounded border-purple-300 text-purple-600"
                      />
                      <div>
                        <span className="font-medium text-purple-900">Skip Claim Refinement</span>
                        <p className="text-sm text-purple-700">I'm confident in my claims and want to proceed directly to component planning</p>
                      </div>
                    </label>

                    {!skipClaimRefinement && (
                      <>
                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                          <h4 className="font-medium text-amber-900 mb-1">⚖️ Purpose: Differentiate Your Claims</h4>
                          <p className="text-sm text-amber-700">
                            These patents will be compared against your claims to ensure novelty and non-obviousness.
                            Recommended: Select high-risk patents (anticipates, obvious) for thorough claim refinement.
                          </p>
                        </div>

                        {/* Threat Level Filter Badges */}
                        {hasAIReview && (
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-medium text-gray-600">Filter by threat:</span>
                            {[
                              { level: null, label: 'All', icon: '📋' },
                              { level: 'anticipates', label: 'Anticipates', icon: '🛑' },
                              { level: 'obvious', label: 'Obvious', icon: '⚠️' },
                              { level: 'adjacent', label: 'Adjacent', icon: '✅' },
                              { level: 'remote', label: 'Remote', icon: '⚪' }
                            ].map(({ level, label, icon }) => {
                              const count = level === null 
                                ? results.length 
                                : results.filter(r => aiAnalysis[getPatentKey(r)]?.noveltyThreat === level).length
                              const isActive = claimRefThreatFilter === level
                              
                              return (
                                <button
                                  key={label}
                                  onClick={() => setClaimRefThreatFilter(level)}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    isActive 
                                      ? level === 'anticipates' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' :
                                        level === 'obvious' ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300' :
                                        level === 'adjacent' ? 'bg-green-100 text-green-800 ring-2 ring-green-300' :
                                        level === 'remote' ? 'bg-gray-200 text-gray-800 ring-2 ring-gray-400' :
                                        'bg-amber-100 text-amber-800 ring-2 ring-amber-300'
                                      : level === 'anticipates' ? 'bg-red-50 text-red-700 hover:bg-red-100' :
                                        level === 'obvious' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
                                        level === 'adjacent' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
                                        level === 'remote' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' :
                                        'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                  }`}
                                >
                                  <span>{icon}</span>
                                  <span>{label}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                                    isActive ? 'bg-white/50' : 'bg-white/70'
                                  }`}>
                                    {count}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Mode Selection */}
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            { mode: 'ai' as const, icon: '🤖', label: 'AI-Selected', desc: 'High-risk patents from AI' },
                            { mode: 'manual' as const, icon: '✍️', label: 'Manual Only', desc: 'Your own prior art notes' },
                            { mode: 'hybrid' as const, icon: '🔀', label: 'Hybrid', desc: 'AI patents + your notes' }
                          ].map(({ mode, icon, label, desc }) => (
                            <label
                              key={mode}
                              className={`relative flex flex-col items-center p-4 border-2 rounded-xl cursor-pointer transition-all ${
                                claimRefMode === mode ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="claimRefMode"
                                value={mode}
                                checked={claimRefMode === mode}
                                onChange={() => setClaimRefMode(mode)}
                                className="sr-only"
                              />
                              <span className="text-2xl mb-2">{icon}</span>
                              <span className="font-medium text-sm">{label}</span>
                              <span className="text-xs text-gray-500 text-center mt-1">{desc}</span>
                              {claimRefMode === mode && (
                                <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-amber-600" />
                              )}
                            </label>
                          ))}
                        </div>

                        {/* Manual Text Input */}
                        {(claimRefMode === 'manual' || claimRefMode === 'hybrid') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Prior Art for Claim Comparison</label>
                            <textarea
                              className="w-full border border-gray-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[120px]"
                              placeholder="Describe prior art that your claims should be differentiated from..."
                              value={claimRefManualText}
                              onChange={(e) => setClaimRefManualText(e.target.value)}
                            />
                          </div>
                        )}

                        {/* AI Patent Selection */}
                        {(claimRefMode === 'ai' || claimRefMode === 'hybrid') && (
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <label className="text-sm font-medium text-gray-700">Select High-Risk Patents for Claim Comparison</label>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    const autoSelected: Record<string, any> = {}
                                    results.forEach((r) => {
                                      const pn = getPatentKey(r)
                                      const analysis = aiAnalysis[pn]
                                      const threat = analysis?.noveltyThreat
                                      if (threat === 'anticipates' || threat === 'obvious') {
                                        autoSelected[pn] = { 
                                          ...r, 
                                          noveltyThreat: threat,
                                          aiSummary: analysis?.aiSummary,
                                          relevantParts: analysis?.relevantParts,
                                          irrelevantParts: analysis?.irrelevantParts,
                                          noveltyComparison: analysis?.noveltyComparison
                                        }
                                      }
                                    })
                                    setClaimRefSelected(autoSelected)
                                    setStatusMessage({
                                      type: 'success',
                                      text: `✓ Auto-selected ${Object.keys(autoSelected).length} high-risk patents for claim comparison`
                                    })
                                  }}
                                  className="text-xs text-amber-600 hover:text-amber-700 font-medium px-2 py-1 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                                >
                                  ✨ Auto-select High-Risk
                                </button>
                                <button
                                  onClick={() => setClaimRefSelected({})}
                                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                >
                                  Clear All
                                </button>
                              </div>
                            </div>
                            
                            {/* Patent list with expandable details */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden">
                              <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-100">
                                {results.filter(r => {
                                  const pn = getPatentKey(r)
                                  const threat = aiAnalysis[pn]?.noveltyThreat
                                  // Apply threat filter if set, otherwise show all patents
                                  if (claimRefThreatFilter !== null) {
                                    return threat === claimRefThreatFilter
                                  }
                                  // Default: show all patents when no filter
                                  return true
                                }).map((r, i) => {
                                  const pn = getPatentKey(r, i)
                                  const analysis = aiAnalysis[pn]
                                  const isSelected = !!claimRefSelected[pn]
                                  const isExpanded = expandedPatentDetails.has(`claimRef-select-${pn}`)
                                  const patentAbstract = (r as any).abstract || (r as any).snippet || ''
                                  
                                  return (
                                    <div key={pn} className={`${isSelected ? 'bg-amber-50/50' : ''}`}>
                                      {/* Patent header row */}
                                      <div className="flex items-start gap-3 p-4">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => {
                                            setClaimRefSelected(prev => {
                                              if (prev[pn]) {
                                                const { [pn]: _, ...rest } = prev
                                                return rest
                                              }
                                              return { 
                                                ...prev, 
                                                [pn]: { 
                                                  ...r, 
                                                  noveltyThreat: analysis?.noveltyThreat,
                                                  aiSummary: analysis?.aiSummary,
                                                  relevantParts: analysis?.relevantParts,
                                                  irrelevantParts: analysis?.irrelevantParts,
                                                  noveltyComparison: analysis?.noveltyComparison
                                                } 
                                              }
                                            })
                                          }}
                                          className="mt-1 w-4 h-4 rounded border-gray-300 text-amber-600 cursor-pointer"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium text-sm text-gray-900">{r.title}</span>
                                            <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${
                                              analysis?.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-700' :
                                              'bg-amber-100 text-amber-700'
                                            }`}>
                                              {analysis?.noveltyThreat || 'unknown'}
                                            </span>
                                          </div>
                                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                            <span className="font-mono">{pn}</span>
                                            <span>•</span>
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setExpandedPatentDetails(prev => {
                                                  const next = new Set(prev)
                                                  const key = `claimRef-select-${pn}`
                                                  if (next.has(key)) next.delete(key)
                                                  else next.add(key)
                                                  return next
                                                })
                                              }}
                                              className="text-amber-600 hover:text-amber-700 font-medium"
                                            >
                                              {isExpanded ? 'Hide Details' : 'View Details'}
                                            </button>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Expandable details */}
                                      {isExpanded && (
                                        <div className="px-4 pb-4">
                                          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100 p-4 space-y-4">
                                            {/* Patent Abstract */}
                                            {patentAbstract && (
                                              <div>
                                                <h5 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                  📄 Patent Abstract
                                                </h5>
                                                <div className="text-sm text-gray-700 bg-white/60 rounded-lg p-3 border border-amber-100">
                                                  {patentAbstract}
                                                </div>
                                              </div>
                                            )}

                                            {/* AI Summary */}
                                            {analysis?.aiSummary && (
                                              <div>
                                                <h5 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                  🤖 AI Summary
                                                </h5>
                                                <div className="text-sm text-gray-700 bg-white/60 rounded-lg p-3 border border-amber-100">
                                                  {analysis.aiSummary}
                                                </div>
                                              </div>
                                            )}

                                            {/* Matching Parts - These are the THREATS */}
                                            {analysis?.relevantParts && analysis.relevantParts.length > 0 && (
                                              <div>
                                                <h5 className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                  ⚠️ Overlapping Claims (Potential Conflicts)
                                                </h5>
                                                <ul className="text-sm text-gray-700 bg-red-50/50 rounded-lg p-3 border border-red-100 space-y-1">
                                                  {analysis.relevantParts.map((part, idx) => (
                                                    <li key={idx} className="flex items-start gap-2">
                                                      <span className="text-red-500 mt-0.5">•</span>
                                                      <span>{part}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}

                                            {/* Non-matching Parts - These are SAFE */}
                                            {analysis?.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                              <div>
                                                <h5 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                  ✅ Key Differences (Your Advantages)
                                                </h5>
                                                <ul className="text-sm text-gray-600 bg-green-50/50 rounded-lg p-3 border border-green-100 space-y-1">
                                                  {analysis.irrelevantParts.map((part, idx) => (
                                                    <li key={idx} className="flex items-start gap-2">
                                                      <span className="text-green-500 mt-0.5">•</span>
                                                      <span>{part}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}

                                            {/* Novelty Comparison */}
                                            {analysis?.noveltyComparison && (
                                              <div>
                                                <h5 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                                  ⚖️ Novelty Assessment
                                                </h5>
                                                <div className="text-sm text-gray-700 bg-purple-50/50 rounded-lg p-3 border border-purple-100">
                                                  {analysis.noveltyComparison}
                                                </div>
                                              </div>
                                            )}

                                            {/* Threat Level Badge */}
                                            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                                              analysis?.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-800' :
                                              analysis?.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-800' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {analysis?.noveltyThreat === 'anticipates' ? '🛑 High Risk: May anticipate your claims - needs differentiation' :
                                               analysis?.noveltyThreat === 'obvious' ? '⚠️ Medium Risk: May raise obviousness concerns - strengthen claims' :
                                               'Risk level unknown'}
                                            </div>
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

                        {/* Summary */}
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                          <div className="text-sm font-medium text-gray-700">
                            {claimRefMode === 'ai' && `${Object.keys(claimRefSelected).length} patents selected for claim comparison`}
                            {claimRefMode === 'manual' && (claimRefManualText.trim() ? 'Manual prior art text provided' : 'No manual text entered')}
                            {claimRefMode === 'hybrid' && `${Object.keys(claimRefSelected).length} patents + ${claimRefManualText.trim() ? 'manual text' : 'no manual text'}`}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div className={`p-4 rounded-xl border ${
                statusMessage.type === 'success' 
                  ? 'bg-green-50 border-green-200 text-green-800' 
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}>
                {statusMessage.text}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-6 border-t border-gray-200">
              <button
                onClick={async () => {
                  // Build prior art data for drafting
                  const priorArtPatentsArray = Object.entries(priorArtSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )
                  
                  // Build claim refinement data  
                  const claimRefPatentsArray = Object.entries(claimRefSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )

                  try {
                    setSavingPriorArt(true)
                    await onComplete({
                      action: 'save_prior_art_config',
                      sessionId: session?.id,
                      priorArtConfig: {
                        mode: priorArtMode,
                        selectedPatents: priorArtPatentsArray,
                        manualText: priorArtManualText
                      },
                      claimRefConfig: {
                        mode: claimRefMode,
                        selectedPatents: claimRefPatentsArray,
                        manualText: claimRefManualText
                      },
                      skipClaimRefinement
                    })
                    await onRefresh()
                    setStatusMessage({
                      type: 'success',
                      text: `✓ Saved: ${priorArtPatentsArray.length} patents for drafting, ${claimRefPatentsArray.length} patents for claim refinement`
                    })
                  } catch (e) {
                    console.error('Failed to save config:', e)
                    setStatusMessage({
                      type: 'warning',
                      text: '⚠️ Failed to save configuration'
                    })
                  } finally {
                    setSavingPriorArt(false)
                  }
                }}
                disabled={savingPriorArt || !hasAIReview}
                className="px-6 py-3 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl disabled:opacity-50 transition-colors"
              >
                {savingPriorArt ? 'Saving...' : 'Save Selections'}
              </button>

              <button
                onClick={async () => {
                  // Build prior art data for drafting
                  const priorArtPatentsArray = Object.entries(priorArtSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )
                  
                  // Build claim refinement data  
                  const claimRefPatentsArray = Object.entries(claimRefSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )

                  // Save configuration first
                  try {
                    await onComplete({
                      action: 'save_prior_art_config',
                      sessionId: session?.id,
                      priorArtConfig: {
                        mode: priorArtMode,
                        selectedPatents: priorArtPatentsArray,
                        manualText: priorArtManualText
                      },
                      claimRefConfig: {
                        mode: claimRefMode,
                        selectedPatents: claimRefPatentsArray,
                        manualText: claimRefManualText
                      },
                      skipClaimRefinement
                    })
                  } catch (e) {
                    console.error('Failed to save config before proceeding:', e)
                  }

                  // If skipping claim refinement, go directly to component planner
                  if (skipClaimRefinement) {
                    setStatusMessage({
                      type: 'success',
                      text: '✓ Skipping Claim Refinement, proceeding to Component Planner...'
                    })

                    await onComplete({
                      action: 'set_stage',
                      sessionId: session?.id,
                      stage: 'COMPONENT_PLANNER',
                      priorArtForDrafting: {
                        mode: priorArtMode,
                        selectedPatents: priorArtPatentsArray,
                        manualText: priorArtManualText
                      },
                      claimRefinementSkipped: true,
                      manualPriorArt: priorArtManualText ? {
                        manualPriorArtText: priorArtManualText,
                        useOnlyManualPriorArt: priorArtMode === 'manual',
                        useManualAndAISearch: priorArtMode === 'hybrid'
                      } : null,
                      selectedPatents: priorArtPatentsArray,
                      priorArtConfig: {
                        useAuto: priorArtMode !== 'manual',
                        useManual: priorArtMode === 'manual' || priorArtMode === 'hybrid',
                        skippedClaimRefinement: true
                      }
                    })
                    await onRefresh()
                    return
                  }
                  
                  // Validate claim refinement selection
                  const hasClaimRef = claimRefMode === 'manual' ? claimRefManualText.trim() :
                                      claimRefMode === 'hybrid' ? (claimRefPatentsArray.length > 0 || claimRefManualText.trim()) :
                                      claimRefPatentsArray.length > 0
                  
                  if (!hasClaimRef) {
                    setStatusMessage({
                      type: 'warning',
                      text: '⚠️ Please select patents or provide text for claim refinement, or enable "Skip Claim Refinement".'
                    })
                    setActiveWorkflowTab('claim-refinement')
                    return
                  }

                  setStatusMessage({
                    type: 'success',
                    text: '✓ Proceeding to Claim Refinement...'
                  })

                  await onComplete({
                    action: 'set_stage',
                    sessionId: session?.id,
                    stage: 'CLAIM_REFINEMENT',
                    priorArtForDrafting: {
                      mode: priorArtMode,
                      selectedPatents: priorArtPatentsArray,
                      manualText: priorArtManualText
                    },
                    claimRefinementConfig: {
                      mode: claimRefMode,
                      selectedPatents: claimRefPatentsArray,
                      manualText: claimRefManualText
                    },
                    manualPriorArt: priorArtManualText ? {
                      manualPriorArtText: priorArtManualText,
                      useOnlyManualPriorArt: priorArtMode === 'manual',
                      useManualAndAISearch: priorArtMode === 'hybrid'
                    } : null,
                    selectedPatents: claimRefPatentsArray,
                    priorArtConfig: {
                      useAuto: claimRefMode !== 'manual',
                      useManual: claimRefMode === 'manual' || claimRefMode === 'hybrid'
                    }
                  })
                  await onRefresh()
                }}
                disabled={!hasAIReview}
                className={`px-8 py-3 text-sm font-semibold text-white rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${
                  skipClaimRefinement 
                    ? 'bg-purple-600 hover:bg-purple-700 hover:shadow-purple-200' 
                    : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-200'
                }`}
              >
                <span>{skipClaimRefinement ? 'Skip to Component Planner' : 'Proceed to Claim Refinement'}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Idea Bank Floating Panel */}
      {ideaBank.length > 0 && ideaBankOpen && (
        <div className="fixed bottom-4 right-4 w-96 max-h-[500px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50 animate-fadeIn">
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-3 flex items-center justify-between">
            <h4 className="font-semibold flex items-center gap-2">
              <span>💡</span> Idea Bank ({ideaBank.length})
            </h4>
            <button onClick={() => setIdeaBankOpen(false)} className="text-white/80 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
            {ideaBank.map((idea, i) => (
              <div key={i} className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                <div className="font-medium text-gray-900 text-sm">{idea.title}</div>
                <div className="text-xs text-gray-600 mt-1">{idea.core_principle}</div>
                {idea.tags && idea.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {idea.tags.map((tag, j) => (
                      <span key={j} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Idea Bank Toggle Button */}
      {ideaBank.length > 0 && !ideaBankOpen && (
        <button
          onClick={() => setIdeaBankOpen(true)}
          className="fixed bottom-4 right-4 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2 z-50"
        >
          <span>💡</span>
          <span className="font-medium">Idea Bank</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{ideaBank.length}</span>
        </button>
      )}
    </div>
  )
})

RelatedArtStage.displayName = 'RelatedArtStage'

export default RelatedArtStage
