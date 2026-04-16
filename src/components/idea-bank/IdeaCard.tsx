'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'
import { motion } from 'framer-motion'

interface IdeaCardProps {
  idea: IdeaBankIdeaWithDetails
  onView: () => void
  onReserve: () => void
  onRelease: () => void
  onEdit: () => void
  onSendToSearch: () => void
  onSendToDrafting: () => void
}

export default function IdeaCard({
  idea,
  onView,
  onReserve,
  onRelease,
  onEdit,
  onSendToSearch,
  onSendToDrafting
}: IdeaCardProps) {
  const [isReserving, setIsReserving] = useState(false)
  const [reservationSuccess, setReservationSuccess] = useState(false)

  const isReserved = idea.status === 'RESERVED'
  const isReservedByUser = idea._isReservedByCurrentUser
  const isRedacted = isReserved && !isReservedByUser

  const handleReserve = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsReserving(true)
    try {
      await onReserve()
      setReservationSuccess(true)
      setTimeout(() => setReservationSuccess(false), 3000)
    } catch (error) {
      console.error('Reservation failed:', error)
    } finally {
      setIsReserving(false)
    }
  }

  const getStatusColor = () => {
    switch (idea.status) {
      case 'PUBLIC': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'RESERVED': return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'LICENSED': return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'ARCHIVED': return 'bg-slate-50 text-slate-600 border-slate-200'
      default: return 'bg-slate-50 text-slate-600 border-slate-200'
    }
  }

  const getNoveltyColor = (score?: number | null) => {
    if (!score) return 'text-slate-400'
    if (score >= 0.8) return 'text-emerald-600'
    if (score >= 0.6) return 'text-amber-600'
    return 'text-red-500'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <Card 
        className={`h-full bg-white border border-slate-200 hover:border-slate-300 hover:shadow-xl transition-all duration-300 overflow-hidden group flex flex-col ${
          isReservedByUser ? 'ring-1 ring-amber-400' : ''
        }`}
      >
        {/* Top decoration line */}
        <div className={`h-1 w-full bg-gradient-to-r ${
          isReservedByUser ? 'from-amber-400 via-orange-400 to-amber-500' : 
          isReserved ? 'from-slate-300 via-slate-400 to-slate-300' :
          'from-cyan-500 via-blue-500 to-purple-500'
        }`} />
        
        <CardHeader className="pb-3 space-y-3">
          <div className="flex justify-between items-start">
            <Badge variant="outline" className={`${getStatusColor()} font-medium text-[10px] tracking-wider uppercase border`}>
              {idea.status}
            </Badge>
            {idea.noveltyScore && (
              <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                <div className={`text-xs font-bold font-mono ${getNoveltyColor(idea.noveltyScore)}`}>
                  {(idea.noveltyScore * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">NOVELTY</div>
              </div>
            )}
          </div>
          
          <h3 className="font-bold text-lg text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors line-clamp-2">
            {isRedacted ? (
              <span className="blur-[2px] select-none text-slate-400">Protected Invention Title</span>
            ) : (
              idea.title
            )}
          </h3>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col space-y-4">
          {/* Description */}
          <div className="flex-1 relative">
            <p className="text-sm text-slate-600 line-clamp-3 leading-relaxed">
              {idea._redactedDescription || idea.description}
            </p>
            {isRedacted && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-[1px] rounded">
                <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-100 shadow-sm">
                  <div className="text-xl mb-1">🔒</div>
                  <div className="text-xs text-amber-800 font-bold tracking-wide uppercase">Reserved Asset</div>
                </div>
              </div>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 font-medium border-t border-slate-100 pt-3 mt-auto">
            <div>
              <div className="uppercase tracking-wider text-slate-400 mb-0.5">Origin</div>
              <div className="text-slate-700 truncate">{idea.creator.name || 'System AI'}</div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-slate-400 mb-0.5">Date</div>
              <div className="text-slate-700">{new Date(idea.createdAt).toLocaleDateString()}</div>
            </div>
          </div>

          {/* Domain Tags */}
          {idea.domainTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {idea.domainTags.slice(0, 3).map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                  {tag}
                </span>
              ))}
              {idea.domainTags.length > 3 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                  +{idea.domainTags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onView}
                className="w-full text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                View Data
              </Button>

              {isReservedByUser ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRelease}
                  className="w-full text-amber-600 hover:bg-amber-50"
                >
                  Release
                </Button>
              ) : !isReserved ? (
                <Button
                  size="sm"
                  onClick={handleReserve}
                  disabled={isReserving}
                  className={`w-full relative overflow-hidden transition-all duration-300 shadow-sm ${
                    reservationSuccess 
                      ? 'bg-emerald-600 hover:bg-emerald-700' 
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {isReserving ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                    </div>
                  ) : reservationSuccess ? (
                    <span className="flex items-center gap-1">✓ Acquired</span>
                  ) : (
                    <span className="flex items-center gap-1 font-semibold tracking-wide text-xs uppercase">
                      Reserve
                    </span>
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled
                  className="w-full bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                >
                  Locked
                </Button>
              )}
            </div>

            {/* Reserved by user: Show Draft Patent and Deep Novelty Search buttons */}
            {isReservedByUser && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  onClick={onSendToDrafting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs shadow-sm"
                >
                  ✍️ Draft Patent
                </Button>
                <Button
                  size="sm"
                  onClick={onSendToSearch}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs shadow-sm"
                >
                  🔍 Deep Novelty
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
