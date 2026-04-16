'use client'

/**
 * NoveltyStageNav - Intelligent Left-Rail Stage Navigation for Novelty Search
 * 
 * Features:
 * - Collapsible/expandable stages with visual progress
 * - Dynamic status tracking with animated indicators
 * - Dark/Light theme toggle
 * - Smooth transitions and AI-inspired design
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { 
  ChevronRight, 
  Check, 
  Circle, 
  Loader2,
  Sun,
  Moon,
  Search,
  Sparkles,
  Zap,
  FileText,
  AlertCircle,
  RotateCcw,
  Play,
  XCircle
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================================
// Types
// ============================================================================

type StageTab = '0' | '1' | '1.5' | '3.5' | '3.5c' | '4' | '5'
type StageStatus = 'completed' | 'in_progress' | 'pending' | 'failed' | 'blocked'
type NavTheme = 'dark' | 'light'

interface NoveltyStageNavProps {
  selectedStage: StageTab
  onStageSelect: (stage: StageTab) => void
  getStageStatus: (key: StageTab) => StageStatus
  isStageCompleted: (key: StageTab) => boolean
  onRunStage: (key: StageTab) => Promise<void>
  activeExecutionStage: string | null
  searchId: string | null
  overallProgress: number
  formTitle: string
}

interface StageConfig {
  key: StageTab
  label: string
  description: string
  icon: React.ElementType
  stageNumber: string | null
}

// ============================================================================
// Stage Configuration
// ============================================================================

const STAGE_CONFIGS: StageConfig[] = [
  { 
    key: '0', 
    label: 'Idea Setup', 
    description: 'Define invention title and description',
    icon: Sparkles,
    stageNumber: null 
  },
  { 
    key: '1', 
    label: 'Patent Search', 
    description: 'Search global patent database',
    icon: Search,
    stageNumber: '1' 
  },
  { 
    key: '1.5', 
    label: 'AI Relevance', 
    description: 'Filter by AI relevance scoring',
    icon: Zap,
    stageNumber: '1.5' 
  },
  { 
    key: '3.5', 
    label: 'Feature Analysis', 
    description: 'Map features to prior art',
    icon: FileText,
    stageNumber: '3.5' 
  },
  { 
    key: '3.5c', 
    label: 'Patent Remarks', 
    description: 'Generate per-patent analysis',
    icon: FileText,
    stageNumber: '3.5c' 
  },
  { 
    key: '4', 
    label: 'Final Report', 
    description: 'Complete novelty assessment',
    icon: FileText,
    stageNumber: '4' 
  },
  { 
    key: '5', 
    label: 'Download Report', 
    description: 'View and download PDF report',
    icon: FileText,
    stageNumber: null  // Display-only stage, no execution needed
  }
]

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  THEME: 'novelty_nav_theme',
  EXPANDED: 'novelty_nav_expanded'
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StatusIconProps {
  status: StageStatus
  size?: 'sm' | 'md'
}

function StatusIcon({ status, size = 'md' }: StatusIconProps) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  
  switch (status) {
    case 'completed':
      return <Check className={`${sizeClass} text-emerald-400`} />
    case 'in_progress':
      return <Loader2 className={`${sizeClass} text-cyan-400 animate-spin`} />
    case 'failed':
      return <XCircle className={`${sizeClass} text-rose-400`} />
    case 'blocked':
      return <Circle className={`${sizeClass} text-slate-500`} />
    default:
      return <Circle className={`${sizeClass} text-slate-600`} />
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function NoveltyStageNav({
  selectedStage,
  onStageSelect,
  getStageStatus,
  isStageCompleted,
  onRunStage,
  activeExecutionStage,
  searchId,
  overallProgress,
  formTitle
}: NoveltyStageNavProps) {
  // Theme state - default to light theme
  const [theme, setTheme] = useState<NavTheme>('light')
  const [isHovered, setIsHovered] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // ============================================================================
  // Initialize from localStorage
  // ============================================================================

  useEffect(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) as NavTheme
    if (savedTheme && (savedTheme === 'dark' || savedTheme === 'light')) {
      setTheme(savedTheme)
    }
  }, [])

  // ============================================================================
  // Persist to localStorage
  // ============================================================================

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const handleStageClick = useCallback((stageKey: StageTab) => {
    onStageSelect(stageKey)
  }, [onStageSelect])

  const handleRunClick = useCallback(async (e: React.MouseEvent, stageKey: StageTab) => {
    e.stopPropagation()
    if (isRunning || activeExecutionStage) return
    setIsRunning(true)
    try {
      await onRunStage(stageKey)
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, activeExecutionStage, onRunStage])

  // ============================================================================
  // Computed Values
  // ============================================================================

  const completedCount = useMemo(() => {
    return STAGE_CONFIGS.filter(s => isStageCompleted(s.key)).length
  }, [isStageCompleted])

  // ============================================================================
  // Theme Classes
  // ============================================================================

  const themeClasses = useMemo(() => ({
    container: theme === 'dark'
      ? 'bg-gradient-to-b from-slate-900/98 via-slate-800/98 to-slate-900/98 border-white/10'
      : 'bg-white/95 border-slate-200 shadow-xl',
    text: theme === 'dark' ? 'text-white' : 'text-slate-900',
    textMuted: theme === 'dark' ? 'text-slate-400' : 'text-slate-600',
    textSubtle: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    border: theme === 'dark' ? 'border-white/10' : 'border-slate-200',
    hover: theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-50',
    activeStage: theme === 'dark'
      ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-cyan-400/40'
      : 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-300',
    activeText: theme === 'dark' ? 'text-cyan-400' : 'text-indigo-600',
    completedText: theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600',
    failedText: theme === 'dark' ? 'text-rose-400' : 'text-rose-600',
    progressBg: theme === 'dark' ? 'bg-slate-700/50' : 'bg-slate-200',
    progressFill: theme === 'dark'
      ? 'bg-gradient-to-r from-cyan-500 to-purple-500'
      : 'bg-gradient-to-r from-indigo-500 to-purple-500',
    iconBg: theme === 'dark' ? 'bg-slate-700/50' : 'bg-slate-100',
    currentIconBg: theme === 'dark'
      ? 'bg-gradient-to-br from-cyan-400 to-purple-500'
      : 'bg-gradient-to-br from-indigo-500 to-purple-500',
    runButton: theme === 'dark'
      ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border-cyan-500/30'
      : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border-indigo-200',
    rerunButton: theme === 'dark'
      ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border-rose-500/30'
      : 'bg-rose-50 text-rose-600 hover:bg-rose-100 border-rose-200'
  }), [theme])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <aside
      className={`
        h-full w-full flex flex-col
        backdrop-blur-xl border-r transition-colors duration-300
        ${themeClasses.container}
        rounded-xl overflow-hidden
      `}
    >
      {/* Header */}
      <div className={`p-4 border-b ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div 
              className={`
                w-10 h-10 rounded-xl flex items-center justify-center
                ${theme === 'dark' 
                  ? 'bg-gradient-to-br from-cyan-400 to-purple-500' 
                  : 'bg-gradient-to-br from-indigo-500 to-purple-500'
                }
                shadow-lg
              `}
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              <Search className="w-5 h-5 text-white" />
            </motion.div>
            <div>
              <div className={`text-sm font-semibold ${themeClasses.text}`}>
                Novelty Search
              </div>
              <div className={`text-xs ${themeClasses.textMuted}`}>
                {formTitle ? formTitle.substring(0, 20) + (formTitle.length > 20 ? '...' : '') : 'AI-Powered Analysis'}
              </div>
            </div>
          </div>
          
          {/* Theme Toggle */}
          <motion.button
            onClick={toggleTheme}
            className={`
              p-2 rounded-lg transition-colors
              ${themeClasses.hover}
            `}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' 
              ? <Sun className={`w-4 h-4 ${themeClasses.textMuted}`} />
              : <Moon className={`w-4 h-4 ${themeClasses.textMuted}`} />
            }
          </motion.button>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[10px] font-medium uppercase tracking-wider ${themeClasses.textSubtle}`}>
              Pipeline Progress
            </span>
            <span className={`text-xs font-semibold ${themeClasses.text}`}>
              {overallProgress}%
            </span>
          </div>
          <div className={`h-1.5 rounded-full ${themeClasses.progressBg} overflow-hidden`}>
            <motion.div
              className={`h-full rounded-full ${themeClasses.progressFill}`}
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          <div className={`mt-1.5 text-[10px] ${themeClasses.textSubtle}`}>
            {completedCount} of {STAGE_CONFIGS.length} stages complete
          </div>
        </div>
      </div>

      {/* Stage List */}
      <nav className={`flex-1 overflow-y-auto py-3 px-3 ${theme === 'dark' ? 'dark-scrollbar' : 'light-scrollbar'}`}>
        <div className="space-y-2">
          {STAGE_CONFIGS.map((stage, stageIndex) => {
            const StageIcon = stage.icon
            const status = getStageStatus(stage.key)
            const isCurrent = stage.key === selectedStage
            const isCompleted = status === 'completed'
            const isFailed = status === 'failed'
            const isInProgress = status === 'in_progress'
            const isBlocked = status === 'blocked'
            const canRun = searchId && stage.stageNumber && !isBlocked && !activeExecutionStage

            // Calculate completion percentage for progress ring
            const progressPercentage = isCompleted ? 100 : isInProgress ? 50 : 0

            return (
              <motion.div
                key={stage.key}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: stageIndex * 0.05 }}
                onMouseEnter={() => setIsHovered(stage.key)}
                onMouseLeave={() => setIsHovered(null)}
              >
                {/* Stage Header */}
                <motion.button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-3 rounded-xl
                    transition-all duration-200 text-left border
                    ${isCurrent 
                      ? themeClasses.activeStage 
                      : `${themeClasses.hover} border-transparent`
                    }
                    ${isFailed ? 'ring-1 ring-rose-400/50' : ''}
                  `}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {/* Stage Icon with Progress Ring */}
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <svg className="w-10 h-10 transform -rotate-90">
                      <circle
                        cx="20" cy="20" r="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={themeClasses.progressBg}
                      />
                      <motion.circle
                        cx="20" cy="20" r="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        initial={{ strokeDasharray: '0 100' }}
                        animate={{ strokeDasharray: `${progressPercentage} 100` }}
                        transition={{ duration: 0.5 }}
                        className={`
                          ${isCompleted ? 'text-emerald-400' : 
                            isCurrent ? themeClasses.activeText : 
                            isFailed ? 'text-rose-400' :
                            themeClasses.textSubtle}
                        `}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <AnimatePresence mode="wait">
                        {isInProgress ? (
                          <motion.div
                            key="loading"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <Loader2 className={`w-4 h-4 ${themeClasses.activeText} animate-spin`} />
                          </motion.div>
                        ) : isCompleted ? (
                          <motion.div
                            key="check"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <Check className="w-4 h-4 text-emerald-400" />
                          </motion.div>
                        ) : isFailed ? (
                          <motion.div
                            key="failed"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="icon"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <StageIcon className={`w-4 h-4 ${isCurrent ? themeClasses.activeText : themeClasses.textMuted}`} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Stage Label & Description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`
                        text-sm font-medium truncate
                        ${isCompleted ? themeClasses.completedText : 
                          isFailed ? themeClasses.failedText :
                          isCurrent ? themeClasses.activeText : 
                          themeClasses.textMuted}
                      `}>
                        {stage.label}
                      </span>
                      
                      {/* Status Badge */}
                      <span className={`
                        text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide
                        ${isCompleted ? 'bg-emerald-500/20 text-emerald-400' :
                          isInProgress ? 'bg-cyan-500/20 text-cyan-400' :
                          isFailed ? 'bg-rose-500/20 text-rose-400' :
                          isBlocked ? 'bg-slate-500/20 text-slate-400' :
                          'bg-slate-500/10 text-slate-500'}
                      `}>
                        {isInProgress ? 'Running' : status}
                      </span>
                    </div>
                    
                    <p className={`text-[11px] ${themeClasses.textSubtle} mt-0.5 truncate`}>
                      {stage.description}
                    </p>
                  </div>

                  {/* Run/Rerun Button (visible on hover) */}
                  <AnimatePresence>
                    {(isHovered === stage.key || isFailed) && canRun && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={(e) => handleRunClick(e, stage.key)}
                        disabled={!!activeExecutionStage}
                        className={`
                          flex items-center justify-center
                          w-8 h-8 rounded-lg border
                          transition-colors flex-shrink-0
                          ${isFailed ? themeClasses.rerunButton : themeClasses.runButton}
                          ${activeExecutionStage ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                        title={isFailed ? 'Rerun stage' : 'Run stage'}
                      >
                        {isFailed ? (
                          <RotateCcw className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </motion.button>
              </motion.div>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className={`p-3 border-t ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${themeClasses.textSubtle}`}>
            Stage {STAGE_CONFIGS.findIndex(s => s.key === selectedStage) + 1} of {STAGE_CONFIGS.length}
          </span>
          <motion.button
            onClick={() => handleStageClick(selectedStage)}
            className={`
              text-[10px] px-2.5 py-1 rounded-md font-medium
              ${theme === 'dark' 
                ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30' 
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              }
              transition-colors
            `}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Current Stage
          </motion.button>
        </div>
      </div>
    </aside>
  )
}


