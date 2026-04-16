'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import BackendActivityPanel from './BackendActivityPanel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import plantumlEncoder from 'plantuml-encoder'
import SectionInstructionPopover from './SectionInstructionPopover'
import AllInstructionsModal from './AllInstructionsModal'
import WritingSamplesModal from './WritingSamplesModal'
import PersonaManager, { type PersonaSelection } from './PersonaManager'
// REMOVED: InlineSectionValidator - validation now handled by AI Review only
import type { ValidationIssue as UnifiedValidationIssue } from '@/types/validation'

// ============================================================================
// AI Review Issue Type
// ============================================================================

interface AIReviewIssue {
  id: string
  sectionKey: string
  sectionLabel: string
  type: 'error' | 'warning' | 'suggestion'
  category: 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity' | 'translation'
  title: string
  description: string
  suggestion: string
  fixPrompt: string
  relatedSections?: string[]
  severity: number
}

interface ValidationIssue {
  sectionKey: string
  type: 'error' | 'warning' | 'info'
  rule: string
  message: string
  actual?: number
  limit?: number
}

// ============================================================================
// Inline Diff View Component - Shows changes between original and revised text
// ============================================================================

function InlineDiffView({ original, revised }: { original: string; revised: string }) {
  // Simple word-level diff for highlighting changes
  const computeDiff = useMemo(() => {
    try {
      if (!original && !revised) return []
      if (!original) return [{ type: 'add' as const, text: revised }]
      if (!revised) return [{ type: 'remove' as const, text: original }]
      
      // Performance safeguard: for very long content, skip detailed diff
      const MAX_CHARS_FOR_DIFF = 30000
      if (original.length > MAX_CHARS_FOR_DIFF || revised.length > MAX_CHARS_FOR_DIFF) {
        return [{ 
          type: 'same' as const, 
          text: '⚠️ Content too long for detailed diff view. Please compare the Original and Revised panels above.' 
        }]
      }
      
      // If content is identical, show message
      if (original === revised) {
        return [{ type: 'same' as const, text: '(No changes - content is identical)' }]
      }
      
      // Split into words while preserving whitespace
      const originalWords = original.split(/(\s+)/)
      const revisedWords = revised.split(/(\s+)/)

      // Additional safeguard: limit word count for diff algorithm
      // Since split(/(\s+)/) creates ~2x elements (words + whitespace), use higher limit
      const MAX_ELEMENTS = 4000  // Allow up to ~2000 actual words
      if (originalWords.length > MAX_ELEMENTS || revisedWords.length > MAX_ELEMENTS) {
        return [{ 
          type: 'same' as const, 
          text: `⚠️ Content too complex for detailed diff (${originalWords.length} elements). Please compare the Original and Revised panels above.` 
        }]
      }
      
      const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
      
      // Simple LCS-based diff algorithm
      const lcs = (a: string[], b: string[]): number[][] => {
        const m = a.length, n = b.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
        
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
              dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
            }
          }
        }
        return dp
      }
      
      // Iterative backtrack to avoid stack overflow on large inputs
      const backtrackIterative = (dp: number[][], a: string[], b: string[]): void => {
        let i = a.length
        let j = b.length
        const stack: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
        
        while (i > 0 || j > 0) {
          if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            stack.push({ type: 'same', text: a[i - 1] })
            i--
            j--
          } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'add', text: b[j - 1] })
            j--
          } else if (i > 0) {
            stack.push({ type: 'remove', text: a[i - 1] })
            i--
          }
        }
        
        // Reverse to get correct order
        while (stack.length > 0) {
          result.push(stack.pop()!)
        }
      }
      
      const dp = lcs(originalWords, revisedWords)
      backtrackIterative(dp, originalWords, revisedWords)
      
      // Merge consecutive same-type segments
      const merged: typeof result = []
      for (const segment of result) {
        if (merged.length > 0 && merged[merged.length - 1].type === segment.type) {
          merged[merged.length - 1].text += segment.text
        } else {
          merged.push({ ...segment })
        }
      }
      
      return merged
    } catch (error) {
      console.error('Diff computation failed:', error)
      // Fallback: show revised content without diff highlighting
      return [{ type: 'same' as const, text: '⚠️ Could not compute diff. Showing revised content in the panel above.' }]
    }
  }, [original, revised])
  
  if (computeDiff.length === 0) {
    return <span className="text-gray-400 italic">No changes detected</span>
  }
  
  return (
    <div className="text-sm leading-relaxed">
      {computeDiff.map((segment, idx) => {
        if (segment.type === 'same') {
          return <span key={idx} className="text-gray-700">{segment.text}</span>
        } else if (segment.type === 'add') {
          return (
            <span 
              key={idx} 
              className="bg-emerald-200 text-emerald-900 px-0.5 rounded"
              title="Added"
            >
              {segment.text}
            </span>
          )
        } else {
          return (
            <span 
              key={idx} 
              className="bg-red-200 text-red-900 line-through px-0.5 rounded"
              title="Removed"
            >
              {segment.text}
            </span>
          )
        }
      })}
    </div>
  )
}

// ============================================================================
// Comprehensive Validation Panel Component
// ============================================================================

interface ValidationPanelProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
  onFix: (sectionKey: string, fixedContent: string) => void
  onProceedToExport: () => void
  /** Callback to sync AI issues to inline section validators */
  onAIIssuesChange?: (issues: AIReviewIssue[]) => void
}

function ValidationPanel({ 
  sessionId, 
  jurisdiction, 
  patentId, 
  draft, 
  onFix,
  onProceedToExport,
  onAIIssuesChange 
}: ValidationPanelProps) {
  // ============================================================================
  // Celebration Messages - Shown when user achieves 100 score
  // Varies by day of week and time of day to avoid repetition
  // ============================================================================
  const CELEBRATION_MESSAGES = [
    // Morning messages (6am - 12pm)
    { time: 'morning', day: 0, emoji: '☕', title: "Perfect Score!", message: "Time for that coffee! You've earned every sip. ☕✨" },
    { time: 'morning', day: 1, emoji: '🌅', title: "Flawless!", message: "Monday morning perfection! Now go flex to your colleagues. 💪" },
    { time: 'morning', day: 2, emoji: '🥐', title: "100% Achieved!", message: "Croissant break? This patent is chef's kiss! 👨‍🍳" },
    { time: 'morning', day: 3, emoji: '🚀', title: "Mission Complete!", message: "Midweek magic! Houston, we have a perfect patent. 🌟" },
    
    // Afternoon messages (12pm - 6pm)
    { time: 'afternoon', day: 0, emoji: '🍕', title: "Nailed It!", message: "Pizza party time! This draft is 100% delicious. 🎉" },
    { time: 'afternoon', day: 1, emoji: '🎯', title: "Bullseye!", message: "Target acquired and destroyed! Go grab an ice cream. 🍦" },
    { time: 'afternoon', day: 4, emoji: '🏆', title: "Champion!", message: "Thursday thunder! You're officially a patent superhero. 🦸" },
    { time: 'afternoon', day: 5, emoji: '🎸', title: "Rock Star!", message: "Friday vibes! Drop the mic and start the weekend early. 🎤" },
    
    // Evening messages (6pm - 10pm)
    { time: 'evening', day: 2, emoji: '🌙', title: "Perfect!", message: "Evening excellence! Netflix & celebrate? You deserve it. 📺" },
    { time: 'evening', day: 3, emoji: '🍷', title: "Masterpiece!", message: "Pour yourself something nice. This draft is *chef's kiss*. 🤌" },
    { time: 'evening', day: 6, emoji: '🎮', title: "Victory!", message: "Weekend warrior! Time to game - you've conquered patents! 🕹️" },
    
    // Late night messages (10pm - 6am)
    { time: 'night', day: 4, emoji: '🦉', title: "Night Owl Win!", message: "Burning the midnight oil paid off! Now get some sleep, genius. 😴" },
    { time: 'night', day: 5, emoji: '⭐', title: "Stellar!", message: "Late night legends get perfect scores. Sweet dreams! 🌠" },
  ]

  // Get celebration message based on current day and time
  const getCelebrationMessage = useCallback(() => {
    const now = new Date()
    const hour = now.getHours()
    const day = now.getDay() // 0 = Sunday, 6 = Saturday
    
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
    if (hour >= 6 && hour < 12) timeOfDay = 'morning'
    else if (hour >= 12 && hour < 18) timeOfDay = 'afternoon'
    else if (hour >= 18 && hour < 22) timeOfDay = 'evening'
    else timeOfDay = 'night'
    
    // Find message matching time and day, or fallback to time match
    let msg = CELEBRATION_MESSAGES.find(m => m.time === timeOfDay && m.day === day)
    if (!msg) msg = CELEBRATION_MESSAGES.find(m => m.time === timeOfDay)
    if (!msg) msg = CELEBRATION_MESSAGES[0] // Ultimate fallback

    return msg
  }, [])

  // Numerical validation state
  const [numericIssues, setNumericIssues] = useState<ValidationIssue[]>([])
  const [numericLoading, setNumericLoading] = useState(false)
  
  // AI Review state
  const [aiIssues, setAiIssues] = useState<AIReviewIssue[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSummary, setAiSummary] = useState<{
    totalIssues: number
    errors: number
    warnings: number
    suggestions: number
    overallScore: number
    recommendation: string
  } | null>(null)
  
  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationMessage, setCelebrationMessage] = useState(getCelebrationMessage())
  const prevScoreRef = useRef<number | null>(null)
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  
  // Fix state
  const [fixingIssue, setFixingIssue] = useState<string | null>(null)
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set())
  
  // Fix preview state - shows diff before applying
  const [pendingFix, setPendingFix] = useState<{
    issue: AIReviewIssue
    sectionKey: string
    originalContent: string
    fixedContent: string
  } | null>(null)
  
  // Last review timestamps
  const [lastNumericCheck, setLastNumericCheck] = useState<string | null>(null)
  const [lastAICheck, setLastAICheck] = useState<string | null>(null)
  
  // Category filter state - filter issues by type or category
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warning' | 'suggestion'>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // Load existing reviews on mount/jurisdiction change
  useEffect(() => {
    const loadExistingReviews = async () => {
      if (!sessionId || !jurisdiction || !patentId) return
      setLoadingExisting(true)
      try {
        const res = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'get_ai_reviews',
            sessionId,
            jurisdiction
          })
        })
        const data = await res.json()
        if (data.success && data.latest?.[jurisdiction.toUpperCase()]) {
          const latestReview = data.latest[jurisdiction.toUpperCase()]
          const issues = latestReview.issues || []
          // Restore review state
          setAiIssues(issues)
          setAiSummary(latestReview.summary || null)
          setCurrentReviewId(latestReview.id)
          setLastAICheck(new Date(latestReview.reviewedAt).toLocaleTimeString())
          // Restore ignored and applied fixes
          const ignored = new Set<string>(
            Array.isArray(latestReview.ignoredIssues) ? latestReview.ignoredIssues : []
          )
          setIgnoredIssues(ignored)
          const applied = new Set<string>(
            Array.isArray(latestReview.appliedFixes) 
              ? latestReview.appliedFixes.map((f: any) => f.issueId)
              : []
          )
          setAppliedFixes(applied)
          // Sync AI issues to inline section validators
          onAIIssuesChange?.(issues)
        }
      } catch (err) {
        console.error('Failed to load existing reviews:', err)
      } finally {
        setLoadingExisting(false)
      }
    }

    loadExistingReviews()
  }, [sessionId, jurisdiction, patentId, onAIIssuesChange])

  // Run numerical validation
  const runNumericValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setNumericLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setNumericIssues(data.issues)
        setLastNumericCheck(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Numeric validation error:', err)
    } finally {
      setNumericLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Track if AI review is a Pro feature (for UI display)
  const [aiReviewUpgradeRequired, setAiReviewUpgradeRequired] = useState(false)

  // Run AI review
  const runAIReview = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setAiLoading(true)
    setAiReviewUpgradeRequired(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'run_ai_review',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.success) {
        const issues = data.issues || []
        setAiIssues(issues)
        setAiSummary(data.summary || null)
        setCurrentReviewId(data.reviewId || null)
        setLastAICheck(new Date().toLocaleTimeString())
        // Reset ignored/applied for new review
        setIgnoredIssues(new Set())
        setAppliedFixes(new Set())
        // Sync AI issues to inline section validators
        onAIIssuesChange?.(issues)
      } else if (data.upgradeRequired) {
        // Pro feature - show upgrade message
        setAiReviewUpgradeRequired(true)
        setAiSummary({
          overallScore: 75, // Minimum baseline score
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          recommendation: 'AI Review is a Pro feature. Upgrade your plan to access AI-powered patent review with comprehensive analysis of claims consistency, diagram alignment, and legal compliance.'
        })
      } else {
        alert(`AI Review failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('AI review error:', err)
      alert('Failed to run AI review. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft, onAIIssuesChange])

  // Generate fix preview for an AI issue (shows diff before applying)
  const generateFixPreview = useCallback(async (issue: AIReviewIssue) => {
    if (!sessionId || !jurisdiction || !patentId) return
    setFixingIssue(issue.id)
    try {
      // Get related content if needed
      const relatedContent: Record<string, string> = {}
      if (issue.relatedSections) {
        for (const key of issue.relatedSections) {
          if (draft[key]) relatedContent[key] = draft[key]
        }
      }

      const originalContent = draft[issue.sectionKey] || ''

      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'apply_ai_fix',
          sessionId,
          jurisdiction,
          sectionKey: issue.sectionKey,
          issue,
          currentContent: originalContent,
          relatedContent,
          previewOnly: true // Signal that we want preview, not direct apply
        })
      })
      const data = await res.json()
      if (data.success && data.fixedContent) {
        // Show the diff preview instead of applying immediately
        setPendingFix({
          issue,
          sectionKey: issue.sectionKey,
          originalContent,
          fixedContent: data.fixedContent
        })
      } else if (data.upgradeRequired) {
        alert('AI Fix is a Pro feature. Please upgrade your plan to apply AI-suggested fixes automatically.')
      } else {
        alert(`Failed to generate fix: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Generate fix preview error:', err)
      alert('Failed to generate fix preview. Please try again.')
    } finally {
      setFixingIssue(null)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Approve and apply the pending fix
  const approveFix = useCallback(() => {
    if (!pendingFix) return
    
    const { issue, sectionKey, fixedContent } = pendingFix
    
    // Apply the fix
    onFix(sectionKey, fixedContent)
    
    // Track the applied fix locally
    setAppliedFixes(prev => new Set([...Array.from(prev), issue.id]))
    
    // Remove the fixed issue from the list and recalculate score
    // Note: onAIIssuesChange is called via useEffect below to avoid render-phase setState
    setAiIssues(prev => {
      const remaining = prev.filter(i => i.id !== issue.id)
      
      // Recalculate score based on remaining issues
      // Score formula: Base 75 + (25 points distributed by issue reduction)
      const BASE_SCORE = 75
      const REMAINING_POINTS = 25
      const errors = remaining.filter(i => i.type === 'error').length
      const warnings = remaining.filter(i => i.type === 'warning').length  
      const suggestions = remaining.filter(i => i.type === 'suggestion').length
      
      let newScore = 100
      if (errors > 0 || warnings > 0 || suggestions > 0) {
        const errorDeduction = Math.min(REMAINING_POINTS * 0.70, errors * 4)
        const warningDeduction = Math.min(REMAINING_POINTS * 0.20, warnings * 1.25)
        const suggestionDeduction = Math.min(REMAINING_POINTS * 0.10, suggestions * 0.5)
        newScore = Math.round(BASE_SCORE + (REMAINING_POINTS - errorDeduction - warningDeduction - suggestionDeduction))
        newScore = Math.max(BASE_SCORE, Math.min(100, newScore))
      }
      
      // Update summary with new counts and score
      setAiSummary(prevSummary => prevSummary ? {
        ...prevSummary,
        totalIssues: remaining.length,
        errors,
        warnings,
        suggestions,
        overallScore: newScore,
        recommendation: remaining.length === 0 
          ? 'All issues resolved! Draft is ready for export.'
          : `${remaining.length} issue${remaining.length !== 1 ? 's' : ''} remaining. Keep fixing to reach 100.`
      } : null)
      
      return remaining
    })
    
    // Clear the pending fix
    setPendingFix(null)
  }, [pendingFix, onFix])

  // Reject the pending fix
  const rejectFix = useCallback(() => {
    setPendingFix(null)
  }, [])

  // Ignore an issue (persists to backend)
  const ignoreIssue = useCallback(async (issueId: string) => {
    // Update local state immediately
    setIgnoredIssues(prev => new Set(Array.from(prev).concat(issueId)))
    
    // Persist to backend
    try {
      await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'ignore_ai_issue',
          sessionId,
          jurisdiction,
          issueId,
          reviewId: currentReviewId
        })
      })
    } catch (err) {
      console.error('Failed to persist ignored issue:', err)
      // Local state already updated, so user experience is smooth
    }
  }, [sessionId, jurisdiction, patentId, currentReviewId])

  // REMOVED: Auto-run numeric validation - now handled by AI Review only
  // Deterministic validation was causing delays and excessive refreshes

  // Sync AI issues to parent when they change (avoids render-phase setState)
  // This handles cases like approveFix where issues are filtered
  const aiIssuesRef = useRef(aiIssues)
  const aiIssuesSignatureRef = useRef<string>(JSON.stringify(aiIssues))
  useEffect(() => {
    // Only sync if the issue set truly changed (not just reference or same length)
    const signature = JSON.stringify(
      aiIssues.map(i => ({
        id: i.id,
        type: i.type,
        category: i.category,
        sectionKey: i.sectionKey,
        title: i.title,
        description: i.description
      }))
    )
    if (signature !== aiIssuesSignatureRef.current) {
      onAIIssuesChange?.(aiIssues)
      aiIssuesSignatureRef.current = signature
    }
    aiIssuesRef.current = aiIssues
  }, [aiIssues, onAIIssuesChange])

  // Trigger celebration when score reaches 100
  useEffect(() => {
    const currentScore = aiSummary?.overallScore ?? null
    // Only celebrate if score just became 100 (wasn't 100 before)
    if (currentScore === 100 && prevScoreRef.current !== 100) {
      setCelebrationMessage(getCelebrationMessage())
      setShowCelebration(true)
      // Auto-hide after 8 seconds
      const timer = setTimeout(() => setShowCelebration(false), 8000)
      return () => clearTimeout(timer)
    }
    prevScoreRef.current = currentScore
  }, [aiSummary?.overallScore, getCelebrationMessage])

  // Calculate counts
  const numericErrorCount = numericIssues.filter(i => i.type === 'error').length
  const numericWarningCount = numericIssues.filter(i => i.type === 'warning').length
  const allActiveAiIssues = aiIssues.filter(i => !ignoredIssues.has(i.id) && !appliedFixes.has(i.id))
  const aiErrorCount = allActiveAiIssues.filter(i => i.type === 'error').length
  const aiWarningCount = allActiveAiIssues.filter(i => i.type === 'warning').length
  const aiSuggestionCount = allActiveAiIssues.filter(i => i.type === 'suggestion').length
  const fixedCount = appliedFixes.size
  const totalErrors = numericErrorCount + aiErrorCount
  const totalWarnings = numericWarningCount + aiWarningCount
  
  // Apply filters to AI issues
  const activeAiIssues = allActiveAiIssues.filter(i => {
    if (filterType !== 'all' && i.type !== filterType) return false
    if (filterCategory !== 'all' && i.category !== filterCategory) return false
    return true
  })
  
  // Get unique categories for filter dropdown
  const uniqueCategories = Array.from(new Set(allActiveAiIssues.map(i => i.category)))
  
  // Group issues by category for organized display
  const issuesByCategory = activeAiIssues.reduce((acc, issue) => {
    if (!acc[issue.category]) acc[issue.category] = []
    acc[issue.category].push(issue)
    return acc
  }, {} as Record<string, typeof activeAiIssues>)

  const figureIssueGuidance = useMemo(() => {
    const figureCodePattern = /\bfig(?:\.|ure)?\.?\s*(\d{1,3})\b/i
    const plantumlPattern = /plantuml|@startuml|@enduml/i

    const flagged = allActiveAiIssues.find(issue => {
      if (issue.category !== 'diagram') return false
      const combined = `${issue.title} ${issue.description} ${issue.suggestion} ${issue.fixPrompt}`
      return figureCodePattern.test(combined) || plantumlPattern.test(combined)
    })

    if (!flagged) return null

    const match = figureCodePattern.exec(`${flagged.title} ${flagged.description} ${flagged.suggestion} ${flagged.fixPrompt}`)
    return {
      figureLabel: match ? match[0].replace(/\s+/g, ' ').toUpperCase() : null
    }
  }, [allActiveAiIssues])

  // Category icons and colors
  const getCategoryStyle = (category: string) => {
    switch (category) {
      case 'consistency': return { icon: '🔗', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' }
      case 'diagram': return { icon: '📊', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' }
      case 'completeness': return { icon: '📋', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' }
      case 'legal': return { icon: '⚖️', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
      case 'clarity': return { icon: '💡', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' }
      case 'translation': return { icon: '🌐', bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' }
      default: return { icon: '📝', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' }
    }
  }

  return (
    <div className="space-y-6">
      {/* Unified Intelligence Dashboard */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden">
        {/* Top Bar - Title & Score */}
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
              <span className="text-xl">🔬</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Draft Intelligence</h3>
              <p className="text-slate-400 text-xs">{jurisdiction} • Patent Quality Analysis</p>
            </div>
          </div>
          
          {/* Score Ring */}
          <div className="flex items-center gap-4">
            {aiSummary ? (
              <div className="relative">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-700" />
                  <circle 
                    cx="18" cy="18" r="15" fill="none" strokeWidth="2" strokeLinecap="round"
                    stroke={aiSummary.overallScore >= 90 ? '#10b981' : aiSummary.overallScore >= 80 ? '#f59e0b' : '#ef4444'}
                    strokeDasharray={`${aiSummary.overallScore * 0.94} 100`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-lg font-bold ${
                    aiSummary.overallScore >= 90 ? 'text-emerald-400' :
                    aiSummary.overallScore >= 80 ? 'text-amber-400' : 'text-red-400'
                  }`}>{aiSummary.overallScore}</span>
                </div>
              </div>
            ) : (
              <div className="text-center px-4 py-2 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="text-slate-500 text-xs">Run AI Review</div>
                <div className="text-slate-400 text-xs">for score</div>
              </div>
            )}
          </div>
        </div>

        {/* AI Summary - if available */}
        {aiSummary?.recommendation && (
          <div className="px-6 py-3 bg-slate-800/30 border-b border-slate-700/50">
            <div className="flex items-start gap-2">
              <span className="text-violet-400 mt-0.5">💡</span>
              <p className="text-sm text-slate-300 leading-relaxed">{aiSummary.recommendation}</p>
            </div>
          </div>
        )}

        {/* Stats Grid - Clickable Filters */}
        <div className="p-4">
          <div className="grid grid-cols-5 gap-3">
            <button
              onClick={() => setFilterType(filterType === 'error' ? 'all' : 'error')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'error' 
                  ? 'bg-red-500/20 ring-2 ring-red-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-red-400">{totalErrors}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Errors</div>
              {filterType === 'error' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
            </button>
            
            <button
              onClick={() => setFilterType(filterType === 'warning' ? 'all' : 'warning')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'warning' 
                  ? 'bg-amber-500/20 ring-2 ring-amber-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-amber-400">{totalWarnings}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Warnings</div>
              {filterType === 'warning' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />}
            </button>
            
            <button
              onClick={() => setFilterType(filterType === 'suggestion' ? 'all' : 'suggestion')}
              className={`group relative rounded-xl p-3 text-center transition-all ${
                filterType === 'suggestion' 
                  ? 'bg-blue-500/20 ring-2 ring-blue-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-2xl font-bold text-blue-400">{aiSuggestionCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Suggestions</div>
              {filterType === 'suggestion' && <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
            </button>
            
            <div className="rounded-xl p-3 text-center bg-slate-800/50">
              <div className="text-2xl font-bold text-emerald-400">{fixedCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Fixed</div>
            </div>
            
            <div className="rounded-xl p-3 text-center bg-slate-800/50">
              <div className="text-2xl font-bold text-slate-500">{ignoredIssues.size}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Ignored</div>
            </div>
          </div>
          
          {/* Filter Indicator */}
          {filterType !== 'all' && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs">
              <span className="text-slate-500">Showing</span>
              <span className={`font-medium px-2 py-0.5 rounded ${
                filterType === 'error' ? 'bg-red-500/20 text-red-400' :
                filterType === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>{activeAiIssues.length} {filterType}s</span>
              <button onClick={() => setFilterType('all')} className="text-slate-500 hover:text-white">✕</button>
            </div>
          )}
        </div>

        {/* Category Breakdown - Mini Pills */}
        {uniqueCategories.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5 justify-center">
            {uniqueCategories.map(cat => {
              const style = getCategoryStyle(cat)
              const count = allActiveAiIssues.filter(i => i.category === cat).length
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                    filterCategory === cat
                      ? `${style.bg} ${style.text} ring-1 ${style.border}`
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  <span>{style.icon}</span>
                  <span className="capitalize">{cat}</span>
                  <span className="opacity-60">({count})</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Action Bar */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            onClick={runNumericValidation}
            disabled={numericLoading}
            className="flex-1 px-3 py-2.5 bg-slate-700/50 text-white rounded-lg font-medium hover:bg-slate-600/50 disabled:opacity-50 flex items-center justify-center gap-2 text-sm border border-slate-600/50 transition-all"
          >
            {numericLoading ? (
              <><span className="animate-spin">⏳</span> Checking...</>
            ) : (
              <><span>📏</span> Numeric Check</>
            )}
          </button>
          
          <button
            onClick={runAIReview}
            disabled={aiLoading}
            className="flex-1 px-3 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg font-medium hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-lg transition-all"
          >
            {aiLoading ? (
              <><span className="animate-spin">⏳</span> Analyzing...</>
            ) : (
              <><span>🤖</span> AI Review</>
            )}
          </button>

          <button
            onClick={onProceedToExport}
            className={`flex-1 px-3 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 text-sm transition-all ${
              totalErrors > 0 
                ? 'bg-amber-600/80 hover:bg-amber-500 text-white' 
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg'
            }`}
          >
            <span>📄</span>
            {totalErrors > 0 ? 'Export Anyway' : 'Export'}
            <span>→</span>
          </button>
        </div>

        {/* Status Footer */}
        <div className="px-4 pb-3 flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-700/30 pt-2">
          <div className="flex items-center gap-3">
            {loadingExisting && <span className="text-cyan-400 animate-pulse">● Loading review...</span>}
            {lastNumericCheck && <span>📏 {lastNumericCheck}</span>}
            {lastAICheck && <span>🤖 {lastAICheck}</span>}
          </div>
          {currentReviewId && <span className="font-mono text-slate-600">ID: {currentReviewId.slice(0, 8)}</span>}
        </div>
      </div>

      {/* Numeric Validation Results */}
      {numericIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <span>📏</span> Numeric Validation
              <span className="text-xs font-normal text-gray-500 ml-2">
                Word limits, character counts, claim numbers
              </span>
            </h4>
          </div>
          <div className="divide-y divide-gray-100">
            {numericIssues.map((issue, idx) => (
              <div 
                key={idx} 
                className={`px-6 py-4 flex items-start gap-4 ${
                  issue.type === 'error' ? 'bg-red-50/50' : 
                  issue.type === 'warning' ? 'bg-amber-50/50' : 'bg-blue-50/50'
                }`}
              >
                <div className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 capitalize">{issue.sectionKey}</div>
                  <div className="text-sm text-gray-600">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-gray-500 mt-1">
                      Current: <strong>{issue.actual}</strong> | Limit: <strong>{issue.limit}</strong>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Preview Modal - Shows diff before applying */}
      {pendingFix && (
        <div 
          className="bg-white rounded-xl border-2 border-emerald-300 shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-300"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fix-preview-title"
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') rejectFix() }}
        >
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200">
            <div className="flex items-center justify-between">
              <div>
                <h4 id="fix-preview-title" className="font-semibold text-gray-900 flex items-center gap-2">
                  <span>🔍</span> Review Proposed Changes
                </h4>
                <p className="text-sm text-gray-600 mt-1">
                  Section: <strong>{pendingFix.issue.sectionLabel}</strong> • Issue: {pendingFix.issue.title}
                </p>
              </div>
              <button
                onClick={rejectFix}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                title="Close preview (Esc)"
                aria-label="Close preview"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Issue being fixed */}
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <div className="text-xs font-medium text-amber-700 mb-1">💡 Issue Being Fixed</div>
              <p className="text-sm text-amber-800">{pendingFix.issue.description}</p>
            </div>
            
            {/* Inline diff - highlight changes - MAIN VIEW */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-600 px-2 py-0.5 bg-violet-100 rounded">CHANGES HIGHLIGHTED</span>
                <span className="text-xs text-gray-500">Added text in green, removed in red • ~300 words visible</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-5 min-h-[400px] max-h-[500px] overflow-y-auto shadow-inner">
                <div className="text-sm leading-relaxed">
                  <InlineDiffView original={pendingFix.originalContent} revised={pendingFix.fixedContent} />
                </div>
              </div>
            </div>
            
            {/* Side-by-side diff view - Collapsible */}
            <details className="group">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 flex items-center gap-2 py-2">
                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                View side-by-side comparison (Original vs Revised)
              </summary>
              <div className="grid grid-cols-2 gap-4 mt-3">
                {/* Original Content */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-red-600 px-2 py-0.5 bg-red-100 rounded">ORIGINAL</span>
                    <span className="text-xs text-gray-500">Before fix</span>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 min-h-[300px] max-h-[450px] overflow-y-auto">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {pendingFix.originalContent || <span className="text-gray-400 italic">No content</span>}
                    </pre>
                  </div>
                </div>
                
                {/* Fixed Content */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-600 px-2 py-0.5 bg-emerald-100 rounded">REVISED</span>
                    <span className="text-xs text-gray-500">After fix</span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 min-h-[300px] max-h-[450px] overflow-y-auto">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {pendingFix.fixedContent || <span className="text-gray-400 italic">No content</span>}
                    </pre>
                  </div>
                </div>
              </div>
            </details>
          </div>
          
          {/* Action buttons */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Review the changes carefully before applying. This will update the draft section.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={rejectFix}
                className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-2"
              >
                <span>✕</span> Reject
              </button>
              <button
                onClick={approveFix}
                className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 flex items-center gap-2 shadow-sm"
              >
                <span>✓</span> Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {figureIssueGuidance && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-blue-900 mb-4">
          <span className="text-lg">🎨</span>
          <div className="space-y-1">
            <div className="font-semibold text-blue-900">
              Figure flagged{figureIssueGuidance.figureLabel ? ` (${figureIssueGuidance.figureLabel})` : ''}
            </div>
            <p className="text-blue-800">
              Go to the Figures section and ask Kisho to update the diagram, using these review remarks as the input so the figure aligns with the draft.
            </p>
          </div>
        </div>
      )}

      {/* AI Review Issues List */}
      {allActiveAiIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h4 className="font-medium text-gray-700 text-sm flex items-center gap-2">
              📋 Issues List
              <span className="text-xs font-normal text-gray-400">
                {activeAiIssues.length} of {allActiveAiIssues.length} shown
              </span>
            </h4>
            {(filterType !== 'all' || filterCategory !== 'all') && (
              <button 
                onClick={() => { setFilterType('all'); setFilterCategory('all') }}
                className="text-xs text-violet-600 hover:text-violet-700"
              >
                Clear all filters
              </button>
            )}
          </div>
          
          <div className="divide-y divide-gray-100">
            {activeAiIssues.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <div className="text-4xl mb-2">🔍</div>
                <div className="text-gray-600 font-medium">No {filterType !== 'all' ? filterType + 's' : 'issues'} to show</div>
                <button
                  onClick={() => { setFilterType('all'); setFilterCategory('all') }}
                  className="text-sm text-violet-600 hover:text-violet-700 mt-2"
                >
                  Clear filters
                </button>
              </div>
            ) : activeAiIssues.map((issue) => {
              const style = getCategoryStyle(issue.category)
              const isFixing = fixingIssue === issue.id
              
              return (
                <div key={issue.id} className={`px-6 py-5 ${style.bg}`}>
                  <div className="flex items-start gap-4">
                    {/* Severity indicator */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-2xl">{style.icon}</span>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <div 
                            key={n}
                            className={`w-1.5 h-1.5 rounded-full ${
                              n <= issue.severity 
                                ? issue.type === 'error' ? 'bg-red-500' 
                                  : issue.type === 'warning' ? 'bg-amber-500' 
                                  : 'bg-blue-500'
                                : 'bg-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Issue content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                          {issue.category}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          issue.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' :
                          issue.type === 'warning' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                          'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {issue.type}
                        </span>
                        <span className="text-xs text-gray-500">
                          Section: <strong>{issue.sectionLabel}</strong>
                        </span>
                      </div>
                      
                      <h5 className="font-semibold text-gray-900 mb-1">{issue.title}</h5>
                      <p className="text-sm text-gray-700 mb-2">{issue.description}</p>
                      
                      <div className="bg-white/80 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs font-medium text-gray-500 mb-1">💡 Suggestion</div>
                        <p className="text-sm text-gray-700">{issue.suggestion}</p>
                      </div>

                      {issue.relatedSections && issue.relatedSections.length > 0 && (
                        <div className="text-xs text-gray-500 mt-2">
                          Related sections: {issue.relatedSections.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => generateFixPreview(issue)}
                        disabled={isFixing || pendingFix !== null}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                      >
                        {isFixing ? (
                          <><span className="animate-spin">⏳</span> Generating...</>
                        ) : (
                          <><span>🔧</span> Preview Fix</>
                        )}
                      </button>
                      <button
                        onClick={() => ignoreIssue(issue.id)}
                        className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-2 whitespace-nowrap"
                      >
                        <span>🚫</span> Ignore
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Clear State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && (lastNumericCheck || lastAICheck) && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-8 text-center">
          <div className="text-5xl mb-4">✨</div>
          <h4 className="text-xl font-semibold text-emerald-800 mb-2">All Clear!</h4>
          <p className="text-emerald-700">
            No issues found. Your draft is ready for export.
          </p>
          <button
            onClick={onProceedToExport}
            className="mt-6 px-8 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 shadow-lg inline-flex items-center gap-2"
          >
            <span>📄</span> Export Draft <span>→</span>
          </button>
        </div>
      )}

      {/* Initial State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && !lastNumericCheck && !lastAICheck && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h4 className="text-lg font-semibold text-gray-700 mb-2">Ready to Review</h4>
          <p className="text-gray-600 text-sm mb-4">
            Run validation checks to ensure your draft meets all requirements.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={runNumericValidation}
              disabled={numericLoading}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
            >
              📏 Numeric Checks
            </button>
            <button
              onClick={runAIReview}
              disabled={aiLoading}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 flex items-center gap-2 text-sm"
            >
              🤖 AI Review
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* 🎉 CELEBRATION OVERLAY - Shows when user achieves 100 score */}
      {/* ================================================================== */}
      {showCelebration && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ 
            background: 'radial-gradient(ellipse at center, rgba(16, 185, 129, 0.1) 0%, transparent 70%)'
          }}
        >
          {/* Confetti particles animation */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(50)].map((_, i) => (
              <div
                key={i}
                className="absolute animate-confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `-20px`,
                  width: `${8 + Math.random() * 8}px`,
                  height: `${8 + Math.random() * 8}px`,
                  background: ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6'][Math.floor(Math.random() * 6)],
                  borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                }}
              />
            ))}
          </div>

          {/* Celebration Card */}
          <div 
            className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 rounded-3xl shadow-2xl p-8 max-w-md mx-4 transform animate-celebrate-bounce pointer-events-auto"
            onClick={() => setShowCelebration(false)}
          >
            {/* Glow effect */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/20 to-transparent" />
            
            {/* Star burst background */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <div className="text-[200px] animate-spin-slow">✦</div>
            </div>
            
            {/* Content */}
            <div className="relative text-center">
              {/* Trophy/Emoji */}
              <div className="text-7xl mb-4 animate-bounce">
                {celebrationMessage.emoji}
              </div>
              
              {/* Score badge */}
              <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur rounded-full px-4 py-1 mb-4">
                <span className="text-white/80 text-sm font-medium">Score</span>
                <span className="text-2xl font-bold text-white">100</span>
                <span className="text-yellow-300">⭐</span>
              </div>
              
              {/* Title */}
              <h2 className="text-3xl font-bold text-white mb-2 drop-shadow-lg">
                {celebrationMessage.title}
              </h2>
              
              {/* Message */}
              <p className="text-lg text-white/90 mb-6 leading-relaxed">
                {celebrationMessage.message}
              </p>
              
              {/* Dismiss hint */}
              <div className="text-white/60 text-xs">
                Click anywhere to dismiss • Auto-hides in 8 seconds
              </div>
            </div>
            
            {/* Decorative corner elements */}
            <div className="absolute top-4 left-4 text-2xl opacity-60">🎊</div>
            <div className="absolute top-4 right-4 text-2xl opacity-60">🎉</div>
            <div className="absolute bottom-4 left-4 text-2xl opacity-60">✨</div>
            <div className="absolute bottom-4 right-4 text-2xl opacity-60">🌟</div>
          </div>
        </div>
      )}

      {/* Celebration CSS Animations */}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes celebrate-bounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-confetti {
          animation: confetti-fall linear forwards;
        }
        .animate-celebrate-bounce {
          animation: celebrate-bounce 2s ease-in-out infinite;
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
      `}</style>
    </div>
  )
}

// ============================================================================
// Simple Validation Report (Legacy - kept for backwards compatibility)
// ============================================================================

interface ValidationReportProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
}

function ValidationReport({ sessionId, jurisdiction, patentId, draft }: ValidationReportProps) {
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const runValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setIssues(data.issues)
        setLastChecked(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Validation error:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  useEffect(() => {
    if (Object.keys(draft).length > 0) {
      runValidation()
    }
  }, [jurisdiction])

  const errorCount = issues.filter(i => i.type === 'error').length
  const warningCount = issues.filter(i => i.type === 'warning').length

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900">Validation Report</h4>
        <button
          onClick={runValidation}
          disabled={loading}
          className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          {loading ? (
            <>
              <span className="animate-spin">⏳</span> Checking...
            </>
          ) : (
            <>
              🔍 Run Validation
            </>
          )}
        </button>
      </div>

      {lastChecked && (
        <div className="text-xs text-gray-500 mb-4">Last checked: {lastChecked}</div>
      )}

      {/* Summary */}
      <div className="flex gap-4 mb-4">
        <div className={`px-3 py-2 rounded-lg text-sm ${errorCount > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
          {errorCount} Error{errorCount !== 1 ? 's' : ''}
        </div>
        <div className={`px-3 py-2 rounded-lg text-sm ${warningCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
          {warningCount} Warning{warningCount !== 1 ? 's' : ''}
        </div>
        {errorCount === 0 && warningCount === 0 && issues.length === 0 && (
          <div className="px-3 py-2 rounded-lg text-sm bg-emerald-50 text-emerald-700">
            ✅ No issues found
          </div>
        )}
      </div>

      {/* Issues List */}
      {issues.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {issues.map((issue, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg text-sm ${
                issue.type === 'error'
                  ? 'bg-red-50 border border-red-100'
                  : issue.type === 'warning'
                    ? 'bg-amber-50 border border-amber-100'
                    : 'bg-blue-50 border border-blue-100'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <div>
                  <div className="font-medium capitalize">{issue.sectionKey}</div>
                  <div className="text-gray-700">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-gray-500 mt-1">
                      Current: {issue.actual} | Limit: {issue.limit}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Export Button Component
// ============================================================================

interface ExportButtonProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  disabled?: boolean
}

function ExportButton({ sessionId, jurisdiction, patentId, disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'docx' | 'pdf'>('docx')
  const [showSuccess, setShowSuccess] = useState(false)

  const handleExport = async () => {
    if (!sessionId || !jurisdiction || !patentId) {
      alert('Missing required information for export. Please ensure you have a valid session and jurisdiction.')
      return
    }
    
    // Check for unsupported format
    if (exportFormat === 'pdf') {
      alert('📋 PDF export is coming soon!\n\nPlease use MS Word (.docx) format for now.')
      return
    }
    
    setExporting(true)
    setShowSuccess(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'export_docx',
          sessionId,
          jurisdiction,
          format: exportFormat
        })
      })

      if (!res.ok) {
        let errorMsg = 'Unknown error'
        try {
          const error = await res.json()
          errorMsg = error.error || error.message || errorMsg
        } catch {
          errorMsg = `Server error (${res.status})`
        }
        alert(`❌ Export failed: ${errorMsg}`)
        return
      }

      // Check content type to ensure we got a file
      const contentType = res.headers.get('content-type')
      if (!contentType?.includes('application/vnd.openxmlformats')) {
        // Might be an error response
        const errorText = await res.text()
        alert(`❌ Export failed: Invalid response format. ${errorText.substring(0, 100)}`)
        return
      }

      // Download the file
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `patent_draft_${jurisdiction}_${new Date().toISOString().split('T')[0]}.docx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      // Show success feedback
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch (err) {
      console.error('Export error:', err)
      alert(`❌ Export failed: ${err instanceof Error ? err.message : 'Network error'}. Please check your connection and try again.`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <select
        value={exportFormat}
        onChange={(e) => setExportFormat(e.target.value as 'docx' | 'pdf')}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      >
        <option value="docx">MS Word (.docx)</option>
        <option value="pdf">PDF (coming soon)</option>
      </select>
      
      <button
        onClick={handleExport}
        disabled={disabled || exporting}
        className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 shadow-lg transition-all ${
          showSuccess 
            ? 'bg-emerald-500 text-white' 
            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60'
        }`}
      >
        {exporting ? (
          <>
            <span className="animate-spin">⏳</span>
            Exporting...
          </>
        ) : showSuccess ? (
          <>
            <span>✅</span>
            Downloaded!
          </>
        ) : (
          <>
            <span>📄</span>
            Export {jurisdiction} Draft
          </>
        )}
      </button>
    </div>
  )
}

type SectionConfig = {
  keys: string[]
  label: string
  description?: string
  constraints?: string[]
  required?: boolean
}

interface AnnexureDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface CountryOption {
  code: string
  label: string
  description: string
  languages: string[]
}

const displayName: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  fieldOfInvention: 'Field of Invention',
  crossReference: 'Cross-Reference to Related Applications',
  background: 'Background',
  objectsOfInvention: 'Objects of the Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals',
  // PCT/JP specific
  technicalProblem: 'Technical Problem',
  technicalSolution: 'Technical Solution',
  advantageousEffects: 'Advantageous Effects'
}

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract' },
  { keys: ['fieldOfInvention'], label: 'Technical Field' },
  { keys: ['background'], label: 'Background' },
  { keys: ['summary', 'briefDescriptionOfDrawings'], label: 'Summary + Brief Description' },
  { keys: ['detailedDescription', 'bestMethod'], label: 'Detailed Description + Best Mode' },
  { keys: ['industrialApplicability'], label: 'Industrial Applicability' },
  { keys: ['claims', 'listOfNumerals'], label: 'Claims + List of Reference Numerals' }
]

export default function AnnexureDraftStage({ session, patent, onComplete, onRefresh }: AnnexureDraftStageProps) {
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [debugSteps, setDebugSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [usePersonaStyle, setUsePersonaStyle] = useState<boolean>(false) // OFF by default
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null)
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({})
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({})
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({})
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({})
  const [autoMode, setAutoMode] = useState<boolean>(false)
  const [autoModeRunning, setAutoModeRunning] = useState<boolean>(false)
  const [autoModeProgress, setAutoModeProgress] = useState<{ current: number; total: number; currentSection: string } | null>(null)
  // Ref for immediate cancellation check (state updates are async, refs are sync)
  const autoModeCancelledRef = useRef<boolean>(false)
  const [activeJurisdiction, setActiveJurisdiction] = useState<string>(() => (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN'))
  const [sourceOfTruth, setSourceOfTruth] = useState<string>(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
      : ['IN']
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    if (preferred && list.includes(preferred)) return preferred
    const active = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    if (active && list.includes(active)) return active
    return list[0] || 'IN'
  })
  const [languageByCode, setLanguageByCode] = useState<Record<string, string>>({})
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [availableCountriesError, setAvailableCountriesError] = useState<string | null>(null)
  const [selectedAddCode, setSelectedAddCode] = useState<string>('')
  const [addingJurisdiction, setAddingJurisdiction] = useState<boolean>(false)
  const [deletingJurisdiction, setDeletingJurisdiction] = useState<string | null>(null)
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null)
  const [profileLoading, setProfileLoading] = useState<boolean>(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState<boolean>(false)
  
  // Activity Panel Visibility
  const [showActivity, setShowActivity] = useState(true)
  
  // Prompt injection info (used internally, debug panel removed)
  const [promptInjectionInfo, setPromptInjectionInfo] = useState<Record<string, { B: boolean; T: boolean; U: boolean; source: string | null; key: string; strategy: string }>>({})

  // Text Formatting
  const [showFormatting, setShowFormatting] = useState(false)
  const [fontFamily, setFontFamily] = useState('serif')
  const [fontSize, setFontSize] = useState('15px')
  
  // User Instructions
  const [userInstructions, setUserInstructions] = useState<Record<string, Record<string, any>>>({}) // { jurisdiction: { sectionKey: instruction } }
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null)
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false)
  const [lineHeight, setLineHeight] = useState('1.7')

  // Help panel state
  const [showHelpPanel, setShowHelpPanel] = useState(false)

  // Confirmation modal state for clear/delete actions
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean
    type: 'clear' | 'delete'
    jurisdiction: string
    inputValue: string
  }>({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })

  // Inline Section Validation - AI Review issues only (deterministic validation removed)
  const [inlineValidationIssues, setInlineValidationIssues] = useState<Record<string, UnifiedValidationIssue[]>>({})

  // Handle AI Review issues sync to inline validators
  const handleAIIssuesChange = useCallback((aiIssues: AIReviewIssue[]) => {
    // Convert AI Review issues to ValidationIssue format and group by section
    const issuesBySection: Record<string, UnifiedValidationIssue[]> = {}
    
    for (const issue of aiIssues) {
      const sectionKey = issue.sectionKey
      if (!issuesBySection[sectionKey]) {
        issuesBySection[sectionKey] = []
      }
      
      // Map AI issue type to validation severity
      const severityMap: Record<string, 'error' | 'warning' | 'notice'> = {
        'error': 'error',
        'warning': 'warning',
        'suggestion': 'notice'
      }
      
      // Convert to ValidationIssue format
      // Store original fixPrompt in metadata for API compatibility
      const validationIssue: UnifiedValidationIssue = {
        id: issue.id,
        sectionId: issue.sectionKey,
        severity: severityMap[issue.type] || 'notice',
        code: `ai_${issue.category}_${issue.id.substring(0, 8)}`,
        message: `${issue.title}${issue.description ? ': ' + issue.description : ''}`,
        suggestedFix: issue.suggestion || issue.fixPrompt || '',
        category: issue.category as UnifiedValidationIssue['category'],
        relatedSections: issue.relatedSections,
        isFixed: false,
        isIgnored: false,
        // Store original AI issue properties needed for API fix
        metadata: {
          fixPrompt: issue.fixPrompt,
          sectionKey: issue.sectionKey,
          sectionLabel: issue.sectionLabel,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
          originalType: issue.type,
          originalSeverity: issue.severity
        }
      }
      
      issuesBySection[sectionKey].push(validationIssue)
    }
    
    // Update inline validation issues (merge with existing, replacing AI issues)
    setInlineValidationIssues(prev => {
      const updated: Record<string, UnifiedValidationIssue[]> = {}
      
      // Collect all unique section keys
      const prevKeys = Object.keys(prev)
      const newKeys = Object.keys(issuesBySection)
      const allSectionKeys: string[] = []
      const seenKeys: Record<string, boolean> = {}
      
      for (const key of prevKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      for (const key of newKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      
      // For each section, keep non-AI issues and add new AI issues
      for (const sectionKey of allSectionKeys) {
        const existingIssues = prev[sectionKey] || []
        const newAIIssues = issuesBySection[sectionKey] || []
        
        // Filter out old AI issues (they start with 'ai-' or have code starting with 'ai_')
        const nonAIIssues = existingIssues.filter(issue => 
          !issue.id.startsWith('ai-') && !issue.code.startsWith('ai_')
        )
        
        // Combine non-AI issues with new AI issues
        updated[sectionKey] = [...nonAIIssues, ...newAIIssues]
      }
      
      return updated
    })
  }, [])

  // REMOVED: validateSection function - deterministic validation now handled by AI Review only
  // This reduces delays and prevents excessive API calls

  // Data for figures - use frozen sequence if available (includes both diagrams and sketches)
  const figurePlans = useMemo(() => Array.isArray(session?.figurePlans) ? session.figurePlans : [], [session?.figurePlans])
  const diagramSources = useMemo(() => Array.isArray(session?.diagramSources) ? session.diagramSources : [], [session?.diagramSources])
  const sketchRecords = useMemo(() => Array.isArray(session?.sketchRecords) ? session.sketchRecords.filter((s: any) => s.status === 'SUCCESS') : [], [session?.sketchRecords])
  const figureSequence = useMemo(() => Array.isArray((session as any)?.figureSequence) ? (session as any).figureSequence : [], [session])
  const figureSequenceFinalized = (session as any)?.figureSequenceFinalized || false

  // Get preferred language for figures based on current jurisdiction
  const preferredFigureLanguage = useMemo(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const status = (session as any)?.jurisdictionDraftStatus || {}
    
    // Check language mode
    const languageMode = status.__languageMode
    if (languageMode === 'individual_english_figures') {
      // In this mode, figures are always in English
      return 'en'
    }
    
    // Check for jurisdiction-specific language
    const jurisdictionLang = languageByCode[code] || status[code]?.language
    if (jurisdictionLang) return jurisdictionLang
    
    // Check for common language
    if (status.__figuresLanguage) return status.__figuresLanguage
    if (status.__commonLanguage) return status.__commonLanguage
    
    return 'en' // Default fallback
  }, [activeJurisdiction, languageByCode, session])

  // Helper to find the best diagram source for a figureNo based on language preference
  // Priority: 1) Exact language match, 2) English fallback
  const findBestDiagramSource = useCallback((figureNo: number): any => {
    // First try to find diagram in preferred language
    let source = diagramSources.find((d: any) => 
      d.figureNo === figureNo && d.language === preferredFigureLanguage
    )
    
    // Fallback to English if no translation exists
    if (!source) {
      source = diagramSources.find((d: any) => 
        d.figureNo === figureNo && (!d.language || d.language === 'en')
      )
    }
    
    // Ultimate fallback - any diagram with this figureNo
    if (!source) {
      source = diagramSources.find((d: any) => d.figureNo === figureNo)
    }
    
    return source
  }, [diagramSources, preferredFigureLanguage])

  // Build unified figures list using frozen sequence (matches export logic)
  // Returns { figures, hasAppended, missingCount } for warning computation
  // Now uses language-aware diagram selection based on active jurisdiction
  const figuresData = useMemo(() => {
    const buildSketchImageUrl = (sketch: any): string | null => {
      const raw = typeof sketch?.imagePath === 'string'
        ? sketch.imagePath
        : typeof sketch?.imageUrl === 'string'
          ? sketch.imageUrl
          : null

      if (raw && (raw.startsWith('/api/') || raw.startsWith('http://') || raw.startsWith('https://'))) {
        return raw
      }

      const projectId = patent?.project?.id
      const patentId = patent?.id

      const filename = (typeof sketch?.imageFilename === 'string' && sketch.imageFilename.trim())
        ? sketch.imageFilename.trim()
        : (() => {
            const candidate = typeof raw === 'string' ? raw : ''
            const noQuery = candidate.split('?')[0]?.split('#')[0] || ''
            const normalized = noQuery.replace(/\\/g, '/')
            const last = normalized.split('/').pop()
            return last && last.trim() ? last.trim() : null
          })()

      if (filename && projectId && patentId) {
        return `/api/projects/${projectId}/patents/${patentId}/upload?filename=${encodeURIComponent(filename)}`
      }

      return raw
    }

    const figures: Array<{
      figureNo: number
      title: string
      type: 'diagram' | 'sketch'
      imageUrl: string | null
      sourceId: string
      isNew?: boolean
      displayLanguage?: string // Track which language version is displayed
    }> = []
    let hasAppended = false
    let missingCount = 0

    if (figureSequenceFinalized && figureSequence.length > 0) {
      // Use the finalized figure sequence (includes both diagrams and sketches in user-defined order)
      const sequencedSourceIds = new Set(figureSequence.map((s: any) => s.sourceId))
      
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = figurePlans.find((f: any) => f.id === seqItem.sourceId)
          // Use language-aware diagram source selection
          const source = plan ? findBestDiagramSource(plan.figureNo) : null
          if (plan) {
            let imgUrl: string | null = null
            if (source?.imageFilename) {
              imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
            } else if (source?.plantuml) {
              try {
                const encoded = plantumlEncoder.encode(source.plantuml)
                imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
              } catch (e) {
                console.error('Failed to encode plantuml', e)
              }
            }
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: plan.title || `Figure ${seqItem.finalFigNo}`,
              type: 'diagram',
              imageUrl: imgUrl,
              sourceId: seqItem.sourceId,
              // Track which language version is being displayed
              displayLanguage: source?.language || 'en'
            })
          } else {
            // Diagram was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Diagram (Source ID: ${seqItem.sourceId})`,
              type: 'diagram',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = sketchRecords.find((s: any) => s.id === seqItem.sourceId)
          if (sketch) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: sketch.title || `Figure ${seqItem.finalFigNo}`,
              type: 'sketch',
              imageUrl: buildSketchImageUrl(sketch),
              sourceId: seqItem.sourceId
            })
          } else {
            // Sketch was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Sketch (Source ID: ${seqItem.sourceId})`,
              type: 'sketch',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        }
      }

      // Auto-append new diagrams added after sequence was finalized
      figurePlans.forEach((plan: any) => {
        if (!sequencedSourceIds.has(plan.id)) {
          // Use language-aware diagram source selection
          const source = findBestDiagramSource(plan.figureNo)
          let imgUrl: string | null = null
          if (source?.imageFilename) {
            imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
          } else if (source?.plantuml) {
            try {
              const encoded = plantumlEncoder.encode(source.plantuml)
              imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
            } catch (e) {
              console.error('Failed to encode plantuml', e)
            }
          }
          figures.push({
            figureNo: figures.length + 1,
            title: plan.title || `Figure ${figures.length + 1}`,
            type: 'diagram',
            imageUrl: imgUrl,
            sourceId: plan.id,
            isNew: true,
            displayLanguage: source?.language || 'en'
          })
          hasAppended = true
        }
      })

      // Auto-append new sketches added after sequence was finalized
      sketchRecords.forEach((sketch: any) => {
        if (!sequencedSourceIds.has(sketch.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: sketch.title || `Figure ${figures.length + 1}`,
            type: 'sketch',
            imageUrl: buildSketchImageUrl(sketch),
            sourceId: sketch.id,
            isNew: true
          })
          hasAppended = true
        }
      })
    } else {
      // Fallback: use figurePlans sorted by figureNo, then append sketches
      const sortedPlans = [...figurePlans].sort((a: any, b: any) => a.figureNo - b.figureNo)
      for (const plan of sortedPlans) {
        // Use language-aware diagram source selection
        const source = findBestDiagramSource(plan.figureNo)
        let imgUrl: string | null = null
        if (source?.imageFilename) {
          imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
        } else if (source?.plantuml) {
          try {
            const encoded = plantumlEncoder.encode(source.plantuml)
            imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
          } catch (e) {
            console.error('Failed to encode plantuml', e)
          }
        }
        figures.push({
          figureNo: plan.figureNo,
          title: plan.title || `Figure ${plan.figureNo}`,
          type: 'diagram',
          imageUrl: imgUrl,
          sourceId: plan.id,
          displayLanguage: source?.language || 'en'
        })
      }
      // Append sketches after diagrams
      const maxFigNo = figures.length > 0 ? Math.max(...figures.map(f => f.figureNo)) : 0
      sketchRecords.forEach((sketch: any, index: number) => {
        figures.push({
          figureNo: maxFigNo + index + 1,
          title: sketch.title || `Figure ${maxFigNo + index + 1}`,
          type: 'sketch',
          imageUrl: buildSketchImageUrl(sketch),
          sourceId: sketch.id
        })
      })
    }

    return { figures, hasAppended, missingCount }
  }, [figurePlans, diagramSources, sketchRecords, figureSequence, figureSequenceFinalized, patent, findBestDiagramSource])

  // Extract figures and warning state from memoized data
  const unifiedFigures = figuresData.figures
  const sequenceOutdated = figuresData.hasAppended || figuresData.missingCount > 0
  const sequenceWarningMessage = figuresData.hasAppended 
    ? `${figuresData.figures.filter(f => f.isNew).length} new figure(s) added after freezing - appended at end. Consider reordering in Planner stage.`
    : figuresData.missingCount > 0
      ? `${figuresData.missingCount} figure(s) deleted after freezing. Consider reordering in Planner stage.`
      : ''

  const copySection = async (key: string) => {
    try {
      const text = generated?.[key] || ''
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {}
  }

  const availableJurisdictions: string[] = useMemo(() => {
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions
      : []
    return list.map((c: string) => (c || '').toUpperCase())
  }, [session?.draftingJurisdictions])

  const latestDrafts = useMemo(() => {
    const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
    const map: Record<string, any> = {}
    drafts.forEach((d: any) => {
      const code = (d?.jurisdiction || 'IN').toUpperCase()
      if (!map[code] || (d.version || 0) > (map[code].version || 0)) {
        map[code] = d
      }
    })
    return map
  }, [session?.annexureDrafts])
  const isMultiJurisdiction = availableJurisdictions.length > 1
  const normalizedActiveJurisdiction = (activeJurisdiction || '').toUpperCase()
  const isReferenceJurisdiction = normalizedActiveJurisdiction === 'REFERENCE'
  const pass2GenerationLocked = isMultiJurisdiction && !session?.referenceDraftComplete && !isReferenceJurisdiction

  const notifyPass2Locked = useCallback(() => {
    alert('Pass 2 is locked. Complete the Reference Draft (Pass 1) for all required sections first.')
  }, [])

  const addableCountries = useMemo(
    () => availableCountries.filter(c => !availableJurisdictions.includes(c.code)),
    [availableCountries, availableJurisdictions]
  )

  const persistStageState = async (opts: {
    jurisdictions?: string[]
    active?: string
    source?: string
    languageMap?: Record<string, string>
  }) => {
    if (!session?.id) return
    const nextJurisdictions = opts.jurisdictions || availableJurisdictions
    const payload: any = {
      action: 'set_stage',
      sessionId: session.id,
      stage: session?.status || 'ANNEXURE_DRAFT',
      draftingJurisdictions: nextJurisdictions,
      activeJurisdiction: opts.active || activeJurisdiction,
      languageByJurisdiction: opts.languageMap || languageByCode,
      sourceOfTruth: opts.source || sourceOfTruth
    }
    await onComplete(payload)
    await onRefresh()
  }

  const handleSourceChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setSourceOfTruth(normalized)
    const reordered = [normalized, ...availableJurisdictions.filter(c => c !== normalized)]
    await persistStageState({ source: normalized, jurisdictions: reordered })
  }

  const handleLanguageChange = async (code: string, lang: string) => {
    const normalized = (code || '').toUpperCase()
    setLanguageByCode(prev => ({ ...prev, [normalized]: lang }))
    await persistStageState({ languageMap: { ...languageByCode, [normalized]: lang } })
  }

  const handleAddJurisdiction = async () => {
    if (!selectedAddCode || !session?.id) return
    if (availableJurisdictions.includes(selectedAddCode)) return
    try {
      setAddingJurisdiction(true)
      const country = availableCountries.find(c => c.code === selectedAddCode)
      const preferredLang = languageByCode[selectedAddCode] || country?.languages?.[0]
      const nextLanguageMap = preferredLang ? { ...languageByCode, [selectedAddCode]: preferredLang } : { ...languageByCode }
      setLanguageByCode(nextLanguageMap)
      const nextList = [...availableJurisdictions, selectedAddCode]
      await persistStageState({
        jurisdictions: nextList,
        active: selectedAddCode,
        source: sourceOfTruth || nextList[0],
        languageMap: nextLanguageMap
      })
      setActiveJurisdiction(selectedAddCode)
    } finally {
      setAddingJurisdiction(false)
    }
  }

  const handleDeleteDraft = async (code: string, removeFromList: boolean = false) => {
    if (!session?.id) return
    const normalized = (code || '').toUpperCase()
    try {
      setDeletingJurisdiction(normalized)
      await onComplete({
        action: 'delete_annexure_draft',
        sessionId: session.id,
        jurisdiction: normalized,
        removeFromList
      })
      // Optimistically update local active/source to reflect removal/clear
      const remaining = removeFromList
        ? availableJurisdictions.filter(c => c !== normalized)
        : availableJurisdictions
      if (removeFromList && remaining.length > 0) {
        const next = remaining[0]
        setActiveJurisdiction(next)
        setSourceOfTruth(prev => (remaining.includes(prev) ? prev : next))
      }
      // Clear the generated state for the deleted jurisdiction to prevent stale data
      if (activeJurisdiction === normalized) {
        setGenerated({})
      }
      await onRefresh()
    } finally {
      setDeletingJurisdiction(null)
    }
  }

  // Initialize from latest saved draft for the active jurisdiction
  useEffect(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const latest = latestDrafts[code]

    if (latest) {
      // Get extraSections from dedicated column OR legacy validationReport location
      const extraSections = (latest as any).extraSections || (latest.validationReport as any)?.extraSections || {}
      
      // For REFERENCE drafts, section content is stored in _rawDraft
      const rawDraft = extraSections._rawDraft || {}
      const isReference = code === 'REFERENCE'
      
      const initial: Record<string, string> = {
        // Legacy columns (dedicated DB fields)
        // For REFERENCE: prefer rawDraft content, fallback to DB columns
        title: isReference ? (rawDraft.title || latest.title || '') : (latest.title || ''),
        fieldOfInvention: isReference ? (rawDraft.fieldOfInvention || latest.fieldOfInvention || '') : (latest.fieldOfInvention || ''),
        background: isReference ? (rawDraft.background || latest.background || '') : (latest.background || ''),
        summary: isReference ? (rawDraft.summary || latest.summary || '') : (latest.summary || ''),
        briefDescriptionOfDrawings: isReference ? (rawDraft.briefDescriptionOfDrawings || latest.briefDescriptionOfDrawings || '') : (latest.briefDescriptionOfDrawings || ''),
        detailedDescription: isReference ? (rawDraft.detailedDescription || latest.detailedDescription || '') : (latest.detailedDescription || ''),
        bestMethod: isReference ? (rawDraft.bestMode || rawDraft.bestMethod || latest.bestMethod || '') : (latest.bestMethod || ''),
        industrialApplicability: isReference ? (rawDraft.industrialApplicability || latest.industrialApplicability || '') : (latest.industrialApplicability || ''),
        claims: isReference ? (rawDraft.claims || latest.claims || '') : (latest.claims || ''),
        abstract: isReference ? (rawDraft.abstract || latest.abstract || '') : (latest.abstract || ''),
        listOfNumerals: isReference ? (rawDraft.listOfNumerals || latest.listOfNumerals || '') : (latest.listOfNumerals || ''),
        // Extra sections (JSON column for scalable storage)
        // For REFERENCE: prefer rawDraft, then extraSections
        crossReference: isReference ? (rawDraft.crossReference || extraSections.crossReference || '') : (extraSections.crossReference || ''),
        preamble: isReference ? (rawDraft.preamble || extraSections.preamble || '') : (extraSections.preamble || ''),
        objectsOfInvention: isReference ? (rawDraft.objectsOfInvention || extraSections.objectsOfInvention || '') : (extraSections.objectsOfInvention || ''),
        technicalProblem: isReference ? (rawDraft.technicalProblem || extraSections.technicalProblem || '') : (extraSections.technicalProblem || ''),
        technicalSolution: isReference ? (rawDraft.technicalSolution || extraSections.technicalSolution || '') : (extraSections.technicalSolution || ''),
        advantageousEffects: isReference ? (rawDraft.advantageousEffects || extraSections.advantageousEffects || '') : (extraSections.advantageousEffects || ''),
        modeOfCarryingOut: isReference ? (rawDraft.modeOfCarryingOut || extraSections.modeOfCarryingOut || '') : (extraSections.modeOfCarryingOut || '')
      }
      setGenerated(initial)
    } else {
      setGenerated({})
    }
  }, [latestDrafts, activeJurisdiction])

  // Sync active jurisdiction when session updates
  useEffect(() => {
    const nextJurisdictionRaw = session?.activeJurisdiction || session?.draftingJurisdictions?.[0]
    const nextJurisdiction = nextJurisdictionRaw ? String(nextJurisdictionRaw).toUpperCase() : ''
    if (nextJurisdiction && nextJurisdiction !== normalizedActiveJurisdiction) {
      setActiveJurisdiction(nextJurisdiction)
    }
  }, [session?.activeJurisdiction, session?.draftingJurisdictions, normalizedActiveJurisdiction])

  // In multi-jurisdiction mode, keep users on Pass 1 until reference draft is complete.
  useEffect(() => {
    if (!isMultiJurisdiction || session?.referenceDraftComplete) return
    if (normalizedActiveJurisdiction !== 'REFERENCE') {
      setActiveJurisdiction('REFERENCE')
    }
  }, [isMultiJurisdiction, session?.referenceDraftComplete, normalizedActiveJurisdiction])

  // Keep source-of-truth in sync
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    const fallbackActive = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    const resolved = preferred && availableJurisdictions.includes(preferred)
      ? preferred
      : (fallbackActive && availableJurisdictions.includes(fallbackActive)
        ? fallbackActive
        : (availableJurisdictions[0] || sourceOfTruth))
    setSourceOfTruth(resolved || 'IN')
  }, [session?.jurisdictionDraftStatus, session?.activeJurisdiction, availableJurisdictions, sourceOfTruth])

  // Load available country profiles
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setAvailableCountriesError(null)
        const res = await fetch('/api/country-profiles', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => a.label.localeCompare(b.label))
        setAvailableCountries(countries)
      } catch (err) {
        console.error('Failed to load country profiles (Annexure stage)', err)
        setAvailableCountriesError('Failed to load jurisdiction catalog. You can still draft with existing selections.')
      }
    }
    fetchCountries()
  }, [])

  // Maintain language preferences
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    setLanguageByCode(prev => {
      const next: Record<string, string> = {}
      availableJurisdictions.forEach(code => {
        const saved = status?.[code]?.language
        const country = availableCountries.find(c => c.code === code)
        const defaultLang = country?.languages?.[0] || ''
        next[code] = saved || prev[code] || defaultLang
      })
      return next
    })
  }, [session?.jurisdictionDraftStatus, availableCountries, availableJurisdictions])

  // Load user instructions for the session
  useEffect(() => {
    const loadUserInstructions = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting/user-instructions?sessionId=${session.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setUserInstructions(data.grouped || {})
        }
      } catch (err) {
        console.error('Failed to load user instructions:', err)
      }
    }
    loadUserInstructions()
  }, [session?.id, patent?.id])

  // Keep add-jurisdiction dropdown updated
  useEffect(() => {
    const addable = availableCountries.filter(c => !availableJurisdictions.includes(c.code))
    if (!selectedAddCode || !addable.find(c => c.code === selectedAddCode)) {
      setSelectedAddCode(addable[0]?.code || '')
    }
  }, [availableCountries, availableJurisdictions, selectedAddCode])

  useEffect(() => {
    if (!selectedAddCode) return
    const country = availableCountries.find(c => c.code === selectedAddCode)
    if (!country) return
    setLanguageByCode(prev => {
      if (prev[selectedAddCode]) return prev
      const lang = country.languages?.[0]
      if (!lang) return prev
      return { ...prev, [selectedAddCode]: lang }
    })
  }, [selectedAddCode, availableCountries])

  // Load country profile to drive section layout
  // For REFERENCE pseudo-country, pass the selected jurisdictions to get dynamic optimized sections
  useEffect(() => {
    const loadProfile = async () => {
      if (!activeJurisdiction) return
      setProfileLoading(true)
      setProfileError(null)
      try {
        // Build URL with jurisdictions param for REFERENCE profile optimization
        let url = `/api/country-profiles/${activeJurisdiction}`
        
        // For REFERENCE profile, append selected jurisdictions to optimize the section list
        if (activeJurisdiction.toUpperCase() === 'REFERENCE') {
          const jurisdictions = (session?.draftingJurisdictions || [])
            .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')
          if (jurisdictions.length > 0) {
            url += `?jurisdictions=${jurisdictions.join(',')}`
          }
        }
        
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) {
          let msg = `Failed to load country profile (${res.status})`
          try {
            const body = await res.json()
            if (body?.error) msg = String(body.error)
          } catch {
            // ignore parse errors; keep generic message
          }
          throw new Error(msg)
        }
        const data = await res.json()
        const profile = data?.profile
        const variant = profile?.structure?.variants?.find((v: any) => v.id === profile?.structure?.defaultVariant) || profile?.structure?.variants?.[0]
        const sections: SectionConfig[] = []
        const canonicalMap: Record<string, string> = {
          title: 'title',
          technical_field: 'fieldOfInvention',
          field_of_invention: 'fieldOfInvention',
          fieldofinvention: 'fieldOfInvention',
          field: 'fieldOfInvention',
          cross_reference: 'crossReference',
          crossreference: 'crossReference',
          background: 'background',
          background_art: 'background',
          objects: 'objectsOfInvention',
          objects_of_invention: 'objectsOfInvention',
          objectsofinvention: 'objectsOfInvention',
          // Direct camelCase mappings for canonical keys returned from API
          objectsOfInvention: 'objectsOfInvention',
          fieldOfInvention: 'fieldOfInvention',
          crossReference: 'crossReference',
          briefDescriptionOfDrawings: 'briefDescriptionOfDrawings',
          detailedDescription: 'detailedDescription',
          bestMethod: 'bestMethod',
          industrialApplicability: 'industrialApplicability',
          listOfNumerals: 'listOfNumerals',
          technicalProblem: 'technicalProblem',
          technicalSolution: 'technicalSolution',
          advantageousEffects: 'advantageousEffects',
          summary_of_invention: 'summary',
          summary: 'summary',
          brief_drawings: 'briefDescriptionOfDrawings',
          brief_description_of_drawings: 'briefDescriptionOfDrawings',
          briefdescriptionofdrawings: 'briefDescriptionOfDrawings',
          description: 'detailedDescription',
          detailed_description: 'detailedDescription',
          detaileddescription: 'detailedDescription',
          best_mode: 'bestMethod',
          best_method: 'bestMethod',
          bestmethod: 'bestMethod',
          industrial_applicability: 'industrialApplicability',
          industrialapplicability: 'industrialApplicability',
          utility: 'industrialApplicability',
          claims: 'claims',
          abstract: 'abstract',
          reference_numerals: 'listOfNumerals',
          reference_signs: 'listOfNumerals',
          list_of_numerals: 'listOfNumerals',
          listofnumerals: 'listOfNumerals',
          // PCT/JP specific
          technical_problem: 'technicalProblem',
          technicalproblem: 'technicalProblem',
          technical_solution: 'technicalSolution',
          technicalsolution: 'technicalSolution',
          advantageous_effects: 'advantageousEffects',
          advantageouseffects: 'advantageousEffects'
        }
        const promptSections = profile?.prompts?.sections || {}
        
        // ============================================================================
        // SECTIONS NOW COME EXCLUSIVELY FROM CountrySectionMapping TABLE
        // This is the single source of truth for which sections appear per jurisdiction
        // Configured via: /super-admin/jurisdiction-config
        // ============================================================================
        
        if (Array.isArray(profile?.sectionMappings) && profile.sectionMappings.length > 0) {
          // Build sections ONLY from CountrySectionMapping table entries
          // Filter out N/A, Implicit, and disabled sections
          const applicableMappings = profile.sectionMappings.filter((mapping: any) => 
            mapping.sectionKey && 
            mapping.heading && 
            mapping.heading !== '(N/A)' && 
            mapping.heading !== '(Implicit)' &&
            mapping.heading !== '(Recommended/NA)' &&
            mapping.heading !== '(Include in Detailed Desc)' &&
            mapping.isEnabled !== false
          )
          const { ensureDisplayOrder } = await import('@/lib/section-display-order')
          
          // Sort by resolved displayOrder (DB source of truth; country override or superset-inherited)
          // This ensures the visible numbering matches the rendered order.
          const mappingsWithOrder = applicableMappings.map((m: any) => ({
            mapping: m,
            order: ensureDisplayOrder(m.displayOrder, `${activeJurisdiction}:${String(m.sectionKey)}`)
          }))
          mappingsWithOrder.sort((a: any, b: any) => a.order - b.order)
          
          for (const { mapping, order: displayOrder } of mappingsWithOrder) {
            const sectionKey = mapping.sectionKey
            
            // Resolve to canonical internal key using the mapping
            const canonicalKey = canonicalMap[sectionKey] || canonicalMap[sectionKey.toLowerCase()] || sectionKey
            
            // Skip sections that don't resolve to a known canonical key (prevents prompt loading errors)
            if (!canonicalKey) {
              console.warn(`[AnnexureDraftStage] Skipping unmapped section: ${sectionKey}`)
              continue
            }
            
            sections.push({
              keys: [canonicalKey],
              label: mapping.heading, // Patent section headings should be titles only (no numeric prefixes)
              description: promptSections?.[canonicalKey]?.description || promptSections?.[sectionKey]?.description || '',
              constraints: promptSections?.[canonicalKey]?.constraints || promptSections?.[sectionKey]?.constraints || [],
              required: mapping.isRequired ?? true
            })
          }
          
          console.log(`[AnnexureDraftStage] Loaded ${sections.length} sections from CountrySectionMapping for ${activeJurisdiction}`)
        } else {
          // No CountrySectionMapping found - this jurisdiction is not configured
          console.error(`[AnnexureDraftStage] No CountrySectionMapping found for ${activeJurisdiction}. Configure via /super-admin/jurisdiction-config`)
        }
        
        if (sections.length > 0) {
          setSectionConfigs(sections)
          setUsingFallback(false)
          setProfileError(null)
        } else {
          // CRITICAL: Do not use fallback - CountrySectionMapping is the single source of truth
          // Show error so admin knows to configure the jurisdiction
          setSectionConfigs([])
          setUsingFallback(true)
          setProfileError(`No sections configured for ${activeJurisdiction}. Please configure via /super-admin/jurisdiction-config`)
        }
      } catch (err) {
        console.error('Failed to load jurisdiction profile', err)
        // Database is the only source of truth for section ordering; do not fall back.
        setProfileError(err instanceof Error ? err.message : 'Failed to load country-specific sections. Please try again or contact support.')
        setSectionConfigs([])
        setUsingFallback(true)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [activeJurisdiction, session?.draftingJurisdictions])

  const handleJurisdictionChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setActiveJurisdiction(normalized)
    if (!session?.id) return
    try {
      await persistStageState({ active: normalized })
    } catch (err) {
      console.error('Failed to persist jurisdiction change', err)
    }
  }

  // Multi-jurisdiction: Generate Reference Draft (superset sections)
  const [generatingReference, setGeneratingReference] = useState(false)
  const [translating, setTranslating] = useState<string | null>(null)

  const handleGenerateReferenceDraft = async (forceRegenerate = false) => {
    if (!session?.id || generatingReference) return
    
    // Check if regenerating existing reference draft
    if (session?.referenceDraftComplete && !forceRegenerate) {
      const confirmed = confirm(
        '⚠️ Regenerating Reference Draft\n\n' +
        'This will replace your existing reference draft. ' +
        'Existing translations for other jurisdictions will become outdated and may need to be regenerated.\n\n' +
        'Do you want to continue?'
      )
      if (!confirmed) return
    }
    
    setGeneratingReference(true)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_reference_draft',
          sessionId: session.id,
          forceRegenerate,
          concurrency: 10
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Reference draft generation failed:', data.error)
        if (data?.draft && typeof data.draft === 'object') {
          setGenerated(data.draft)
        }
        await onRefresh()
        alert(`❌ Failed to generate reference draft: ${data.error || 'Unknown error'}`)
        return
      }
      // Refresh to get updated session with reference draft
      await onRefresh()
      if (data.draft) {
        setGenerated(data.draft)
        alert('✅ Reference draft generated successfully!\n\nYou can now translate to other jurisdictions.')
      }
    } catch (err) {
      console.error('Reference draft generation error:', err)
      alert(`❌ Failed to generate reference draft: ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setGeneratingReference(false)
    }
  }

  // Multi-jurisdiction: Translate Reference Draft to a jurisdiction
  const handleTranslateToJurisdiction = async (targetJurisdiction: string) => {
    if (!session?.id || translating) return
    const code = targetJurisdiction.toUpperCase()
    
    // Validate jurisdiction exists in available list
    if (!availableJurisdictions.includes(code) && code !== 'REFERENCE') {
      alert(`Invalid jurisdiction: ${code}. Please select a valid jurisdiction.`)
      return
    }
    
    setTranslating(code)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'translate_to_jurisdiction',
          sessionId: session.id,
          targetJurisdiction: code
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Translation failed:', data.error)
        alert(`❌ Translation failed for ${code}: ${data.error || 'Unknown error'}`)
        return
      }
      
      // Check for high fallback rate warning
      if (data.warning) {
        console.warn('[Translation] Warning:', data.warning)
      }
      
      // Refresh to get updated session with translated draft
      await onRefresh()
      
      // Build comprehensive success message
      let message = `✅ Translation to ${code} complete!`
      
      // Add fallback warning if applicable
      if (data.warning) {
        message += `\n\n⚠️ ${data.warning}`
      }
      
      // Add validation issues if any
      if (data.validation?.issues?.length > 0) {
        const errorCount = data.validation.issues.filter((i: any) => i.type === 'error').length
        const warnCount = data.validation.issues.filter((i: any) => i.type === 'warning').length
        if (errorCount > 0 || warnCount > 0) {
          message += `\n\n📋 Validation Report:\n• ${errorCount} error(s)\n• ${warnCount} warning(s)\n\nPlease review the Validation section.`
        }
      }
      
      alert(message)
      
      // Switch to translated jurisdiction
      if (data.draft) {
        setGenerated(data.draft)
        setActiveJurisdiction(code)
      }
    } catch (err) {
      console.error('Translation error:', err)
      alert(`❌ Translation failed: ${err instanceof Error ? err.message : 'Network error'}. Please try again.`)
    } finally {
      setTranslating(null)
    }
  }

  const handleGenerate = async (keys: string[], skipRefresh = false) => {
    if (loading) return
    if (pass2GenerationLocked) {
      notifyPass2Locked()
      return
    }
    setLoading(true)
    setShowActivity(true)
    setCurrentKeys(keys)
    try {
      const sections = keys.filter(Boolean)
      if (sections.length === 0) {
        throw new Error('No valid sections to generate')
      }
      
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      // For REFERENCE jurisdiction, use generate_reference_section for proper persistence
      // Handle both single and multi-key by looping
      if (isReference) {
        const generatedContent: Record<string, string> = {}
        const debugStepsCollected: any[] = []
        
        for (const sectionKey of sections) {
          const result = await generateSingleSection(sectionKey, true)
          
          if (result.success && result.content) {
            generatedContent[sectionKey] = result.content
            debugStepsCollected.push({ step: `generate_${sectionKey}`, status: 'done' })
          } else {
            // If generation fails, throw error with context
            throw new Error(`Failed to generate ${displayName[sectionKey] || sectionKey}: ${result.error || 'Unknown error'}`)
          }
        }
        
        // Update state with all generated content
        setGenerated(prev => ({ ...prev, ...generatedContent }))
        setDebugSteps(debugStepsCollected)
        
        // REMOVED: onRefresh() - content is already persisted by API, local state is updated
        // Avoiding refresh reduces delay and prevents UI flicker
      } else {
        // Standard generation for non-REFERENCE jurisdictions
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections,
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const filtered: Record<string, string> = {}
        Object.entries(incoming).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim()) filtered[k] = v.trim()
        })
        setGenerated(prev => ({ ...prev, ...filtered }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // REMOVED: onRefresh() - content is already persisted via onComplete, local state is updated
        // Avoiding refresh reduces delay and prevents UI flicker
      }
    } catch (error) {
      console.error('Generation failed:', error)
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setLoading(false)
      // Optionally hide activity after a delay
      // setTimeout(() => setShowActivity(false), 5000)
    }
  }
  
  // Helper function to generate a single section (used by auto-mode)
  const generateSingleSection = async (sectionKey: string, isReference: boolean): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      if (!isReference && pass2GenerationLocked) {
        return {
          success: false,
          error: 'Pass 2 is locked until the reference draft is complete.'
        }
      }
      if (isReference) {
        // Use REFERENCE-specific API
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey
          })
        })
        const data = await res.json()
        if (!res.ok) {
          return { success: false, error: data.error || 'Failed to generate section' }
        }
        if (data.success && data.content) {
          return { success: true, content: data.content }
        }
        return { success: false, error: 'No content returned' }
      } else {
        // Standard generation
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [sectionKey],
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const value = typeof incoming?.[sectionKey] === 'string' ? incoming[sectionKey].trim() : ''
        if (value) {
          return { success: true, content: value }
        }
        return { success: false, error: 'No content returned' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Pre-check function to identify all warnings before starting auto-generation
  const checkAutoModeWarnings = async (sectionsToCheck: string[]): Promise<{ warnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>; errors: string[] }> => {
    try {
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      // Consolidated API call - same endpoint for both REFERENCE and regular jurisdictions
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'check_warnings',
          sessionId: session?.id,
          sections: sectionsToCheck,
          // Only include jurisdiction for non-REFERENCE drafts
          ...(isReference ? {} : { jurisdiction: activeJurisdiction })
        })
      })
      
      const data = await res.json()
      if (res.ok && data.warnings) {
        return { warnings: data.warnings, errors: [] }
      }
      return { warnings: [], errors: [] }
    } catch (err) {
      console.warn('Failed to check warnings:', err)
      return { warnings: [], errors: [] }
    }
  }

  // State for auto-mode warning modal
  const [autoModeWarningModal, setAutoModeWarningModal] = useState<{
    show: boolean
    warnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>
    pendingSections: string[]
  }>({ show: false, warnings: [], pendingSections: [] })

  // Start auto-generation after user confirms in the modal
  const startAutoGeneration = async (pendingSections: string[]) => {
    setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })
    
    // Reset cancellation flag
    autoModeCancelledRef.current = false
    setAutoModeRunning(true)
    setShowActivity(true)
    
    const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
    let successCount = 0
    let failedSection: string | null = null
    let failedError: string | null = null
    
    try {
      for (let i = 0; i < pendingSections.length; i++) {
        // Check if auto-mode was cancelled (using ref for immediate check)
        if (autoModeCancelledRef.current) {
          console.log('[AutoMode] Cancelled by user')
          break
        }
        
        const sectionKey = pendingSections[i]
        const sectionLabel = displayName[sectionKey] || sectionKey
        
        setAutoModeProgress({
          current: i + 1,
          total: pendingSections.length,
          currentSection: sectionLabel
        })
        
        setCurrentKeys([sectionKey])
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }))
        
        // First attempt
        let result = await generateSingleSection(sectionKey, isReference)
        
        // If failed, retry once
        if (!result.success) {
          console.log(`[AutoMode] First attempt failed for ${sectionKey}, retrying...`)
          setDebugSteps([{ step: `retry_${sectionKey}`, status: 'running' }])
          
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Check cancellation before retry
          if (autoModeCancelledRef.current) {
            setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
            break
          }
          
          result = await generateSingleSection(sectionKey, isReference)
        }
        
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
        
        if (result.success && result.content) {
          setGenerated(prev => ({ ...prev, [sectionKey]: result.content! }))
          setDebugSteps([{ step: `generate_${sectionKey}`, status: 'done' }])
          successCount++
        } else {
          // Failed after retry - stop auto-mode and notify user
          console.error(`[AutoMode] Failed to generate ${sectionKey} after retry:`, result.error)
          setDebugSteps([{ step: `generate_${sectionKey}`, status: 'fail', meta: { error: result.error } }])
          failedSection = sectionLabel
          failedError = result.error || 'Unknown error'
          break // Stop the loop
        }
        
        // Small delay between sections to avoid overwhelming the API
        if (i < pendingSections.length - 1 && !autoModeCancelledRef.current) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
      
      // Final refresh to ensure all content is persisted
      await onRefresh()
      
      // Show appropriate message based on outcome
      if (autoModeCancelledRef.current) {
        alert(`⏹ Auto-generation stopped.\n\n${successCount} of ${pendingSections.length} section(s) were generated and saved.`)
      } else if (failedSection) {
        alert(
          `❌ Auto-generation stopped due to error.\n\n` +
          `Failed section: ${failedSection}\n` +
          `Error: ${failedError}\n\n` +
          `${successCount} of ${pendingSections.length} section(s) were generated before the error.`
        )
      } else {
        // Success - show different message based on jurisdiction
        if (successCount > 0) {
          if (isReference) {
            alert(
              `✅ Reference Draft Complete!\n\n` +
              `${successCount} section(s) have been generated and saved.\n\n` +
              `🔓 Other jurisdictions (${availableJurisdictions.join(', ')}) are now unlocked for translation.`
            )
          } else {
            alert(`✅ Auto-generation complete!\n\n${successCount} section(s) have been generated and saved.`)
          }
        }
      }
    } catch (error) {
      console.error('[AutoMode] Unexpected error:', error)
      alert(`Auto-generation failed unexpectedly: ${error instanceof Error ? error.message : 'Unknown error'}\n\n${successCount} section(s) were generated before the error.`)
    } finally {
      setAutoModeRunning(false)
      setAutoModeProgress(null)
      setCurrentKeys(null)
      // Reset cancellation flag
      autoModeCancelledRef.current = false
    }
  }

  // Auto-mode: Generate all sections sequentially without user interaction
  const handleAutoGenerateAll = async () => {
    if (autoModeRunning || loading) return

    if (!sectionConfigs) return
    if (pass2GenerationLocked) {
      notifyPass2Locked()
      return
    }

    // Get all section keys that don't have content yet
    const pendingSections = sectionConfigs
      .map(s => s.keys[0])
      .filter(key => key && !generated?.[key]?.trim())

    if (pendingSections.length === 0) {
      alert('All sections already have content. Use the regenerate option to update individual sections.')
      return
    }

    // Pre-check for warnings before starting auto-generation
    setLoading(true)
    const { warnings } = await checkAutoModeWarnings(pendingSections)
    setLoading(false)

    // Show warning modal with all warnings before proceeding
    setAutoModeWarningModal({
      show: true,
      warnings,
      pendingSections
    })
  }
  
  // Stop auto-mode immediately
  const handleStopAutoMode = () => {
    autoModeCancelledRef.current = true // Immediate flag for sync check
    setAutoMode(false)
  }

  const handleApproveSave = async (keys: string[]) => {
    const patch: Record<string, string> = {}
    for (const k of keys) if (generated?.[k]) patch[k] = generated[k]
    if (Object.keys(patch).length === 0) return
    await onComplete({ action: 'save_sections', sessionId: session?.id, patch })
    // REMOVED: onRefresh() - content is already persisted via onComplete
  }

  const handleAutosaveSection = async (key: string) => {
    const value = (editDrafts?.[key] ?? generated?.[key] ?? '').trim()
    if (!value) return
    setGenerated(prev => ({ ...prev, [key]: value }))
    await onComplete({ action: 'autosave_sections', sessionId: session?.id, patch: { [key]: value } })
    setEditingKey(null)
  }

  const handleRegenerateSection = async (key: string) => {
    if (sectionLoading[key]) return
    if (pass2GenerationLocked) {
      notifyPass2Locked()
      return
    }
    setSectionLoading(prev => ({ ...prev, [key]: true }))
    setShowActivity(true)
    try {
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      if (isReference) {
        // Use REFERENCE-specific API for proper persistence
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey: key
          })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to regenerate section')
        }
        if (data.success && data.content) {
          setGenerated(prev => ({ ...prev, [key]: data.content }))
        }
        setDebugSteps([{ step: `regenerate_${key}`, status: 'done' }])
        // REMOVED: onRefresh() - content is already persisted by API, local state is updated
      } else {
        // Standard regeneration for non-REFERENCE jurisdictions
        const instructions: Record<string, string> = {}
        if (regenRemarks[key]) instructions[key] = regenRemarks[key]
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [key],
          instructions,
          usePersonaStyle,
          personaSelection, // Pass selected personas for multi-persona style support
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const value = typeof incoming?.[key] === 'string' ? incoming[key].trim() : ''
        if (value) setGenerated(prev => ({ ...prev, [key]: value }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // REMOVED: onRefresh() - content is already persisted via onComplete, local state is updated
      }
      
      setRegenOpen(prev => ({ ...prev, [key]: false }))
      setRegenRemarks(prev => ({ ...prev, [key]: '' }))
    } catch (error) {
      console.error('Regeneration failed:', error)
      alert(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // If no jurisdictions are available, show a message instead of defaulting to IN
  if (availableJurisdictions.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-gray-500 mb-4">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Jurisdictions Available</h3>
        <p className="text-gray-500 mb-4">All patent jurisdictions have been removed from this drafting session.</p>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  // Tooltip wrapper component for hover explanations
  const Tooltip = ({ children, content, position = 'bottom' }: { children: React.ReactNode; content: string; position?: 'top' | 'bottom' | 'left' | 'right' }) => (
    <div className="relative group/tooltip inline-flex">
      {children}
      <div className={`absolute z-50 invisible group-hover/tooltip:visible opacity-0 group-hover/tooltip:opacity-100 transition-all duration-200 pointer-events-none
        ${position === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : ''}
        ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : ''}
        ${position === 'left' ? 'right-full mr-2 top-1/2 -translate-y-1/2' : ''}
        ${position === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : ''}
      `}>
        <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl max-w-xs whitespace-normal leading-relaxed">
          {content}
          <div className={`absolute w-2 h-2 bg-slate-900 transform rotate-45
            ${position === 'bottom' ? '-top-1 left-1/2 -translate-x-1/2' : ''}
            ${position === 'top' ? '-bottom-1 left-1/2 -translate-x-1/2' : ''}
            ${position === 'left' ? '-right-1 top-1/2 -translate-y-1/2' : ''}
            ${position === 'right' ? '-left-1 top-1/2 -translate-y-1/2' : ''}
          `} />
        </div>
      </div>
    </div>
  )

  // Check if delete is allowed (only when more than one jurisdiction)
  const canDeleteJurisdiction = availableJurisdictions.filter(j => j !== 'REFERENCE').length > 1

  return (
    <div className="pb-24 pt-8 bg-[#F5F6F7] min-h-screen relative">
      {/* Confirmation Modal for Clear/Delete Actions */}
      {confirmationModal.isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${confirmationModal.type === 'delete' ? 'bg-red-100' : 'bg-amber-100'}`}>
                {confirmationModal.type === 'delete' ? (
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {confirmationModal.type === 'delete' ? 'Delete Jurisdiction Draft' : 'Clear Draft Content'}
                </h3>
                <p className="text-sm text-gray-500">
                  {confirmationModal.type === 'delete' 
                    ? `This will permanently remove ${confirmationModal.jurisdiction} from your drafting session.`
                    : `This will clear all generated content for ${confirmationModal.jurisdiction}.`
                  }
                </p>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type <span className="font-bold text-gray-900">"{confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR'}"</span> to confirm:
              </label>
              <input
                type="text"
                value={confirmationModal.inputValue}
                onChange={(e) => setConfirmationModal(prev => ({ ...prev, inputValue: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                placeholder={confirmationModal.type === 'delete' ? 'Type DELETE' : 'Type CLEAR'}
                autoFocus
              />
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const expectedValue = confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR'
                  if (confirmationModal.inputValue === expectedValue) {
                    try {
                      await handleDeleteDraft(confirmationModal.jurisdiction, confirmationModal.type === 'delete')
                      setConfirmationModal({ isOpen: false, type: 'clear', jurisdiction: '', inputValue: '' })
                    } catch (error) {
                      console.error('Action failed:', error)
                      alert(`Failed to ${confirmationModal.type} draft. Please try again.`)
                    }
                  }
                }}
                disabled={confirmationModal.inputValue !== (confirmationModal.type === 'delete' ? 'DELETE' : 'CLEAR')}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmationModal.type === 'delete' 
                    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-400' 
                    : 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400'
                }`}
              >
                {confirmationModal.type === 'delete' ? 'Delete Jurisdiction' : 'Clear Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Panel - Fixed position in corner */}
      {showHelpPanel && (
        <div className="fixed bottom-4 right-4 z-40 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Drafting Help
            </h3>
            <button onClick={() => setShowHelpPanel(false)} className="text-white/80 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto text-sm space-y-4">
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">📝 Writing Style</h4>
              <p className="text-gray-600 text-xs">Control how AI generates content. Enable "Style" to match your selected persona's writing patterns.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">👤 Persona</h4>
              <p className="text-gray-600 text-xs">Select a writing persona (CSE, Bio, Chemistry) to guide the technical language and style.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">✍️ Samples</h4>
              <p className="text-gray-600 text-xs">Upload your own writing samples to train the AI on your preferred style.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">🚀 Auto Mode</h4>
              <p className="text-gray-600 text-xs">Automatically generate all sections sequentially. Great for initial drafts.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">🌍 Multi-Jurisdiction</h4>
              <p className="text-gray-600 text-xs">Draft for multiple countries. The Reference Draft is your master template that gets translated to country-specific versions.</p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">🔬 AI Review</h4>
              <p className="text-gray-600 text-xs">After generating, run AI Review to check for consistency, completeness, and patent-specific issues.</p>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-gray-400 text-xs">Hover over any control for more details.</p>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls Bar - Redesigned */}
      <div className="max-w-[850px] mx-auto mb-6 px-8">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Annexure Draft</h2>
            <p className="text-sm text-gray-500">Review and edit your patent application.</p>
          </div>
          
          {/* Help Button */}
          <Tooltip content="Open the help guide to learn about all the drafting tools and features available." position="left">
            <button
              onClick={() => setShowHelpPanel(!showHelpPanel)}
              className={`p-2.5 rounded-full transition-all duration-200 ${
                showHelpPanel 
                  ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' 
                  : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 shadow-sm'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Controls Row - Organized into logical groups */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Group 1: Writing Style Controls */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="When enabled, AI will mimic the writing style of your selected persona, adapting tone, terminology, and structure to match." position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  usePersonaStyle ? 'bg-emerald-50' : 'bg-gray-50'
                }`}>
                  <button
                    onClick={() => setUsePersonaStyle(!usePersonaStyle)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      usePersonaStyle ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      usePersonaStyle ? 'left-4' : 'left-0.5'
                    }`} />
                  </button>
                  <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-gray-500'}`}>
                    Style
                  </span>
                </div>
              </Tooltip>

              <Tooltip content="Choose a writing persona (e.g., CSE, Bio, Chemistry) that defines the technical vocabulary and drafting patterns for your patent." position="bottom">
                <button
                  onClick={() => setShowPersonaManager(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                    personaSelection?.primaryPersonaName
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>👤</span>
                  <span className="font-medium">
                    {personaSelection?.primaryPersonaName || 'Persona'}
                  </span>
                  {personaSelection?.secondaryPersonaNames?.length ? (
                    <span className="text-[10px] bg-blue-200 text-blue-700 px-1 rounded">+{personaSelection.secondaryPersonaNames.length}</span>
                  ) : null}
                </button>
              </Tooltip>

              <Tooltip content="Upload and manage your own writing samples to train the AI on your unique drafting style." position="bottom">
                <button
                  onClick={() => setShowWritingSamplesModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <span>✍️</span>
                  <span className="font-medium">Samples</span>
                </button>
              </Tooltip>
            </div>

            {/* Group 2: Generation Controls */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Enable Auto Mode to generate all draft sections automatically in sequence. Perfect for creating a complete first draft quickly." position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  autoModeRunning ? 'bg-amber-50' : autoMode ? 'bg-emerald-50' : 'bg-gray-50'
                }`}>
                  <button
                    onClick={() => setAutoMode(!autoMode)}
                    disabled={autoModeRunning}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      autoMode ? 'bg-emerald-500' : 'bg-gray-300'
                    } ${autoModeRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      autoMode ? 'left-4' : 'left-0.5'
                    }`} />
                  </button>
                  <span className={`text-xs font-medium ${autoMode ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {autoModeRunning ? '⏳ Running...' : 'Auto'}
                  </span>
                </div>
              </Tooltip>

              {autoMode && !autoModeRunning && (
                <Tooltip content="Start generating all remaining sections automatically." position="bottom">
                  <button
                    onClick={handleAutoGenerateAll}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50"
                  >
                    Generate All
                  </button>
                </Tooltip>
              )}

              {autoModeRunning && (
                <>
                  {autoModeProgress && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-50 border border-blue-100">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-xs font-medium text-blue-700">
                        {autoModeProgress.current}/{autoModeProgress.total}
                      </span>
                      <span className="text-xs text-blue-600 max-w-[100px] truncate">
                        {autoModeProgress.currentSection}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={handleStopAutoMode}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>

            {/* Group 3: Draft Management */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Clear all generated content for the current jurisdiction while keeping it in your drafting list." position="bottom">
                <button
                  type="button"
                  onClick={() => setConfirmationModal({ isOpen: true, type: 'clear', jurisdiction: activeJurisdiction, inputValue: '' })}
                  disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="font-medium">Clear</span>
                </button>
              </Tooltip>

              <Tooltip content={canDeleteJurisdiction 
                ? "Permanently delete this jurisdiction and remove it from your drafting session." 
                : "Cannot delete - you must have at least one jurisdiction in your drafting session."
              } position="bottom">
                <button
                  type="button"
                  onClick={() => canDeleteJurisdiction && setConfirmationModal({ isOpen: true, type: 'delete', jurisdiction: activeJurisdiction, inputValue: '' })}
                  disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning || !canDeleteJurisdiction}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                    canDeleteJurisdiction
                      ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                      : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="font-medium">Delete</span>
                </button>
              </Tooltip>
            </div>

            {/* Group 4: Tools */}
            <div className="flex items-center gap-2">
              <Tooltip content="Add custom instructions for specific sections to guide the AI's output for this draft." position="bottom">
                <button
                  onClick={() => setShowAllInstructionsModal(true)}
                  className={`p-2 rounded-lg border transition-colors relative ${
                    Object.keys(userInstructions).length > 0
                      ? 'bg-violet-50 border-violet-200 text-violet-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  {Object.keys(userInstructions).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-500 rounded-full text-[9px] text-white flex items-center justify-center font-medium">
                      {Object.values(userInstructions).reduce((sum, j) => sum + Object.keys(j).length, 0)}
                    </span>
                  )}
                </button>
              </Tooltip>

              <Tooltip content="Customize the font family, size, and line spacing of the draft preview." position="bottom">
                <div className="relative">
                  <button
                    onClick={() => setShowFormatting(!showFormatting)}
                    className={`p-2 rounded-lg border transition-colors ${
                      showFormatting
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  </button>

                  {/* Formatting Panel */}
                  {showFormatting && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Font Family</label>
                          <select
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="serif">Serif (Times New Roman)</option>
                            <option value="sans-serif">Sans Serif (Arial)</option>
                            <option value="monospace">Monospace (Courier)</option>
                            <option value="Georgia, serif">Georgia</option>
                            <option value="system-ui, sans-serif">System UI</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Font Size</label>
                          <select
                            value={fontSize}
                            onChange={(e) => setFontSize(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="12px">Small (12px)</option>
                            <option value="14px">Medium (14px)</option>
                            <option value="15px">Default (15px)</option>
                            <option value="16px">Large (16px)</option>
                            <option value="18px">Extra Large (18px)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Line Spacing</label>
                          <select
                            value={lineHeight}
                            onChange={(e) => setLineHeight(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="1.3">Compact (1.3)</option>
                            <option value="1.5">Normal (1.5)</option>
                            <option value="1.7">Relaxed (1.7)</option>
                            <option value="1.9">Spacious (1.9)</option>
                            <option value="2.1">Very Spacious (2.1)</option>
                          </select>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-gray-100">
                          <button
                            onClick={() => setShowFormatting(false)}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Tooltip>
            </div>

            {/* Active Jurisdiction Badge */}
            {activeJurisdiction && (
              <div className="ml-auto">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                  <span className="text-xs text-slate-500">Drafting:</span>
                  <span className="text-xs font-semibold text-slate-700">{activeJurisdiction}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMultiJurisdiction && (
        <div className="max-w-[850px] mx-auto mb-8 px-8">
          <div className="border border-gray-200 rounded-lg bg-white shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Multi-Jurisdiction Filing
              {!session?.referenceDraftComplete && (
                <span className="ml-2 text-amber-600 font-normal normal-case">
                  ⚠️ Generate Reference Draft first
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Reference Draft Tab - Always first in multi-jurisdiction mode */}
              <button
                onClick={() => handleJurisdictionChange('REFERENCE')}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  activeJurisdiction === 'REFERENCE'
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                📝 Reference Draft
                {session?.referenceDraftComplete && (
                  <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">✓</span>
                )}
              </button>
              
              {/* Country jurisdiction tabs - exclude REFERENCE as it has its own dedicated tab above */}
              {availableJurisdictions
                .filter(code => code !== 'REFERENCE')
                .map((code) => {
                const isLocked = !session?.referenceDraftComplete
                const hasTranslation = latestDrafts[code]?.version > 0
                
                return (
                <button
                  key={code}
                    onClick={() => !isLocked && handleJurisdictionChange(code)}
                    disabled={isLocked}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                      isLocked
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : code === activeJurisdiction
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                    title={isLocked ? 'Complete Reference Draft first' : `Draft for ${code}`}
                  >
                    {isLocked && '🔒 '}{code}
                    {hasTranslation && !isLocked && (
                      <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1 rounded">v{latestDrafts[code]?.version}</span>
                    )}
                </button>
                )
              })}
            </div>
            
            {/* Translation hint */}
            {session?.referenceDraftComplete && activeJurisdiction !== 'REFERENCE' && (
              <div className="mt-3 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded p-2">
                💡 <strong>Translation Mode:</strong> Content will be translated from Reference Draft with temp=0 for consistency.
              </div>
            )}
            
            {/* Action buttons for multi-jurisdiction - same UI pattern as other jurisdictions */}
            <div className="mt-4 flex flex-wrap gap-2">
              {isReferenceJurisdiction && !session?.referenceDraftComplete && (
                <button
                  onClick={() => void handleGenerateReferenceDraft(false)}
                  disabled={generatingReference || loading || autoModeRunning}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {generatingReference ? (
                    <>
                      <span className="animate-spin">...</span>
                      Generating Reference Draft...
                    </>
                  ) : (
                    <>Generate Reference Draft</>
                  )}
                </button>
              )}

              {isReferenceJurisdiction && session?.referenceDraftComplete && (
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-center gap-2">
                    Reference Draft Complete
                  </span>
                  <button
                    onClick={() => void handleGenerateReferenceDraft(true)}
                    disabled={generatingReference || loading || autoModeRunning}
                    className="px-4 py-2 bg-white border border-purple-200 text-purple-700 rounded-lg font-medium hover:bg-purple-50 disabled:opacity-60 flex items-center gap-2"
                  >
                    {generatingReference ? (
                      <>
                        <span className="animate-spin">...</span>
                        Regenerating...
                      </>
                    ) : (
                      <>Regenerate Reference Draft</>
                    )}
                  </button>
                </div>
              )}

              {!isReferenceJurisdiction && session?.referenceDraftComplete && (
                <button
                  onClick={() => handleTranslateToJurisdiction(activeJurisdiction)}
                  disabled={!!translating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating === activeJurisdiction ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating to {activeJurisdiction}...
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      Translate to {activeJurisdiction}
                    </>
                  )}
                </button>
              )}
              
              {/* Translate All button */}
              {isReferenceJurisdiction && session?.referenceDraftComplete && availableJurisdictions.length > 0 && (
                <button
                  onClick={async () => {
                    for (const code of availableJurisdictions) {
                      if (!latestDrafts[code]?.version) {
                        await handleTranslateToJurisdiction(code)
                      }
                    }
                  }}
                  disabled={!!translating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating {translating}...
                    </>
                  ) : (
                    <>
                      <span>🌐</span>
                      Translate All ({availableJurisdictions.filter(c => !latestDrafts[c]?.version).length} remaining)
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The "Paper" Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[1100px] px-[60px] py-[60px] relative border border-gray-100">

        {profileLoading && (
          <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500">
               <span className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full"></span>
               Loading template...
            </div>
          </div>
        )}

        {profileError && (
          <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
            <div className="font-semibold">Jurisdiction configuration error</div>
            <div className="text-sm mt-1">
              {profileError}
            </div>
            <div className="text-sm mt-2">
              Fix this in <a className="underline" href="/super-admin/jurisdiction-config">/super-admin/jurisdiction-config</a> (ensure every mapped section has a positive, unique display order).
            </div>
          </div>
        )}

        <div className="space-y-10">
            {(sectionConfigs || fallbackSections).map((section, idx) => {
              const isGeneratingThis = loading && currentKeys?.join('|') === section.keys.join('|')
              const isRegeneratingThis = section.keys.some(k => sectionLoading[k])
              const isWorking = isGeneratingThis || isRegeneratingThis
              const hasContent = section.keys.some(k => generated?.[k])

              return (
              <div key={section.keys.join('|') || idx} className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg">
                {/* Hover Actions (Floating) */}
                <div className={`absolute -right-4 top-0 transform translate-x-full opacity-0 group-hover:opacity-100 transition-opacity pl-2 ${isWorking ? 'opacity-100' : ''}`}>
                   <div className="flex flex-col gap-1 bg-white border border-gray-200 shadow-sm rounded-md p-1">
                      {!hasContent ? (
                         <button
                           disabled={loading || autoModeRunning}
                           onClick={() => autoMode && !autoModeRunning ? handleAutoGenerateAll() : handleGenerate(section.keys)}
                           className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-md"
                           title={autoMode ? "Generate all pending sections" : "Generate"}
                         >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApproveSave(section.keys)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-md"
                            title="Save"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button
                             onClick={() => {
                               const key = section.keys[0] // Default to first key for simple edit trigger
                               setEditingKey(editingKey === key ? null : key)
                               setEditDrafts(prev => ({ ...prev, [key]: generated?.[key] || '' }))
                             }}
                             className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
                             title="Edit"
                          >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </>
                      )}
                   </div>
                </div>

                {/* Section Header */}
                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                  </h3>
                    {/* Per-section instruction controls */}
                    {(() => {
                      const key = section.keys[0]
                      const jurisdictionInstr = userInstructions[activeJurisdiction]?.[key]
                      const globalInstr = userInstructions['*']?.[key]
                      const hasInstruction = jurisdictionInstr || globalInstr
                      const activeInstr = jurisdictionInstr || globalInstr
                      const isActive = activeInstr?.isActive !== false
                      
                      return (
                        <div className="relative flex items-center gap-1">
                          {hasInstruction && (
                            <span
                              className={`text-[10px] px-2 py-1 rounded-full ${
                                isActive
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-100 text-amber-700 border border-amber-200'
                              }`}
                              title={isActive ? 'Instruction is active' : 'Instruction is saved but inactive'}
                            >
                              {isActive ? 'INSTR ON' : 'INSTR OFF'}
                            </span>
                          )}
                          {/* Quick toggle button - only show if instruction exists */}
                          {hasInstruction && (
                            <button
                              onClick={async () => {
                                const instr = jurisdictionInstr || globalInstr
                                if (!instr) return
                                const newStatus = !isActive
                                try {
                                  await fetch(`/api/patents/${patent?.id}/drafting/user-instructions`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                                    },
                                    body: JSON.stringify({
                                      sessionId: session?.id,
                                      sectionKey: key,
                                      jurisdiction: instr.jurisdiction || (jurisdictionInstr ? activeJurisdiction : '*'),
                                      instruction: instr.instruction,
                                      emphasis: instr.emphasis,
                                      avoid: instr.avoid,
                                      style: instr.style,
                                      wordCount: instr.wordCount,
                                      isActive: newStatus
                                    })
                                  })
                                  // Update local state
                                  const jur = jurisdictionInstr ? activeJurisdiction : '*'
                                  setUserInstructions(prev => ({
                                    ...prev,
                                    [jur]: {
                                      ...(prev[jur] || {}),
                                      [key]: { ...instr, isActive: newStatus }
                                    }
                                  }))
                                } catch (err) {
                                  console.error('Failed to toggle instruction:', err)
                                }
                              }}
                              className={`p-1 rounded transition-colors ${
                                isActive 
                                  ? 'text-emerald-600 hover:bg-emerald-50' 
                                  : 'text-gray-400 hover:bg-gray-100'
                              }`}
                              title={isActive ? 'Click to disable instruction' : 'Click to enable instruction'}
                            >
                              {isActive ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor">
                                  <circle cx="10" cy="10" r="7" strokeWidth="1.5" />
                                </svg>
                              )}
                            </button>
                          )}
                          
                          {/* Edit/Add instruction button */}
                          <button
                            onClick={() => setInstructionPopoverKey(instructionPopoverKey === key ? null : key)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              hasInstruction
                                ? isActive
                                  ? 'text-violet-600 bg-violet-50 hover:bg-violet-100'
                                  : 'text-gray-400 bg-gray-100 hover:bg-gray-200 line-through'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                            title={
                              hasInstruction 
                                ? isActive 
                                  ? `Custom instruction for ${jurisdictionInstr ? activeJurisdiction : 'all jurisdictions'} (active)`
                                  : `Custom instruction (disabled)`
                                : 'Add custom instruction'
                            }
                          >
                            <svg className="w-4 h-4" fill={hasInstruction ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
                          
                          {/* Instruction Popover */}
                          {instructionPopoverKey === key && (
                            <SectionInstructionPopover
                              sectionKey={key}
                              sectionLabel={section.label || displayName[key] || key}
                              sessionId={session?.id || ''}
                              patentId={patent?.id || ''}
                              activeJurisdiction={activeJurisdiction}
                              existingInstruction={jurisdictionInstr || null}
                              globalInstruction={globalInstr || null}
                              onSave={(instr) => {
                                const jur = instr.jurisdiction || '*'
                                setUserInstructions(prev => ({
                                  ...prev,
                                  [jur]: {
                                    ...(prev[jur] || {}),
                                    [key]: instr.instruction ? instr : undefined
                                  }
                                }))
                              }}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Activity Panel Injection */}
                  {isWorking && showActivity && (
                      <div className="ml-4 transform scale-90 origin-right">
                        <BackendActivityPanel
                          isVisible={true}
                          onClose={() => setShowActivity(false)}
                          steps={(Array.isArray(debugSteps) ? debugSteps : []).map((s: any) => ({
                            id: String(s.step || ''),
                            state: s.status === 'fail' ? 'error' : (s.status || 'running')
                          }))}
                        />
                      </div>
                  )}
                </div>

                {/* Content Area */}
                <div className="text-gray-800 text-justify">
                  {!hasContent && !isWorking ? (
                    <div 
                      onClick={() => {
                        if (autoModeRunning) return // Don't allow clicks during auto-mode
                        // When auto-mode is ON, clicking ANY section triggers full auto-generation from the first pending section
                        if (autoMode) {
                          handleAutoGenerateAll()
                        } else {
                          handleGenerate(section.keys)
                        }
                      }}
                      className={`border-2 border-dashed border-gray-100 rounded-lg p-8 text-center hover:border-indigo-100 hover:bg-indigo-50/30 transition-all cursor-pointer group/empty ${autoModeRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                       <div className="text-gray-400 group-hover/empty:text-indigo-400 font-medium mb-1">
                         {autoMode ? 'Auto-generate pending sections' : 'Section not generated'}
                       </div>
                       <div className="text-xs text-gray-300 group-hover/empty:text-indigo-300">
                         {autoMode ? 'Click to start from first pending section' : 'Click to draft with AI'}
                       </div>
                    </div>
                  ) : (
                    <div>
                      {section.keys.map(keyName => (
                        <div key={keyName} className="mb-6 last:mb-0">
                          {section.keys.length > 1 && (
                             <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-4">{displayName[keyName] || keyName}</h4>
                          )}
                          
                          {/* Toolbar for each section text */}
                          {generated?.[keyName] && (
                             <div className="flex items-center justify-end gap-1 mb-2">
                               <button
                                 onClick={() => copySection(keyName)}
                                 className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                                 title={copiedKey === keyName ? "Copied" : "Copy to clipboard"}
                               >
                                  {copiedKey === keyName ? <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>}
                               </button>
                               <button
                                 onClick={() => !sectionLoading[keyName] && setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                 className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                 title="Regenerate"
                                 disabled={sectionLoading[keyName]}
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                               </button>
                               <button
                                 onClick={() => { setEditingKey(editingKey === keyName ? null : keyName); setEditDrafts(prev => ({ ...prev, [keyName]: generated?.[keyName] || '' })) }}
                                 className={`p-1.5 rounded transition-colors ${editingKey === keyName ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                                 title="Edit"
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                               </button>
                             </div>
                          )}
                          
                          {editingKey === keyName ? (
                            <div className="relative">
                              <textarea
                                className="w-full border-0 bg-gray-50 p-4 rounded-md text-gray-800 focus:ring-1 focus:ring-indigo-200 resize-none text-justify"
                                style={{
                                  fontFamily,
                                  fontSize,
                                  lineHeight
                                }}
                                value={editDrafts[keyName] ?? generated[keyName] ?? ''}
                                onChange={(e) => setEditDrafts(prev => ({ ...prev, [keyName]: e.target.value }))}
                                rows={Math.max(6, (generated[keyName] || '').split('\n').length)}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setEditingKey(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1">Cancel</button>
                                <button onClick={() => handleAutosaveSection(keyName)} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded shadow-sm hover:bg-indigo-700">Save</button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <div className="whitespace-pre-wrap text-justify"
                                   style={{
                                     fontFamily,
                                     fontSize,
                                     lineHeight
                                   }}>
                                {generated[keyName] || (isWorking ? <span className="text-gray-300 animate-pulse">Drafting content...</span> : '')}
                              </div>

                              {/* Inline Regeneration Dialog */}
                              {regenOpen[keyName] && (
                                <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1 bg-indigo-100 rounded-md">
                                       <svg className="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    </div>
                                    <label className="block text-xs font-semibold text-indigo-900">Refinement Instructions</label>
                                  </div>
                                  <textarea
                                    className="w-full border-indigo-200 rounded-md p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                                    value={regenRemarks[keyName] || ''}
                                    onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                    placeholder="Tell the AI what to improve (e.g. 'Make it more concise', 'Expand on the benefits', 'Fix the claim dependencies')..."
                                    rows={3}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded transition-colors border border-transparent hover:border-gray-200">Cancel</button>
                                    <button 
                                      onClick={() => handleRegenerateSection(keyName)} 
                                      disabled={sectionLoading[keyName]}
                                      className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm disabled:opacity-50 flex items-center gap-2"
                                    >
                                      {sectionLoading[keyName] && <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>}
                                      {sectionLoading[keyName] ? 'Refining...' : 'Regenerate Section'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* REMOVED: InlineSectionValidator - validation now handled by AI Review only */}
                              {/* Deterministic validation was causing delays and excessive refreshes */}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )})}

            {/* Drawings Section */}
            <div className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg mt-16 break-before-page">
               <div className="flex items-baseline justify-between mb-8">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    Drawings
                  </h3>
               </div>
               
               {/* Warning when figures have been added/deleted after freezing the sequence */}
               {sequenceOutdated && figureSequenceFinalized && (
                 <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                   <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>
                   <div>
                     <p className="text-sm text-amber-800 font-medium">Figure sequence may be outdated</p>
                     <p className="text-xs text-amber-700 mt-0.5">{sequenceWarningMessage}</p>
                   </div>
                 </div>
               )}

               <div className="space-y-16">
                 {unifiedFigures.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-lg">
                      <div className="text-gray-400 font-medium mb-1">No figures defined</div>
                      <div className="text-xs text-gray-300">Define figures in the Planner stage to see them here.</div>
                    </div>
                 ) : (
                   unifiedFigures.map((figure) => (
                     <div key={`${figure.type}-${figure.sourceId}`} className="flex flex-col items-center break-inside-avoid">
                       <div className="w-full max-w-3xl bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center bg-gray-50/50 p-4">
                          {figure.imageUrl ? (
                            <img 
                              src={figure.imageUrl} 
                              alt={`Figure ${figure.figureNo}`}
                              className="max-w-full max-h-[600px] object-contain mix-blend-multiply"
                              loading="lazy"
                              onError={(e) => {
                                // Hide broken image and show placeholder instead
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const placeholder = target.nextElementSibling as HTMLElement
                                if (placeholder) placeholder.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div 
                            className="text-center p-8 text-gray-400 flex-col items-center"
                            style={{ display: figure.imageUrl ? 'none' : 'flex' }}
                          >
                            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span className="text-sm font-medium">Figure {figure.figureNo}</span>
                            <span className="text-xs opacity-75 mt-1">
                              {figure.title.startsWith('Missing') ? figure.title : (figure.type === 'sketch' ? 'Sketch pending' : 'Draft pending')}
                            </span>
                          </div>
                       </div>
                       <div className="mt-4 text-center max-w-xl">
                         <div className="font-bold text-gray-900 uppercase tracking-widest text-sm flex items-center justify-center gap-2 flex-wrap">
                           FIG. {figure.figureNo}
                           {figure.type === 'sketch' && (
                             <span className="text-xs font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Sketch</span>
                           )}
                           {figure.isNew && <span className="text-xs font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">New</span>}
                           {/* Show fallback indicator if using English when a different language is preferred */}
                           {figure.type === 'diagram' && 
                            figure.displayLanguage === 'en' && 
                            preferredFigureLanguage !== 'en' && (
                             <span 
                               className="text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                               title={`No translation available for ${preferredFigureLanguage}. Using English version.`}
                             >
                               EN (no {preferredFigureLanguage.toUpperCase()} translation)
                             </span>
                           )}
                         </div>
                         {figure.title && <div className="text-sm text-gray-600 mt-1">{figure.title}</div>}
                       </div>
                     </div>
                   ))
                 )}
               </div>
            </div>
           
            {/* Validation & Export Section (Multi-jurisdiction - including Reference Draft) */}
            {isMultiJurisdiction && (
              (activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete) ||
              (activeJurisdiction !== 'REFERENCE' && latestDrafts[activeJurisdiction]?.version > 0)
            ) && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    // Apply the fix to the generated content
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    // Mark as needing save
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    // Scroll to export section or show export modal
                    const exportSection = document.getElementById('export-section')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section" className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
            
            {/* Validation & Export Section (Single jurisdiction) */}
            {!isMultiJurisdiction && Object.keys(generated).length > 0 && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    const exportSection = document.getElementById('export-section-single')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section-single" className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
        </div>
    </div>

      {/* All Instructions Modal */}
      {showAllInstructionsModal && (
        <AllInstructionsModal
          sessionId={session?.id || ''}
          patentId={patent?.id || ''}
          activeJurisdiction={activeJurisdiction}
          availableJurisdictions={availableJurisdictions}
          sectionLabels={displayName}
          onClose={() => setShowAllInstructionsModal(false)}
          onUpdate={() => {
            // Refresh instructions
            fetch(`/api/patents/${patent?.id}/drafting/user-instructions?sessionId=${session?.id}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
            })
              .then(res => res.json())
              .then(data => setUserInstructions(data.grouped || {}))
              .catch(console.error)
          }}
        />
      )}

      {/* Persona Manager Modal */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            setPersonaSelection(selection)
            if (selection.primaryPersonaId) {
              setUsePersonaStyle(true) // Auto-enable style when persona selected
            }
          }}
        />
      )}

      {/* Writing Samples Modal */}
      {showWritingSamplesModal && (
        <WritingSamplesModal
          onClose={() => setShowWritingSamplesModal(false)}
          onUpdate={() => {
            // Could refresh any UI state related to samples
          }}
        />
      )}

      {/* Auto-Generation Warning Modal */}
      {autoModeWarningModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xl">
                  🚀
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Auto-Generate Mode</h3>
                  <p className="text-sm text-gray-500">{autoModeWarningModal.pendingSections.length} section(s) to generate</p>
                </div>
              </div>
              <button 
                onClick={() => setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {/* Sections List */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Sections to generate:</h4>
                <div className="flex flex-wrap gap-2">
                  {autoModeWarningModal.pendingSections.map(key => (
                    <span key={key} className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">
                      {displayName[key] || key}
                    </span>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {autoModeWarningModal.warnings.length > 0 && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-amber-600 text-lg">⚠️</span>
                    <h4 className="text-sm font-semibold text-amber-800">Missing Context Detected</h4>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    The following context is missing and may reduce generation quality:
                  </p>
                  <div className="space-y-3">
                    {autoModeWarningModal.warnings.map((w, idx) => (
                      <div key={idx} className="bg-white/60 rounded-lg p-3 border border-amber-100">
                        <div className="flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5">
                            {w.type === 'priorArt' ? '📚' : w.type === 'figures' ? '🖼️' : '🔧'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-800">{displayName[w.section] || w.section}</span>
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded uppercase">
                                {w.type === 'priorArt' ? 'Prior Art' : w.type === 'figures' ? 'Figures' : 'Components'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">{w.message}</p>
                            <p className="text-xs text-amber-700 mt-1.5 italic">Impact: {w.impact}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 mt-3 pt-3 border-t border-amber-200">
                    💡 You can add this context now by closing this dialog and using the context panels, or continue with potentially reduced quality.
                  </p>
                </div>
              )}

              {/* No Warnings */}
              {autoModeWarningModal.warnings.length === 0 && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-600 text-lg">✅</span>
                    <p className="text-sm text-emerald-800 font-medium">All required context is available</p>
                  </div>
                  <p className="text-xs text-emerald-700 mt-2">
                    The AI has access to all the context it needs for optimal generation quality.
                  </p>
                </div>
              )}

              {/* Info */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
                <p>• Sections will be generated one by one in sequence</p>
                <p>• You can cancel at any time using the Stop button</p>
                <p>• Failed sections will be retried once automatically</p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setAutoModeWarningModal({ show: false, warnings: [], pendingSections: [] })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => startAutoGeneration(autoModeWarningModal.pendingSections)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2 ${
                  autoModeWarningModal.warnings.length > 0
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {autoModeWarningModal.warnings.length > 0 ? (
                  <>
                    <span>Continue Anyway</span>
                    <span className="text-xs opacity-75">({autoModeWarningModal.warnings.length} warning{autoModeWarningModal.warnings.length > 1 ? 's' : ''})</span>
                  </>
                ) : (
                  <>
                    <span>Start Generation</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
