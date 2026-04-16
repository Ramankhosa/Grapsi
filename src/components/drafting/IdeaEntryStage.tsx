'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Sparkles, 
  Lock, 
  Unlock, 
  ChevronDown, 
  ChevronRight,
  Edit2, 
  Check, 
  RefreshCw, 
  AlertCircle,
  FileText,
  Globe,
  Lightbulb,
  Scale
} from 'lucide-react'
import RichTextEditor, { ClaimsEditor, RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import KishoNormalizationLoader from '@/components/ui/kisho-normalization-loader'

interface IdeaEntryStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface Claim {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  text: string
  category?: 'method' | 'system' | 'apparatus' | 'composition' | 'product'
}

export default function IdeaEntryStage({ session, patent, onComplete, onRefresh }: IdeaEntryStageProps) {
  const [normalizedData, setNormalizedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNormalized, setShowNormalized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showInventionDetails, setShowInventionDetails] = useState(true)
  const [showClaimsDetails, setShowClaimsDetails] = useState(true)
  const [isNavigating, setIsNavigating] = useState(false)

  // Claims state
  const [claims, setClaims] = useState<Claim[]>([])
  const [claimsText, setClaimsText] = useState('')
  const [claimsFrozen, setClaimsFrozen] = useState(false)
  const [claimsFrozenAt, setClaimsFrozenAt] = useState<string | null>(null)
  const [isGeneratingClaims, setIsGeneratingClaims] = useState(false)
  const [showClaimsSection, setShowClaimsSection] = useState(true)
  const claimsEditorRef = useRef<RichTextEditorRef>(null)

  // Editable fields
  const [problem, setProblem] = useState('')
  const [objectives, setObjectives] = useState('')
  const [logic, setLogic] = useState('')
  const [bestMethod, setBestMethod] = useState('')
  const [components, setComponents] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [abstractText, setAbstractText] = useState('')
  const [cpcCodes, setCpcCodes] = useState<string[]>([])
  const [ipcCodes, setIpcCodes] = useState<string[]>([])
  const [useInitialClaimsForDraft, setUseInitialClaimsForDraft] = useState(false)
  const [skipPriorArtClicked, setSkipPriorArtClicked] = useState(false)
  const [regenerateInstructions, setRegenerateInstructions] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)

  // Use data from existing idea record
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const title = session?.ideaRecord?.title || ''
  
  // Jurisdiction info
  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const allJurisdictions = session?.draftingJurisdictions || [activeJurisdiction]
  const allowRefine = session?.ideaRecord?.allowRefine !== false // Default to true

  // Load normalized data and claims on component mount
  useEffect(() => {
    if (session?.ideaRecord?.normalizedData) {
      setNormalizedData({
        normalizedData: session.ideaRecord.normalizedData,
        extractedFields: {
          problem: session.ideaRecord.problem,
          objectives: session.ideaRecord.objectives,
          components: session.ideaRecord.components,
          logic: session.ideaRecord.logic,
          inputs: session.ideaRecord.inputs,
          outputs: session.ideaRecord.outputs,
          variants: session.ideaRecord.variants,
          bestMethod: session.ideaRecord.bestMethod,
          abstract: session.ideaRecord.abstract,
          cpcCodes: session.ideaRecord.cpcCodes,
          ipcCodes: session.ideaRecord.ipcCodes
        }
      })
      setShowNormalized(true)

      // Initialize editable state
      setProblem(session.ideaRecord.problem || '')
      setObjectives(session.ideaRecord.objectives || '')
      setLogic(session.ideaRecord.logic || '')
      setBestMethod(session.ideaRecord.bestMethod || '')
      setComponents(Array.isArray(session.ideaRecord.components) ? session.ideaRecord.components : [])
      setSearchQuery((session as any)?.ideaRecord?.searchQuery || '')
      setAbstractText(session.ideaRecord.abstract || '')
      setCpcCodes(Array.isArray(session.ideaRecord.cpcCodes) ? session.ideaRecord.cpcCodes : [])
      setIpcCodes(Array.isArray(session.ideaRecord.ipcCodes) ? session.ideaRecord.ipcCodes : [])
    }

    // Load claims data from normalizedData
    const normalizedData = (session?.ideaRecord?.normalizedData as any) || {}
    if (normalizedData.claims) {
      const savedClaims = normalizedData.claims
      if (Array.isArray(savedClaims)) {
        setClaims(savedClaims)
        // Convert structured claims to text for editor
        const claimsTextContent = savedClaims.map((c: Claim) => {
          const prefix = c.type === 'dependent' && c.dependsOn ? `(Claim ${c.dependsOn}) ` : ''
          return `${c.number}. ${prefix}${c.text}`
        }).join('\n\n')
        setClaimsText(claimsTextContent)
      } else if (typeof savedClaims === 'string') {
        setClaimsText(savedClaims)
      }
    }
    
    // Check if claims are frozen
    if (normalizedData.claimsApprovedAt) {
      setClaimsFrozen(true)
      setClaimsFrozenAt(normalizedData.claimsApprovedAt)
    }
  }, [session])

  // Reset draft saved state when claims content changes
  useEffect(() => {
    if (draftSaved) {
      setDraftSaved(false)
    }
  }, [claimsText])

  const strippedClaims = typeof claimsText === 'string' ? claimsText.replace(/<[^>]*>/g, '').trim() : ''
  const hasClaims = strippedClaims.length > 0 || claims.length > 0
  const canProceed = !!normalizedData && hasClaims

  // Generate claims using jurisdiction-aware rules
  const handleGenerateClaims = async () => {
    if (!session?.id) return
    
    try {
      setIsGeneratingClaims(true)
      setError(null)

      const response = await onComplete({
        action: 'generate_claims',
        sessionId: session.id,
        jurisdiction: activeJurisdiction,
        userInstructions: regenerateInstructions.trim() || undefined,
        ideaContext: {
          title,
          problem,
          objectives,
          logic,
          components,
          bestMethod,
          abstract: abstractText
        }
      })

      if (response?.claims) {
        if (Array.isArray(response.claims)) {
          setClaims(response.claims)
          // Format for display
          const formatted = response.claims.map((c: Claim) => {
            const depText = c.type === 'dependent' && c.dependsOn 
              ? `The ${c.category || 'invention'} of claim ${c.dependsOn}, wherein ` 
              : ''
            return `<p><strong>${c.number}.</strong> ${depText}${c.text}</p>`
          }).join('')
          setClaimsText(formatted)
        } else if (typeof response.claims === 'string') {
          setClaimsText(response.claims)
        }
      }

      await onRefresh()
      // Clear instructions after successful regeneration
      setRegenerateInstructions('')
    } catch (e) {
      console.error('Failed to generate claims:', e)
      setError('Failed to generate claims. Please try again.')
    } finally {
      setIsGeneratingClaims(false)
    }
  }

  // Save claims (without freezing)
  const handleSaveClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText

      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: claims.length > 0 ? claims : null
      })

      await onRefresh()
      setDraftSaved(true)
    } catch (e) {
      console.error('Failed to save claims:', e)
      setError('Failed to save claims.')
    }
  }

  // Freeze/approve claims
  const handleFreezeClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText

      if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
        setError('Please generate or enter claims before freezing.')
        return
      }

      await onComplete({
        action: 'freeze_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: claims.length > 0 ? claims : null,
        jurisdiction: activeJurisdiction
      })

      setClaimsFrozen(true)
      setClaimsFrozenAt(new Date().toISOString())
      await onRefresh()
    } catch (e) {
      console.error('Failed to freeze claims:', e)
      setError('Failed to freeze claims.')
    }
  }

  // Unfreeze claims for editing
  const handleUnfreezeClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      await onComplete({
        action: 'unfreeze_claims',
        sessionId: session.id
      })

      setClaimsFrozen(false)
      setClaimsFrozenAt(null)
      await onRefresh()
    } catch (e) {
      console.error('Failed to unfreeze claims:', e)
      setError('Failed to unfreeze claims.')
    }
  }

  const persistClaimsDraft = async () => {
    if (!session?.id) return
    const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
    if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
      throw new Error('Please add claims before continuing.')
    }
    await onComplete({
      action: 'save_claims',
      sessionId: session.id,
      claims: claimsContent,
      claimsStructured: claims.length > 0 ? claims : null
    })
  }

  const proceedToPriorArt = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) {
        await persistClaimsDraft()
      }
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'RELATED_ART'
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to proceed to prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to proceed to prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  const handleSkipClick = () => {
    setSkipPriorArtClicked(true)
  }

  const skipPriorArtAndFreeze = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) {
        await persistClaimsDraft()
      }
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER',
        skipPriorArt: true,
        useInitialClaimsForDrafting: useInitialClaimsForDraft
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to skip prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to skip prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* Header with Jurisdiction Badge */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Lightbulb className="w-6 h-6 text-indigo-600" />
              </div>
              Idea & Claims Review
            </h2>
            <p className="text-gray-500 mt-2">
              Review your invention structure and generate jurisdiction-aware patent claims.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Mode indicator */}
            <Badge variant={allowRefine ? 'default' : 'secondary'} className="flex items-center gap-1.5 px-3 py-1.5">
              {allowRefine ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Kisho Enhanced
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  Original Content
                </>
              )}
            </Badge>
            
            {/* Jurisdiction Badge */}
            <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-amber-200 text-amber-800">
              <Globe className="w-3.5 h-3.5" />
              {activeJurisdiction}
              {allJurisdictions.length > 1 && (
                <span className="text-xs opacity-70">+{allJurisdictions.length - 1}</span>
              )}
            </Badge>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(!showNormalized || !normalizedData) && (
        <KishoNormalizationLoader mode={allowRefine ? 'enhance' : 'preserve'} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left Column: Invention Details */}
        <div className="space-y-4">
          {/* Collapsible Original Input */}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <button 
              onClick={() => setShowOriginal(!showOriginal)} 
              className="w-full flex justify-between items-center px-5 py-3 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Original Input Reference</span>
              </div>
              {showOriginal ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
            <AnimatePresence>
              {showOriginal && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-5 border-t border-gray-100 bg-gray-50/30">
                    <div className="mb-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Title</span>
                      <p className="text-sm text-gray-900 font-medium">{title}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Description</span>
                      <div className="bg-white p-4 rounded border border-gray-200 text-sm text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                        {rawIdea}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* AI-Normalized Results (Collapsible) */}
          {showNormalized && normalizedData && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowInventionDetails(!showInventionDetails)}
                className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30 hover:bg-indigo-50/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Invention Structure
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {allowRefine ? 'AI Enhanced' : 'Parsed'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {!showInventionDetails && (
                    <span className="text-xs text-gray-500">Click to expand</span>
                  )}
                  {showInventionDetails ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              <AnimatePresence>
                {showInventionDetails && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {/* Toolbar */}
                    <div className="flex items-center justify-end px-6 py-2 border-b border-gray-100 bg-gray-50/50">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setIsEditing((v) => !v)}
                          className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isEditing ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100 bg-white border border-gray-200'}`}
                        >
                          {isEditing ? <><Check className="w-3 h-3 mr-1" /> Done</> : <><Edit2 className="w-3 h-3 mr-1" /> Edit</>}
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setError(null)
                              if (!session?.id) return
                              const currentRaw = session?.ideaRecord?.rawInput || rawIdea || ''
                              const currentTitle = session?.ideaRecord?.title || title || ''
                              if (!currentRaw || !currentTitle) {
                                setError('Cannot regenerate: missing title or description.')
                                return
                              }
                              setIsRegenerating(true)
                              setShowNormalized(false)
                              setNormalizedData(null)
                              await onComplete({
                                action: 'normalize_idea',
                                sessionId: session.id,
                                rawIdea: currentRaw,
                                title: currentTitle
                              })
                              await onRefresh()
                              setShowNormalized(true)
                            } catch (e) {
                              setError('Failed to regenerate AI output. Please try again.')
                            } finally {
                              setIsRegenerating(false)
                            }
                          }}
                          className="inline-flex items-center px-2 py-1.5 text-xs font-medium rounded-md text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
                          disabled={isRegenerating}
                          title="Regenerate AI Structure"
                        >
                          <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6 max-h-[600px] overflow-y-auto">
                      {/* Classification Codes */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">CPC Codes</label>
                          {isEditing ? (
                            <input
                              className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                              placeholder="e.g., H04L 29/08"
                              value={cpcCodes.join(', ')}
                              onChange={(e) => setCpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            />
                          ) : (
                            <div className="text-sm font-mono bg-gray-50 px-3 py-1.5 rounded border border-gray-100 text-gray-700">
                              {cpcCodes?.length ? cpcCodes.join(', ') : <span className="text-gray-400">None</span>}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">IPC Codes</label>
                          {isEditing ? (
                            <input
                              className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                              placeholder="e.g., G06F 17/30"
                              value={ipcCodes.join(', ')}
                              onChange={(e) => setIpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            />
                          ) : (
                            <div className="text-sm font-mono bg-gray-50 px-3 py-1.5 rounded border border-gray-100 text-gray-700">
                              {ipcCodes?.length ? ipcCodes.join(', ') : <span className="text-gray-400">None</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Problem Statement */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Problem Statement</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={3}
                            value={problem}
                            onChange={(e) => setProblem(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {problem || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Objectives */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Objectives</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={2}
                            value={objectives}
                            onChange={(e) => setObjectives(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {objectives || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Technical Logic */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Technical Logic</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={3}
                            value={logic}
                            onChange={(e) => setLogic(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {logic || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Key Components */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">
                          Key Components <span className="text-gray-400 font-normal text-xs">({components?.length || 0})</span>
                        </h4>
                        {components?.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {components.slice(0, 6).map((comp: any, idx: number) => (
                              <div key={idx} className="p-2 bg-gray-50 rounded border border-gray-100 text-xs">
                                <span className="font-medium text-gray-900">{comp.name}</span>
                                {comp.type && (
                                  <span className="text-gray-500 ml-1">({comp.type})</span>
                                )}
                              </div>
                            ))}
                            {components.length > 6 && (
                              <div className="p-2 text-xs text-gray-500">
                                +{components.length - 6} more...
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic">No components identified</p>
                        )}
                      </div>

                      {/* Best Method */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Best Method</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={2}
                            value={bestMethod}
                            onChange={(e) => setBestMethod(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {bestMethod || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Search Query */}
                      <div className="pt-4 border-t border-gray-100">
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Search Query</h4>
                        {isEditing ? (
                          <input
                            className="w-full text-sm font-mono bg-gray-50 border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm font-mono text-gray-600 bg-gray-50 p-3 rounded border border-gray-100">
                            {searchQuery || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Edit Actions Footer */}
                    {isEditing && (
                      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-end">
                        <Button
                          onClick={async () => {
                            try {
                              await onComplete({
                                action: 'update_idea_record',
                                sessionId: session?.id,
                                patch: {
                                  problem, objectives, logic, bestMethod, components,
                                  searchQuery, abstract: abstractText, cpcCodes, ipcCodes
                                }
                              })
                              setIsEditing(false)
                              onRefresh()
                            } catch (err) {
                              console.error('Failed to save edits:', err)
                              setError('Failed to save edits')
                            }
                          }}
                          size="sm"
                        >
                          Save Changes
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Right Column: Claims Section */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Claims Header */}
            <button
              onClick={() => setShowClaimsDetails(!showClaimsDetails)}
              className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Scale className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Initial Patent Claims
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {activeJurisdiction} Rules
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {!showClaimsDetails && (
                  <span className="text-xs text-gray-500">Click to expand</span>
                )}
                {showClaimsDetails ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            <AnimatePresence>
              {showClaimsDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {/* Claims Status Banner */}
                  {!claimsFrozen && (
                    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
                      <div className="flex items-center gap-2 text-sm text-amber-800">
                        <AlertCircle className="w-4 h-4" />
                        <span>Claims must be frozen before proceeding. They will be used throughout the drafting pipeline.</span>
                      </div>
                    </div>
                  )}

                  {claimsFrozen && claimsFrozenAt && (
                    <div className="px-6 py-3 bg-green-50 border-b border-green-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-800">
                          <Check className="w-4 h-4" />
                          <span>Claims frozen on {new Date(claimsFrozenAt).toLocaleDateString()}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleUnfreezeClaims}
                          className="text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                        >
                          <Unlock className="w-3 h-3 mr-1" />
                          Unfreeze to Edit
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Multi-Jurisdiction Notice */}
                  {allJurisdictions.length > 1 && (
                    <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
                      <div className="flex items-start gap-2 text-sm text-blue-800">
                        <Globe className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium">Multi-Jurisdiction Filing:</span>{' '}
                          <span>These reference claims are generated for initial review using {activeJurisdiction} rules. Jurisdiction-specific claims will be drafted one-by-one during the drafting stage.</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Claims Editor */}
                  <div className="p-6">
                    {!claimsText && !isGeneratingClaims ? (
                      <div className="text-center py-8">
                        <Scale className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-600 mb-4">No claims generated yet.</p>
                        <Button
                          onClick={handleGenerateClaims}
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                          disabled={!normalizedData}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Generate Claims for {activeJurisdiction}
                        </Button>
                        <p className="text-xs text-gray-500 mt-3">
                          Claims will be generated using {activeJurisdiction} patent office rules
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {isGeneratingClaims ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                              <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto mb-3" />
                              <p className="text-sm text-gray-600">Generating jurisdiction-aware claims...</p>
                              <p className="text-xs text-gray-500 mt-1">Applying {activeJurisdiction} rules</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <ClaimsEditor
                              ref={claimsEditorRef}
                              value={claimsText}
                              onChange={setClaimsText}
                              disabled={claimsFrozen}
                              placeholder="1. A method for... comprising:
   a) a first step of...
   b) a second step of...

2. The method of claim 1, wherein..."
                            />

                            {/* Action Buttons */}
                            <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={regenerateInstructions}
                                  onChange={(e) => setRegenerateInstructions(e.target.value)}
                                  placeholder="Enter instructions for claim regeneration (optional)"
                                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                  disabled={claimsFrozen || isGeneratingClaims}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleGenerateClaims}
                                  disabled={claimsFrozen || isGeneratingClaims}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                  Regenerate
                                </Button>
                              </div>

                              <div className="flex items-center gap-2">
                                {!claimsFrozen && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={handleSaveClaims}
                                      className={draftSaved ? "bg-green-50 border-green-200 text-green-700" : ""}
                                    >
                                      {draftSaved ? (
                                        <>
                                          <Check className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                                          Saved!
                                        </>
                                      ) : (
                                        "Save Draft"
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={handleFreezeClaims}
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                                      Freeze Initial Claims
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Why freeze claims?</h4>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Claims define the legal scope of your patent protection</li>
              <li>• Frozen claims will be used in Figure Planner for relevant diagrams</li>
              <li>• Prior Art analysis will compare patents against your specific claims</li>
              <li>• Final draft will use these exact claims (no regeneration)</li>
              <li>• Multi-jurisdiction support: claims transform to country-specific style</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-10 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4" />
            <span>
              {claimsFrozen ? 'Claims are frozen; you can still proceed or unfreeze to edit.' : 'Claims are provisional; you can continue to prior art or skip and freeze them as final.'}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {skipPriorArtClicked ? (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={useInitialClaimsForDraft}
                    onChange={(e) => setUseInitialClaimsForDraft(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Use Initial Claims for drafting
                </label>
                <Button
                  onClick={skipPriorArtAndFreeze}
                  disabled={!canProceed || isNavigating}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleSkipClick}
                  disabled={!canProceed || isNavigating}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Skip Prior Art Stage
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  onClick={proceedToPriorArt}
                  disabled={!canProceed || isNavigating}
                >
                  Next: Prior Art
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
