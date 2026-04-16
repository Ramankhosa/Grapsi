'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Sparkles } from 'lucide-react'

interface KishoWidgetProps {
  onTipClick?: (tip: string) => void
}

const kishoTips = [
  "Group similar ideas before drafting — saves 20% editing time.",
  "Review patent abstracts first, claims second — efficiency hack.",
  "Save drafts frequently; your ideas are worth protecting.",
  "Novelty searches work best with specific technical details.",
  "Take breaks between drafting sessions — fresh eyes catch more.",
  "Start with the problem your invention solves, not the solution.",
  "Similar patents aren't dead ends — they're innovation opportunities.",
  "Document your 'why' for each invention — it strengthens claims."
]

export default function KishoWidget({ onTipClick }: KishoWidgetProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showSpeechBubble, setShowSpeechBubble] = useState(false)
  const [currentTip, setCurrentTip] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    // Show welcome tip on mount
    const timer = setTimeout(() => {
      showRandomTip()
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  const showRandomTip = () => {
    const randomTip = kishoTips[Math.floor(Math.random() * kishoTips.length)]
    setCurrentTip(randomTip)
    setShowSpeechBubble(true)

    // Auto-hide after 8 seconds
    setTimeout(() => {
      setShowSpeechBubble(false)
    }, 8000)
  }

  const handleClick = () => {
    setIsAnimating(true)
    showRandomTip()
    onTipClick?.(currentTip)

    // Reset animation after a short delay
    setTimeout(() => setIsAnimating(false), 500)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Speech Bubble */}
      {showSpeechBubble && (
        <div className="mb-4 max-w-xs animate-fade-in origin-bottom-right">
          <div className="bg-white border border-ai-blue-200 rounded-2xl rounded-br-none p-4 shadow-lg shadow-ai-blue-900/5">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-ai-blue-50 rounded-full shrink-0">
                <Sparkles className="w-4 h-4 text-ai-blue-600" />
              </div>
              <p className="text-sm text-ai-graphite-700 leading-relaxed font-medium">
                {currentTip}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Kisho Avatar Button */}
      <button
        className={`
          relative group flex items-center justify-center w-14 h-14 rounded-full 
          bg-white border-2 border-ai-blue-100 hover:border-ai-blue-300 shadow-lg hover:shadow-xl
          transition-all duration-300 ease-out
          ${isHovered ? 'scale-110' : 'scale-100'}
          ${isAnimating ? 'scale-90' : ''}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleClick}
        aria-label="Ask AI Assistant"
      >
        {/* Inner Glow */}
        <div className="absolute inset-1 bg-gradient-to-br from-ai-blue-50 to-white rounded-full" />
        
        {/* Icon or Image */}
        <div className="relative z-10 text-ai-blue-600">
           {/* Fallback to icon if no image, or generic AI icon */}
           <MessageSquare className="w-6 h-6" />
        </div>

        {/* Status Indicator */}
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full">
           <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-75" />
        </div>
      </button>
    </div>
  )
}
