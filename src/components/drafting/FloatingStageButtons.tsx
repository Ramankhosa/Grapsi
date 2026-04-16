'use client'

/**
 * FloatingStageButtons - Quick Navigation Arrows
 * 
 * Floating forward/backward buttons for quick stage navigation.
 * Subtle by default, fully visible on hover.
 */

import React, { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface FloatingStageButtonsProps {
  onPrevious: (() => Promise<void>) | null
  onNext: (() => Promise<void>) | null
  previousLabel?: string
  nextLabel?: string
  disabled?: boolean
}

export default function FloatingStageButtons({
  onPrevious,
  onNext,
  previousLabel = 'Previous Stage',
  nextLabel = 'Next Stage',
  disabled = false
}: FloatingStageButtonsProps) {
  const [hoveredButton, setHoveredButton] = useState<'prev' | 'next' | null>(null)
  const [isNavigating, setIsNavigating] = useState(false)

  const handleNavigation = async (direction: 'prev' | 'next') => {
    if (disabled || isNavigating) return
    
    const handler = direction === 'prev' ? onPrevious : onNext
    if (!handler) return

    try {
      setIsNavigating(true)
      await handler()
    } catch (error) {
      console.error('Navigation failed:', error)
    } finally {
      setIsNavigating(false)
    }
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
            style={{ marginLeft: '288px' }} // Account for sidebar width (72 = w-72 in tailwind = 18rem = 288px)
          >
            <motion.button
              onClick={() => handleNavigation('prev')}
              onMouseEnter={() => setHoveredButton('prev')}
              onMouseLeave={() => setHoveredButton(null)}
              disabled={disabled || isNavigating}
              className={`
                group relative flex items-center
                transition-all duration-300 ease-out
                ${disabled || isNavigating ? 'cursor-not-allowed' : 'cursor-pointer'}
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
                  ? 'bg-white/95 shadow-xl border-blue-200' 
                  : 'bg-white/40 hover:bg-white/70'
                }
              `}>
                {/* Icon */}
                <div className={`
                  flex items-center justify-center
                  w-10 h-10 rounded-xl
                  transition-all duration-300
                  ${hoveredButton === 'prev'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md'
                    : 'bg-gray-100/80 text-gray-400 group-hover:text-gray-600'
                  }
                `}>
                  {isNavigating && hoveredButton === 'prev' ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <ChevronLeft className="w-6 h-6" />
                  )}
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
                  className="absolute inset-0 rounded-r-2xl bg-blue-400/20"
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
              disabled={disabled || isNavigating}
              className={`
                group relative flex items-center
                transition-all duration-300 ease-out
                ${disabled || isNavigating ? 'cursor-not-allowed' : 'cursor-pointer'}
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
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md'
                    : 'bg-gray-100/80 text-gray-400 group-hover:text-gray-600'
                  }
                `}>
                  {isNavigating && hoveredButton === 'next' ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <ChevronRight className="w-6 h-6" />
                  )}
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
                    delay: 1.5 // Offset from prev button
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

