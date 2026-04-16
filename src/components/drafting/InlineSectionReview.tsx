'use client'

import React, { useState, useCallback } from 'react'
import {
  ReviewItem,
  ReviewSeverity,
  ReviewItemStatus,
  SectionReviewState,
  FixHistoryEntry,
  DiffData,
  DiffSegment,
  calculateSectionStatus,
  getStatusIndicatorStyle,
  getSeverityStyle
} from '@/types/section-review'

// ============================================================================
// Props Interfaces
// ============================================================================

interface InlineSectionReviewProps {
  sectionKey: string
  sectionLabel: string
  reviewItems: ReviewItem[]
  fixHistory: FixHistoryEntry[]
  onApplyFix: (issueId: string, suggestedFix: string, fixPrompt: string) => Promise<{ success: boolean; fixedContent?: string; diffData?: DiffData; error?: string }>
  onIgnoreIssue: (issueId: string) => void
  onRevertFix: (fixHistoryId: string) => Promise<{ success: boolean; revertedContent?: string; error?: string }>
  isLoading?: boolean
  compact?: boolean
}

// ============================================================================
// Section Status Badge
// ============================================================================

function SectionStatusBadge({ 
  reviewItems, 
  onClick,
  isExpanded 
}: { 
  reviewItems: ReviewItem[]
  onClick: () => void
  isExpanded: boolean
}) {
  const status = calculateSectionStatus(reviewItems)
  const style = getStatusIndicatorStyle(status)
  
  if (status === 'no_issues') return null
  
  const pendingCount = reviewItems.filter(i => i.status === 'pending').length
  const fixedCount = reviewItems.filter(i => i.status === 'fixed').length
  
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
        transition-all duration-200 hover:shadow-sm
        ${style.bgColor} ${style.color}
      `}
    >
      <span className="text-sm">{style.emoji}</span>
      <span>
        {pendingCount > 0 && `${pendingCount} issue${pendingCount > 1 ? 's' : ''}`}
        {pendingCount > 0 && fixedCount > 0 && ' · '}
        {fixedCount > 0 && `${fixedCount} fixed`}
      </span>
      <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
        ▾
      </span>
    </button>
  )
}

// ============================================================================
// Review Item Card
// ============================================================================

function ReviewItemCard({
  item,
  onFix,
  onIgnore,
  isApplying,
  showFixHistory,
  fixHistory
}: {
  item: ReviewItem
  onFix: () => void
  onIgnore: () => void
  isApplying: boolean
  showFixHistory: boolean
  fixHistory: FixHistoryEntry[]
}) {
  const [expanded, setExpanded] = useState(false)
  const style = getSeverityStyle(item.severity)
  
  // Find related fix history entry
  const relatedFix = fixHistory.find(f => f.issueId === item.id)
  
  return (
    <div className={`
      rounded-lg border ${style.borderColor} ${style.bgColor}
      transition-all duration-200
    `}>
      {/* Header */}
      <div className="px-3 py-2.5 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{style.icon}</span>
            <span className={`text-xs font-medium uppercase tracking-wide ${style.color}`}>
              {item.severity}
            </span>
            {item.status !== 'pending' && (
              <span className={`
                text-xs px-1.5 py-0.5 rounded
                ${item.status === 'fixed' ? 'bg-emerald-100 text-emerald-700' : ''}
                ${item.status === 'ignored' ? 'bg-gray-100 text-gray-600' : ''}
                ${item.status === 'reverted' ? 'bg-amber-100 text-amber-700' : ''}
              `}>
                {item.status}
              </span>
            )}
          </div>
          <p className={`text-sm ${style.color} leading-relaxed`}>
            {item.message}
          </p>
        </div>
        
        {/* Expand button */}
        {item.suggestedFix && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      
      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 mt-2 pt-2">
          {/* Suggested Fix */}
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <span>💡</span> Suggested fix:
            </p>
            <p className="text-sm text-gray-700 bg-white/50 rounded px-2 py-1.5 border border-gray-100">
              {item.suggestedFix}
            </p>
          </div>
          
          {/* Actions */}
          {item.status === 'pending' && (
            <div className="flex items-center gap-2">
              <button
                onClick={onFix}
                disabled={isApplying}
                className={`
                  px-3 py-1.5 rounded-md text-sm font-medium
                  bg-emerald-600 text-white hover:bg-emerald-700
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors flex items-center gap-1.5
                `}
              >
                {isApplying ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Applying...
                  </>
                ) : (
                  <>
                    <span>🔧</span>
                    Apply Fix
                  </>
                )}
              </button>
              <button
                onClick={onIgnore}
                disabled={isApplying}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Ignore
              </button>
            </div>
          )}
          
          {/* Fix History for this item */}
          {showFixHistory && relatedFix && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Fix applied: {relatedFix.changeSummary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Diff Viewer Component
// ============================================================================

function DiffViewer({ diffData, onClose }: { diffData: DiffData; onClose: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Handle empty or no-change diffs
  if (!diffData.segments || diffData.segments.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
        <span className="text-sm text-gray-500">No visible changes</span>
        <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600">×</button>
      </div>
    )
  }
  
  const hasChanges = diffData.segments.some(s => s.type !== 'unchanged')
  if (!hasChanges) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
        <span className="text-sm text-gray-500">Content unchanged</span>
        <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600">×</button>
      </div>
    )
  }
  
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Changes Made</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{diffData.summary}</span>
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      
      <div className={`p-3 overflow-y-auto transition-all duration-200 ${isExpanded ? 'max-h-96' : 'max-h-48'}`}>
        <div className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words">
          {diffData.segments.map((segment, idx) => (
            <span
              key={idx}
              className={`
                ${segment.type === 'addition' ? 'bg-emerald-100 text-emerald-800 underline decoration-emerald-400' : ''}
                ${segment.type === 'deletion' ? 'bg-red-100 text-red-800 line-through' : ''}
                ${segment.type === 'modification' ? 'bg-amber-100 text-amber-800' : ''}
                ${segment.type === 'unchanged' ? '' : ''}
              `}
            >
              {segment.text}
            </span>
          ))}
        </div>
      </div>
      
      {/* Legend */}
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300"></span>
          Added
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-300"></span>
          Removed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>
          Changed
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// Fix History Panel
// ============================================================================

function FixHistoryPanel({
  fixHistory,
  onRevert,
  isReverting
}: {
  fixHistory: FixHistoryEntry[]
  onRevert: (id: string) => void
  isReverting: boolean
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  
  if (fixHistory.length === 0) return null
  
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
        <span>📋</span> Fix History ({fixHistory.length})
      </p>
      <div className="space-y-2">
        {fixHistory.map((entry) => (
          <div key={entry.id} className="bg-white border border-gray-100 rounded-lg">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700">{entry.changeSummary}</p>
                <p className="text-xs text-gray-400">
                  {new Date(entry.timestamp).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  {expandedId === entry.id ? 'Hide diff' : 'View diff'}
                </button>
                <button
                  onClick={() => onRevert(entry.id)}
                  disabled={isReverting}
                  className="text-xs text-amber-600 hover:text-amber-700 disabled:opacity-50"
                >
                  {isReverting ? 'Reverting...' : 'Revert'}
                </button>
              </div>
            </div>
            
            {/* Expanded diff view */}
            {expandedId === entry.id && entry.diffData && (
              <div className="px-3 pb-3">
                <DiffViewer 
                  diffData={entry.diffData} 
                  onClose={() => setExpandedId(null)} 
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function InlineSectionReview({
  sectionKey,
  sectionLabel,
  reviewItems,
  fixHistory,
  onApplyFix,
  onIgnoreIssue,
  onRevertFix,
  isLoading = false,
  compact = false
}: InlineSectionReviewProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null)
  const [isReverting, setIsReverting] = useState(false)
  const [showDiff, setShowDiff] = useState<string | null>(null)
  const [lastDiffData, setLastDiffData] = useState<DiffData | null>(null)
  
  // Filter items for this section
  const sectionItems = reviewItems.filter(item => item.sectionKey === sectionKey)
  const pendingItems = sectionItems.filter(item => item.status === 'pending')
  const fixedItems = sectionItems.filter(item => item.status === 'fixed')
  
  // Handle apply fix
  const handleApplyFix = useCallback(async (item: ReviewItem) => {
    setApplyingIssueId(item.id)
    try {
      const result = await onApplyFix(item.id, item.suggestedFix, item.fixPrompt)
      if (result.success && result.diffData) {
        setLastDiffData(result.diffData)
        setShowDiff(item.id)
      }
    } finally {
      setApplyingIssueId(null)
    }
  }, [onApplyFix])
  
  // Handle revert
  const handleRevert = useCallback(async (fixHistoryId: string) => {
    setIsReverting(true)
    try {
      await onRevertFix(fixHistoryId)
    } finally {
      setIsReverting(false)
    }
  }, [onRevertFix])
  
  // Don't render if no items
  if (sectionItems.length === 0) return null
  
  return (
    <div className="mb-4">
      {/* Collapsed Header */}
      <div className="flex items-center gap-2">
        <SectionStatusBadge
          reviewItems={sectionItems}
          onClick={() => setIsExpanded(!isExpanded)}
          isExpanded={isExpanded}
        />
        
        {!isExpanded && pendingItems.length > 0 && (
          <span className="text-xs text-gray-500">
            {pendingItems.filter(i => i.severity === 'error').length} errors,{' '}
            {pendingItems.filter(i => i.severity === 'warning').length} warnings
          </span>
        )}
        
        {isLoading && (
          <span className="text-xs text-gray-400 animate-pulse">Analyzing...</span>
        )}
      </div>
      
      {/* Expanded Review Panel */}
      {isExpanded && (
        <div className="mt-3 animate-in slide-in-from-top-2 duration-200">
          {/* Last applied diff viewer */}
          {showDiff && lastDiffData && (
            <div className="mb-3">
              <DiffViewer 
                diffData={lastDiffData} 
                onClose={() => setShowDiff(null)} 
              />
            </div>
          )}
          
          {/* Review Items */}
          <div className="space-y-2">
            {/* Pending items first */}
            {pendingItems.map(item => (
              <ReviewItemCard
                key={item.id}
                item={item}
                onFix={() => handleApplyFix(item)}
                onIgnore={() => onIgnoreIssue(item.id)}
                isApplying={applyingIssueId === item.id}
                showFixHistory={false}
                fixHistory={fixHistory}
              />
            ))}
            
            {/* Fixed/Ignored items collapsed */}
            {fixedItems.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-2">
                  {fixedItems.length} issue{fixedItems.length > 1 ? 's' : ''} resolved
                </p>
                {fixedItems.map(item => (
                  <ReviewItemCard
                    key={item.id}
                    item={item}
                    onFix={() => {}}
                    onIgnore={() => {}}
                    isApplying={false}
                    showFixHistory={true}
                    fixHistory={fixHistory}
                  />
                ))}
              </div>
            )}
          </div>
          
          {/* Fix History */}
          <FixHistoryPanel
            fixHistory={fixHistory.filter(f => 
              sectionItems.some(item => item.id === f.issueId)
            )}
            onRevert={handleRevert}
            isReverting={isReverting}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Utility: Compute diff segments from before/after text
// ============================================================================

export function computeDiffSegments(before: string, after: string): DiffData {
  // Simple word-based diff algorithm
  const beforeWords = before.split(/(\s+)/)
  const afterWords = after.split(/(\s+)/)
  
  const segments: DiffSegment[] = []
  let addedCount = 0
  let removedCount = 0
  
  // Use LCS (Longest Common Subsequence) for better diff
  const lcs = computeLCS(beforeWords, afterWords)
  
  let beforeIdx = 0
  let afterIdx = 0
  let lcsIdx = 0
  
  while (beforeIdx < beforeWords.length || afterIdx < afterWords.length) {
    if (lcsIdx < lcs.length && beforeIdx < beforeWords.length && beforeWords[beforeIdx] === lcs[lcsIdx]) {
      if (afterIdx < afterWords.length && afterWords[afterIdx] === lcs[lcsIdx]) {
        // Common word
        segments.push({ type: 'unchanged', text: beforeWords[beforeIdx] })
        beforeIdx++
        afterIdx++
        lcsIdx++
      } else if (afterIdx < afterWords.length) {
        // Added word
        segments.push({ type: 'addition', text: afterWords[afterIdx] })
        addedCount++
        afterIdx++
      }
    } else if (beforeIdx < beforeWords.length && (lcsIdx >= lcs.length || beforeWords[beforeIdx] !== lcs[lcsIdx])) {
      // Removed word
      segments.push({ type: 'deletion', text: beforeWords[beforeIdx] })
      removedCount++
      beforeIdx++
    } else if (afterIdx < afterWords.length) {
      // Added word
      segments.push({ type: 'addition', text: afterWords[afterIdx] })
      addedCount++
      afterIdx++
    }
  }
  
  return {
    beforeText: before,
    afterText: after,
    segments,
    summary: `Added ${addedCount} words, removed ${removedCount} words`
  }
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
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
  
  // Backtrack to find LCS
  const lcs: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  
  return lcs
}

