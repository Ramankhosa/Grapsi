'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, Lightbulb, Search, Clock, Sparkles } from 'lucide-react'

interface ActivityItem {
  id: string
  type: 'idea' | 'draft' | 'novelty' | 'reservation'
  title: string
  description: string
  timestamp: Date
  icon: any
  kishoNote?: string
}

interface ActivityFeedProps {
  limit?: number
}

export default function ActivityFeed({ limit = 5 }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  const generateMockActivities = useCallback(async () => {
    // In a real implementation, this would fetch from various APIs
    const mockActivities: ActivityItem[] = [
      {
        id: '1',
        type: 'idea',
        title: 'New Concept Detected',
        description: 'AI cross-referenced your notes with medical device trends.',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        icon: Lightbulb,
        kishoNote: 'Potential overlap with Project Bio-Mesh — review recommended.'
      },
      {
        id: '2',
        type: 'draft',
        title: 'Smart Bandage System',
        description: 'Draft auto-saved at 60% completion.',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        icon: FileText,
        kishoNote: 'Claims section is structured. Ready for manual refinement.'
      },
      {
        id: '3',
        type: 'novelty',
        title: 'Classroom Monitor Search',
        description: 'Search complete. 2 unique patent matches found.',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        icon: Search,
        kishoNote: 'One match shows 85% similarity — differentiation strategy needed.'
      },
      {
        id: '4',
        type: 'reservation',
        title: 'IoT Security Framework',
        description: 'Reservation active. 28 days remaining.',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        icon: Clock,
        kishoNote: 'Similar patents filed recently in EU. Recommend prioritizing.'
      },
      {
        id: '5',
        type: 'idea',
        title: 'Sustainable Packaging',
        description: 'Concept captured from recent session.',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        icon: Lightbulb,
        kishoNote: 'Market gap identified in biodegradable composites.'
      }
    ]

    setTimeout(() => {
      setActivities(mockActivities.slice(0, limit))
      setLoading(false)
    }, 500)
  }, [limit])

  useEffect(() => {
    generateMockActivities()
  }, [generateMockActivities])

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`

    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays}d ago`
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex gap-4">
              <div className="w-8 h-8 bg-slate-100 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-0 overflow-hidden shadow-sm">
      <div className="divide-y divide-slate-100">
        {activities.map((activity, index) => (
          <div key={activity.id} className="group p-4 hover:bg-slate-50 transition-colors">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                  activity.type === 'idea' ? 'bg-amber-50 border-amber-100 text-amber-600' :
                  activity.type === 'draft' ? 'bg-ai-blue-50 border-ai-blue-100 text-ai-blue-600' :
                  activity.type === 'novelty' ? 'bg-purple-50 border-purple-100 text-purple-600' :
                  'bg-slate-50 border-slate-100 text-slate-500'
                }`}>
                  <activity.icon className="w-5 h-5" />
                </div>
                
                {/* Connector Line */}
                {index < activities.length - 1 && (
                   <div className="absolute top-10 left-1/2 -translate-x-1/2 w-px h-12 bg-slate-100 group-hover:bg-slate-200 transition-colors md:block hidden" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-ai-graphite-900">
                    {activity.title}
                  </h4>
                  <span className="text-xs font-mono text-slate-400 whitespace-nowrap ml-2">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>

                <p className="text-sm text-slate-500 mb-3 leading-relaxed">
                  {activity.description}
                </p>

                {/* Kisho Insight Box */}
                {activity.kishoNote && (
                  <div className="flex gap-3 bg-ai-blue-50/50 rounded-lg p-3 border border-ai-blue-100/50">
                    <Sparkles className="w-4 h-4 text-ai-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-ai-blue-700/90 leading-relaxed font-medium">
                      {activity.kishoNote}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
