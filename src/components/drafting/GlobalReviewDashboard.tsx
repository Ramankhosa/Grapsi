'use client'

import React, { useState, useMemo } from 'react'
import {
  ReviewItem,
  SectionReviewState,
  GlobalReviewState,
  FixHistoryEntry,
  calculateSectionStatus,
  getStatusIndicatorStyle,
  getSeverityStyle
} from '@/types/section-review'

// ============================================================================
// Props Interface
// ============================================================================

interface GlobalReviewDashboardProps {
  reviewItems: ReviewItem[]
  fixHistory: FixHistoryEntry[]
  sections: Array<{ key: string; label: string }>
  overallScore: number
  recommendation: string
  reviewedAt: string
  onScrollToSection: (sectionKey: string) => void
  onRunReview: () => void
  isReviewRunning: boolean
}

// ============================================================================
// Summary Stats Card
// ============================================================================

function SummaryStatsCard({
  totalIssues,
  pendingCount,
  fixedCount,
  ignoredCount,
  errorCount,
  warningCount,
  noticeCount,
  overallScore
}: {
  totalIssues: number
  pendingCount: number
  fixedCount: number
  ignoredCount: number
  errorCount: number
  warningCount: number
  noticeCount: number
  overallScore: number
}) {
  // Score color based on value
  const scoreColor = overallScore >= 80 ? 'text-emerald-600' :
    overallScore >= 60 ? 'text-amber-600' : 'text-red-600'
  const scoreBg = overallScore >= 80 ? 'bg-emerald-50' :
    overallScore >= 60 ? 'bg-amber-50' : 'bg-red-50'
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Overall Score */}
      <div className={`${scoreBg} rounded-xl p-4 text-center`}>
        <p className={`text-3xl font-bold ${scoreColor}`}>{overallScore}</p>
        <p className="text-xs text-gray-500 mt-1">Overall Score</p>
      </div>
      
      {/* Issue Breakdown */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Pending</span>
          <span className="text-lg font-semibold text-gray-800">{pendingCount}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-gray-600">Fixed</span>
          <span className="text-lg font-semibold text-emerald-600">{fixedCount}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-gray-600">Ignored</span>
          <span className="text-lg font-semibold text-gray-400">{ignoredCount}</span>
        </div>
      </div>
      
      {/* Severity Breakdown */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-red-600">🔴 Errors</span>
          <span className="text-lg font-semibold text-red-600">{errorCount}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-amber-600">🟡 Warnings</span>
          <span className="text-lg font-semibold text-amber-600">{warningCount}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-slate-600">🔵 Notices</span>
          <span className="text-lg font-semibold text-slate-600">{noticeCount}</span>
        </div>
      </div>
      
      {/* Total */}
      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <p className="text-3xl font-bold text-gray-800">{totalIssues}</p>
        <p className="text-xs text-gray-500 mt-1">Total Issues</p>
      </div>
    </div>
  )
}

// ============================================================================
// Section Row
// ============================================================================

function SectionRow({
  sectionKey,
  sectionLabel,
  reviewItems,
  onClick
}: {
  sectionKey: string
  sectionLabel: string
  reviewItems: ReviewItem[]
  onClick: () => void
}) {
  const sectionItems = reviewItems.filter(item => item.sectionKey === sectionKey)
  const status = calculateSectionStatus(sectionItems)
  const style = getStatusIndicatorStyle(status)
  
  const pendingCount = sectionItems.filter(i => i.status === 'pending').length
  const errorCount = sectionItems.filter(i => i.severity === 'error' && i.status === 'pending').length
  const warningCount = sectionItems.filter(i => i.severity === 'warning' && i.status === 'pending').length
  const fixedCount = sectionItems.filter(i => i.status === 'fixed').length
  
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center justify-between p-3 rounded-lg
        border transition-all duration-200
        hover:shadow-sm hover:border-gray-300
        ${style.bgColor}
      `}
    >
      <div className="flex items-center gap-3">
        {/* Status Badge */}
        <span className={`
          w-6 h-6 rounded-full flex items-center justify-center
          text-xs font-bold ${style.color}
          ${status === 'no_issues' ? 'bg-gray-100' : ''}
        `}>
          {style.emoji}
        </span>
        
        {/* Section Label */}
        <span className="text-sm font-medium text-gray-800">{sectionLabel}</span>
      </div>
      
      {/* Issue Counts */}
      <div className="flex items-center gap-3 text-xs">
        {errorCount > 0 && (
          <span className="text-red-600">{errorCount} errors</span>
        )}
        {warningCount > 0 && (
          <span className="text-amber-600">{warningCount} warnings</span>
        )}
        {fixedCount > 0 && (
          <span className="text-emerald-600">{fixedCount} fixed</span>
        )}
        {sectionItems.length === 0 && (
          <span className="text-gray-400">No issues</span>
        )}
        
        {/* Arrow */}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  )
}

// ============================================================================
// Issue List Panel
// ============================================================================

function IssueListPanel({
  reviewItems,
  onScrollToSection
}: {
  reviewItems: ReviewItem[]
  onScrollToSection: (sectionKey: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'fixed' | 'errors'>('all')
  
  const filteredItems = useMemo(() => {
    switch (filter) {
      case 'pending':
        return reviewItems.filter(i => i.status === 'pending')
      case 'fixed':
        return reviewItems.filter(i => i.status === 'fixed')
      case 'errors':
        return reviewItems.filter(i => i.severity === 'error' && i.status === 'pending')
      default:
        return reviewItems
    }
  }, [reviewItems, filter])
  
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">All Issues</h3>
        
        {/* Filter Tabs */}
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {(['all', 'pending', 'errors', 'fixed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                px-2.5 py-1 text-xs rounded-md transition-colors
                ${filter === f ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}
              `}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'errors' ? 'Errors' : 'Fixed'}
            </button>
          ))}
        </div>
      </div>
      
      {/* Issue List */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No issues match this filter</p>
        ) : (
          filteredItems.map(item => {
            const severity = getSeverityStyle(item.severity)
            return (
              <button
                key={item.id}
                onClick={() => onScrollToSection(item.sectionKey)}
                className={`
                  w-full text-left p-3 rounded-lg border
                  ${severity.bgColor} ${severity.borderColor}
                  hover:shadow-sm transition-all
                `}
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm">{severity.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-500">{item.sectionLabel}</span>
                      {item.status !== 'pending' && (
                        <span className={`
                          text-xs px-1.5 py-0.5 rounded
                          ${item.status === 'fixed' ? 'bg-emerald-100 text-emerald-700' : ''}
                          ${item.status === 'ignored' ? 'bg-gray-100 text-gray-600' : ''}
                        `}>
                          {item.status}
                        </span>
                      )}
                    </div>
                    <p className={`text-sm ${severity.color} line-clamp-2`}>{item.message}</p>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function GlobalReviewDashboard({
  reviewItems,
  fixHistory,
  sections,
  overallScore,
  recommendation,
  reviewedAt,
  onScrollToSection,
  onRunReview,
  isReviewRunning
}: GlobalReviewDashboardProps) {
  const [view, setView] = useState<'sections' | 'issues'>('sections')
  
  // Compute stats
  const stats = useMemo(() => {
    const pending = reviewItems.filter(i => i.status === 'pending')
    const fixed = reviewItems.filter(i => i.status === 'fixed')
    const ignored = reviewItems.filter(i => i.status === 'ignored')
    const errors = reviewItems.filter(i => i.severity === 'error')
    const warnings = reviewItems.filter(i => i.severity === 'warning')
    const notices = reviewItems.filter(i => i.severity === 'notice')
    
    return {
      totalIssues: reviewItems.length,
      pendingCount: pending.length,
      fixedCount: fixed.length,
      ignoredCount: ignored.length,
      errorCount: errors.filter(i => i.status === 'pending').length,
      warningCount: warnings.filter(i => i.status === 'pending').length,
      noticeCount: notices.filter(i => i.status === 'pending').length
    }
  }, [reviewItems])
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <span>🔍</span> AI Review Dashboard
          </h2>
          {reviewedAt && (
            <p className="text-xs text-gray-500 mt-0.5">
              Last reviewed: {new Date(reviewedAt).toLocaleString()}
            </p>
          )}
        </div>
        
        <button
          onClick={onRunReview}
          disabled={isReviewRunning}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium
            bg-indigo-600 text-white hover:bg-indigo-700
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors flex items-center gap-2
          `}
        >
          {isReviewRunning ? (
            <>
              <span className="animate-spin">⏳</span>
              Running Review...
            </>
          ) : (
            <>
              <span>🔄</span>
              Re-run Review
            </>
          )}
        </button>
      </div>
      
      {/* Content */}
      <div className="p-5">
        {/* Recommendation Banner */}
        {recommendation && (
          <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-sm text-slate-700">
              <span className="font-medium">📋 Recommendation:</span> {recommendation}
            </p>
          </div>
        )}
        
        {/* Stats */}
        <SummaryStatsCard {...stats} overallScore={overallScore} />
        
        {/* View Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setView('sections')}
            className={`
              px-4 py-2 text-sm rounded-lg transition-colors
              ${view === 'sections' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
            `}
          >
            By Section
          </button>
          <button
            onClick={() => setView('issues')}
            className={`
              px-4 py-2 text-sm rounded-lg transition-colors
              ${view === 'issues' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
            `}
          >
            All Issues
          </button>
        </div>
        
        {/* Section View */}
        {view === 'sections' && (
          <div className="space-y-2">
            {sections.map(section => (
              <SectionRow
                key={section.key}
                sectionKey={section.key}
                sectionLabel={section.label}
                reviewItems={reviewItems}
                onClick={() => onScrollToSection(section.key)}
              />
            ))}
          </div>
        )}
        
        {/* Issues View */}
        {view === 'issues' && (
          <IssueListPanel
            reviewItems={reviewItems}
            onScrollToSection={onScrollToSection}
          />
        )}
        
        {/* Fix History Summary */}
        {fixHistory.length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span>📋</span> Recent Changes ({fixHistory.length})
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {fixHistory.slice(0, 5).map(entry => (
                <div key={entry.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                  <span className="text-gray-700">{entry.changeSummary}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

