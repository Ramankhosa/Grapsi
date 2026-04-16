'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import AnimatedLogo from './animated-logo'

export type KishoNormalizationMode = 'enhance' | 'preserve'

export const KISHO_NORMALIZATION_STEPS: Record<KishoNormalizationMode, string[]> = {
  enhance: [
    'Kisho is reading your invention end-to-end…',
    'Kisho is extracting the core inventive concept…',
    'Kisho is tightening the problem statement for clarity…',
    'Kisho is structuring the solution into key components…',
    'Kisho is mapping inputs → processing → outputs…',
    'Kisho is drafting a clean, patent-ready abstract…',
    'Kisho is identifying classification signals (CPC/IPC)…',
    'Kisho is generating search-ready terminology and synonyms…',
    'Kisho is finalizing a consistent, review-ready outline…'
  ],
  preserve: [
    'Kisho is preserving your wording while organizing the idea…',
    'Kisho is extracting the core problem you described…',
    'Kisho is listing key components and interactions…',
    'Kisho is capturing the technical logic as written…',
    'Kisho is mapping inputs → processing → outputs…',
    'Kisho is drafting a concise abstract from your text…',
    'Kisho is tagging likely CPC/IPC classifications…',
    'Kisho is generating a search query using your terminology…',
    'Kisho is formatting everything into a review-ready outline…'
  ]
}

interface KishoNormalizationLoaderProps {
  mode: KishoNormalizationMode
  className?: string
}

export default function KishoNormalizationLoader({ mode, className = '' }: KishoNormalizationLoaderProps) {
  const steps = useMemo(() => KISHO_NORMALIZATION_STEPS[mode], [mode])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const perStepMs = 2200
    const timer = window.setInterval(() => {
      setActiveIndex((i) => (i < steps.length - 1 ? i + 1 : i))
    }, perStepMs)

    return () => window.clearInterval(timer)
  }, [steps.length])

  const stepNumber = Math.min(activeIndex + 1, steps.length)
  const currentMessage = steps[Math.min(activeIndex, steps.length - 1)] || steps[0] || 'Kisho is getting things ready…'

  return (
    <div className={`mb-8 border border-indigo-100 bg-indigo-50/50 rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-4">
        <AnimatedLogo size="sm" className="flex-shrink-0" useKishoFallback={true} autoPlayDuration={3500} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700/80">
              Preparing your idea
            </div>
            <div className="text-xs text-indigo-700/70 tabular-nums">
              Step {stepNumber}/{steps.length}
            </div>
          </div>

          <div className="mt-1 text-sm font-medium text-indigo-950" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentMessage}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
              >
                {currentMessage}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {steps.map((_, idx) => {
                const isDone = idx < activeIndex
                const isActive = idx === activeIndex
                return (
                  <span
                    key={idx}
                    className={[
                      'h-1.5 w-1.5 rounded-full transition-colors',
                      isDone ? 'bg-indigo-500' : isActive ? 'bg-indigo-600 animate-pulse' : 'bg-indigo-200'
                    ].join(' ')}
                  />
                )
              })}
            </div>
            <div className="text-xs text-indigo-700/70">
              {mode === 'preserve'
                ? 'Your wording stays intact — you’ll review everything next.'
                : 'You’ll review and fine-tune everything next.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
