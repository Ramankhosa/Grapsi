'use client'

/**
 * NoveltyFloatingButtons - Quick Navigation Arrows for Novelty Search
 * 
 * Floating forward/backward buttons for quick stage navigation.
 * Subtle by default, fully visible on hover.
 */

import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Play, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface NoveltyFloatingButtonsProps {
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  onRunCurrent: (() => Promise<void>) | null
  previousLabel?: string
  nextLabel?: string
  currentStageLabel?: string
  isRunning?: boolean
  isFailed?: boolean
  disabled?: boolean
}

export default function NoveltyFloatingButtons({
  onPrevious,
  onNext,
  onRunCurrent,
  previousLabel = 'Previous Stage',
  nextLabel = 'Next Stage',
  currentStageLabel = 'Run Stage',
  isRunning = false,
  isFailed = false,
  disabled = false
}: NoveltyFloatingButtonsProps) {
  const [hoveredButton, setHoveredButton] = useState<'prev' | 'next' | 'run' | null>(null)

  const handleNavigation = async (direction: 'prev' | 'next') => {
    if (disabled) return
    
    const handler = direction === 'prev' ? onPrevious : onNext
    if (handler) handler()
  }

  const handleRun = async () => {
    if (disabled || isRunning || !onRunCurrent) return
    await onRunCurrent()
  }

  return (
    <>
      {/* Previous Stage Button - Left Side */}
      <AnimatePresence>
        {onPrevious && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-40"
            style={{ marginLeft: '300px' }}
          >
            <motion.button
              onClick={() => handleNavigation('prev')}
              onMouseEnter={() => setHoveredButton('prev')}
              onMouseLeave={() => setHoveredButton(null)}
              disabled={disabled}
              className={`
                group relative flex items-center
                transition-all duration-300 ease-out
                ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
              `}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.95 }}
            >
              {/* Button Background */}
              <div className={`
                relative flex items-center gap-2 py-3 pl-2 pr-3
                rounded-r-2xl
                backdrop-blur-md
                border border-l-0 border-gray-200/50
                shadow-lg
                transition-all duration-300
                ${hoveredButton === 'prev' 
                  ? 'bg-white/95 shadow-xl border-indigo-200' 
                  : 'bg-white/40 hover:bg-white/70'
                }
              `}>
                {/* Icon */}
                <div className={`
                  flex items-center justify-center
                  w-10 h-10 rounded-xl
                  transition-all duration-300
                  ${hoveredButton === 'prev'
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md'
                    : 'bg-gray-100/80 text-gray-400 group-hover:text-gray-600'
                  }
                `}>
                  <ChevronLeft className="w-6 h-6" />
                </div>

                {/* Label - Shows on hover */}
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{
                    width: hoveredButton === 'prev' ? 'auto' : 0,
                    opacity: hoveredButton === 'prev' ? 1 : 0
                  }}
                  className="overflow-hidden whitespace-nowrap text-sm font-medium text-gray-700"
                >
                  {previousLabel}
                </motion.span>
              </div>

              {/* Pulse indicator when idle */}
              {hoveredButton !== 'prev' && (
                <motion.div
                  className="absolute inset-0 rounded-r-2xl bg-indigo-400/20"
                  animate={{
                    opacity: [0, 0.5, 0],
                    scale: [1, 1.05, 1]
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    repeatDelay: 2
                  }}
                />
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Run/Rerun Button - Center Bottom */}
      <AnimatePresence>
        {onRunCurrent && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
            style={{ marginLeft: '140px' }}
          >
            <motion.button
              onClick={handleRun}
              onMouseEnter={() => setHoveredButton('run')}
              onMouseLeave={() => setHoveredButton(null)}
              disabled={disabled || isRunning}
              className={`
                group relative flex items-center
                transition-all duration-300 ease-out
                ${disabled || isRunning ? 'cursor-not-allowed' : 'cursor-pointer'}
              `}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.95 }}
            >
              {/* Button Background */}
              <div className={`
                relative flex items-center gap-3 py-3 px-5
                rounded-2xl
                backdrop-blur-md
                border shadow-lg
                transition-all duration-300
                ${isFailed
                  ? hoveredButton === 'run'
                    ? 'bg-rose-500 border-rose-400 shadow-rose-500/30'
                    : 'bg-rose-500/90 border-rose-400/50'
                  : hoveredButton === 'run'
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 border-indigo-400 shadow-indigo-500/30'
                    : 'bg-gradient-to-r from-indigo-500/90 to-purple-600/90 border-indigo-400/50'
                }
              `}>
                {/* Icon */}
                <div className="flex items-center justify-center text-white">
                  {isRunning ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : isFailed ? (
                    <RotateCcw className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                </div>

                {/* Label */}
                <span className="text-sm font-semibold text-white whitespace-nowrap">
                  {isRunning ? 'Processing...' : isFailed ? 'Retry Stage' : currentStageLabel}
                </span>
              </div>

              {/* Glow effect */}
              <motion.div
                className={`absolute inset-0 rounded-2xl ${isFailed ? 'bg-rose-500/30' : 'bg-indigo-500/30'}`}
                animate={{
                  opacity: [0.3, 0.6, 0.3],
                  scale: [1, 1.1, 1]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                style={{ filter: 'blur(10px)', zIndex: -1 }}
              />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Next Stage Button - Right Side */}
      <AnimatePresence>
        {onNext && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-0 top-1/2 -translate-y-1/2 z-40"
          >
            <motion.button
              onClick={() => handleNavigation('next')}
              onMouseEnter={() => setHoveredButton('next')}
              onMouseLeave={() => setHoveredButton(null)}
              disabled={disabled}
              className={`
                group relative flex items-center
                transition-all duration-300 ease-out
                ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
              `}
              whileHover={{ x: -4 }}
              whileTap={{ scale: 0.95 }}
            >
              {/* Button Background */}
              <div className={`
                relative flex items-center gap-2 py-3 pl-3 pr-2
                rounded-l-2xl
                backdrop-blur-md
                border border-r-0 border-gray-200/50
                shadow-lg
                transition-all duration-300
                ${hoveredButton === 'next' 
                  ? 'bg-white/95 shadow-xl border-emerald-200' 
                  : 'bg-white/40 hover:bg-white/70'
                }
              `}>
                {/* Label - Shows on hover */}
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{
                    width: hoveredButton === 'next' ? 'auto' : 0,
                    opacity: hoveredButton === 'next' ? 1 : 0
                  }}
                  className="overflow-hidden whitespace-nowrap text-sm font-medium text-gray-700"
                >
                  {nextLabel}
                </motion.span>

                {/* Icon */}
                <div className={`
                  flex items-center justify-center
                  w-10 h-10 rounded-xl
                  transition-all duration-300
                  ${hoveredButton === 'next'
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md'
                    : 'bg-gray-100/80 text-gray-400 group-hover:text-gray-600'
                  }
                `}>
                  <ChevronRight className="w-6 h-6" />
                </div>
              </div>

              {/* Pulse indicator when idle */}
              {hoveredButton !== 'next' && (
                <motion.div
                  className="absolute inset-0 rounded-l-2xl bg-emerald-400/20"
                  animate={{
                    opacity: [0, 0.5, 0],
                    scale: [1, 1.05, 1]
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    repeatDelay: 2,
                    delay: 1.5
                  }}
                />
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}


