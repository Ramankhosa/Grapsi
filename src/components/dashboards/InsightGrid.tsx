'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { FolderKanban, Lightbulb, ArrowRight } from 'lucide-react'

interface IdeaBankStats {
  totalIdeas: number
  publicIdeas: number
  reservedIdeas: number
  userReservations: number
}

interface InsightGridProps {
  onCardHover?: (cardType: string, message: string) => void
}

export default function InsightGrid({ onCardHover }: InsightGridProps) {
  const { user } = useAuth()
  const router = useRouter()
  const [ideaStats, setIdeaStats] = useState<IdeaBankStats | null>(null)
  const [projectsCount, setProjectsCount] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      fetchDashboardData()
    }
  }, [user])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)

      // Fetch idea bank stats
      const ideaResponse = await fetch('/api/idea-bank/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (ideaResponse.ok) {
        const ideaData = await ideaResponse.json()
        setIdeaStats(ideaData.stats)
      }

      // Fetch projects for the active workspace count.
      const projectsResponse = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (projectsResponse.ok) {
        const projectsData = await projectsResponse.json()
        const projects = projectsData.projects || []
        setProjectsCount(projects.length)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCardClick = (card: any) => {
    if (card.navigateTo) {
      router.push(card.navigateTo)
    }
  }

  const cards = [
    {
      id: 'projects',
      icon: FolderKanban,
      title: 'Active Projects',
      value: projectsCount.toString(),
      label: projectsCount === 1 ? 'Project' : 'Projects',
      description: `Managing ${projectsCount} active invention portfolios`,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      tooltip: 'Manage your patent projects and collaborations.',
      navigateTo: '/projects'
    },
    {
      id: 'ideas',
      icon: Lightbulb,
      title: 'Idea Bank',
      value: ideaStats ? String(ideaStats.totalIdeas || 0) : '0',
      label: 'Concepts',
      description: ideaStats ? `${ideaStats.userReservations} reserved by you` : 'Loading...',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      tooltip: `Idea growth rate +20% this week.`,
      navigateTo: '/idea-bank'
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm animate-pulse h-32">
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 bg-slate-100 rounded-lg"></div>
              <div className="w-16 h-6 bg-slate-100 rounded"></div>
            </div>
            <div className="mt-4 w-24 h-4 bg-slate-100 rounded"></div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map((card) => (
        <div
          key={card.id}
          className="group relative bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 cursor-pointer overflow-hidden"
          onMouseEnter={() => onCardHover?.(card.id, card.tooltip)}
          onMouseLeave={() => onCardHover?.(card.id, '')}
          onClick={() => card.navigateTo && handleCardClick(card)}
        >
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2.5 rounded-lg ${card.bgColor} ${card.color} transition-colors`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div className="flex items-center text-slate-300 group-hover:text-ai-blue-500 transition-colors">
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>

            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold text-ai-graphite-900 font-mono tracking-tight">
                  {card.value}
                </span>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {card.label}
                </span>
              </div>
              <h3 className="text-sm font-medium text-ai-graphite-700 mb-1">
                {card.title}
              </h3>
              <p className="text-xs text-slate-400 truncate">
                {card.description}
              </p>
            </div>
          </div>
          
          {/* Subtle colored glow on hover */}
          <div className={`absolute -bottom-10 -right-10 w-32 h-32 ${card.bgColor} rounded-full opacity-0 group-hover:opacity-50 transition-opacity duration-500 blur-2xl`} />
        </div>
      ))}
    </div>
  )
}
