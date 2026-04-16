'use client'

import { useState, useCallback, useEffect } from 'react'
import type { 
  ValidationIssue, 
  ValidationSeverity, 
  SectionValidationRules 
} from '@/types/validation'
import { SEVERITY_COLORS, SECTION_LABELS } from '@/types/validation'

// ============================================================================
// Types
// ============================================================================

interface InlineSectionValidatorProps {
  /** Section key identifier */
  sectionKey: string
  
  /** Current section content */
  content: string
  
  /** Jurisdiction for validation rules */
  jurisdiction: string
  
  /** Patent ID for API calls */
  patentId: string
  
  /** Session ID for API calls */
  sessionId: string
  
  /** Validation issues for this section */
  issues: ValidationIssue[]
  
  /** Validation rules from DB (optional - will be fetched if not provided) */
  rules?: SectionValidationRules
  
  /** Callback when fix is applied */
  onFix: (fixedContent: string) => void
  
  /** Callback when issues change (after ignore/fix) */
  onIssuesChange: (issues: ValidationIssue[]) => void
  
  /** Whether validation is currently loading */
  isLoading?: boolean
  
  /** Compact mode - just show badge */
  compact?: boolean
}

// ============================================================================
// Severity Icons
// ============================================================================

function SeverityIcon({ severity, className = '' }: { severity: ValidationSeverity; className?: string }) {
  const colors = SEVERITY_COLORS[severity]
  
  if (severity === 'notice') {
    return (
      <svg className={`w-4 h-4 ${colors.icon} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  
  if (severity === 'warning') {
    return (
      <svg className={`w-4 h-4 ${colors.icon} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  }
  
  // error
  return (
    <svg className={`w-4 h-4 ${colors.icon} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

// ============================================================================
// Badge Component
// ============================================================================

interface ValidationBadgeProps {
  issues: ValidationIssue[]
  onClick: () => void
  isExpanded: boolean
  isLoading?: boolean
}

function ValidationBadge({ issues, onClick, isExpanded, isLoading }: ValidationBadgeProps) {
  // Filter out ignored issues
  const activeIssues = issues.filter(i => !i.isIgnored && !i.isFixed)
  
  if (isLoading) {
    return (
      <button
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 animate-pulse"
        disabled
      >
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Checking...</span>
      </button>
    )
  }
  
  if (activeIssues.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>OK</span>
      </span>
    )
  }
  
  // Count by severity
  const errorCount = activeIssues.filter(i => i.severity === 'error').length
  const warningCount = activeIssues.filter(i => i.severity === 'warning').length
  const noticeCount = activeIssues.filter(i => i.severity === 'notice').length
  
  // Determine badge severity (highest priority)
  let badgeSeverity: ValidationSeverity = 'notice'
  if (errorCount > 0) badgeSeverity = 'error'
  else if (warningCount > 0) badgeSeverity = 'warning'
  
  const colors = SEVERITY_COLORS[badgeSeverity]
  
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200
        ${colors.badge} border ${colors.border}
        hover:shadow-sm hover:scale-105 active:scale-95
        focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-amber-300`}
      aria-expanded={isExpanded}
      aria-label={`${activeIssues.length} validation issue${activeIssues.length !== 1 ? 's' : ''}`}
    >
      <SeverityIcon severity={badgeSeverity} className="w-3.5 h-3.5" />
      <span>{activeIssues.length}</span>
      <svg 
        className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

// ============================================================================
// Issue Card Component
// ============================================================================

interface IssueCardProps {
  issue: ValidationIssue
  onFix: () => void
  onIgnore: () => void
  isFixing: boolean
}

function IssueCard({ issue, onFix, onIgnore, isFixing }: IssueCardProps) {
  const colors = SEVERITY_COLORS[issue.severity]
  
  const severityLabel = {
    notice: 'Notice',
    warning: 'Warning',
    error: 'Error'
  }[issue.severity]
  
  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4 transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${colors.badge}`}>
            <SeverityIcon severity={issue.severity} className="w-3 h-3" />
            {severityLabel}
          </span>
          <span className="text-xs text-slate-400 font-mono">{issue.code}</span>
        </div>
      </div>
      
      {/* Message */}
      <p className={`mt-2 text-sm ${colors.text} leading-relaxed`}>
        {issue.message}
      </p>
      
      {/* Suggested Fix */}
      {issue.suggestedFix && (
        <div className="mt-3 p-3 rounded-md bg-white/60 border border-slate-200/50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>Suggested Fix</span>
          </div>
          <p className="text-sm text-slate-700">{issue.suggestedFix}</p>
        </div>
      )}
      
      {/* Related Sections */}
      {issue.relatedSections && issue.relatedSections.length > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Related:</span>
          {issue.relatedSections.map(s => (
            <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {SECTION_LABELS[s] || s}
            </span>
          ))}
        </div>
      )}
      
      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onFix}
          disabled={isFixing || !issue.suggestedFix}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-all duration-200
            ${isFixing 
              ? 'bg-slate-100 text-slate-400 cursor-wait' 
              : 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950'}
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-500`}
        >
          {isFixing ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Fixing...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Fix</span>
            </>
          )}
        </button>
        
        <button
          onClick={onIgnore}
          disabled={isFixing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            text-slate-600 bg-white border border-slate-200
            transition-all duration-200
            hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
          <span>Ignore</span>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function InlineSectionValidator({
  sectionKey,
  content,
  jurisdiction,
  patentId,
  sessionId,
  issues,
  rules,
  onFix,
  onIssuesChange,
  isLoading = false,
  compact = false
}: InlineSectionValidatorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [fixingIssueId, setFixingIssueId] = useState<string | null>(null)
  
  // Auto-expand if there are errors
  useEffect(() => {
    const hasErrors = issues.some(i => i.severity === 'error' && !i.isIgnored && !i.isFixed)
    if (hasErrors && !compact) {
      setIsExpanded(true)
    }
  }, [issues, compact])
  
  // Filter active issues for this section
  const sectionIssues = issues.filter(i => 
    i.sectionId === sectionKey && !i.isIgnored && !i.isFixed
  )
  
  // Handle fix action
  const handleFix = useCallback(async (issue: ValidationIssue) => {
    if (!issue.suggestedFix) return
    
    setFixingIssueId(issue.id)
    
    try {
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
          sectionKey,
          issue,
          currentContent: content
        })
      })
      
      const data = await res.json()
      
      if (data.success && data.fixedContent) {
        // Apply the fix
        onFix(data.fixedContent)
        
        // Mark issue as fixed
        const updatedIssues = issues.map(i => 
          i.id === issue.id ? { ...i, isFixed: true } : i
        )
        onIssuesChange(updatedIssues)
      } else {
        console.error('Fix failed:', data.error)
        // Could show a toast notification here
      }
    } catch (err) {
      console.error('Error applying fix:', err)
    } finally {
      setFixingIssueId(null)
    }
  }, [patentId, sessionId, jurisdiction, sectionKey, content, issues, onFix, onIssuesChange])
  
  // Handle ignore action
  const handleIgnore = useCallback(async (issueId: string) => {
    // Update locally immediately
    const updatedIssues = issues.map(i => 
      i.id === issueId ? { ...i, isIgnored: true } : i
    )
    onIssuesChange(updatedIssues)
    
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
          issueId
        })
      })
    } catch (err) {
      console.error('Error ignoring issue:', err)
      // Local state already updated
    }
  }, [patentId, sessionId, jurisdiction, issues, onIssuesChange])
  
  // Compact mode - just the badge
  if (compact) {
    return (
      <ValidationBadge 
        issues={sectionIssues} 
        onClick={() => setIsExpanded(!isExpanded)}
        isExpanded={isExpanded}
        isLoading={isLoading}
      />
    )
  }
  
  return (
    <div className="mt-2">
      {/* Badge Row */}
      <div className="flex items-center gap-2">
        <ValidationBadge 
          issues={sectionIssues} 
          onClick={() => setIsExpanded(!isExpanded)}
          isExpanded={isExpanded}
          isLoading={isLoading}
        />
        
        {/* Quick summary text */}
        {sectionIssues.length > 0 && !isExpanded && (
          <span className="text-xs text-slate-500">
            Click to review {sectionIssues.length} issue{sectionIssues.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      
      {/* Collapsible Issues Panel */}
      {isExpanded && sectionIssues.length > 0 && (
        <div 
          className="mt-3 space-y-3 animate-in slide-in-from-top-2 duration-200"
          role="region"
          aria-label={`Validation issues for ${SECTION_LABELS[sectionKey] || sectionKey}`}
        >
          {sectionIssues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onFix={() => handleFix(issue)}
              onIgnore={() => handleIgnore(issue.id)}
              isFixing={fixingIssueId === issue.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Summary Badge for Stage Navigation
// ============================================================================

interface ValidationSummaryBadgeProps {
  issues: ValidationIssue[]
  onClick?: () => void
}

export function ValidationSummaryBadge({ issues, onClick }: ValidationSummaryBadgeProps) {
  const activeIssues = issues.filter(i => !i.isIgnored && !i.isFixed)
  
  if (activeIssues.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Validated
      </span>
    )
  }
  
  const errorCount = activeIssues.filter(i => i.severity === 'error').length
  const warningCount = activeIssues.filter(i => i.severity === 'warning').length
  
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium
        bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
    >
      {errorCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-rose-600">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          {errorCount}
        </span>
      )}
      {warningCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-amber-600">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {warningCount}
        </span>
      )}
      <span>{activeIssues.length} issues</span>
    </button>
  )
}

