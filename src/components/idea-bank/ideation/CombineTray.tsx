'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { Node } from '@xyflow/react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap,
  Layers,
  Box,
  X,
  Sparkles,
  Loader2,
  ChevronDown,
  Target,
  Check,
  Info,
  Plus,
  Trash2,
  FolderPlus,
  GripVertical,
  Edit2,
  MessageSquare,
  Brain,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'

// TRIZ Operator type from session
interface TrizOperator {
  id: string
  name: string
  description: string
  examples?: string[]
}

// Bucket for grouping dimensions
interface IdeaBucket {
  id: string
  name: string
  dimensionIds: string[]
}

interface CombineTrayProps {
  selectedNodes: Set<string>
  nodes: Node[]
  availableOperators: TrizOperator[]
  onGenerate: (count: number, intent: string, selectedOperators: string[], buckets?: IdeaBucket[], userGuidance?: string) => void
  onClear: () => void
  onRemoveNode?: (nodeId: string) => void  // NEW: Remove a single dimension from selection
  loading: boolean
  // Obviousness check states
  checkingObviousness?: boolean
  obviousnessWarning?: {
    score: number
    flags: string[]
    wildCard?: any
    analogySuggestions?: string[]
    message: string
  } | null
  onForceGenerate?: (count: number, intent: string, selectedOperators: string[], buckets?: IdeaBucket[], userGuidance?: string) => void
}

type RecipeIntent = 'DIVERGENT' | 'CONVERGENT' | 'RISK_REDUCTION' | 'COST_REDUCTION'

const intentOptions: { value: RecipeIntent; label: string; description: string; tooltip: string; icon: React.ReactNode }[] = [
  {
    value: 'DIVERGENT',
    label: 'Divergent',
    description: 'Creative & diverse ideas',
    tooltip: 'Maximize creativity: generates wild, cross-domain ideas using distant analogies. Best for brainstorming & exploring new possibilities.',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    value: 'CONVERGENT',
    label: 'Convergent',
    description: 'Practical solutions',
    tooltip: 'Focus on feasibility: generates implementable solutions based on proven engineering principles. Best for near-term product development.',
    icon: <Target className="w-4 h-4" />,
  },
  {
    value: 'RISK_REDUCTION',
    label: 'Low Risk',
    description: 'Safety & reliability',
    tooltip: 'Prioritize safety: generates ideas that emphasize reliability, redundancy, and fail-safe mechanisms. Best for regulated industries.',
    icon: <Layers className="w-4 h-4" />,
  },
  {
    value: 'COST_REDUCTION',
    label: 'Low Cost',
    description: 'Cost-effective',
    tooltip: 'Minimize cost: generates ideas focused on material reduction, simpler manufacturing, and economies of scale. Best for cost-sensitive markets.',
    icon: <Box className="w-4 h-4" />,
  },
]

// TRIZ Operator detailed descriptions
const TRIZ_OPERATOR_TIPS: Record<string, string> = {
  'Segmentation': 'Divide an object into independent parts, or make it modular/easy to disassemble',
  'Extraction': 'Remove the problematic part or extract only the necessary component',
  'Local Quality': 'Change uniform structure to non-uniform, make each part function optimally',
  'Asymmetry': 'Replace symmetrical form with asymmetrical to improve function',
  'Merging': 'Combine identical or similar objects, or operations in time',
  'Universality': 'Make an object perform multiple functions, eliminating the need for other objects',
  'Nesting': 'Place one object inside another, pass one through the cavity of another',
  'Anti-Weight': 'Compensate object weight by merging with others that provide lift',
  'Prior Action': 'Perform action in advance, or pre-arrange objects for convenient operation',
  'Cushion in Advance': 'Prepare emergency means beforehand to compensate for low reliability',
  'Equipotentiality': 'Change conditions so object doesn\'t need to be raised or lowered',
  'Do It in Reverse': 'Invert the action, make movable parts fixed and vice versa',
  'Spheroidality': 'Replace linear parts with curved, flat surfaces with spherical',
  'Dynamics': 'Allow characteristics to change optimally, divide into movable parts',
  'Partial or Excessive Action': 'If 100% is hard, use "less" or "more" to simplify the problem',
  'Another Dimension': 'Move in 3D space, use multi-story arrangement, tilt object',
  'Mechanical Vibration': 'Use oscillation, increase frequency to ultrasonic',
  'Periodic Action': 'Replace continuous with periodic action, use pauses for other actions',
  'Continuity of Useful Action': 'Carry on work continuously, eliminate idle runs',
  'Skipping': 'Conduct process at high speed to skip harmful stages',
  'default': 'Apply this TRIZ principle to transform your dimensions into inventive ideas'
}

export default function CombineTray({
  selectedNodes,
  nodes,
  availableOperators,
  onGenerate,
  onClear,
  onRemoveNode,
  loading,
  checkingObviousness = false,
  obviousnessWarning,
  onForceGenerate,
}: CombineTrayProps) {
  const [ideaCount, setIdeaCount] = useState(3)
  const [intent, setIntent] = useState<RecipeIntent>('DIVERGENT')
  const [selectedOperators, setSelectedOperators] = useState<Set<string>>(new Set())
  const [showOperatorInfo, setShowOperatorInfo] = useState(false)
  
  // User guidance for idea generation
  const [userGuidance, setUserGuidance] = useState('')
  const [showGuidanceInput, setShowGuidanceInput] = useState(false)
  
  // Multi-bucket system
  const [buckets, setBuckets] = useState<IdeaBucket[]>([])
  const [useBuckets, setUseBuckets] = useState(false)
  const [bucketCounter, setBucketCounter] = useState(1)
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  
  // Drag and drop state
  const [draggedDimension, setDraggedDimension] = useState<string | null>(null)
  const [dragOverBucket, setDragOverBucket] = useState<string | null>(null)

  // Get dimension nodes from selection
  const dimensionNodes = useMemo(() => {
    const result: Node[] = []
    selectedNodes.forEach(nodeId => {
      const node = nodes.find(n => n.id === nodeId)
      if (node && node.type === 'dimension') {
        result.push(node)
      }
    })
    return result
  }, [selectedNodes, nodes])

  // Unassigned dimensions (not in any bucket)
  const unassignedDimensions = useMemo(() => {
    if (!useBuckets) return dimensionNodes
    const assignedIds = new Set(buckets.flatMap(b => b.dimensionIds))
    return dimensionNodes.filter(n => !assignedIds.has(n.id))
  }, [dimensionNodes, buckets, useBuckets])

  // Toggle operator selection
  const toggleOperator = (opId: string) => {
    setSelectedOperators(prev => {
      const next = new Set(prev)
      if (next.has(opId)) {
        next.delete(opId)
      } else {
        next.add(opId)
      }
      return next
    })
  }

  // Auto-generate bucket name from first dimension or counter
  const generateBucketName = useCallback((dimensionIds: string[] = []) => {
    if (dimensionIds.length > 0) {
      const firstDim = dimensionNodes.find(n => n.id === dimensionIds[0])
      if (firstDim) {
        return `${(firstDim.data as any).title || 'Bucket'} Group`
      }
    }
    return `Bucket ${bucketCounter}`
  }, [dimensionNodes, bucketCounter])

  // Add a new bucket with auto-generated name
  const addBucket = useCallback((initialDimensionIds: string[] = []) => {
    const name = generateBucketName(initialDimensionIds)
    const newBucket: IdeaBucket = {
      id: `bucket-${Date.now()}`,
      name,
      dimensionIds: initialDimensionIds,
    }
    setBuckets(prev => [...prev, newBucket])
    setBucketCounter(prev => prev + 1)
    setUseBuckets(true)
    return newBucket
  }, [generateBucketName])

  // Remove a bucket
  const removeBucket = (bucketId: string) => {
    setBuckets(prev => prev.filter(b => b.id !== bucketId))
    if (buckets.length <= 1) {
      setUseBuckets(false)
    }
  }

  // Update bucket name
  const updateBucketName = (bucketId: string, newName: string) => {
    setBuckets(prev => prev.map(b => 
      b.id === bucketId ? { ...b, name: newName.trim() || generateBucketName(b.dimensionIds) } : b
    ))
    setEditingBucketId(null)
    setEditingName('')
  }

  // Start editing bucket name
  const startEditingBucket = (bucket: IdeaBucket) => {
    setEditingBucketId(bucket.id)
    setEditingName(bucket.name)
  }

  // Add dimension to bucket
  const addToBucket = (bucketId: string, dimensionId: string) => {
    // First remove from any other bucket
    setBuckets(prev => prev.map(b => ({
      ...b,
      dimensionIds: b.id === bucketId 
        ? [...b.dimensionIds.filter(id => id !== dimensionId), dimensionId]
        : b.dimensionIds.filter(id => id !== dimensionId)
    })))
  }

  // Remove dimension from bucket
  const removeFromBucket = (bucketId: string, dimensionId: string) => {
    setBuckets(prev => prev.map(b => 
      b.id === bucketId 
        ? { ...b, dimensionIds: b.dimensionIds.filter(id => id !== dimensionId) }
        : b
    ))
  }

  // Drag handlers for dimensions
  const handleDragStart = (e: React.DragEvent, dimensionId: string) => {
    e.dataTransfer.setData('text/plain', dimensionId)
    setDraggedDimension(dimensionId)
  }

  const handleDragEnd = () => {
    setDraggedDimension(null)
    setDragOverBucket(null)
  }

  const handleDragOver = (e: React.DragEvent, bucketId: string) => {
    e.preventDefault()
    setDragOverBucket(bucketId)
  }

  const handleDragLeave = () => {
    setDragOverBucket(null)
  }

  const handleDrop = (e: React.DragEvent, bucketId: string) => {
    e.preventDefault()
    const dimensionId = e.dataTransfer.getData('text/plain')
    if (dimensionId) {
      addToBucket(bucketId, dimensionId)
    }
    setDragOverBucket(null)
    setDraggedDimension(null)
  }

  // Handle drop on "new bucket" zone
  const handleDropNewBucket = (e: React.DragEvent) => {
    e.preventDefault()
    const dimensionId = e.dataTransfer.getData('text/plain')
    if (dimensionId) {
      addBucket([dimensionId])
    }
    setDragOverBucket(null)
    setDraggedDimension(null)
  }

  const totalDimensionsSelected = dimensionNodes.length
  const canGenerate = totalDimensionsSelected > 0
  const selectedIntent = intentOptions.find(o => o.value === intent)!

  const handleGenerate = () => {
    const guidance = userGuidance.trim() || undefined
    if (useBuckets && buckets.length > 0) {
      // Generate with buckets
      onGenerate(ideaCount, intent, Array.from(selectedOperators), buckets, guidance)
    } else {
      // Generate without buckets (all selected dimensions together)
      onGenerate(ideaCount, intent, Array.from(selectedOperators), undefined, guidance)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-500" />
            Idea Recipe
          </h3>
          {totalDimensionsSelected > 0 && (
            <button
              onClick={() => {
                onClear()
                setSelectedOperators(new Set())
                setBuckets([])
                setUseBuckets(false)
                setBucketCounter(1)
                setUserGuidance('')
                setShowGuidanceInput(false)
              }}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {totalDimensionsSelected} dimension{totalDimensionsSelected !== 1 ? 's' : ''} selected
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Selected Dimensions */}
        <div className="bg-white rounded-xl p-3 border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-slate-700">Dimensions</span>
            </div>
            {!useBuckets && totalDimensionsSelected > 1 && (
              <button
                onClick={() => setUseBuckets(true)}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <FolderPlus className="w-3 h-3" />
                Use Buckets
              </button>
            )}
          </div>

          {!useBuckets ? (
            // Simple list view with drag support
            <div className="flex flex-wrap gap-1.5 min-h-[40px]">
              {dimensionNodes.length > 0 ? (
                dimensionNodes.map(node => (
                  <div
                    key={node.id}
                    draggable
                    onDragStart={(e: React.DragEvent) => handleDragStart(e, node.id)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-grab active:cursor-grabbing ${draggedDimension === node.id ? 'opacity-50' : ''}`}
                    title={(node.data as any).title || node.id}
                  >
                    <Badge className="bg-blue-100 text-blue-800 text-xs flex items-center gap-1 pr-1">
                      <GripVertical className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      <span className="text-left">{(node.data as any).title || node.id}</span>
                      {onRemoveNode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveNode(node.id)
                          }}
                          className="ml-1 p-0.5 rounded-full hover:bg-blue-200 transition-colors flex-shrink-0"
                          title="Remove dimension"
                        >
                          <X className="w-3 h-3 text-blue-600" />
                        </button>
                      )}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic p-2">
                  Select dimensions from the mind map
                </p>
              )}
            </div>
          ) : (
            // Bucket view with drag-and-drop
            <div className="space-y-3">
              {/* Unassigned dimensions - draggable */}
              {unassignedDimensions.length > 0 && (
                <div className="p-2 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1.5">
                    📦 Unassigned ({unassignedDimensions.length}) <span className="font-normal">- drag to bucket</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {unassignedDimensions.map(node => (
                      <div
                        key={node.id}
                        draggable
                        onDragStart={(e: React.DragEvent) => handleDragStart(e, node.id)}
                        onDragEnd={handleDragEnd}
                        className={`cursor-grab active:cursor-grabbing ${draggedDimension === node.id ? 'opacity-50 scale-105' : ''}`}
                        title={(node.data as any).title || node.id}
                      >
                        <Badge className="bg-slate-200 text-slate-700 text-xs flex items-center gap-1 pr-1">
                          <GripVertical className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <span className="text-left">{(node.data as any).title || node.id}</span>
                          {onRemoveNode && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onRemoveNode(node.id)
                              }}
                              className="ml-1 p-0.5 rounded-full hover:bg-slate-300 transition-colors flex-shrink-0"
                              title="Remove dimension"
                            >
                              <X className="w-3 h-3 text-slate-600" />
                            </button>
                          )}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Buckets - droppable */}
              {buckets.map(bucket => (
                <div 
                  key={bucket.id} 
                  className={`p-2 rounded-lg border-2 transition-all
                    ${dragOverBucket === bucket.id 
                      ? 'bg-blue-100 border-blue-400 border-dashed scale-[1.02]' 
                      : 'bg-blue-50 border-blue-200'}`}
                  onDragOver={(e) => handleDragOver(e, bucket.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, bucket.id)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    {editingBucketId === bucket.id ? (
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => updateBucketName(bucket.id, editingName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') updateBucketName(bucket.id, editingName)
                          if (e.key === 'Escape') { setEditingBucketId(null); setEditingName('') }
                        }}
                        className="h-6 text-xs w-32"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => startEditingBucket(bucket)}
                        className="text-xs font-semibold text-blue-700 flex items-center gap-1 hover:text-blue-900"
                      >
                        🗂️ {bucket.name}
                        <Edit2 className="w-2.5 h-2.5 opacity-50" />
                      </button>
                    )}
                    <button
                      onClick={() => removeBucket(bucket.id)}
                      className="text-blue-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 min-h-[28px]">
                    {bucket.dimensionIds.length > 0 ? (
                      bucket.dimensionIds.map(dimId => {
                        const node = dimensionNodes.find(n => n.id === dimId)
                        if (!node) return null
                        return (
                          <div
                            key={dimId}
                            draggable
                            onDragStart={(e: React.DragEvent) => handleDragStart(e, dimId)}
                            onDragEnd={handleDragEnd}
                            className={`cursor-grab active:cursor-grabbing ${draggedDimension === dimId ? 'opacity-50' : ''}`}
                          >
                            <Badge className="bg-blue-200 text-blue-800 text-xs flex items-center gap-1">
                              <GripVertical className="w-3 h-3 text-blue-400" />
                              {(node.data as any).title || dimId}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeFromBucket(bucket.id, dimId) }}
                                className="hover:text-red-600"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </Badge>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-[10px] text-blue-400 italic w-full text-center py-1">
                        {dragOverBucket === bucket.id ? '↓ Drop here!' : 'Drag dimensions here'}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Drop zone for new bucket */}
              <div 
                className={`p-3 rounded-lg border-2 border-dashed transition-all flex items-center justify-center gap-2 cursor-pointer
                  ${draggedDimension && !dragOverBucket 
                    ? 'bg-green-50 border-green-400 text-green-700' 
                    : 'bg-slate-50 border-slate-300 text-slate-500 hover:border-blue-300 hover:text-blue-600'}`}
                onClick={() => addBucket()}
                onDragOver={(e) => { e.preventDefault(); setDragOverBucket('new') }}
                onDragLeave={() => setDragOverBucket(null)}
                onDrop={handleDropNewBucket}
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {draggedDimension ? 'Drop to create new bucket' : 'Add Bucket'}
                </span>
              </div>

              <button
                onClick={() => {
                  setBuckets([])
                  setUseBuckets(false)
                  setBucketCounter(1)
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                ← Back to simple view
              </button>
            </div>
          )}
        </div>

        {/* TRIZ Operators */}
        <AnimatePresence>
          {totalDimensionsSelected > 0 && availableOperators.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-xl p-3 border border-slate-200"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-slate-700">TRIZ Operators</span>
                  <Badge variant="secondary" className="text-[10px] h-4">
                    {selectedOperators.size}
                  </Badge>
                </div>
                <button
                  onClick={() => setShowOperatorInfo(!showOperatorInfo)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
              
              {showOperatorInfo && (
                <p className="text-[11px] text-slate-500 mb-2 p-2 bg-amber-50 rounded border border-amber-100">
                  TRIZ operators guide how dimensions combine into ideas. Optional but recommended.
                </p>
              )}
              
              <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                {availableOperators.slice(0, 10).map(op => (
                  <button
                    key={op.id}
                    onClick={() => toggleOperator(op.id)}
                    title={TRIZ_OPERATOR_TIPS[op.name] || op.description || TRIZ_OPERATOR_TIPS['default']}
                    className={`
                      p-2 rounded-lg border text-left transition-all text-xs group relative
                      ${selectedOperators.has(op.id)
                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-amber-200'
                      }
                    `}
                  >
                    <div className="flex items-center gap-1.5">
                      {selectedOperators.has(op.id) ? (
                        <Check className="w-3 h-3 text-amber-600" />
                      ) : (
                        <Zap className="w-3 h-3 text-slate-400" />
                      )}
                      <span className="font-medium truncate">{op.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generation Settings */}
        {totalDimensionsSelected > 0 && (
          <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-3">
            {/* Intent Selection */}
            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1.5 block">
                Generation Style
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {intentOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setIntent(option.value)}
                    title={option.tooltip}
                    className={`
                      p-2 rounded-lg border text-left transition-all
                      ${intent === option.value
                        ? 'bg-blue-50 border-blue-300'
                        : 'bg-slate-50 border-slate-200 hover:border-blue-200'
                      }
                    `}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={`
                        w-5 h-5 rounded flex items-center justify-center
                        ${intent === option.value ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-500'}
                      `}>
                        {option.icon}
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-800">{option.label}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Idea Count */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Ideas {useBuckets && buckets.length > 0 ? 'per bucket' : ''}
                </label>
                <span className="text-sm font-bold text-blue-600">{ideaCount}</span>
              </div>
              <Slider
                value={[ideaCount]}
                onValueChange={(v) => setIdeaCount(v[0])}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>
          </div>
        )}

        {/* User Guidance Section - Guide the AI */}
        {totalDimensionsSelected > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl p-3 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-slate-700">Guide the AI</span>
              </div>
              {userGuidance && (
                <button
                  onClick={() => {
                    setUserGuidance('')
                    setShowGuidanceInput(false)
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
            
            {!showGuidanceInput && !userGuidance ? (
              <button
                onClick={() => setShowGuidanceInput(true)}
                className="
                  w-full flex items-center gap-2 px-3 py-2.5
                  text-xs text-blue-600 hover:text-blue-700
                  bg-white hover:bg-blue-50/50
                  rounded-lg border border-blue-100 hover:border-blue-200
                  transition-all duration-150
                "
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add your guidance to steer idea generation...</span>
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={userGuidance}
                  onChange={(e) => setUserGuidance(e.target.value)}
                  placeholder="e.g., Focus on mechanical solutions without electronics, explore biological analogies like cell division, prioritize safety over cost..."
                  className="
                    w-full px-3 py-2 text-xs
                    bg-white border border-blue-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
                    placeholder:text-slate-400
                    resize-none
                  "
                  rows={3}
                  autoFocus={showGuidanceInput && !userGuidance}
                />
                {userGuidance && (
                  <p className="text-[10px] text-blue-600 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Your guidance will be honored with high priority
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Obviousness Warning */}
      {obviousnessWarning && (
        <div className="p-3 border-t border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2 mb-2">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-800">
                Combination Novelty: {obviousnessWarning.score}/100
              </p>
              <p className="text-[10px] text-amber-700 mt-1">
                {obviousnessWarning.message}
              </p>
              {obviousnessWarning.wildCard && (
                <p className="text-[10px] text-amber-700 mt-1">
                  <span className="font-medium">Suggested wildcard:</span> {obviousnessWarning.wildCard.title || 'Add an unexpected dimension'}
                </p>
              )}
            </div>
          </div>
          {onForceGenerate && (
            <Button
              onClick={() => onForceGenerate(ideaCount, intent, Array.from(selectedOperators), useBuckets ? buckets : undefined, userGuidance.trim() || undefined)}
              variant="outline"
              size="sm"
              className="w-full text-amber-700 border-amber-300 hover:bg-amber-100"
            >
              <Zap className="w-3 h-3 mr-1" />
              Generate Anyway
            </Button>
          )}
        </div>
      )}

      {/* Generate Button */}
      <div className="p-3 border-t border-slate-200 bg-white">
        <Button
          onClick={handleGenerate}
          disabled={!canGenerate || loading || checkingObviousness}
          className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg"
        >
          {checkingObviousness ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Checking novelty...
            </>
          ) : loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Generate {useBuckets && buckets.length > 0 
                ? `${ideaCount * buckets.length} Ideas (${buckets.length} buckets)`
                : `${ideaCount} Ideas`
              }
              {userGuidance && ' (Guided)'}
            </>
          )}
        </Button>
        {!canGenerate && (
          <p className="text-[10px] text-center text-slate-400 mt-2">
            Select dimensions from the mind map first
          </p>
        )}
        {userGuidance && canGenerate && !loading && (
          <p className="text-[10px] text-center text-blue-500 mt-1.5 flex items-center justify-center gap-1">
            <MessageSquare className="w-3 h-3" />
            AI will follow your guidance
          </p>
        )}
      </div>
    </div>
  )
}
