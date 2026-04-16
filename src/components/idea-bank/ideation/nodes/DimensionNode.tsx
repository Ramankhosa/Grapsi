'use client'

import { memo, useCallback, useMemo, useState, useRef } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Check, ZoomIn, Plus, Minus, ArrowRight, AlertTriangle, Zap, MessageSquare, Send } from 'lucide-react'

// Payload structure for suggested moves (new format)
interface SuggestedMovePayload {
  move: string
  impact: string
  leadsTo: string
  tension?: string
  challengesPrior?: boolean
  modifies?: 'BEHAVIOR_OVER_TIME' | 'ARCHITECTURE_CONTROL_FLOW' | 'INTERFACE_BOUNDARY' | 'FAILURE_MODE_LIFECYCLE'
  isSuggestedMove: true
}

interface DimensionNodeData {
  title: string
  description?: string
  family?: string
  state?: string
  type?: string
  tags?: string[]
  selected?: boolean
  collapsed?: boolean
  hasChildren?: boolean
  expanding?: boolean
  isNew?: boolean
  payloadJson?: SuggestedMovePayload | Record<string, unknown>
  payload?: SuggestedMovePayload | Record<string, unknown>  // API returns as 'payload'
  onSelect?: () => void
  onExpand?: (userInput?: string) => void  // Updated to accept user input
  onCollapse?: () => void
}

// Compact color palette - just border accents, no gradients
const FAMILY_COLORS = [
  { border: 'border-l-stone-400', bg: 'bg-white', text: 'text-stone-700', handle: '!bg-stone-400' },
  { border: 'border-l-slate-400', bg: 'bg-white', text: 'text-slate-700', handle: '!bg-slate-400' },
  { border: 'border-l-zinc-400', bg: 'bg-white', text: 'text-zinc-700', handle: '!bg-zinc-400' },
  { border: 'border-l-amber-500', bg: 'bg-amber-50/30', text: 'text-amber-800', handle: '!bg-amber-500' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/30', text: 'text-emerald-800', handle: '!bg-emerald-500' },
  { border: 'border-l-sky-500', bg: 'bg-sky-50/30', text: 'text-sky-800', handle: '!bg-sky-500' },
  { border: 'border-l-rose-500', bg: 'bg-rose-50/30', text: 'text-rose-800', handle: '!bg-rose-500' },
  { border: 'border-l-indigo-500', bg: 'bg-indigo-50/30', text: 'text-indigo-800', handle: '!bg-indigo-500' },
  { border: 'border-l-teal-500', bg: 'bg-teal-50/30', text: 'text-teal-800', handle: '!bg-teal-500' },
  { border: 'border-l-orange-500', bg: 'bg-orange-50/30', text: 'text-orange-800', handle: '!bg-orange-500' },
  { border: 'border-l-cyan-500', bg: 'bg-cyan-50/30', text: 'text-cyan-800', handle: '!bg-cyan-500' },
  { border: 'border-l-violet-500', bg: 'bg-violet-50/30', text: 'text-violet-800', handle: '!bg-violet-500' },
]

function getFamilyColorIndex(family: string | undefined): number {
  if (!family) return 0
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    const char = family.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash) % FAMILY_COLORS.length
}

// Helper to check if payload is a suggested move with required fields
function isSuggestedMovePayload(payload: unknown): payload is SuggestedMovePayload {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Partial<SuggestedMovePayload>
  // Verify it has the flag AND the required content fields
  return p.isSuggestedMove === true && 
    typeof p.move === 'string' && 
    typeof p.impact === 'string' && 
    typeof p.leadsTo === 'string'
}

// Labels for the "modifies" field
const MODIFIES_LABELS: Record<string, { label: string; color: string }> = {
  'BEHAVIOR_OVER_TIME': { label: 'Behavior', color: 'bg-blue-100 text-blue-700' },
  'ARCHITECTURE_CONTROL_FLOW': { label: 'Architecture', color: 'bg-purple-100 text-purple-700' },
  'INTERFACE_BOUNDARY': { label: 'Interface', color: 'bg-green-100 text-green-700' },
  'FAILURE_MODE_LIFECYCLE': { label: 'Lifecycle', color: 'bg-orange-100 text-orange-700' },
}

function DimensionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DimensionNodeData
  const isExpanded = nodeData.state === 'EXPANDED'
  const isFamily = nodeData.type === 'DIMENSION_FAMILY'
  const isCollapsed = nodeData.collapsed
  const hasChildren = nodeData.hasChildren
  const isSelected = nodeData.selected || selected
  const isExpanding = nodeData.expanding || false
  const isNew = nodeData.isNew || false
  
  // Check if this is a suggested move (new format)
  // API returns payloadJson as 'payload', so check both
  const payloadData = nodeData.payloadJson || nodeData.payload
  const isSuggestedMove = isSuggestedMovePayload(payloadData)
  const moveData = isSuggestedMove ? payloadData : null
  
  // Hover state for showing full description
  const [isHovered, setIsHovered] = useState(false)
  
  // User input state for dimension exploration
  const [userInput, setUserInput] = useState('')
  const [showInput, setShowInput] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const familyColor = useMemo(() => {
    const colorIndex = getFamilyColorIndex(nodeData.family)
    return FAMILY_COLORS[colorIndex]
  }, [nodeData.family])

  const canExpand = !isExpanded && !hasChildren

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (canExpand) {
      nodeData.onExpand?.(userInput.trim() || undefined)
      setUserInput('')
      setShowInput(false)
    }
  }, [canExpand, nodeData, userInput])

  // Handle expand with user input
  const handleExpandWithInput = useCallback(() => {
    nodeData.onExpand?.(userInput.trim() || undefined)
    setUserInput('')
    setShowInput(false)
  }, [nodeData, userInput])

  // Toggle input visibility
  const toggleInput = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowInput(prev => !prev)
    // Focus input after showing
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // Render suggested move format (new context-aware format)
  if (isSuggestedMove && moveData) {
    return (
      <div
        onClick={(e) => e.stopPropagation()} // Prevent React Flow from selecting node on click
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-new={isNew ? "true" : undefined}
        className={`
          group relative rounded-lg transition-all duration-150
          w-[340px] border-l-4 border border-slate-200
          ${isSelected
            ? 'bg-blue-50 border-l-blue-500 shadow-md ring-1 ring-blue-300'
            : moveData.challengesPrior
              ? 'bg-amber-50/50 border-l-amber-500 hover:shadow-sm hover:border-amber-300'
              : `${familyColor.bg} ${familyColor.border} hover:shadow-sm hover:border-slate-300`
          }
        `}
      >
        {/* Handles */}
        <Handle
          type="target"
          position={Position.Left}
          className={`!w-2 !h-2 !border !border-white !-left-1 ${
            isSelected ? '!bg-blue-500' : moveData.challengesPrior ? '!bg-amber-500' : familyColor.handle
          }`}
        />
        <Handle
          type="source"
          position={Position.Right}
          className={`!w-2 !h-2 !border !border-white !-right-1 ${
            isSelected ? '!bg-blue-500' : moveData.challengesPrior ? '!bg-amber-500' : familyColor.handle
          }`}
        />

        {/* Content area for suggested move */}
        <div className="px-3 py-2.5">
          {/* Header: checkbox + "What if" statement + expand button */}
          <div className="flex items-start gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                nodeData.onSelect?.()
              }}
              className={`
                flex-shrink-0 w-5 h-5 rounded mt-0.5
                flex items-center justify-center
                transition-all duration-100
                ${isSelected 
                  ? 'bg-blue-500 text-white' 
                  : 'border-2 border-slate-300 hover:border-blue-400 hover:bg-blue-50'
                }
              `}
              title="Select this move for idea generation"
            >
              {isSelected && <Check className="w-3 h-3" />}
            </button>
            
            <div className="flex-1 min-w-0 pr-8">
              {/* "What if..." statement - the main move */}
              <h4 className={`font-semibold text-[13px] leading-tight ${
                isSelected ? 'text-blue-800' : moveData.challengesPrior ? 'text-amber-800' : familyColor.text
              }`}>
                {moveData.move}
              </h4>
            </div>
          </div>
          
          {/* Impact section */}
          <div className="mt-2 flex items-start gap-1.5">
            <ArrowRight className="w-3 h-3 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Impact:</span>
              <p className="text-[11px] text-slate-700 leading-snug">{moveData.impact}</p>
            </div>
          </div>
          
          {/* Leads to section */}
          <div className="mt-1.5 flex items-start gap-1.5">
            <Zap className="w-3 h-3 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Leads to:</span>
              <p className={`text-[11px] text-slate-600 leading-snug ${isHovered ? '' : 'line-clamp-2'}`}>
                {moveData.leadsTo}
              </p>
            </div>
          </div>
          
          {/* Tension/Challenge indicator (if this challenges prior assumptions) */}
          {moveData.tension && (
            <div className="mt-1.5 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Tension:</span>
                <p className={`text-[11px] text-amber-700 leading-snug ${isHovered ? '' : 'line-clamp-2'}`}>
                  {moveData.tension}
                </p>
              </div>
            </div>
          )}
          
          {/* Tags: modifies type + challenges prior badge */}
          <div className="mt-2 flex flex-wrap gap-1">
            {moveData.modifies && MODIFIES_LABELS[moveData.modifies] && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${MODIFIES_LABELS[moveData.modifies].color}`}>
                {MODIFIES_LABELS[moveData.modifies].label}
              </span>
            )}
            {moveData.challengesPrior && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">
                Challenges Prior
              </span>
            )}
            {nodeData.family && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {nodeData.family}
              </span>
            )}
          </div>
          
          {/* User Input Section - for exploring deeper with your direction */}
          {canExpand && (
            <div className="mt-2.5 pt-2 border-t border-slate-100">
              {!showInput ? (
                <button
                  onClick={toggleInput}
                  className="
                    w-full flex items-center gap-1.5 px-2 py-1.5
                    text-[11px] text-blue-600 hover:text-blue-700
                    bg-blue-50/50 hover:bg-blue-50
                    rounded-md border border-blue-100 hover:border-blue-200
                    transition-all duration-150
                  "
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Add your direction...</span>
                </button>
              ) : (
                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleExpandWithInput()
                      }
                      if (e.key === 'Escape') {
                        setShowInput(false)
                        setUserInput('')
                      }
                    }}
                    placeholder="e.g., Focus on cost-effective approaches, or explore this with magnetic mechanisms..."
                    className="
                      w-full px-2 py-1.5 text-[11px]
                      bg-white border border-blue-200 rounded-md
                      focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400
                      placeholder:text-slate-400
                      resize-none
                    "
                    rows={2}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExpandWithInput()
                      }}
                      className="
                        flex-1 flex items-center justify-center gap-1
                        px-2 py-1 text-[10px] font-medium
                        bg-blue-500 hover:bg-blue-600 text-white
                        rounded transition-colors
                      "
                    >
                      <Send className="w-3 h-3" />
                      Explore Deeper
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowInput(false)
                        setUserInput('')
                      }}
                      className="
                        px-2 py-1 text-[10px]
                        text-slate-500 hover:text-slate-700
                        bg-slate-100 hover:bg-slate-200
                        rounded transition-colors
                      "
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Expand/Zoom button - to further explore this dimension */}
        {canExpand && (
          <div className="absolute right-2 top-2">
            {isExpanding ? (
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onExpand?.(userInput.trim() || undefined)
                  setUserInput('')
                  setShowInput(false)
                }}
                className="
                  w-7 h-7 rounded-full
                  bg-blue-500 hover:bg-blue-600
                  text-white
                  flex items-center justify-center
                  shadow-sm hover:shadow
                  transition-all duration-150
                  hover:scale-110
                "
                title={userInput.trim() ? "Explore with your direction" : "Explore deeper into this move"}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        
        {/* Collapse/Expand children toggle */}
        {(hasChildren || isExpanded) && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onCollapse?.()
            }}
            className={`
              absolute -right-3 top-1/2 -translate-y-1/2 z-10
              group/collapse
              w-6 h-6 rounded-full
              flex items-center justify-center
              transition-all duration-200
              shadow-sm hover:shadow-md
              ${isCollapsed 
                ? 'bg-amber-500 hover:bg-amber-600 text-white' 
                : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
              }
            `}
          >
            {isCollapsed ? (
              <Plus className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        
        {/* Selected indicator */}
        {isSelected && (
          <div className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>
    )
  }

  // Original dimension node format (for families and legacy options)
  return (
    <div
      onClick={(e) => e.stopPropagation()} // Prevent React Flow from selecting node on click
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-new={isNew ? "true" : undefined}
      className={`
        group relative rounded-lg transition-all duration-150
        w-[280px] border-l-4 border border-slate-200
        ${isSelected
          ? 'bg-blue-50 border-l-blue-500 shadow-md ring-1 ring-blue-300'
          : `${familyColor.bg} ${familyColor.border} hover:shadow-sm hover:border-slate-300`
        }
      `}
    >
      {/* Compact Handles */}
      <Handle
          type="target"
          position={Position.Left}
          className={`!w-2 !h-2 !border !border-white !-left-1 ${
            isSelected ? '!bg-blue-500' : familyColor.handle
          }`}
        />
        <Handle
          type="source"
          position={Position.Right}
          className={`!w-2 !h-2 !border !border-white !-right-1 ${
            isSelected ? '!bg-blue-500' : familyColor.handle
          }`}
        />

      {/* Compact content area */}
      <div className="px-2.5 py-2">
        {/* Header row: checkbox + title + expand button */}
        <div className="flex items-start gap-2">
          {/* Checkbox for selection */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              nodeData.onSelect?.()
            }}
            className={`
              flex-shrink-0 w-5 h-5 rounded mt-0.5
              flex items-center justify-center
              transition-all duration-100
              ${isSelected 
                ? 'bg-blue-500 text-white' 
                : 'border-2 border-slate-300 hover:border-blue-400 hover:bg-blue-50'
              }
            `}
            title="Select this dimension for idea generation"
          >
            {isSelected && <Check className="w-3 h-3" />}
          </button>
          
          {/* Title - wraps instead of truncates, takes full width */}
          <div className="flex-1 min-w-0 pr-6">
            <h4 className={`font-semibold text-[13px] leading-tight ${
              isSelected ? 'text-blue-800' : familyColor.text
            }`}>
              {nodeData.title}
            </h4>
            
            {/* Description - shows more lines, expands on hover */}
            {nodeData.description && (
              <p className={`
                text-[11px] text-slate-600 mt-1 leading-snug
                ${isHovered ? '' : 'line-clamp-3'}
              `}>
                {nodeData.description}
              </p>
            )}
            
            {/* Family tag - minimal, only if not obvious */}
            {isFamily && nodeData.family && (
              <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {nodeData.family}
              </span>
            )}
          </div>
        </div>
        
        {/* User Input Section - for ALL expandable nodes */}
        {canExpand && (
          <div className="mt-2 pt-2 border-t border-slate-100">
            {!showInput ? (
              <button
                onClick={toggleInput}
                className="
                  w-full flex items-center gap-1.5 px-2 py-1.5
                  text-[11px] text-blue-600 hover:text-blue-700
                  bg-blue-50/50 hover:bg-blue-50
                  rounded-md border border-blue-100 hover:border-blue-200
                  transition-all duration-150
                "
              >
                <MessageSquare className="w-3 h-3" />
                <span>{isFamily ? 'Add your thought...' : 'Add your direction...'}</span>
              </button>
            ) : (
              <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <textarea
                  ref={inputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleExpandWithInput()
                    }
                    if (e.key === 'Escape') {
                      setShowInput(false)
                      setUserInput('')
                    }
                  }}
                  placeholder={isFamily 
                    ? "e.g., What if we use biodegradable materials?" 
                    : "e.g., Focus on cost-effective approaches..."
                  }
                  className="
                    w-full px-2 py-1.5 text-[11px]
                    bg-white border border-blue-200 rounded-md
                    focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400
                    placeholder:text-slate-400
                    resize-none
                  "
                  rows={2}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleExpandWithInput()
                    }}
                    className="
                      flex-1 flex items-center justify-center gap-1
                      px-2 py-1 text-[10px] font-medium
                      bg-blue-500 hover:bg-blue-600 text-white
                      rounded transition-colors
                    "
                  >
                    <Send className="w-3 h-3" />
                    {isFamily ? 'Explore with AI' : 'Explore Deeper'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowInput(false)
                      setUserInput('')
                    }}
                    className="
                      px-2 py-1 text-[10px]
                      text-slate-500 hover:text-slate-700
                      bg-slate-100 hover:bg-slate-200
                      rounded transition-colors
                    "
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Expand button - positioned inline, smaller */}
        {canExpand && (
          <div className="absolute right-1.5 top-2">
            {isExpanding ? (
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onExpand?.(userInput.trim() || undefined)
                  setUserInput('')
                  setShowInput(false)
                }}
                className="
                  w-6 h-6 rounded-full
                  bg-blue-500 hover:bg-blue-600
                  text-white
                  flex items-center justify-center
                  shadow-sm hover:shadow
                  transition-all duration-150
                  hover:scale-105
                "
                title={userInput.trim() ? "Explore with your direction" : "Explore sub-dimensions"}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Collapse/Expand toggle at arrow tip (right edge) */}
      {(hasChildren || isExpanded) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            nodeData.onCollapse?.()
          }}
          className={`
            absolute -right-3 top-1/2 -translate-y-1/2 z-10
            group/collapse
            w-6 h-6 rounded-full
            flex items-center justify-center
            transition-all duration-200
            shadow-sm hover:shadow-md
            ${isCollapsed 
              ? 'bg-amber-500 hover:bg-amber-600 text-white' 
              : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }
          `}
        >
          {isCollapsed ? (
            <Plus className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
          {/* Tooltip on hover */}
          <span className={`
            absolute right-full mr-2 top-1/2 -translate-y-1/2
            px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap
            opacity-0 group-hover/collapse:opacity-100
            pointer-events-none
            transition-opacity duration-150
            ${isCollapsed 
              ? 'bg-amber-600 text-white' 
              : 'bg-slate-700 text-white'
            }
          `}>
            {isCollapsed ? 'Show children' : 'Hide children'}
          </span>
        </button>
      )}
      
      {/* Selected indicator - tiny badge */}
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <Check className="w-2.5 h-2.5 text-white" />
        </div>
      )}
    </div>
  )
}

export default memo(DimensionNode)
