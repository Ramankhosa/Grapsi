'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Lightbulb, Star } from 'lucide-react'

interface IdeaNodeData {
  title: string
  principle?: string
  noveltyScore?: number
  userRating?: number
  status?: string
  selected?: boolean
  onSelect?: () => void
}

function IdeaNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as IdeaNodeData

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'SHORTLISTED':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'REJECTED':
        return 'bg-red-100 text-red-800 border-red-300'
      case 'EXPORTED':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      default:
        return 'bg-purple-100 text-purple-800 border-purple-300'
    }
  }
  
  return (
    <div
      className={`
        px-4 py-3 rounded-2xl shadow-lg border-2 min-w-56 max-w-72
        transition-all duration-200 cursor-pointer
        ${nodeData.selected || selected
          ? 'bg-gradient-to-br from-purple-50 to-violet-50 border-purple-500 shadow-xl shadow-purple-200/50'
          : 'bg-gradient-to-br from-white to-purple-50 border-purple-200 hover:border-purple-400 hover:shadow-xl'
        }
      `}
      onClick={nodeData.onSelect}
    >
      {/* Left handle - connects from dimensions/operators */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white"
      />
      
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-sm">
          <Lightbulb className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 text-sm line-clamp-2">
            {nodeData.title}
          </div>
          {nodeData.principle && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
              {nodeData.principle}
            </p>
          )}
          
          <div className="flex items-center gap-2 mt-2">
            {nodeData.status && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(nodeData.status)}`}>
                {nodeData.status}
              </span>
            )}
            {nodeData.noveltyScore !== undefined && (
              <span className={`
                text-[10px] px-2 py-0.5 rounded-full
                ${nodeData.noveltyScore >= 70 ? 'bg-green-100 text-green-700' :
                  nodeData.noveltyScore >= 40 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'}
              `}>
                {nodeData.noveltyScore}% novel
              </span>
            )}
          </div>
          
          {nodeData.userRating && (
            <div className="flex items-center gap-0.5 mt-2">
              {[1, 2, 3, 4, 5].map(star => (
                <Star
                  key={star}
                  className={`w-3 h-3 ${
                    star <= nodeData.userRating!
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-slate-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(IdeaNode)

