'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X, ArrowRight, BrainCircuit } from 'lucide-react'

interface AISpotlightProps {
  draftsCount: number
  latestNoveltySearch?: any
  userReservations: number
}

export default function AISpotlight({ draftsCount, latestNoveltySearch, userReservations }: AISpotlightProps) {
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(true)
  const [currentSuggestion, setCurrentSuggestion] = useState<any>(null)

  const generateSuggestion = useCallback(() => {
    const suggestions = []

    // Draft completion suggestion
    if (draftsCount > 0) {
      suggestions.push({
        type: 'draft',
        title: 'Resume Drafting',
        message: `You have ${draftsCount} draft${draftsCount > 1 ? 's' : ''} pending. Your latest draft is waiting for review.`,
        actions: [
          { label: 'Resume Draft', action: () => router.push('/patents/draft/new') },
          { label: 'View Projects', action: () => router.push('/projects') }
        ]
      })
    }

    // Novelty review suggestion
    if (latestNoveltySearch) {
      const stage1Results = latestNoveltySearch.results?.stage1
      const patentCount = stage1Results?.patentCount || 0

      if (patentCount > 0) {
        suggestions.push({
          type: 'novelty',
          title: 'Analysis Complete',
          message: `"${latestNoveltySearch.title.substring(0, 25)}..." returned ${patentCount} citations. Review the findings to proceed.`,
          actions: [
            { label: 'View Report', action: () => router.push(`/novelty-search/${latestNoveltySearch.id}/consolidated`) },
            { label: 'New Search', action: () => router.push('/novelty-search') }
          ]
        })
      }
    }

    // Default suggestion
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'welcome',
        title: 'Intelligence Ready',
        message: 'The neural engine is idle. Initiate a new novelty search or explore high-potential concepts.',
        actions: [
          { label: 'Start Search', action: () => router.push('/novelty-search') },
          { label: 'Explore Ideas', action: () => router.push('/idea-bank') }
        ]
      })
    }

    const randomIndex = Math.floor(Math.random() * suggestions.length)
    setCurrentSuggestion(suggestions[randomIndex])
  }, [draftsCount, latestNoveltySearch, router])

  useEffect(() => {
    generateSuggestion()
  }, [generateSuggestion])

  if (!isVisible || !currentSuggestion) return null

  return (
    <div className="relative bg-white border border-ai-blue-200 rounded-xl p-6 shadow-sm overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-ai-blue-50 rounded-bl-full opacity-50 pointer-events-none" />
      
      <div className="flex justify-between items-start mb-4">
         <div className="flex items-center gap-2 text-ai-blue-600">
            <BrainCircuit className="w-5 h-5" />
            <h3 className="font-bold text-sm uppercase tracking-wider">System Recommendation</h3>
         </div>
         <button 
           onClick={() => setIsVisible(false)}
           className="text-slate-400 hover:text-slate-600 transition-colors"
         >
           <X className="w-4 h-4" />
         </button>
      </div>

      <h4 className="text-lg font-bold text-ai-graphite-900 mb-2">
        {currentSuggestion.title}
      </h4>
      
      <p className="text-slate-600 text-sm leading-relaxed mb-6">
        {currentSuggestion.message}
      </p>

      <div className="flex flex-col gap-3">
        {currentSuggestion.actions.map((action: any, index: number) => (
          <button
            key={index}
            onClick={action.action}
            className={`
              w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200
              ${index === 0
                ? 'bg-ai-blue-600 text-white hover:bg-ai-blue-700 shadow-sm hover:shadow-md'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
              }
            `}
          >
            {action.label}
            {index === 0 && <ArrowRight className="w-4 h-4" />}
          </button>
        ))}
      </div>
    </div>
  )
}
