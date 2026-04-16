'use client'

import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Lightbulb, ChevronRight } from 'lucide-react'

interface SeedNodeData {
  title: string
  description?: string
  state?: string
  selected?: boolean
  onSelect?: () => void
}

function SeedNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as SeedNodeData
  
  return (
    <div
      className={`
        px-4 py-3 rounded-2xl shadow-xl border-2 min-w-52 max-w-72
        transition-all duration-200
        ${nodeData.selected || selected
          ? 'bg-gradient-to-br from-cyan-50 to-cyan-100 border-cyan-500 shadow-cyan-300/40'
          : 'bg-gradient-to-br from-white to-slate-50 border-cyan-300 hover:border-cyan-400 hover:shadow-2xl'
        }
      `}
      onClick={nodeData.onSelect}
    >
      {/* Right handle - connects to dimensions (left-to-right flow) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-white"
      />
      
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-lg">
          <Lightbulb className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-900 text-sm">
              {nodeData.title}
            </span>
            <ChevronRight className="w-4 h-4 text-cyan-500" />
          </div>
          {nodeData.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
              {nodeData.description}
            </p>
          )}
          <div className="mt-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-gradient-to-r from-cyan-500 to-cyan-600 text-white uppercase tracking-wider shadow-sm">
              ✦ Core Idea
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(SeedNode)

