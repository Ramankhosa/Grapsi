'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Lightbulb,
  Search,
  Download,
  Star,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  FileText,
  Scale,
  AlertTriangle,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface ClosestPriorArt {
  publicationNumber: string
  title: string
  relevanceScore: number
  overlappingFeatures: string[]
  differentiatingFactors: string[]
  remark: string
}

interface NoveltySummary {
  patentsAnalyzed?: number
  closestPriorArt?: ClosestPriorArt[]
  priorArtSummary?: string
  phositaTest?: string
  reasoning?: string
  results?: Array<{
    publicationNumber?: string
    title: string
    snippet?: string
    assignee?: string
  }>
}

interface IdeaFrame {
  id: string
  title: string
  problem: string
  principle: string
  technicalEffect?: string
  status: string
  noveltyScore?: number
  userRating?: number
  data?: any
  noveltySummary?: NoveltySummary
}

interface FeedbackLoopResult {
  ideaId: string
  iteration: number
  originalNovelty: number
  finalNovelty: number
  improved: boolean
  mutationApplied?: string
}

interface FeedbackLoopResults {
  enabled: boolean
  iterations: FeedbackLoopResult[]
  lowNoveltyCount: number
  totalChecked: number
}

interface QualityMetrics {
  ideasWithInventiveLeap: number
  ideasWithAnalogy: number
  inventiveLeapRatio: number
  analogyRatio: number
}

interface IdeaFramePanelProps {
  ideas: IdeaFrame[]
  onSelectIdea: (idea: IdeaFrame) => void
  onCheckNovelty: (ideaId: string) => void
  onExport: (ideaIds: string[]) => void
  onClose: () => void
  onDeleteIdea?: (ideaId: string) => void  // NEW: Delete an idea
  feedbackLoopResults?: FeedbackLoopResults | null
  qualityMetrics?: QualityMetrics | null
}

// Helper functions defined outside component to avoid recreation
const getNoveltyColorStatic = (score?: number) => {
  if (score === undefined) return 'bg-slate-100 text-slate-600'
  if (score >= 70) return 'bg-green-100 text-green-700'
  if (score >= 40) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

const getStatusIconStatic = (status: string) => {
  switch (status) {
    case 'SHORTLISTED':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />
    case 'REJECTED':
      return <XCircle className="w-4 h-4 text-red-500" />
    case 'EXPORTED':
      return <ExternalLink className="w-4 h-4 text-blue-500" />
    default:
      return <Lightbulb className="w-4 h-4 text-purple-500" />
  }
}

// Fullscreen Modal - defined as a separate component to prevent re-creation on parent re-renders
interface FullscreenIdeaModalProps {
  idea: IdeaFrame
  onClose: () => void
  onCopy: (idea: IdeaFrame) => void
  copied: boolean
  onCheckNovelty: (ideaId: string) => void
  checkingNovelty: string | null
  onToggleExport: (ideaId: string) => void
  isSelectedForExport: boolean
}

function FullscreenIdeaModal({
  idea,
  onClose,
  onCopy,
  copied,
  onCheckNovelty,
  checkingNovelty,
  onToggleExport,
  isSelectedForExport,
}: FullscreenIdeaModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 md:p-6 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-violet-50 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {getStatusIconStatic(idea.status)}
                <h2 className="text-lg md:text-xl font-bold text-slate-900 line-clamp-2">
                  {idea.title}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {idea.noveltyScore !== undefined && (
                  <Badge className={`${getNoveltyColorStatic(idea.noveltyScore)} text-sm`}>
                    {idea.noveltyScore}% novel
                  </Badge>
                )}
                {idea.userRating && (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star
                        key={star}
                        className={`w-4 h-4 ${
                          star <= idea.userRating!
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy(idea)
                }}
                className="hidden md:flex"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </>
                )}
              </Button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
              >
                <Minimize2 className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Content - Scrollable */}
        <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 md:space-y-6">
          {/* Problem */}
          <div className="bg-slate-50 rounded-xl p-4">
            <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Problem Statement
            </label>
            <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
              {idea.problem}
            </p>
          </div>

          {/* Principle */}
          <div className="bg-slate-50 rounded-xl p-4">
            <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Core Principle
            </label>
            <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
              {idea.principle}
            </p>
          </div>

          {/* Technical Effect */}
          {idea.technicalEffect && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Technical Effect
              </label>
              <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
                {idea.technicalEffect}
              </p>
            </div>
          )}

          {/* Inventive Leap */}
          {idea.data?.inventiveLeap && (
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">
              <label className="text-xs md:text-sm font-semibold text-violet-600 uppercase tracking-wider">
                🚀 Inventive Leap
              </label>
              <p className="text-sm md:text-base text-violet-800 mt-2 leading-relaxed">
                {idea.data.inventiveLeap}
              </p>
            </div>
          )}

          {/* Why Not Obvious */}
          {idea.data?.whyNotObvious && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Why This Is Not Obvious
              </label>
              <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
                {idea.data.whyNotObvious}
              </p>
            </div>
          )}

          {/* Cross-Domain Analogy */}
          {idea.data?.analogySource && (
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl p-4 border border-cyan-200">
              <label className="text-xs md:text-sm font-semibold text-cyan-600 uppercase tracking-wider">
                🔗 Cross-Domain Analogy
              </label>
              <div className="mt-2">
                <span className="text-sm md:text-base font-medium text-cyan-800">
                  From: {idea.data.analogySource.domain}
                </span>
                <p className="text-sm md:text-base text-cyan-700 mt-1">
                  {idea.data.analogySource.concept}
                </p>
              </div>
            </div>
          )}

          {/* Contradiction Resolved */}
          {idea.data?.contradictionResolved && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Contradiction Resolved
              </label>
              <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
                {idea.data.contradictionResolved}
              </p>
            </div>
          )}

          {/* Resolution Strategy */}
          {idea.data?.resolutionStrategy && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                TRIZ Resolution Strategy
              </label>
              <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
                {idea.data.resolutionStrategy}
              </p>
            </div>
          )}

          {/* Second Order Effect */}
          {idea.data?.secondOrderEffect && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
              <label className="text-xs md:text-sm font-semibold text-amber-600 uppercase tracking-wider">
                ⚡ Second-Order Effect
              </label>
              <p className="text-sm md:text-base text-amber-800 mt-2 leading-relaxed">
                {idea.data.secondOrderEffect}
              </p>
            </div>
          )}

          {/* Components */}
          {idea.data?.components?.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Key Components
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {idea.data.components.map((comp: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs md:text-sm py-1 px-3">
                    {comp}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Variants */}
          {idea.data?.variants?.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Implementation Variants ({idea.data.variants.length})
              </label>
              <div className="mt-3 space-y-3">
                {idea.data.variants.map((v: any, i: number) => (
                  <div key={i} className="pl-4 border-l-4 border-violet-300 bg-white rounded-r-lg p-3">
                    <span className="font-semibold text-slate-800">{v.title}</span>
                    <p className="text-sm text-slate-600 mt-1">{v.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Claim Hooks */}
          {idea.data?.claimHooks?.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Patent Claim Hooks
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {idea.data.claimHooks.map((hook: string, i: number) => (
                  <Badge key={i} className="bg-purple-100 text-purple-700 text-xs md:text-sm py-1 px-3">
                    {hook}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Prior Art Analysis - Shows after novelty check */}
          {idea.noveltySummary && (
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl p-4 border border-cyan-200">
              <label className="text-xs md:text-sm font-semibold text-cyan-700 uppercase tracking-wider flex items-center gap-2">
                <Scale className="w-4 h-4" />
                Prior Art Analysis
              </label>
              
              {/* Summary */}
              {idea.noveltySummary.priorArtSummary && (
                <p className="text-sm text-slate-700 mt-3 leading-relaxed">
                  {idea.noveltySummary.priorArtSummary}
                </p>
              )}

              {/* Patents Analyzed Count */}
              {idea.noveltySummary.patentsAnalyzed !== undefined && idea.noveltySummary.patentsAnalyzed >= 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs text-cyan-600">
                  <FileText className="w-3.5 h-3.5" />
                  <span>{idea.noveltySummary.patentsAnalyzed} patents analyzed</span>
                </div>
              )}

              {/* Closest Prior Art */}
              {idea.noveltySummary.closestPriorArt && idea.noveltySummary.closestPriorArt.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold text-slate-600 mb-2">
                    Most Relevant Prior Art:
                  </div>
                  <div className="space-y-2">
                    {idea.noveltySummary.closestPriorArt.map((patent, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 border border-slate-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className="bg-slate-100 text-slate-700 text-[10px] font-mono">
                                {patent.publicationNumber || 'N/A'}
                              </Badge>
                              {patent.relevanceScore !== undefined && (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                  patent.relevanceScore >= 70 
                                    ? 'bg-red-100 text-red-700' 
                                    : patent.relevanceScore >= 40 
                                      ? 'bg-amber-100 text-amber-700' 
                                      : 'bg-green-100 text-green-700'
                                }`}>
                                  {patent.relevanceScore}% match
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-medium text-slate-800 mt-1 line-clamp-2">
                              {patent.title || 'Unknown Patent'}
                            </p>
                            {patent.remark && (
                              <p className="text-[11px] text-slate-500 mt-1 italic">
                                {patent.remark}
                              </p>
                            )}
                          </div>
                        </div>
                        {patent.differentiatingFactors && patent.differentiatingFactors.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {patent.differentiatingFactors.slice(0, 2).map((factor, j) => (
                              <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                                ✓ {factor}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Patents Searched */}
              {idea.noveltySummary.results && idea.noveltySummary.results.length > 0 && (
                <details className="mt-4">
                  <summary className="text-xs font-medium text-cyan-700 cursor-pointer hover:text-cyan-800">
                    View all {idea.noveltySummary.results.length} patents searched →
                  </summary>
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {idea.noveltySummary.results.map((r, i) => (
                      <div key={i} className="text-[11px] text-slate-600 py-1 border-b border-slate-100 last:border-0">
                        <span className="font-mono text-slate-500">{r.publicationNumber || 'N/A'}</span>
                        {' - '}
                        <span>{r.title}</span>
                        {r.assignee && <span className="text-slate-400"> ({r.assignee})</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* PHOSITA Test */}
              {idea.noveltySummary.phositaTest && (
                <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-amber-700">PHOSITA Assessment</div>
                      <p className="text-xs text-amber-800 mt-1">{idea.noveltySummary.phositaTest}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 md:p-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => onCheckNovelty(idea.id)}
            disabled={checkingNovelty === idea.id}
            className="flex-1"
          >
            {checkingNovelty === idea.id ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Checking Novelty...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Check Novelty
              </>
            )}
          </Button>
          <Button
            onClick={() => {
              onToggleExport(idea.id)
              onClose()
            }}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {isSelectedForExport ? 'Remove from Export' : 'Add to Export'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function IdeaFramePanel({
  ideas,
  onSelectIdea,
  onCheckNovelty,
  onExport,
  onClose,
  onDeleteIdea,
  feedbackLoopResults,
  qualityMetrics,
}: IdeaFramePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set())
  const [checkingNovelty, setCheckingNovelty] = useState<string | null>(null)
  const [fullscreenIdea, setFullscreenIdea] = useState<IdeaFrame | null>(null)
  const [copied, setCopied] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle escape key for fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenIdea) {
        setFullscreenIdea(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [fullscreenIdea])

  // Update fullscreenIdea when ideas prop changes (e.g., after novelty check)
  // This ensures the modal shows updated data like noveltySummary
  useEffect(() => {
    if (fullscreenIdea) {
      const updatedIdea = ideas.find(i => i.id === fullscreenIdea.id)
      if (updatedIdea) {
        // Check if novelty data was added/updated
        const hasNewNoveltyData = updatedIdea.noveltySummary && !fullscreenIdea.noveltySummary
        const noveltyScoreChanged = updatedIdea.noveltyScore !== fullscreenIdea.noveltyScore
        
        if (hasNewNoveltyData || noveltyScoreChanged) {
          setFullscreenIdea(updatedIdea)
        }
      }
    }
  }, [ideas]) // Only depend on ideas to avoid infinite loops

  const handleNoveltyCheck = async (ideaId: string) => {
    setCheckingNovelty(ideaId)
    await onCheckNovelty(ideaId)
    setCheckingNovelty(null)
  }

  const toggleExportSelection = (ideaId: string) => {
    setSelectedForExport(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else {
        next.add(ideaId)
      }
      return next
    })
  }

  const handleExport = () => {
    if (selectedForExport.size > 0) {
      onExport(Array.from(selectedForExport))
    }
  }

  const getNoveltyColor = (score?: number) => {
    if (score === undefined) return 'bg-slate-100 text-slate-600'
    if (score >= 70) return 'bg-green-100 text-green-700'
    if (score >= 40) return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SHORTLISTED':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'REJECTED':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'EXPORTED':
        return <ExternalLink className="w-4 h-4 text-blue-500" />
      default:
        return <Lightbulb className="w-4 h-4 text-purple-500" />
    }
  }

  // Copy to clipboard handler - moved outside modal to use local state
  const handleCopyToClipboard = async (idea: IdeaFrame) => {
    const text = `
Title: ${idea.title}

Problem: ${idea.problem}

Principle: ${idea.principle}

${idea.technicalEffect ? `Technical Effect: ${idea.technicalEffect}` : ''}

${idea.data?.inventiveLeap ? `Inventive Leap: ${idea.data.inventiveLeap}` : ''}

${idea.data?.whyNotObvious ? `Why Not Obvious: ${idea.data.whyNotObvious}` : ''}

${idea.data?.analogySource ? `Cross-Domain Analogy: ${idea.data.analogySource.domain} - ${idea.data.analogySource.concept}` : ''}

${idea.data?.contradictionResolved ? `Contradiction Resolved: ${idea.data.contradictionResolved}` : ''}

${idea.data?.claimHooks?.length > 0 ? `Claim Hooks: ${idea.data.claimHooks.join(', ')}` : ''}
    `.trim()

    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      {/* Fullscreen Modal */}
      <AnimatePresence>
        {fullscreenIdea && (
          <FullscreenIdeaModal
            idea={fullscreenIdea}
            onClose={() => setFullscreenIdea(null)}
            onCopy={handleCopyToClipboard}
            copied={copied}
            onCheckNovelty={handleNoveltyCheck}
            checkingNovelty={checkingNovelty}
            onToggleExport={toggleExportSelection}
            isSelectedForExport={selectedForExport.has(fullscreenIdea.id)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-3 md:p-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-violet-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-sm md:text-base">
              <Lightbulb className="w-4 h-4 text-purple-500" />
              Generated Ideas ({ideas.length})
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <p className="text-[10px] md:text-xs text-slate-500">
            Tap an idea to expand • Long press for fullscreen view
          </p>

          {/* Quality Metrics - Responsive Grid */}
          {qualityMetrics && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="bg-white/60 rounded-lg p-2">
                <div className="text-[9px] md:text-[10px] text-slate-500 uppercase">Inventive Leap</div>
                <div className="text-xs md:text-sm font-semibold text-violet-700">
                  {Math.round(qualityMetrics.inventiveLeapRatio * 100)}%
                </div>
              </div>
              <div className="bg-white/60 rounded-lg p-2">
                <div className="text-[9px] md:text-[10px] text-slate-500 uppercase">Cross-Domain</div>
                <div className="text-xs md:text-sm font-semibold text-cyan-700">
                  {Math.round(qualityMetrics.analogyRatio * 100)}%
                </div>
              </div>
            </div>
          )}

          {/* Feedback Loop Results */}
          {feedbackLoopResults && feedbackLoopResults.enabled && (
            <div className="mt-3 p-2 bg-white/60 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-[9px] md:text-[10px] text-slate-500 uppercase">Quality Check</span>
                {feedbackLoopResults.lowNoveltyCount > 0 ? (
                  <Badge className="bg-amber-100 text-amber-700 text-[8px] md:text-[9px]">
                    {feedbackLoopResults.lowNoveltyCount} flagged
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 text-[8px] md:text-[9px]">
                    All pass
                  </Badge>
                )}
              </div>
              <div className="text-[10px] md:text-xs text-slate-600 mt-1">
                {feedbackLoopResults.totalChecked} ideas auto-checked
              </div>
            </div>
          )}
        </div>

        {/* Ideas List */}
        <div className="flex-1 overflow-auto">
          {ideas.map((idea, index) => (
            <motion.div
              key={idea.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="border-b border-slate-100"
            >
              {/* Idea Header */}
              <div
                className={`p-3 md:p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                  selectedForExport.has(idea.id) ? 'bg-violet-50' : ''
                }`}
                onClick={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
                onDoubleClick={() => setFullscreenIdea(idea)}
              >
                <div className="flex items-start gap-2 md:gap-3">
                  {/* Selection Checkbox */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExportSelection(idea.id)
                    }}
                    className={`
                      flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5
                      transition-colors touch-manipulation
                      ${selectedForExport.has(idea.id)
                        ? 'bg-violet-500 border-violet-500'
                        : 'border-slate-300 hover:border-violet-400'
                      }
                    `}
                  >
                    {selectedForExport.has(idea.id) && (
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusIcon(idea.status)}
                      <h4 className="font-medium text-slate-900 text-xs md:text-sm line-clamp-1">
                        {idea.title}
                      </h4>
                    </div>
                    <p className="text-[10px] md:text-xs text-slate-500 line-clamp-2">
                      {idea.principle}
                    </p>

                    {/* Tags & Scores */}
                    <div className="flex flex-wrap items-center gap-1 md:gap-2 mt-2">
                      {idea.noveltyScore !== undefined && (
                        <Badge className={`${getNoveltyColor(idea.noveltyScore)} text-[9px] md:text-[10px] py-0.5`}>
                          {idea.noveltyScore}% novel
                        </Badge>
                      )}
                      {idea.userRating && (
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star
                              key={star}
                              className={`w-2.5 h-2.5 md:w-3 md:h-3 ${
                                star <= idea.userRating!
                                  ? 'text-yellow-400 fill-yellow-400'
                                  : 'text-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setFullscreenIdea(idea)
                      }}
                      className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
                      title="View fullscreen"
                    >
                      <Maximize2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />
                    </button>
                    {onDeleteIdea && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm('Delete this idea? This cannot be undone.')) {
                            onDeleteIdea(idea.id)
                          }
                        }}
                        className="p-1.5 hover:bg-red-100 rounded-md transition-colors group"
                        title="Delete idea"
                      >
                        <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400 group-hover:text-red-500" />
                      </button>
                    )}
                    <div className="hidden md:block">
                      {expandedId === idea.id ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Details (Desktop only, use fullscreen on mobile) */}
              <AnimatePresence>
                {expandedId === idea.id && !isMobile && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      {/* Problem */}
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Problem
                        </label>
                        <p className="text-sm text-slate-700 mt-1">
                          {idea.problem}
                        </p>
                      </div>

                      {/* Technical Effect */}
                      {idea.technicalEffect && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Technical Effect
                          </label>
                          <p className="text-sm text-slate-700 mt-1">
                            {idea.technicalEffect}
                          </p>
                        </div>
                      )}

                      {/* Additional Data */}
                      {idea.data && (
                        <>
                          {/* Inventive Leap */}
                          {idea.data.inventiveLeap && (
                            <div className="p-2 bg-violet-50 rounded-lg border border-violet-100">
                              <label className="text-xs font-semibold text-violet-600 uppercase tracking-wider">
                                Inventive Leap
                              </label>
                              <p className="text-sm text-violet-800 mt-1">
                                {idea.data.inventiveLeap}
                              </p>
                            </div>
                          )}

                          {/* Cross-Domain Analogy */}
                          {idea.data.analogySource && (
                            <div className="p-2 bg-cyan-50 rounded-lg border border-cyan-100">
                              <label className="text-xs font-semibold text-cyan-600 uppercase tracking-wider">
                                Cross-Domain Analogy
                              </label>
                              <div className="text-sm text-cyan-800 mt-1">
                                <span className="font-medium">{idea.data.analogySource.domain}:</span>{' '}
                                {idea.data.analogySource.concept}
                              </div>
                            </div>
                          )}

                          {/* Claim Hooks */}
                          {idea.data.claimHooks?.length > 0 && (
                            <div>
                              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                Claim Hooks
                              </label>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {idea.data.claimHooks.slice(0, 5).map((hook: string, i: number) => (
                                  <Badge key={i} className="bg-purple-100 text-purple-700 text-[10px]">
                                    {hook}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* Prior Art Summary (Compact) */}
                      {idea.noveltySummary && (
                        <div className="p-3 bg-cyan-50 rounded-lg border border-cyan-200">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-cyan-700 uppercase tracking-wider flex items-center gap-1">
                              <Scale className="w-3 h-3" />
                              Prior Art Analysis
                            </label>
                            {idea.noveltySummary.patentsAnalyzed !== undefined && (
                              <span className="text-[10px] text-cyan-600">
                                {idea.noveltySummary.patentsAnalyzed} patents
                              </span>
                            )}
                          </div>
                          {idea.noveltySummary.priorArtSummary && (
                            <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                              {idea.noveltySummary.priorArtSummary}
                            </p>
                          )}
                          {idea.noveltySummary.closestPriorArt && idea.noveltySummary.closestPriorArt.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {idea.noveltySummary.closestPriorArt.slice(0, 2).map((p, i) => (
                                <Badge key={i} className="bg-white text-cyan-700 text-[9px] font-mono border border-cyan-200">
                                  {p.publicationNumber || 'N/A'}
                                </Badge>
                              ))}
                              {idea.noveltySummary.closestPriorArt.length > 2 && (
                                <span className="text-[9px] text-cyan-500">+{idea.noveltySummary.closestPriorArt.length - 2} more</span>
                              )}
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setFullscreenIdea(idea)
                            }}
                            className="text-[10px] text-cyan-600 hover:text-cyan-800 mt-2 underline"
                          >
                            View full analysis →
                          </button>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleNoveltyCheck(idea.id)
                          }}
                          disabled={checkingNovelty === idea.id}
                          className="text-xs"
                        >
                          {checkingNovelty === idea.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3 mr-1" />
                              Check Novelty
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setFullscreenIdea(idea)
                          }}
                          className="text-xs"
                        >
                          <Maximize2 className="w-3 h-3 mr-1" />
                          Full View
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mobile: Auto-expand on tap goes to fullscreen */}
              {expandedId === idea.id && isMobile && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-3 pb-3 space-y-2"
                >
                  {/* Show novelty summary indicator on mobile */}
                  {idea.noveltySummary && (
                    <div className="p-2 bg-cyan-50 rounded-lg border border-cyan-200 text-xs">
                      <div className="flex items-center gap-2 text-cyan-700">
                        <Scale className="w-3 h-3" />
                        <span className="font-medium">Prior Art Analyzed</span>
                        {idea.noveltySummary.patentsAnalyzed !== undefined && (
                          <span className="text-cyan-600">({idea.noveltySummary.patentsAnalyzed} patents)</span>
                        )}
                      </div>
                      {idea.noveltySummary.closestPriorArt && idea.noveltySummary.closestPriorArt.length > 0 && (
                        <div className="mt-1 text-[10px] text-slate-500">
                          {idea.noveltySummary.closestPriorArt.length} relevant patents found
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFullscreenIdea(idea)}
                    className="w-full text-xs"
                  >
                    <Maximize2 className="w-3 h-3 mr-1" />
                    View Full Details
                  </Button>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Export Footer */}
        <div className="p-3 md:p-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] md:text-xs text-slate-500">
              {selectedForExport.size} selected for export
            </span>
            {selectedForExport.size > 0 && (
              <button
                onClick={() => setSelectedForExport(new Set())}
                className="text-[10px] md:text-xs text-violet-600 hover:text-violet-800"
              >
                Clear selection
              </button>
            )}
          </div>
          <Button
            onClick={handleExport}
            disabled={selectedForExport.size === 0}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg text-xs md:text-sm"
          >
            <Download className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2" />
            Export to Idea Bank ({selectedForExport.size})
          </Button>
        </div>
      </div>
    </>
  )
}
