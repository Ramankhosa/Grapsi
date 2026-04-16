'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'

interface IdeaListItemProps {
  idea: IdeaBankIdeaWithDetails
  onView: () => void
  onReserve: () => void
  onRelease: () => void
  onEdit: () => void
  onSendToSearch: () => void
  onSendToDrafting: () => void
}

export default function IdeaListItem({
  idea,
  onView,
  onReserve,
  onRelease,
  onEdit,
  onSendToSearch,
  onSendToDrafting
}: IdeaListItemProps) {
  const [isReserving, setIsReserving] = useState(false)
  const [reservationSuccess, setReservationSuccess] = useState(false)

  const isReserved = idea.status === 'RESERVED'
  const isReservedByUser = idea._isReservedByCurrentUser
  const isRedacted = isReserved && !isReservedByUser

  const handleReserve = async () => {
    setIsReserving(true)
    try {
      await onReserve()
      setReservationSuccess(true)
      // Reset success state after a delay
      setTimeout(() => setReservationSuccess(false), 3000)
    } catch (error) {
      console.error('Reservation failed:', error)
    } finally {
      setIsReserving(false)
    }
  }

  const getStatusColor = () => {
    switch (idea.status) {
      case 'PUBLIC': return 'bg-green-100 text-green-800'
      case 'RESERVED': return 'bg-orange-100 text-orange-800'
      case 'LICENSED': return 'bg-blue-100 text-blue-800'
      case 'ARCHIVED': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getNoveltyColor = (score?: number | null) => {
    if (!score) return 'bg-gray-100 text-gray-600'
    if (score >= 0.8) return 'bg-green-100 text-green-800'
    if (score >= 0.6) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  return (
    <div className={`border rounded-lg p-4 transition-all duration-200 hover:shadow-md ${
      isReserved ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
    } ${isReservedByUser ? 'ring-2 ring-orange-300' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor()}>
            {idea.status.toLowerCase()}
          </Badge>
          {idea.noveltyScore && (
            <Badge className={getNoveltyColor(idea.noveltyScore)}>
              Novelty: {(idea.noveltyScore * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {new Date(idea.createdAt).toLocaleDateString()}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg text-gray-900 mb-2 line-clamp-1">
            {isRedacted ? `${idea.title.split(' ').slice(0, 3).join(' ')}...` : idea.title}
          </h3>

          <p className="text-sm text-gray-600 mb-2 line-clamp-2">
            {idea._redactedDescription || idea.description}
          </p>

          {isRedacted && (
            <p className="text-xs text-orange-600 mb-2">
              Content reserved • {idea.reservedCount} reservations
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>By {idea.creator.name || idea.creator.email}</span>
            {idea.technicalField && (
              <>
                <span>•</span>
                <span>Field: {idea.technicalField}</span>
              </>
            )}
            {idea.domainTags.length > 0 && (
              <>
                <span>•</span>
                <span>{idea.domainTags.slice(0, 3).join(', ')}{idea.domainTags.length > 3 ? ` +${idea.domainTags.length - 3}` : ''}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end lg:justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={onView}
            className="flex-1 lg:flex-none"
          >
            View Details
          </Button>

          {isReservedByUser ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onRelease}
                className="text-orange-600 border-orange-300 hover:bg-orange-50"
              >
                Release
              </Button>
              <Button
                size="sm"
                onClick={onSendToSearch}
                className="bg-blue-600 hover:bg-blue-700"
              >
                🔍 Search
              </Button>
              <Button
                size="sm"
                onClick={onSendToDrafting}
                className="bg-green-600 hover:bg-green-700"
              >
                ✍️ Draft
              </Button>
            </>
          ) : !isReserved ? (
            <Button
              size="sm"
              onClick={handleReserve}
              disabled={isReserving}
              className={`bg-orange-600 hover:bg-orange-700 ${
                reservationSuccess ? 'bg-green-600 hover:bg-green-700' : ''
              }`}
            >
              {isReserving ? (
                <div className="flex items-center gap-1">
                  <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                  <span>Reserving...</span>
                </div>
              ) : reservationSuccess ? (
                <div className="flex items-center gap-1">
                  <span>✓ Reserved</span>
                </div>
              ) : (
                'Reserve'
              )}
            </Button>
          ) : isReservedByUser ? (
            <Button
              size="sm"
              onClick={onReserve}
              disabled
              className="bg-green-600 hover:bg-green-700 cursor-not-allowed flex items-center gap-1"
            >
              <span>✓ Reserved</span>
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            className="text-gray-600"
          >
            ✏️ Edit
          </Button>
        </div>
      </div>
    </div>
  )
}
