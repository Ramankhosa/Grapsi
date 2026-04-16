'use client'

import { motion } from 'framer-motion'
import { BookOpen, FileText, Target, Clock, CheckCircle, AlertCircle } from 'lucide-react'

interface PaperProgressCardProps {
  title: string
  paperType?: string
  progress: number // 0-100
  totalWords: number
  targetWords?: number
  citationsCount: number
  targetCitations?: number
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'
  sections?: {
    completed: number
    total: number
    required: number
  }
  lastModified?: string
  className?: string
}

export default function PaperProgressCard({
  title,
  paperType,
  progress,
  totalWords,
  targetWords,
  citationsCount,
  targetCitations,
  status,
  sections,
  lastModified,
  className = ''
}: PaperProgressCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'IN_PROGRESS':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'DRAFT':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      default:
        return 'text-slate-600 bg-slate-50 border-slate-200'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-4 h-4" />
      case 'IN_PROGRESS':
        return <Clock className="w-4 h-4" />
      case 'DRAFT':
        return <FileText className="w-4 h-4" />
      default:
        return <AlertCircle className="w-4 h-4" />
    }
  }

  const getProgressColor = (progress: number) => {
    if (progress >= 90) return 'bg-green-500'
    if (progress >= 70) return 'bg-blue-500'
    if (progress >= 50) return 'bg-yellow-500'
    return 'bg-orange-500'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-all duration-200 ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-slate-900 truncate mb-1">
            {title}
          </h3>
          {paperType && (
            <p className="text-sm text-slate-600 mb-2">{paperType}</p>
          )}

          <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
            {getStatusIcon(status)}
            {status.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* Progress Circle */}
      <div className="flex items-center justify-center mb-6">
        <div className="relative w-24 h-24">
          <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-slate-200"
            />
            <motion.circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className={getProgressColor(progress)}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: progress / 100 }}
              transition={{ duration: 1, delay: 0.2 }}
              style={{
                strokeDasharray: `${2 * Math.PI * 10}`,
                strokeDashoffset: `${2 * Math.PI * 10 * (1 - progress / 100)}`
              }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-slate-900">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-slate-600 mb-1">
            <BookOpen className="w-3 h-3" />
            <span className="text-xs">Words</span>
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {totalWords.toLocaleString()}
          </div>
          {targetWords && (
            <div className="text-xs text-slate-500">
              / {targetWords.toLocaleString()}
            </div>
          )}
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-slate-600 mb-1">
            <Target className="w-3 h-3" />
            <span className="text-xs">Citations</span>
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {citationsCount}
          </div>
          {targetCitations && (
            <div className="text-xs text-slate-500">
              / {targetCitations}
            </div>
          )}
        </div>
      </div>

      {/* Sections Progress */}
      {sections && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-600">Sections</span>
            <span className="font-medium text-slate-900">
              {sections.completed}/{sections.total}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div
              className="bg-violet-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(sections.completed / sections.total) * 100}%` }}
            />
          </div>
          {sections.required > sections.completed && (
            <div className="text-xs text-orange-600 mt-1">
              {sections.required - sections.completed} required sections remaining
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {lastModified && (
        <div className="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-100">
          <span>Modified {new Date(lastModified).toLocaleDateString()}</span>
        </div>
      )}
    </motion.div>
  )
}
