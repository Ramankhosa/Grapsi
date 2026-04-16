'use client'

import { motion } from 'framer-motion'
import {
  BookOpen,
  FileText,
  Target,
  Clock,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Calendar
} from 'lucide-react'

interface PaperStatsWidgetProps {
  totalWords: number
  targetWords?: number
  sectionsCompleted: number
  sectionsTotal: number
  sectionsRequired: number
  citationsImported: number
  citationsUsed: number
  citationsUnused: number
  timeSpentWriting?: number // in minutes
  lastActivity?: string
  className?: string
}

export default function PaperStatsWidget({
  totalWords,
  targetWords,
  sectionsCompleted,
  sectionsTotal,
  sectionsRequired,
  citationsImported,
  citationsUsed,
  citationsUnused,
  timeSpentWriting,
  lastActivity,
  className = ''
}: PaperStatsWidgetProps) {
  const wordsProgress = targetWords ? Math.min((totalWords / targetWords) * 100, 100) : 0
  const sectionsProgress = (sectionsCompleted / sectionsTotal) * 100
  const citationsUsedProgress = citationsImported > 0 ? (citationsUsed / citationsImported) * 100 : 0

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const stats = [
    {
      label: 'Word Count',
      value: totalWords.toLocaleString(),
      target: targetWords?.toLocaleString(),
      progress: wordsProgress,
      color: 'bg-blue-500',
      icon: BookOpen
    },
    {
      label: 'Sections',
      value: `${sectionsCompleted}/${sectionsTotal}`,
      target: sectionsRequired > sectionsCompleted ? `${sectionsRequired} required` : null,
      progress: sectionsProgress,
      color: 'bg-violet-500',
      icon: FileText
    },
    {
      label: 'Citations Used',
      value: `${citationsUsed}/${citationsImported}`,
      target: citationsUnused > 0 ? `${citationsUnused} unused` : null,
      progress: citationsUsedProgress,
      color: 'bg-green-500',
      icon: Target
    }
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border border-slate-200 rounded-lg p-6 ${className}`}
    >
      <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-violet-600" />
        Writing Statistics
      </h3>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
            className="bg-slate-50 rounded-lg p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${stat.color.replace('bg-', 'bg-opacity-20 ')}`}>
                <stat.icon className={`w-4 h-4 ${stat.color.replace('bg-', 'text-')}`} />
              </div>
              <span className="text-sm font-medium text-slate-600">{stat.label}</span>
            </div>

            <div className="mb-2">
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              {stat.target && (
                <div className="text-xs text-slate-500">{stat.target}</div>
              )}
            </div>

            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${stat.color}`}
                style={{ width: `${stat.progress}%` }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="text-center p-3 bg-slate-50 rounded-lg">
          <div className="text-lg font-bold text-slate-900">{totalWords}</div>
          <div className="text-xs text-slate-600">Total Words</div>
        </div>

        <div className="text-center p-3 bg-slate-50 rounded-lg">
          <div className="text-lg font-bold text-slate-900">{citationsImported}</div>
          <div className="text-xs text-slate-600">Citations</div>
        </div>

        {timeSpentWriting && (
          <div className="text-center p-3 bg-slate-50 rounded-lg">
            <div className="text-lg font-bold text-slate-900">{formatTime(timeSpentWriting)}</div>
            <div className="text-xs text-slate-600">Time Writing</div>
          </div>
        )}

        <div className="text-center p-3 bg-slate-50 rounded-lg">
          <div className={`text-lg font-bold ${
            sectionsCompleted >= sectionsRequired ? 'text-green-600' : 'text-orange-600'
          }`}>
            {sectionsCompleted >= sectionsRequired ? (
              <CheckCircle className="w-6 h-6 mx-auto" />
            ) : (
              sectionsCompleted
            )}
          </div>
          <div className="text-xs text-slate-600">Sections Done</div>
        </div>
      </div>

      {/* Citation Usage Breakdown */}
      <div className="bg-slate-50 rounded-lg p-4 mb-6">
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Citation Usage</h4>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-green-600">{citationsUsed}</div>
            <div className="text-xs text-slate-600">Used</div>
          </div>
          <div>
            <div className="text-lg font-bold text-orange-600">{citationsUnused}</div>
            <div className="text-xs text-slate-600">Unused</div>
          </div>
          <div>
            <div className="text-lg font-bold text-blue-600">{citationsImported}</div>
            <div className="text-xs text-slate-600">Total</div>
          </div>
        </div>
      </div>

      {/* Footer with last activity */}
      {lastActivity && (
        <div className="flex items-center gap-2 text-xs text-slate-500 pt-4 border-t border-slate-100">
          <Calendar className="w-3 h-3" />
          Last activity: {new Date(lastActivity).toLocaleDateString()} at {new Date(lastActivity).toLocaleTimeString()}
        </div>
      )}
    </motion.div>
  )
}
