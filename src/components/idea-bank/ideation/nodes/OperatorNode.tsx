'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Zap, Square, CheckSquare } from 'lucide-react'

interface OperatorNodeData {
  title: string
  description?: string
  tags?: string[]
  selected?: boolean
  onSelect?: () => void
}

function OperatorNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as OperatorNodeData
  const isSelected = nodeData.selected || selected
  
  return (
    <div
      className={`
        px-3 py-2.5 rounded-xl shadow-md border min-w-44 max-w-52
        transition-all duration-200 cursor-pointer
        ${isSelected
          ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-500 shadow-xl shadow-amber-300/50 ring-2 ring-amber-300 animate-pulse-subtle'
          : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400 hover:shadow-lg'
        }
      `}
    >
      {/* Left handle - connects from seed */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-amber-600 !scale-125' : '!bg-amber-500'
        }`}
      />
      {/* Right handle - for potential extensions */}
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-3 !h-3 !border-2 !border-white transition-all ${
          isSelected ? '!bg-amber-600 !scale-125' : '!bg-amber-500'
        }`}
      />
      
      <div className="flex items-start gap-2">
        {/* Checkbox for selection */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            nodeData.onSelect?.()
          }}
          className={`
            flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
            transition-all duration-200 hover:scale-110
            ${isSelected 
              ? 'bg-amber-500 text-white shadow-md' 
              : 'bg-amber-100 text-amber-400 hover:bg-amber-200 hover:text-amber-600'
            }
          `}
          title={isSelected ? 'Click to deselect' : 'Click to select for idea generation'}
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="flex-shrink-0 w-5 h-5 rounded bg-amber-200 flex items-center justify-center">
              <Zap className="w-3 h-3 text-amber-700" />
            </div>
            <span className={`font-semibold text-sm truncate ${
              isSelected ? 'text-amber-700' : 'text-slate-800'
            }`}>
              {nodeData.title}
            </span>
          </div>
          {nodeData.description && (
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-snug">
              {nodeData.description}
            </p>
          )}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-amber-100">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-200 text-amber-700 uppercase tracking-wide">
              <Zap className="w-2.5 h-2.5" />
              TRIZ Operator
            </span>
            <span className="text-[9px] text-slate-400">
              {isSelected ? '✓ Selected' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(OperatorNode)

