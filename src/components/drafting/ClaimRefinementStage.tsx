'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle2, Sparkles, Lock, Unlock, Pencil, Save, X, Plus, Trash2, Wand2, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'

interface ClaimRefinementStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ClaimRow = { number: number; text: string }

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const parseClaims = (html: string, structured?: any[]): ClaimRow[] => {
  if (Array.isArray(structured) && structured.length > 0) {
    return structured.map((c: any) => ({ number: Number(c.number) || 0, text: c.text || '' }))
  }
  if (!html) return []
  const blocks = html.split(/<\/p>/i)
  const rows: ClaimRow[] = []
  blocks.forEach((b) => {
    const plain = stripTags(b)
    if (!plain) return
    const match = plain.match(/^(\d+)\.\s*(.+)$/)
    if (match) {
      rows.push({ number: Number(match[1]), text: match[2] })
    }
  })
  return rows
}

type DiffPart = { type: 'same' | 'add' | 'del'; text: string }

const diffWords = (oldText: string, newText: string): DiffPart[] => {
  const a = (oldText || '').split(/\s+/)
  const b = (newText || '').split(/\s+/)
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      parts.push({ type: 'same', text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: 'del', text: a[i] })
      i++
    } else {
      parts.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) { parts.push({ type: 'del', text: a[i++] }) }
  while (j < n) { parts.push({ type: 'add', text: b[j++] }) }
  return parts
}

const renderDiff = (oldText: string, newText: string) => {
  if (!newText || oldText === newText) return <span className="text-gray-800">{oldText || newText}</span>
  const parts = diffWords(oldText, newText)
  return (
    <div className="flex flex-wrap gap-1 text-sm leading-6">
      {parts.map((p, idx) => {
        if (p.type === 'same') return <span key={idx}>{p.text}</span>
        if (p.type === 'add') return <span key={idx} className="bg-green-100 text-green-800 px-1 rounded">{p.text}</span>
        return <span key={idx} className="bg-red-100 text-red-800 line-through px-1 rounded">{p.text}</span>
      })}
    </div>
  )
}

export default function ClaimRefinementStage({ session, onComplete, onRefresh }: ClaimRefinementStageProps) {
  // Debug: Log session data to diagnose data flow issues
  console.log('🔍 ClaimRefinementStage - Session received:', {
    sessionId: session?.id,
    hasPriorArtConfig: !!session?.priorArtConfig,
    priorArtConfig: session?.priorArtConfig,
    claimRefinementConfig: (session?.priorArtConfig as any)?.claimRefinementConfig,
    selectedPatentsCount: (session?.priorArtConfig as any)?.claimRefinementConfig?.selectedPatents?.length || 0
  })

  const normalized = (session?.ideaRecord?.normalizedData as any) || {}
  const structured = normalized.claimsStructured || normalized.claimsStructuredProvisional || normalized.claimsStructuredFinal || []
  const currentClaimsHtml = normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || ''
  const provisionalClaimsHtml = normalized.claimsProvisional || currentClaimsHtml
  const claimRefConfig = (session?.priorArtConfig as any)?.claimRefinementConfig || {}
  const claimRefManualText = typeof claimRefConfig?.manualText === 'string' ? claimRefConfig.manualText : ''
  const claimRefSelectedPatentsFromConfig: any[] = Array.isArray(claimRefConfig?.selectedPatents) ? claimRefConfig.selectedPatents : []
  
  // Debug: Log extracted config values
  console.log('🔍 ClaimRefinementStage - Config extracted:', {
    claimRefConfig,
    claimRefManualText,
    claimRefSelectedPatentsFromConfig
  })

  const baseClaims = useMemo(() => parseClaims(provisionalClaimsHtml, structured), [provisionalClaimsHtml, structured])
  const [preview, setPreview] = useState<any>(normalized.claimsRefinementPreview || null)
  const normalizePatentId = (p: any) => {
    const pn = p?.patentNumber || p?.pn || p?.publication_number || p?.publicationNumber || p?.id
    return typeof pn === 'string' ? pn.trim() : ''
  }
  const resolveThreat = (tags?: string[], novelty?: string) => {
    const tagThreat = (tags || []).find((t) => ['AI_ANTICIPATES', 'AI_OBVIOUS', 'AI_ADJACENT', 'AI_REMOTE'].includes(t))
    if (novelty) return novelty
    if (tagThreat === 'AI_ANTICIPATES') return 'anticipates'
    if (tagThreat === 'AI_OBVIOUS') return 'obvious'
    if (tagThreat === 'AI_ADJACENT') return 'adjacent'
    if (tagThreat === 'AI_REMOTE') return 'remote'
    return 'unknown'
  }
  // Patents for claim refinement should ONLY come from the claim refinement config
  // DO NOT fall back to relatedArtSelections as those are for prior art drafting, not claim refinement
  const optionsFromConfig = useMemo(() => claimRefSelectedPatentsFromConfig
    .map((p: any) => {
      const id = normalizePatentId(p)
      if (!id) return null
      return {
        id,
        title: p.title || 'Untitled',
        threat: resolveThreat(p.tags, (p as any).noveltyThreat),
        source: 'config' as const
      }
    })
    .filter(Boolean) as Array<{ id: string; title: string; threat: string; source: 'config' }>, [claimRefSelectedPatentsFromConfig])

  const configIdsKey = optionsFromConfig.map((p) => p.id).join('|')
  // Only use patents explicitly selected for claim refinement - no fallback to prior art selections
  const priorArtOptions = optionsFromConfig
  const initialMode = claimRefConfig.mode || 'ai'
  const [useAuto, setUseAuto] = useState(initialMode !== 'manual')
  const [useManual, setUseManual] = useState(initialMode === 'manual' || initialMode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
  const [selectedPatents, setSelectedPatents] = useState<string[]>(priorArtOptions.map((p) => p.id))
  const [acceptMap, setAcceptMap] = useState<Record<number, boolean>>({})
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdditionalInstructions, setShowAdditionalInstructions] = useState(false)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [expandedPatentRefs, setExpandedPatentRefs] = useState<Set<string>>(new Set())
  const [showPatentReferences, setShowPatentReferences] = useState(true)
  
  // Manual editing states
  const [isEditMode, setIsEditMode] = useState(false)
  const [editableClaims, setEditableClaims] = useState<ClaimRow[]>([])
  const [savingClaims, setSavingClaims] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [unfreezing, setUnfreezing] = useState(false)
  const [showInputsPanel, setShowInputsPanel] = useState(true)
  
  // Check if claims are frozen
  const isFrozen = !!normalized.claimsApprovedAt

  // Toggle patent expansion
  const togglePatentRef = (patentId: string) => {
    setExpandedPatentRefs(prev => {
      const next = new Set(prev)
      if (next.has(patentId)) next.delete(patentId)
      else next.add(patentId)
      return next
    })
  }

  useEffect(() => {
    const mode = claimRefConfig.mode || 'ai'
    // Only use patents from claim refinement config - not fallback to prior art
    const nextSelected = optionsFromConfig.map((p) => p.id)
    setUseAuto(mode !== 'manual')
    setUseManual(mode === 'manual' || mode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
    setSelectedPatents(nextSelected)
  }, [claimRefConfig.mode, claimRefManualText, session?.manualPriorArt, configIdsKey, optionsFromConfig])

  useEffect(() => {
    if (preview?.refinedClaims) {
      const defaults: Record<number, boolean> = {}
      preview.refinedClaims.forEach((c: any) => {
        if (c.refined_text) defaults[Number(c.number)] = true
      })
      setAcceptMap(defaults)
    }
  }, [preview])

  // Initialize editable claims when entering edit mode or when baseClaims change
  useEffect(() => {
    if (isEditMode && editableClaims.length === 0) {
      setEditableClaims([...baseClaims])
    }
  }, [isEditMode, baseClaims, editableClaims.length])

  // Track unsaved changes
  useEffect(() => {
    if (isEditMode && editableClaims.length > 0) {
      const hasChanges = editableClaims.some((ec, idx) => {
        const original = baseClaims[idx]
        return !original || ec.text !== original.text || ec.number !== original.number
      }) || editableClaims.length !== baseClaims.length
      setHasUnsavedChanges(hasChanges)
    }
  }, [editableClaims, baseClaims, isEditMode])

  // Automatically unfreeze claims when entering claim refinement stage
  // BUT skip auto-unfreeze if the user just manually froze claims in this session
  const hasAutoUnfrozenRef = useRef(false)
  const userJustFrozeRef = useRef(false)
  const initialFrozenStateRef = useRef<boolean | null>(null)
  
  // Capture the initial frozen state on first render
  useEffect(() => {
    if (initialFrozenStateRef.current === null) {
      initialFrozenStateRef.current = isFrozen
    }
  }, [isFrozen])
  
  useEffect(() => {
    const autoUnfreezeClaims = async () => {
      // CRITICAL: Skip auto-unfreeze if user manually froze claims in this component session
      if (userJustFrozeRef.current) {
        console.log('[ClaimRefinementStage] Skipping auto-unfreeze: user manually froze claims')
        return
      }
      
      // Only auto-unfreeze once, only if claims were already frozen when component FIRST mounted,
      // and only if the user hasn't manually frozen claims
      const wasInitiallyFrozen = initialFrozenStateRef.current === true
      if (!hasAutoUnfrozenRef.current && isFrozen && wasInitiallyFrozen && session?.id && normalized) {
        hasAutoUnfrozenRef.current = true
        console.log('[ClaimRefinementStage] Auto-unfreezing claims for editing')
        try {
          await onComplete({
            action: 'unfreeze_claims',
            sessionId: session.id
          })
          await onRefresh()
          // Don't show success message for automatic unfreeze to avoid confusion
        } catch (e) {
          console.error('Auto-unfreeze failed:', e)
          hasAutoUnfrozenRef.current = false // Reset on failure so user can try manually
        }
      }
    }

    autoUnfreezeClaims()
  }, [isFrozen, session?.id, normalized, onComplete, onRefresh])

  // Enter edit mode
  const handleStartEditing = () => {
    setEditableClaims([...baseClaims])
    setIsEditMode(true)
    setSuccessMessage(null)
  }

  // Cancel editing
  const handleCancelEditing = () => {
    setEditableClaims([])
    setIsEditMode(false)
    setHasUnsavedChanges(false)
  }

  // Update a claim's text
  const handleClaimTextChange = (index: number, newText: string) => {
    setEditableClaims(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], text: newText }
      return updated
    })
  }

  // Add a new claim
  const handleAddClaim = () => {
    const maxNumber = editableClaims.reduce((max, c) => Math.max(max, c.number), 0)
    setEditableClaims(prev => [...prev, { number: maxNumber + 1, text: '' }])
  }

  // Remove a claim
  const handleRemoveClaim = (index: number) => {
    setEditableClaims(prev => {
      const updated = prev.filter((_, i) => i !== index)
      // Renumber claims
      return updated.map((c, idx) => ({ ...c, number: idx + 1 }))
    })
  }

  // Save edited claims
  const handleSaveClaims = async () => {
    if (!session?.id) return
    try {
      setSavingClaims(true)
      setError(null)
      
      // Convert editable claims back to HTML and structured format
      const claimsHtml = editableClaims.map(c => `<p>${c.number}. ${c.text}</p>`).join('\n')
      const claimsStructured = editableClaims.map(c => ({
        number: c.number,
        text: c.text,
        type: c.number === 1 ? 'independent' : 'dependent',
        category: c.number === 1 ? 'independent' : 'dependent'
      }))

      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsHtml,
        claimsStructured
      })
      
      await onRefresh()
      setIsEditMode(false)
      setHasUnsavedChanges(false)
      setSuccessMessage('Claims saved successfully!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Save claims failed', e)
      setError('Failed to save claims.')
    } finally {
      setSavingClaims(false)
    }
  }

  const handlePreview = async () => {
    if (!session?.id) return
    try {
      setLoadingPreview(true)
      setError(null)
      const resp = await onComplete({
        action: 'claim_refinement_preview',
        sessionId: session.id,
        useAuto,
        useManual,
        selectedPatents,
        additionalInstructions: showAdditionalInstructions ? additionalInstructions : ''
      })
      if (resp?.preview) {
        setPreview(resp.preview)
      }
    } catch (e) {
      console.error('Preview failed', e)
      setError('Failed to generate refinement preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleApply = async () => {
    if (!session?.id) return
    try {
      setApplying(true)
      setError(null)
      setSuccessMessage(null)
      const accepted = Object.entries(acceptMap).filter(([, v]) => v).map(([k]) => Number(k))

      // Store original claims for comparison feedback
      const originalClaims = baseClaims

      await onComplete({
        action: 'claim_refinement_apply',
        sessionId: session.id,
        acceptedClaimNumbers: accepted
      })
      await onRefresh()

      // Enhanced feedback: Show what was changed
      const claimCount = accepted.length
      if (claimCount === 0) {
        setSuccessMessage('✓ No changes applied - all refinements were rejected.')
      } else {
        // Count how many claims were actually modified
        const refinedClaims = preview?.refinedClaims || []
        const modifiedCount = accepted.filter(claimNum =>
          refinedClaims.find((r: any) => Number(r.number) === claimNum)?.refined_text
        ).length

        const message = `✓ Applied ${claimCount} claim refinement${claimCount !== 1 ? 's' : ''}${modifiedCount > 0 ? ` (${modifiedCount} claim${modifiedCount !== 1 ? 's' : ''} modified)` : ''}. Claims have been updated and are ready for final approval.`
        setSuccessMessage(message)
      }

      setTimeout(() => setSuccessMessage(null), 8000) // Extended duration for better visibility
    } catch (e) {
      console.error('Apply failed', e)
      setError('Failed to apply refinements.')
    } finally {
      setApplying(false)
    }
  }

  const handleFreeze = async () => {
    if (!session?.id) return
    
    // Warn if there are unsaved changes
    if (isEditMode && hasUnsavedChanges) {
      const confirmProceed = window.confirm('You have unsaved changes. Do you want to save them before freezing?')
      if (confirmProceed) {
        await handleSaveClaims()
        // Wait for refresh to complete
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    
    try {
      setFreezing(true)
      setError(null)
      
      // CRITICAL: Mark that user manually froze claims to prevent auto-unfreeze
      userJustFrozeRef.current = true
      console.log('[ClaimRefinementStage] User manually freezing claims - auto-unfreeze disabled')
      
      await onComplete({
        action: 'freeze_claims',
        sessionId: session.id,
        claims: normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || currentClaimsHtml,
        claimsStructured: structured && structured.length ? structured : undefined,
        jurisdiction: (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
      })
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER'
      })
      await onRefresh()
      setSuccessMessage('Claims frozen and ready for next stage!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Freeze failed', e)
      setError('Failed to freeze claims.')
      // Reset the flag on failure so auto-unfreeze can work if needed
      userJustFrozeRef.current = false
    } finally {
      setFreezing(false)
    }
  }

  const handleUnfreeze = async () => {
    if (!session?.id) return
    try {
      setUnfreezing(true)
      setError(null)
      
      // Reset the manual freeze flag when user explicitly unfreezes
      userJustFrozeRef.current = false
      
      await onComplete({
        action: 'unfreeze_claims',
        sessionId: session.id
      })
      await onRefresh()
      setSuccessMessage('Claims unfrozen. You can now edit them.')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (e) {
      console.error('Unfreeze failed', e)
      setError('Failed to unfreeze claims.')
    } finally {
      setUnfreezing(false)
    }
  }

  const refinedClaims = preview?.refinedClaims || []

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Claim Refinement</h1>
                <p className="text-slate-500 text-sm">AI-powered novelty optimization</p>
              </div>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
            isFrozen 
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {isFrozen ? '✓ Claims Finalized' : '○ Draft Mode'}
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-700">{successMessage}</div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Claims Panel - 3 columns */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-medium text-slate-900">
                    {isEditMode ? 'Editing Claims' : 'Your Claims'}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                    {isEditMode ? editableClaims.length : baseClaims.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditMode ? (
                    <button
                      onClick={handleStartEditing}
                      disabled={isFrozen}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleCancelEditing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveClaims}
                        disabled={savingClaims || !hasUnsavedChanges}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingClaims ? 'Saving...' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isFrozen && !isEditMode && (
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-600">Claims are locked. Unlock to make changes.</span>
                  <button
                    onClick={handleUnfreeze}
                    disabled={unfreezing}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                  >
                    <Unlock className="w-3 h-3" />
                    {unfreezing ? 'Unlocking...' : 'Unlock'}
                  </button>
                </div>
              )}

              {hasUnsavedChanges && isEditMode && (
                <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-xs text-blue-700">Unsaved changes</span>
                </div>
              )}

              <div className="p-5 max-h-[480px] overflow-y-auto space-y-3">
                {isEditMode ? (
                  <>
                    {editableClaims.map((c, index) => (
                      <div key={index} className="group relative">
                        <div className="absolute -left-3 top-3 w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium flex items-center justify-center">
                          {c.number}
                        </div>
                        <div className="ml-5 bg-slate-50 rounded-xl p-4 border border-slate-200 hover:border-indigo-200 transition-colors">
                          <textarea
                            value={c.text}
                            onChange={(e) => handleClaimTextChange(index, e.target.value)}
                            className="w-full text-sm text-slate-700 bg-transparent border-0 p-0 focus:outline-none focus:ring-0 resize-none min-h-[60px]"
                            placeholder="Enter claim text..."
                          />
                          <button
                            onClick={() => handleRemoveClaim(index)}
                            className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={handleAddClaim}
                      className="ml-5 w-[calc(100%-1.25rem)] py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add claim
                    </button>
                  </>
                ) : (
                  baseClaims.map((c) => (
                    <div key={c.number} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
                        {c.number}
                      </div>
                      <div className="text-sm text-slate-700 leading-relaxed">{c.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* AI Preview Panel */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  <h2 className="font-medium text-slate-900">AI Suggestions</h2>
                </div>
                {preview && (
                  <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 text-xs font-medium">
                    {refinedClaims.filter((r: any) => r.refined_text).length} refined
                  </span>
                )}
              </div>
              <div className="p-5">
                {!preview ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                      <Wand2 className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500">Run AI refinement to see suggestions</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {baseClaims.map((c) => {
                      const refined = refinedClaims.find((r: any) => Number(r.number) === Number(c.number))
                      const refinedText = refined?.refined_text || ''
                      const originalText = refined?.original_text || c.text
                      const accepted = acceptMap[c.number] ?? Boolean(refinedText)
                      
                      return (
                        <div key={c.number} className={`rounded-xl p-4 transition-colors bg-white border ${
                          refinedText ? 'border-emerald-200' : 'border-slate-200'
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-500">Claim {c.number}</span>
                              {refinedText ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">Modified</span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-medium">Unchanged</span>
                              )}
                            </div>
                            {refinedText && (
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={accepted}
                                  onChange={(e) => setAcceptMap((prev) => ({ ...prev, [c.number]: e.target.checked }))}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-[10px] text-slate-500">Accept</span>
                              </label>
                            )}
                          </div>
                          <div className="text-sm">
                            {refinedText ? renderDiff(originalText, refinedText) : (
                              <span className="text-slate-600">{originalText}</span>
                            )}
                          </div>
                          {refined?.change_reason && (
                            <div className="mt-2 pt-2 border-t border-emerald-100 text-xs text-emerald-700 flex items-start gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <span>{refined.change_reason}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions Panel - 2 columns */}
          <div className="lg:col-span-2 space-y-4">
            {/* Workflow Steps */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-medium text-slate-900">Workflow</h2>
              </div>
              <div className="p-5 space-y-3">
                {/* Step 1 */}
                <button
                  onClick={handlePreview}
                  disabled={loadingPreview || isFrozen}
                  className="w-full group"
                >
                  <div className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                    loadingPreview 
                      ? 'border-indigo-300 bg-indigo-50' 
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50'
                  } ${isFrozen ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
                      1
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-slate-900 text-sm">Generate Refinements</div>
                      <div className="text-xs text-slate-500">AI analyzes claims against patents</div>
                    </div>
                    {loadingPreview ? (
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Wand2 className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                    )}
                  </div>
                </button>

                {/* Arrow */}
                <div className="flex justify-center">
                  <ArrowRight className="w-4 h-4 text-slate-300 rotate-90" />
                </div>

                {/* Step 2 */}
                <button
                  onClick={handleApply}
                  disabled={applying || !preview || isFrozen}
                  className="w-full group"
                >
                  <div className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                    applying 
                      ? 'border-violet-300 bg-violet-50' 
                      : !preview 
                        ? 'border-slate-100 bg-slate-50 opacity-60' 
                        : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/50'
                  } ${isFrozen ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div className={`w-8 h-8 rounded-full text-sm font-semibold flex items-center justify-center flex-shrink-0 ${
                      preview ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-400'
                    }`}>
                      2
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-slate-900 text-sm">Apply Changes</div>
                      <div className="text-xs text-slate-500">Accept selected refinements</div>
                    </div>
                    {applying ? (
                      <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckCircle2 className={`w-5 h-5 transition-colors ${preview ? 'text-slate-400 group-hover:text-violet-600' : 'text-slate-300'}`} />
                    )}
                  </div>
                </button>

                {/* Arrow */}
                <div className="flex justify-center">
                  <ArrowRight className="w-4 h-4 text-slate-300 rotate-90" />
                </div>

                {/* Step 3 - Freeze/Unfreeze */}
                <button
                  onClick={isFrozen ? handleUnfreeze : handleFreeze}
                  disabled={freezing || unfreezing}
                  className="w-full group"
                >
                  <div className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                    isFrozen 
                      ? 'border-emerald-200 bg-emerald-50 hover:border-amber-300 hover:bg-amber-50' 
                      : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50'
                  }`}>
                    <div className={`w-8 h-8 rounded-full text-sm font-semibold flex items-center justify-center flex-shrink-0 ${
                      isFrozen ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}>
                      3
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-slate-900 text-sm">
                        {isFrozen ? 'Unlock Claims' : 'Finalize Claims'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {isFrozen ? 'Unlock to make more changes' : 'Lock and proceed to next stage'}
                      </div>
                    </div>
                    {(freezing || unfreezing) ? (
                      <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                    ) : isFrozen ? (
                      <Unlock className="w-5 h-5 text-amber-500 group-hover:text-amber-600 transition-colors" />
                    ) : (
                      <Lock className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Inputs Panel */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowInputsPanel(!showInputsPanel)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <h2 className="font-medium text-slate-900">Refinement Settings</h2>
                {showInputsPanel ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              
              {showInputsPanel && (
                <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                  {/* Source toggles */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={useAuto}
                        onChange={(e) => setUseAuto(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-700">Patent References</div>
                        <div className="text-xs text-slate-500">{priorArtOptions.length} selected</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={useManual}
                        onChange={(e) => setUseManual(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-700">Manual Notes</div>
                        <div className="text-xs text-slate-500">Custom guidance</div>
                      </div>
                    </label>
                  </div>

                  {priorArtOptions.length === 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                      <p className="text-xs text-amber-700">No patents selected. Go to Related Art stage to select patents for refinement.</p>
                    </div>
                  )}

                  {priorArtOptions.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">Selected Patents</span>
                        <button
                          onClick={() => setShowPatentReferences(!showPatentReferences)}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          {showPatentReferences ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      {showPatentReferences && (
                        <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-slate-50 rounded-lg">
                          {claimRefSelectedPatentsFromConfig.map((patent: any) => {
                            const patentId = patent?.patentNumber || patent?.pn || patent?.id || ''
                            const threat = patent?.noveltyThreat || resolveThreat(patent?.tags, patent?.noveltyThreat)
                            return (
                              <label key={patentId} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white cursor-pointer transition-colors">
                                <input
                                  type="checkbox"
                                  checked={selectedPatents.includes(patentId)}
                                  onChange={(e) => {
                                    setSelectedPatents((prev) => {
                                      if (e.target.checked) return [...prev, patentId]
                                      return prev.filter((x) => x !== patentId)
                                    })
                                  }}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-mono text-slate-600 truncate">{patentId}</div>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                  threat === 'anticipates' ? 'bg-red-100 text-red-700' :
                                  threat === 'obvious' ? 'bg-amber-100 text-amber-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {threat}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Additional Instructions */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showAdditionalInstructions}
                        onChange={(e) => setShowAdditionalInstructions(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      <span className="text-xs font-medium text-slate-600">Custom Instructions</span>
                    </label>
                    {showAdditionalInstructions && (
                      <textarea
                        className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        rows={3}
                        placeholder="E.g., Focus on mechanical aspects, exclude software claims..."
                        value={additionalInstructions}
                        onChange={(e) => setAdditionalInstructions(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
