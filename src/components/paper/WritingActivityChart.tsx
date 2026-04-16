'use client'

import { motion } from 'framer-motion'
import { BarChart3, TrendingUp, Calendar, Clock, BookOpen } from 'lucide-react'

interface WritingSession {
  date: string
  wordsWritten: number
  timeSpent: number // in minutes
  sectionsCompleted: number
}

interface WritingActivityChartProps {
  sessions: WritingSession[]
  timeRange?: 'week' | 'month' | 'quarter'
  className?: string
}

export default function WritingActivityChart({
  sessions,
  timeRange = 'week',
  className = ''
}: WritingActivityChartProps) {
  // Group sessions by date and calculate totals
  const groupedSessions = sessions.reduce((acc, session) => {
    const date = new Date(session.date).toISOString().split('T')[0]
    if (!acc[date]) {
      acc[date] = {
        date,
        totalWords: 0,
        totalTime: 0,
        sectionsCompleted: 0,
        sessions: 0
      }
    }
    acc[date].totalWords += session.wordsWritten
    acc[date].totalTime += session.timeSpent
    acc[date].sectionsCompleted += session.sectionsCompleted
    acc[date].sessions += 1
    return acc
  }, {} as Record<string, {
    date: string
    totalWords: number
    totalTime: number
    sectionsCompleted: number
    sessions: number
  }>)

  const chartData = Object.values(groupedSessions).sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  // Calculate max values for scaling
  const maxWords = Math.max(...chartData.map(d => d.totalWords), 1)
  const maxTime = Math.max(...chartData.map(d => d.totalTime), 1)

  // Generate date labels based on time range
  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr)
    switch (timeRange) {
      case 'week':
        return date.toLocaleDateString('en-US', { weekday: 'short' })
      case 'month':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      case 'quarter':
        return date.toLocaleDateString('en-US', { month: 'short' })
      default:
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  // Calculate summary stats
  const totalWords = chartData.reduce((sum, d) => sum + d.totalWords, 0)
  const totalTime = chartData.reduce((sum, d) => sum + d.totalTime, 0)
  const totalSections = chartData.reduce((sum, d) => sum + d.sectionsCompleted, 0)
  const avgWordsPerSession = sessions.length > 0 ? Math.round(totalWords / sessions.length) : 0
  const avgTimePerSession = sessions.length > 0 ? Math.round(totalTime / sessions.length) : 0

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  if (chartData.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-white border border-slate-200 rounded-lg p-6 text-center ${className}`}
      >
        <BarChart3 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 mb-2">No Writing Activity Yet</h3>
        <p className="text-slate-600">Start writing to see your activity chart here.</p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border border-slate-200 rounded-lg p-6 ${className}`}
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-violet-600" />
          Writing Activity
        </h3>
        <select
          value={timeRange}
          onChange={() => {}} // Could implement time range switching
          className="text-sm border border-slate-300 rounded px-3 py-1"
        >
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
        </select>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <div className="text-lg font-bold text-blue-600">{totalWords.toLocaleString()}</div>
          <div className="text-xs text-slate-600">Total Words</div>
        </div>
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-lg font-bold text-green-600">{formatTime(totalTime)}</div>
          <div className="text-xs text-slate-600">Time Writing</div>
        </div>
        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <div className="text-lg font-bold text-purple-600">{totalSections}</div>
          <div className="text-xs text-slate-600">Sections Done</div>
        </div>
        <div className="text-center p-3 bg-orange-50 rounded-lg">
          <div className="text-lg font-bold text-orange-600">{sessions.length}</div>
          <div className="text-xs text-slate-600">Sessions</div>
        </div>
      </div>

      {/* Averages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <div>
            <div className="text-sm font-medium text-slate-900">{avgWordsPerSession.toLocaleString()}</div>
            <div className="text-xs text-slate-600">Avg words per session</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
          <Clock className="w-4 h-4 text-green-600" />
          <div>
            <div className="text-sm font-medium text-slate-900">{formatTime(avgTimePerSession)}</div>
            <div className="text-xs text-slate-600">Avg time per session</div>
          </div>
        </div>
      </div>

      {/* Activity Chart */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-900">Daily Activity</h4>

        <div className="space-y-3">
          {chartData.map((day, index) => (
            <motion.div
              key={day.date}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center gap-4"
            >
              <div className="w-16 text-sm text-slate-600 font-medium">
                {getDateLabel(day.date)}
              </div>

              {/* Words bar */}
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 bg-slate-200 rounded-full h-3">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(day.totalWords / maxWords) * 100}%` }}
                    transition={{ duration: 0.8, delay: index * 0.1 }}
                    className="bg-blue-500 h-3 rounded-full"
                  />
                </div>
                <div className="text-xs text-slate-600 w-12 text-right">
                  {day.totalWords}
                </div>
              </div>

              {/* Time indicator */}
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Clock className="w-3 h-3" />
                {formatTime(day.totalTime)}
              </div>

              {/* Sections completed */}
              {day.sectionsCompleted > 0 && (
                <div className="flex items-center gap-1 text-xs text-green-600">
                  <BookOpen className="w-3 h-3" />
                  +{day.sectionsCompleted}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-6 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <div className="w-3 h-3 bg-blue-500 rounded"></div>
          Words Written
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Clock className="w-3 h-3" />
          Time Spent
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <BookOpen className="w-3 h-3" />
          Sections Completed
        </div>
      </div>
    </motion.div>
  )
}
