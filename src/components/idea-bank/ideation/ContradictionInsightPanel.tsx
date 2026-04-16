'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lightbulb,
  Target,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Scale,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react'

interface Contradiction {
  parameterToImprove: string
  parameterThatWorsens: string
  whyThisIsHard?: string
  conflictDescription?: string
}

interface ResolutionStrategy {
  strategy: string
  description: string
  applicableTo: string
}

interface ContradictionMappingData {
  contradictions?: Contradiction[]
  inventivePrinciples?: string[]
  resolutionStrategies?: ResolutionStrategy[]
  secondOrderEffects?: string[]
}

interface ContradictionInsightPanelProps {
  data: ContradictionMappingData
  onClose?: () => void
}

// Strategy name to user-friendly display
const STRATEGY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  'SEPARATION_IN_TIME': { label: 'Time Separation', icon: '⏰', color: 'blue' },
  'SEPARATION_IN_SPACE': { label: 'Space Separation', icon: '📍', color: 'green' },
  'SEPARATION_ON_CONDITION': { label: 'Conditional Separation', icon: '🎯', color: 'purple' },
  'SEPARATION_BETWEEN_PARTS': { label: 'Part Separation', icon: '🔧', color: 'amber' },
  'INVERSION': { label: 'Inversion', icon: '🔄', color: 'rose' },
  'SUBSTANCE_FIELD_SHIFT': { label: 'Energy Shift', icon: '⚡', color: 'cyan' },
  'DYNAMIZATION': { label: 'Dynamization', icon: '🌊', color: 'indigo' },
}

export default function ContradictionInsightPanel({
  data,
  onClose,
}: ContradictionInsightPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isFullView, setIsFullView] = useState(false)

  const hasContradictions = data.contradictions && data.contradictions.length > 0
  const hasPrinciples = data.inventivePrinciples && data.inventivePrinciples.length > 0
  const hasStrategies = data.resolutionStrategies && data.resolutionStrategies.length > 0
  const hasEffects = data.secondOrderEffects && data.secondOrderEffects.length > 0

  if (!hasContradictions && !hasPrinciples) {
    return null
  }

  // Collapsed badge view
  if (!isExpanded) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-4 left-4 z-40"
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="group bg-gradient-to-r from-violet-500/10 to-purple-500/10 hover:from-violet-500/20 hover:to-purple-500/20 backdrop-blur-sm rounded-xl shadow-lg border border-violet-200/50 p-3 transition-all hover:shadow-xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Lightbulb className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-slate-800">
                Invention Insights
              </div>
              <div className="text-xs text-slate-500">
                {data.contradictions?.length || 0} tradeoffs identified
              </div>
            </div>
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-violet-500 transition-colors" />
          </div>
          
          {/* Mini preview of principles */}
          {hasPrinciples && (
            <div className="flex flex-wrap gap-1 mt-2 max-w-[200px]">
              {data.inventivePrinciples!.slice(0, 3).map((p, i) => (
                <span
                  key={i}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium"
                >
                  {typeof p === 'string' ? p : (p as any).name || p}
                </span>
              ))}
              {data.inventivePrinciples!.length > 3 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                  +{data.inventivePrinciples!.length - 3}
                </span>
              )}
            </div>
          )}
        </button>
      </motion.div>
    )
  }

  // Expanded panel view
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className={`fixed z-50 ${
          isFullView
            ? 'inset-4 md:inset-8'
            : 'bottom-4 left-4 w-[420px] max-h-[70vh]'
        }`}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden h-full flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Invention Insights</h3>
                  <p className="text-violet-100 text-xs">
                    Understanding your invention's core tradeoffs
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsFullView(!isFullView)}
                  className="p-2 rounded-lg hover:bg-white/20 transition-colors"
                  title={isFullView ? 'Minimize' : 'Maximize'}
                >
                  {isFullView ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 rounded-lg hover:bg-white/20 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Contradictions Section */}
            {hasContradictions && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Scale className="w-4 h-4 text-amber-500" />
                  Key Tradeoffs in Your Invention
                </div>
                
                {data.contradictions!.map((contradiction, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200/50"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                            Improve: {contradiction.parameterToImprove}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span className="text-sm font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded">
                            Worsens: {contradiction.parameterThatWorsens}
                          </span>
                        </div>
                        {(contradiction.whyThisIsHard || contradiction.conflictDescription) && (
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {contradiction.whyThisIsHard || contradiction.conflictDescription}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Resolution Strategies */}
            {hasStrategies && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Target className="w-4 h-4 text-emerald-500" />
                  Resolution Strategies
                </div>
                
                {data.resolutionStrategies!.map((strategy, index) => {
                  const strategyInfo = STRATEGY_LABELS[strategy.strategy] || {
                    label: strategy.strategy.replace(/_/g, ' '),
                    icon: '🔧',
                    color: 'slate',
                  }
                  
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className={`bg-${strategyInfo.color}-50 rounded-xl p-4 border border-${strategyInfo.color}-200/50`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{strategyInfo.icon}</span>
                        <div className="flex-1">
                          <div className="font-medium text-slate-800 text-sm mb-1">
                            {strategyInfo.label}
                          </div>
                          <p className="text-xs text-slate-600 mb-2">
                            {strategy.description}
                          </p>
                          <div className="text-[10px] text-slate-400">
                            Applies to: {strategy.applicableTo}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {/* TRIZ Principles */}
            {hasPrinciples && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  TRIZ Inventive Principles Applied
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {data.inventivePrinciples!.map((principle, index) => (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 text-xs font-medium border border-violet-200/50"
                    >
                      {typeof principle === 'string' ? principle : (principle as any).name || principle}
                    </motion.span>
                  ))}
                </div>
                
                <p className="text-[10px] text-slate-400 italic">
                  These principles from TRIZ methodology guide the idea generation toward non-obvious solutions.
                </p>
              </div>
            )}

            {/* Second Order Effects */}
            {hasEffects && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  Watch Out For (Second-Order Effects)
                </div>
                
                <div className="bg-rose-50 rounded-xl p-4 border border-rose-200/50">
                  <ul className="space-y-2">
                    {data.secondOrderEffects!.map((effect, index) => (
                      <motion.li
                        key={index}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="flex items-start gap-2 text-xs text-rose-700"
                      >
                        <span className="text-rose-400 mt-0.5">•</span>
                        <span>{effect}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
                
                <p className="text-[10px] text-slate-400 italic">
                  Solving one contradiction may create new challenges. Consider these when refining your ideas.
                </p>
              </div>
            )}

            {/* Why This Matters callout */}
            <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200/50">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <div>
                  <div className="font-medium text-slate-800 text-sm mb-1">
                    Why This Matters for Patents
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Ideas that resolve contradictions demonstrate a clear <strong>inventive step</strong> - 
                    the key requirement for patent protection. Patent examiners look for solutions that 
                    aren't obvious to someone skilled in the art. Your contradiction-resolving ideas 
                    have a stronger patent potential.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 p-3 bg-slate-50">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Based on TRIZ methodology</span>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-violet-600 hover:text-violet-700 font-medium"
              >
                Minimize
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}















