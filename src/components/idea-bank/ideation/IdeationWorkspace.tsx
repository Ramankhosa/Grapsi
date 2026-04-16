'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  Connection,
  Node,
  Edge,
  NodeTypes,
  MarkerType,
} from '@xyflow/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Plus,
  Play,
  Loader2,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Target,
  Layers,
  Zap,
  Search,
  FileText,
  ArrowRight,
  X,
  Settings,
  RefreshCw,
  Download,
  Edit3,
  ChevronLeft,
  ChevronDown,
  HelpCircle,
  LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

// Import custom nodes
import SeedNode from './nodes/SeedNode'
import DimensionNode from './nodes/DimensionNode'
import OperatorNode from './nodes/OperatorNode'
import IdeaNode from './nodes/IdeaNode'
import CombineTray from './CombineTray'
import IdeaFramePanel from './IdeaFramePanel'
import IdeationHelpModal from './IdeationHelpModal'
import IdeationProcessingView from './IdeationProcessingView'
import ContradictionInsightPanel from './ContradictionInsightPanel'

interface IdeationWorkspaceProps {
  onExportToBank: () => void
}

// Session status stages
type SessionStage = 
  | 'idle'           // Initial - no session
  | 'seed_input'     // Editing seed (new or returning to edit)
  | 'normalizing'    // Processing - analyzing seed
  | 'clarifying'     // Input needed - questions from AI
  | 'classifying'    // Processing - classifying invention
  | 'mapping_contradictions' // Processing - mapping technical contradictions to TRIZ
  | 'expanding'      // Processing - building dimensions
  | 'exploring'      // Workspace - user explores mind map
  | 'checking_obviousness' // Processing - checking if combination is too obvious
  | 'generating'     // Processing - creating ideas
  | 'checking_novelty' // Processing - verifying novelty against patent databases
  | 'reviewing'      // Workspace - reviewing ideas

// Streaming idea interface for progressive display
interface StreamingIdea {
  id: string
  title: string
  problem: string
  principle: string
  status: 'generating' | 'ready' | 'checking_novelty' | 'verified'
  noveltyScore?: number
}

// Helper to determine which view to show
const isInputView = (stage: SessionStage) => 
  ['idle', 'seed_input', 'clarifying'].includes(stage)

const isProcessingView = (stage: SessionStage) =>
  ['normalizing', 'classifying', 'mapping_contradictions', 'expanding', 'generating', 'checking_novelty'].includes(stage)
  // Note: 'checking_obviousness' is handled inline in the combine tray, not as a full processing view

const isWorkspaceView = (stage: SessionStage) =>
  ['exploring', 'reviewing'].includes(stage)

interface IdeationSession {
  id: string
  status: string
  seedText: string
  seedGoal?: string
  seedConstraints: string[]
  normalization?: any
  classification?: any
}

interface IdeaFrame {
  id: string
  title: string
  problem: string
  principle: string
  technicalEffect?: string
  status: string
  noveltyScore?: number
  userRating?: number
  data?: any
  noveltySummary?: {
    patentsAnalyzed?: number
    closestPriorArt?: Array<{
      publicationNumber: string
      title: string
      relevanceScore: number
      overlappingFeatures: string[]
      differentiatingFactors: string[]
      remark: string
    }>
    priorArtSummary?: string
    phositaTest?: string
    reasoning?: string
    results?: Array<{
      publicationNumber?: string
      title: string
      snippet?: string
      assignee?: string
    }>
  }
}

const nodeTypes: NodeTypes = {
  seed: SeedNode,
  dimension: DimensionNode,
  operator: OperatorNode,
  idea: IdeaNode,
}

// Subtle edge colors that match family colors - same palette as DimensionNode
const FAMILY_EDGE_COLORS = [
  '#a8a29e', // stone
  '#94a3b8', // slate
  '#a1a1aa', // zinc
  '#a3a3a3', // neutral
  '#fbbf24', // amber (muted)
  '#34d399', // emerald (muted)
  '#38bdf8', // sky (muted)
  '#fb7185', // rose (muted)
  '#818cf8', // indigo (muted)
  '#2dd4bf', // teal (muted)
  '#fb923c', // orange (muted)
  '#22d3ee', // cyan (muted)
]

// Simple hash function to get consistent color index from family name
function getFamilyEdgeColor(family: string | undefined): string {
  if (!family) return '#94a3b8' // Default slate
  let hash = 0
  for (let i = 0; i < family.length; i++) {
    const char = family.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return FAMILY_EDGE_COLORS[Math.abs(hash) % FAMILY_EDGE_COLORS.length]
}

// Utility: Convert backend node type to React Flow node type
function getNodeType(type: string): string {
  const typeMap: Record<string, string> = {
    'SEED': 'seed',
    'DIMENSION_FAMILY': 'dimension',
    'DIMENSION_OPTION': 'dimension',
    'OPERATOR': 'operator',
    'IDEA': 'idea',
    'COMPONENT': 'dimension',
    'CONSTRAINT': 'dimension',
  }
  return typeMap[type] || 'dimension'
}

// Utility: Map session status to UI stage
function mapStatusToStage(status: string): SessionStage {
  const stageMap: Record<string, SessionStage> = {
    'SEED_INPUT': 'seed_input',
    'CLARIFYING': 'clarifying',
    'CLASSIFYING': 'classifying',
    'EXPANDING': 'expanding',
    'EXPLORING': 'exploring',
    'GENERATING': 'generating',
    'REVIEWING': 'reviewing',
    'ARCHIVED': 'reviewing',
  }
  return stageMap[status] || 'exploring'
}

export default function IdeationWorkspace({ onExportToBank }: IdeationWorkspaceProps) {
  // Session state
  const [sessions, setSessions] = useState<any[]>([])
  const [currentSession, setCurrentSession] = useState<IdeationSession | null>(null)
  const [stage, setStage] = useState<SessionStage>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Input state
  const [seedText, setSeedText] = useState('')
  const [seedGoal, setSeedGoal] = useState('')
  const [seedConstraints, setSeedConstraints] = useState<string[]>([])
  const [newConstraint, setNewConstraint] = useState('')
  
  // Clarifying questions state
  const [clarifyingAnswers, setClarifyingAnswers] = useState<Record<number, string>>({})
  
  // Edit mode - to preserve selections when regenerating
  const [preservedSelections, setPreservedSelections] = useState<Set<string>>(new Set())

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<ReactFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  // Selection state for combine tray
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set())
  
  // Collapsed nodes state
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  // Expanding nodes state for loading indicators
  const [expandingNodes, setExpandingNodes] = useState<Set<string>>(new Set())

  // Track newly added nodes for smooth animations
  const [newNodes, setNewNodes] = useState<Set<string>>(new Set())

  // Ideas panel size state
  const [ideasPanelWidth, setIdeasPanelWidth] = useState(384) // Default 24rem (w-96)
  
  // Idea frames
  const [ideaFrames, setIdeaFrames] = useState<IdeaFrame[]>([])
  const [selectedIdea, setSelectedIdea] = useState<IdeaFrame | null>(null)
  const [showIdeaPanel, setShowIdeaPanel] = useState(false)

  // Combine tray visibility
  const [showTray, setShowTray] = useState(false)
  
  // Streaming ideas for progressive display during generation
  const [streamingIdeas, setStreamingIdeas] = useState<StreamingIdea[]>([])
  
  // Novelty check progress state
  const [noveltyProgress, setNoveltyProgress] = useState<{
    currentStep: number
    totalSteps: number
    message: string
    recordsSearched?: number
    matchesFound?: number
  } | undefined>(undefined)
  
  // Track which idea is being novelty checked
  const [noveltyCheckingIdeaId, setNoveltyCheckingIdeaId] = useState<string | null>(null)

  // NEW: Pipeline enhancement states
  const [contradictionMapping, setContradictionMapping] = useState<any>(null)
  const [obviousnessWarning, setObviousnessWarning] = useState<any>(null)
  const [checkingObviousness, setCheckingObviousness] = useState(false) // Inline loading state for obviousness check
  const [feedbackLoopResults, setFeedbackLoopResults] = useState<any>(null)
  const [qualityMetrics, setQualityMetrics] = useState<any>(null)
  
  // Store pending generation params for "Generate Anyway" functionality
  const [pendingGenerationParams, setPendingGenerationParams] = useState<{
    count: number
    intent: string
    selectedOperators: string[]
    buckets?: any[]
  } | null>(null)

  // Help modal state
  const [showHelp, setShowHelp] = useState(false)
  
  // Session restoration flag
  const [isRestoringSession, setIsRestoringSession] = useState(true)

  // ============================================
  // SESSION PERSISTENCE - Survive page refresh
  // ============================================
  const STORAGE_KEYS = {
    SESSION_ID: 'ideation_current_session_id',
    SELECTED_NODES: 'ideation_selected_nodes',
    COLLAPSED_NODES: 'ideation_collapsed_nodes',
  }

  // Persist selected nodes to localStorage
  const persistSelectedNodes = useCallback((nodeIds: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_NODES, JSON.stringify(Array.from(nodeIds)))
    } catch (e) {
      console.warn('Failed to persist selected nodes:', e)
    }
  }, [])

  // Persist collapsed nodes to localStorage
  const persistCollapsedNodes = useCallback((nodeIds: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEYS.COLLAPSED_NODES, JSON.stringify(Array.from(nodeIds)))
    } catch (e) {
      console.warn('Failed to persist collapsed nodes:', e)
    }
  }, [])

  // Persist current session ID to localStorage
  const persistCurrentSession = useCallback((sessionId: string | null) => {
    try {
      if (sessionId) {
        localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId)
      } else {
        localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
      }
    } catch (e) {
      console.warn('Failed to persist session ID:', e)
    }
  }, [])

  // Restore session state on component mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedSessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID)
        const savedSelectedNodes = localStorage.getItem(STORAGE_KEYS.SELECTED_NODES)
        const savedCollapsedNodes = localStorage.getItem(STORAGE_KEYS.COLLAPSED_NODES)

        if (savedSessionId) {
          console.log('[Session Restore] Found saved session:', savedSessionId)
          
          // Load the session
          const response = await fetch(`/api/idea-bank/ideation/${savedSessionId}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            
            // Restore session
            setCurrentSession(data.session)
            
            // Load graph nodes and edges
            if (data.graph) {
              const loadedNodes = data.graph.nodes.map((n: any) => ({
                id: n.id,
                type: getNodeType(n.type),
                position: n.position,
                data: {
                  ...n.data,
                  type: n.type,
                },
              }))
              setNodes(loadedNodes)
              setEdges(data.graph.edges.map((e: any) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                label: e.label,
                animated: e.animated,
                markerEnd: { type: MarkerType.ArrowClosed },
              })))

              // Restore collapsed nodes
              if (savedCollapsedNodes) {
                try {
                  const parsed = JSON.parse(savedCollapsedNodes)
                  setCollapsedNodes(new Set(parsed))
                } catch {
                  // Use default collapsing
                  const nodesWithChildren = new Set<string>()
                  loadedNodes.forEach((n: any) => {
                    const parentId = n.data?.parentId || n.data?.parentNodeId
                    if (parentId) nodesWithChildren.add(parentId)
                  })
                  const nodesToCollapse = loadedNodes
                    .filter((n: any) => nodesWithChildren.has(n.id) && n.type !== 'seed')
                    .map((n: any) => n.id)
                  setCollapsedNodes(new Set(nodesToCollapse))
                }
              }

              // Restore selected nodes
              if (savedSelectedNodes) {
                try {
                  const parsed = JSON.parse(savedSelectedNodes)
                  // Only restore selections that exist in current graph
                  const validSelections = parsed.filter((id: string) => 
                    loadedNodes.some((n: any) => n.id === id)
                  )
                  setSelectedNodes(new Set(validSelections))
                  if (validSelections.length > 0) {
                    setShowTray(true)
                  }
                } catch {
                  console.warn('Failed to parse saved selections')
                }
              }
            }

            // Load idea frames
            if (data.ideaFrames) {
              setIdeaFrames(data.ideaFrames)
            }

            // Set stage based on session status
            const restoredStage = mapStatusToStage(data.session.status)
            setStage(restoredStage)
            
            // Show tray if in exploring/reviewing stage
            if (['exploring', 'reviewing'].includes(restoredStage)) {
              setShowTray(true)
            }

            console.log('[Session Restore] Successfully restored session to stage:', restoredStage)
          } else {
            // Session not found or access denied - clear saved data
            console.log('[Session Restore] Session not found, clearing saved data')
            localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_NODES)
            localStorage.removeItem(STORAGE_KEYS.COLLAPSED_NODES)
          }
        }
      } catch (e) {
        console.error('[Session Restore] Failed to restore session:', e)
      } finally {
        setIsRestoringSession(false)
      }
    }

    restoreSession()
  }, []) // Only run on mount

  // Persist session ID whenever it changes
  useEffect(() => {
    if (!isRestoringSession && currentSession) {
      persistCurrentSession(currentSession.id)
    }
  }, [currentSession?.id, isRestoringSession, persistCurrentSession])

  // Persist selections whenever they change
  useEffect(() => {
    if (!isRestoringSession) {
      persistSelectedNodes(selectedNodes)
    }
  }, [selectedNodes, isRestoringSession, persistSelectedNodes])

  // Persist collapsed nodes whenever they change
  useEffect(() => {
    if (!isRestoringSession) {
      persistCollapsedNodes(collapsedNodes)
    }
  }, [collapsedNodes, isRestoringSession, persistCollapsedNodes])

  // Auto-fit view when nodes change
  const fitViewToNodes = useCallback(() => {
    if (reactFlowInstance && nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          duration: 300,
          maxZoom: 1.2,
        })
      }, 100)
    }
  }, [reactFlowInstance, nodes.length])

  // Auto-layout recalculation to prevent overlapping
  // Groups nodes by parent and recalculates Y positions to avoid overlap
  const recalculateLayout = useCallback(() => {
    if (nodes.length === 0) return

    const LEVEL_WIDTH = 400  // Horizontal spacing between levels
    const NODE_HEIGHT = 180  // Generous vertical spacing for clear hierarchy
    const CHILD_SPACING = 180 // Spacing between child nodes matching NODE_HEIGHT
    
    // Build tree structure
    const nodeMap = new Map<string, typeof nodes[0]>()
    const childrenMap = new Map<string, string[]>()
    
    nodes.forEach(node => {
      nodeMap.set(node.id, node)
      const parentId = (node.data as any)?.parentId || (node.data as any)?.parentNodeId
      if (parentId) {
        const children = childrenMap.get(parentId) || []
        children.push(node.id)
        childrenMap.set(parentId, children)
      }
    })

    // Calculate subtree height recursively
    const getSubtreeHeight = (nodeId: string, visited = new Set<string>()): number => {
      if (visited.has(nodeId)) return NODE_HEIGHT
      visited.add(nodeId)
      
      const children = childrenMap.get(nodeId) || []
      const isCollapsed = collapsedNodes.has(nodeId)
      
      if (children.length === 0 || isCollapsed) {
        return NODE_HEIGHT
      }
      
      // Sum up heights of all visible children
      let totalHeight = 0
      children.forEach(childId => {
        const parentId = (nodeMap.get(childId)?.data as any)?.parentId
        // Skip if child's parent is collapsed
        if (!collapsedNodes.has(parentId)) {
          totalHeight += getSubtreeHeight(childId, visited)
        }
      })
      
      return Math.max(NODE_HEIGHT, totalHeight)
    }

    // Group nodes by depth level
    const nodesByDepth = new Map<number, typeof nodes>()
    nodes.forEach(node => {
      const depth = (node.data as any)?.depth || 0
      const existing = nodesByDepth.get(depth) || []
      existing.push(node)
      nodesByDepth.set(depth, existing)
    })

    // Recalculate Y positions for each depth level
    const newNodes = [...nodes]
    const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b)
    
    depths.forEach(depth => {
      if (depth === 0) return // Skip seed node
      
      const nodesAtDepth = nodesByDepth.get(depth) || []
      
      // Group by parent
      const byParent = new Map<string, typeof nodes>()
      nodesAtDepth.forEach(node => {
        const parentId = (node.data as any)?.parentId || (node.data as any)?.parentNodeId || 'root'
        const siblings = byParent.get(parentId) || []
        siblings.push(node)
        byParent.set(parentId, siblings)
      })

      // For each parent group, recalculate positions
      byParent.forEach((siblings, parentId) => {
        if (siblings.length === 0) return
        
        const parent = nodeMap.get(parentId)
        const parentY = parent?.position?.y || 100
        
        // Calculate total height needed for this subtree
        let totalHeight = 0
        const heights: number[] = []
        siblings.forEach(node => {
          const h = getSubtreeHeight(node.id)
          heights.push(h)
          totalHeight += h
        })
        
        // Distribute siblings vertically centered around parent
        let currentY = parentY - (totalHeight / 2) + (NODE_HEIGHT / 2)
        
        siblings.forEach((node, idx) => {
          const nodeIndex = newNodes.findIndex(n => n.id === node.id)
          if (nodeIndex !== -1) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              position: {
                x: newNodes[nodeIndex].position.x,
                y: currentY,
              },
            }
          }
          currentY += heights[idx]
        })
      })
    })

    // Only update if positions actually changed
    const hasChanges = newNodes.some((node, idx) => 
      node.position.y !== nodes[idx].position.y
    )
    
    if (hasChanges) {
      setNodes(newNodes)
    }
  }, [nodes, collapsedNodes, setNodes, fitViewToNodes])

  // Auto-layout function to properly space out nodes when needed
  const autoLayoutNodes = useCallback(() => {
    if (nodes.length <= 1) return

    const LEVEL_WIDTH = 400  // Horizontal spacing between levels
    const NODE_HEIGHT = 180  // Vertical spacing between nodes
    const START_X = 100
    const START_Y = 100

    // Build parent-child relationships
    const childrenMap = new Map<string, string[]>()
    const nodeMap = new Map<string, typeof nodes[0]>()
    
    nodes.forEach(node => {
      nodeMap.set(node.id, node)
      const parentId = (node.data as any)?.parentId || (node.data as any)?.parentNodeId
      if (parentId) {
        const children = childrenMap.get(parentId) || []
        children.push(node.id)
        childrenMap.set(parentId, children)
      }
    })

    // Calculate subtree height for a node
    const getSubtreeHeight = (nodeId: string, visited = new Set<string>()): number => {
      if (visited.has(nodeId)) return NODE_HEIGHT
      visited.add(nodeId)
      
      const children = childrenMap.get(nodeId) || []
      if (children.length === 0 || collapsedNodes.has(nodeId)) {
        return NODE_HEIGHT
      }
      
      let totalHeight = 0
      children.forEach(childId => {
        totalHeight += getSubtreeHeight(childId, visited)
      })
      
      return Math.max(NODE_HEIGHT, totalHeight)
    }

    // Position nodes recursively
    const positionedNodes = new Map<string, { x: number, y: number }>()
    
    const positionNode = (nodeId: string, x: number, yStart: number, yEnd: number): void => {
      const yCenter = (yStart + yEnd) / 2
      positionedNodes.set(nodeId, { x, y: yCenter })
      
      const children = childrenMap.get(nodeId) || []
      if (children.length === 0 || collapsedNodes.has(nodeId)) return
      
      // Position children
      const childX = x + LEVEL_WIDTH
      let currentY = yStart
      
      children.forEach(childId => {
        const childHeight = getSubtreeHeight(childId)
        positionNode(childId, childX, currentY, currentY + childHeight)
        currentY += childHeight
      })
    }

    // Find root nodes (nodes without parents or seed nodes)
    const rootNodes = nodes.filter(n => {
      const parentId = (n.data as any)?.parentId || (n.data as any)?.parentNodeId
      return !parentId || n.type === 'seed'
    })

    // Position from each root
    let currentRootY = START_Y
    rootNodes.forEach(rootNode => {
      const subtreeHeight = getSubtreeHeight(rootNode.id)
      positionNode(rootNode.id, START_X, currentRootY, currentRootY + subtreeHeight)
      currentRootY += subtreeHeight + NODE_HEIGHT // Gap between trees
    })

    // Apply new positions
    const newNodes = nodes.map(node => {
      const newPos = positionedNodes.get(node.id)
      if (newPos) {
        return {
          ...node,
          position: { x: newPos.x, y: newPos.y },
        }
      }
      return node
    })

    setNodes(newNodes)
  }, [nodes, collapsedNodes, setNodes])

  // NOTE: Auto-layout can be triggered manually via button or on specific events

  // Keyboard shortcuts for help (?), ideas panel (i), and auto-layout (l)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(true)
      }
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey && ideaFrames.length > 0) {
        e.preventDefault()
        setShowIdeaPanel(prev => !prev)
      }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey && nodes.length > 1) {
        e.preventDefault()
        autoLayoutNodes()
        // Fit view after layout
        setTimeout(() => {
          if (reactFlowInstance) {
            reactFlowInstance.fitView({ padding: 0.2, duration: 500 })
          }
        }, 100)
      }
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showHelp, ideaFrames.length, nodes.length, autoLayoutNodes, reactFlowInstance])

  // History panel state - load on demand to reduce server load
  const [showHistory, setShowHistory] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)

  // Load sessions only when history panel is opened (on-demand)
  const loadSessions = async () => {
    if (sessionsLoaded) return // Don't reload if already loaded
    
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSessions(data.sessions || [])
        setSessionsLoaded(true)
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  // Load sessions when history panel is opened
  useEffect(() => {
    if (showHistory && !sessionsLoaded) {
      loadSessions()
    }
  }, [showHistory, sessionsLoaded])

  const loadSession = async (sessionId: string, fitView: boolean = false, skipStageUpdate: boolean = false) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        
        // Load graph nodes and edges
        if (data.graph) {
          const loadedNodes = data.graph.nodes.map((n: any) => ({
            id: n.id,
            type: getNodeType(n.type),
            position: n.position,
            data: {
              ...n.data,
              type: n.type, // Include original type for DimensionNode to determine if expandable
            },
          }))
          setNodes(loadedNodes)
          setEdges(data.graph.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: e.animated,
            markerEnd: { type: MarkerType.ArrowClosed },
          })))

          // By default, collapse all nodes that have children (show only top-level structure)
          const nodesWithChildren = new Set<string>()
          loadedNodes.forEach((n: any) => {
            const parentId = n.data?.parentId || n.data?.parentNodeId
            if (parentId) {
              nodesWithChildren.add(parentId)
            }
          })
          // Collapse all nodes that have children except the seed
          const nodesToCollapse = loadedNodes
            .filter((n: any) => nodesWithChildren.has(n.id) && n.type !== 'seed')
            .map((n: any) => n.id)
          setCollapsedNodes(new Set(nodesToCollapse))
        }

        // Load idea frames
        if (data.ideaFrames) {
          setIdeaFrames(data.ideaFrames)
        }

        // Set stage based on session status (unless explicitly skipped during generation flow)
        if (!skipStageUpdate) {
          setStage(mapStatusToStage(data.session.status))
        }

        // Auto-fit view after loading only if requested
        if (fitView) {
          setTimeout(() => fitViewToNodes(), 200)
        }
      }
    } catch (e) {
      setError('Failed to load session')
    } finally {
      setLoading(false)
    }
  }

  // Create new session
  const handleCreateSession = async () => {
    if (!seedText.trim()) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/idea-bank/ideation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          seedText: seedText.trim(),
          seedGoal: seedGoal.trim() || undefined,
          seedConstraints: seedConstraints.filter(c => c.trim()),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(data.session)
        setStage('seed_input')
        
        // Create seed node
        const seedNode: ReactFlowNode = {
          id: 'seed-root',
          type: 'seed',
          position: { x: 400, y: 100 },
          data: {
            title: seedText.slice(0, 100),
            description: seedText,
            state: 'EXPANDED',
          },
        }
        setNodes([seedNode])

        // Start normalization
        await handleNormalize(data.session.id)
      } else {
        const err = await response.json()
        setError(err.error || 'Failed to create session')
      }
    } catch (e) {
      setError('Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  // Normalize seed
  const handleNormalize = async (sessionId: string) => {
    setStage('normalizing')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/normalize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, normalization: data.normalization } : null)
        
        if (data.hasUnknowns) {
          setStage('clarifying')
        } else {
          await handleClassify(sessionId)
        }
      } else {
        throw new Error('Normalization failed')
      }
    } catch (e) {
      setError('Failed to normalize seed')
      setStage('seed_input')
    }
  }

  // Classify invention
  const handleClassify = async (sessionId: string) => {
    setStage('classifying')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/classify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentSession(prev => prev ? { ...prev, classification: data.classification } : null)
        
        // NEW: Run contradiction mapping (Stage 2.5)
        await handleMapContradictions(sessionId)
      } else {
        throw new Error('Classification failed')
      }
    } catch (e) {
      setError('Failed to classify invention')
      setStage('seed_input')
    }
  }

  // NEW: Map technical contradictions to TRIZ principles (Stage 2.5)
  const handleMapContradictions = async (sessionId: string) => {
    setStage('mapping_contradictions')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/contradiction-mapping`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setContradictionMapping(data.contradictionMapping)
        
        // Continue to dimension initialization
        await handleInitializeDimensions(sessionId)
      } else {
        // Non-fatal - continue without contradiction mapping
        console.warn('Contradiction mapping failed, continuing...')
        await handleInitializeDimensions(sessionId)
      }
    } catch (e) {
      // Non-fatal - continue without contradiction mapping
      console.warn('Contradiction mapping error:', e)
      await handleInitializeDimensions(sessionId)
    }
  }

  // Initialize dimensions
  const handleInitializeDimensions = async (sessionId: string) => {
    setStage('expanding')
    try {
      const response = await fetch(`/api/idea-bank/ideation/${sessionId}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ action: 'initialize' }),
      })

      if (response.ok) {
        // Reload full session to get updated graph
        await loadSession(sessionId, true) // Fit view when transitioning to exploration
        setStage('exploring')
        setShowTray(true)
        
        // Restore preserved selections if any
        if (preservedSelections.size > 0) {
          setSelectedNodes(preservedSelections)
          setPreservedSelections(new Set())
        }
      } else {
        throw new Error('Failed to initialize dimensions')
      }
    } catch (e) {
      setError('Failed to initialize dimensions')
    }
  }

  // Go back to edit seed (preserving current selections)
  const handleEditSeed = () => {
    // Preserve current selections for when we regenerate
    if (selectedNodes.size > 0) {
      setPreservedSelections(new Set(selectedNodes))
    }
    
    // Populate form with current session data
    if (currentSession) {
      setSeedText(currentSession.seedText)
      setSeedGoal(currentSession.seedGoal || '')
      setSeedConstraints(currentSession.seedConstraints || [])
    }
    
    // Go back to seed input
    setStage('seed_input')
    setShowTray(false)
    setShowIdeaPanel(false)
  }

  // Submit clarifying answers and continue
  const handleSubmitClarifyingAnswers = async () => {
    if (!currentSession) return
    
    const questions = currentSession.normalization?.unknownsToAsk as string[] || []
    
    // If there are answers, combine with seed text
    if (Object.keys(clarifyingAnswers).length > 0 && questions.length > 0) {
      const answersText = Object.entries(clarifyingAnswers)
        .map(([idx, answer]) => {
          const question = questions[parseInt(idx)]
          return question && answer ? `Q: ${question}\nA: ${answer}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
      
      if (answersText) {
        // Update seed text with additional context from answers
        const updatedSeedText = seedText + '\n\nAdditional clarifications:\n' + answersText
        setSeedText(updatedSeedText)
      }
    }
    
    // Clear answers and proceed to classification
    setClarifyingAnswers({})
    await handleClassify(currentSession.id)
  }

  // Expand a node - SILK SMOOTH EXPANSION
  // userInput: Optional user-provided direction for the AI to consider with HIGH PRIORITY
  const handleExpandNode = async (nodeId: string, userInput?: string) => {
    if (!currentSession) return

    // Set expanding state for loading indicator
    setExpandingNodes(prev => new Set(prev).add(nodeId))

    try {
      const requestBody = { 
        action: 'expand', 
        nodeId,
        userInput: userInput?.trim() || undefined,  // Pass user input to API
      }
      console.log('[Expand] Sending request:', {
        url: `/api/idea-bank/ideation/${currentSession.id}/expand`,
        body: requestBody,
        hasUserInput: !!userInput,
        authToken: localStorage.getItem('auth_token') ? 'present' : 'MISSING',
      })
      
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/expand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (response.ok) {
        const data = await response.json()

        if (data.success && data.graph) {
          // SILK SMOOTH: Add new nodes and edges incrementally without page reload
          const newNodesForFlow = data.graph.nodes.map((n: any) => ({
            id: n.id,
            type: getNodeType(n.type),
            position: n.position,
            data: {
              ...n.data,
              type: n.type, // Include original type for DimensionNode
            },
          }))

          const newEdgesForFlow = data.graph.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: e.animated,
            markerEnd: { type: MarkerType.ArrowClosed },
          }))

          // Add new nodes and edges to existing state - SILK SMOOTH
          // Combine all node updates in a single setState to avoid race conditions
          const newNodeIds = newNodesForFlow.map((n: any) => n.id)
          
          setNodes(prevNodes => {
            // First add the new nodes
            const withNewNodes = [...prevNodes, ...newNodesForFlow]
            // Then update the parent node state
            return withNewNodes.map(node =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, state: 'EXPANDED' } }
                : node
            )
          })
          
          setEdges(prevEdges => [...prevEdges, ...newEdgesForFlow])

          // Remove the expanded node from collapsed nodes so its children become visible
          setCollapsedNodes(prev => {
            const next = new Set(prev)
            next.delete(nodeId)
            return next
          })

          // Mark new nodes for smooth animation
          setNewNodes(new Set(newNodeIds))

          // Clear animation flag after animation completes
          setTimeout(() => {
            setNewNodes(prev => {
              const next = new Set(prev)
              newNodeIds.forEach((id: string) => next.delete(id))
              return next
            })
          }, 600)

          // Subtle pan to show newly expanded children without losing context
          // Only pan if we have the react flow instance
          if (reactFlowInstance && newNodesForFlow.length > 0) {
            // Get the current viewport
            const viewport = reactFlowInstance.getViewport()
            
            // Find the average position of new nodes to pan toward them slightly
            const avgX = newNodesForFlow.reduce((sum: number, n: any) => sum + (n.position?.x || 0), 0) / newNodesForFlow.length
            const avgY = newNodesForFlow.reduce((sum: number, n: any) => sum + (n.position?.y || 0), 0) / newNodesForFlow.length
            
            // Calculate current center of viewport
            const viewportWidth = window.innerWidth * 0.6 // Approximate canvas width
            const viewportHeight = window.innerHeight - 80 // Canvas height
            const currentCenterX = (-viewport.x + viewportWidth / 2) / viewport.zoom
            const currentCenterY = (-viewport.y + viewportHeight / 2) / viewport.zoom
            
            // Only pan if children are significantly off-screen
            const dx = avgX - currentCenterX
            const dy = avgY - currentCenterY
            
            // If children are more than 300px away from center, pan slightly toward them
            if (Math.abs(dx) > 300 || Math.abs(dy) > 300) {
              // Pan just a bit (30%) toward the children, keeping user somewhat in context
              const panX = viewport.x - (dx * 0.3 * viewport.zoom)
              const panY = viewport.y - (dy * 0.15 * viewport.zoom) // Less vertical pan
              
              setTimeout(() => {
                reactFlowInstance.setViewport({
                  x: panX,
                  y: panY,
                  zoom: viewport.zoom,
                }, { duration: 400 })
              }, 100)
            }
          }
        } else {
          throw new Error(data.error || 'Expansion failed')
        }
      } else {
        // Try to get the actual error message from the response
        let errorMessage = 'Expansion request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || `Server error (${response.status})`
        } catch {
          errorMessage = `Server error (${response.status}): ${response.statusText}`
        }
        console.error('[Expand] Server error:', response.status, errorMessage)
        throw new Error(errorMessage)
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to expand node'
      setError(errorMsg)
      console.error('Expansion error:', e)
    } finally {
      // Clear expanding state
      setExpandingNodes(prev => {
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
    }
  }

  // Toggle node selection
  const handleNodeSelect = (nodeId: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  // Bucket type for multi-bucket generation
  interface IdeaBucket {
    id: string
    name: string
    dimensionIds: string[]
  }

  // NEW: Check obviousness before generation (Stage 3.5)
  // Note: This is handled inline with loading state, not as a full processing view
  const handleCheckObviousness = async (
    selectedDimensionIds: string[],
    generationParams: { count: number; intent: string; selectedOperators: string[]; buckets?: any[] }
  ): Promise<boolean> => {
    if (!currentSession || selectedDimensionIds.length === 0) return true

    // Use inline loading state instead of full processing view
    setCheckingObviousness(true)
    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/obviousness-filter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ selectedDimensions: selectedDimensionIds }),
      })

      if (response.ok) {
        const data = await response.json()
        
        if (!data.shouldProceed) {
          // Store pending params for "Generate Anyway"
          setPendingGenerationParams(generationParams)
          
          // Show warning to user
          setObviousnessWarning({
            score: data.noveltyScore,
            flags: data.flags || [],
            wildCard: data.wildCard,
            analogySuggestions: data.analogySuggestions || [],
            message: 'This combination may be too obvious. Consider adding the suggested wildcard dimension.',
          })
          return false // Indicate user should reconsider
        }
        
        // Clear any previous warning
        setObviousnessWarning(null)
        setPendingGenerationParams(null)
        return true // OK to proceed
      }
    } catch (e) {
      console.warn('Obviousness check failed:', e)
    } finally {
      setCheckingObviousness(false)
    }
    
    return true // On error, allow proceeding
  }

  // Generate ideas - operators now come from tray selection, not mind map
  // userGuidance: Optional user-provided guidance for the AI to follow with HIGH PRIORITY
  const handleGenerateIdeas = async (
    count: number = 5, 
    intent: string = 'DIVERGENT', 
    selectedOperatorIds: string[] = [],
    buckets?: IdeaBucket[],
    userGuidance?: string,
    skipObviousnessCheck: boolean = false
  ) => {
    if (!currentSession) return

    // Get selected dimension nodes from mind map
    const selectedNodeData = nodes.filter(n => selectedNodes.has(n.id))
    const components = selectedNodeData.filter(n => (n.data as any)?.type === 'COMPONENT').map(n => n.id)
    const dimensions = selectedNodeData.filter(n => 
      (n.data as any)?.type === 'DIMENSION_FAMILY' || (n.data as any)?.type === 'DIMENSION_OPTION'
    ).map(n => n.id)

    const allDimensions = [...dimensions, ...Array.from(selectedNodes).filter(id => !components.includes(id))]

    // NEW: Run obviousness check first (Stage 3.5)
    if (!skipObviousnessCheck && allDimensions.length > 0) {
      const shouldProceed = await handleCheckObviousness(allDimensions, {
        count,
        intent,
        selectedOperators: selectedOperatorIds,
        buckets,
      })
      if (!shouldProceed) {
        setStage('exploring') // Return to exploring, let user decide
        return
      }
    }

    setStage('generating')
    setLoading(true)
    
    // Initialize streaming ideas with placeholders
    const placeholderIdeas: StreamingIdea[] = Array.from({ length: count }, (_, i) => ({
      id: `generating-${i}`,
      title: '',
      problem: '',
      principle: '',
      status: 'generating' as const,
    }))
    setStreamingIdeas(placeholderIdeas)
    
    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          recipe: {
            selectedComponents: components,
            selectedDimensions: allDimensions,
            selectedOperators: selectedOperatorIds,
            recipeIntent: intent,
            count,
            buckets: buckets || null,
            userGuidance: userGuidance?.trim() || undefined,  // Pass user guidance to API
          },
          userGuidance: userGuidance?.trim() || undefined,  // Also at top level for backwards compatibility
          enableFeedbackLoop: false, // Disable automatic novelty checking - user can check manually
          maxIterations: 0,
          noveltyThreshold: 60,
          skipObviousnessCheck: true, // Already checked above
        }),
      })

      if (response.ok) {
        const data = await response.json()
        
        // Store feedback loop and quality metrics
        setFeedbackLoopResults(data.feedbackLoop)
        setQualityMetrics(data.qualityMetrics)
        
        // Store any obviousness warning from the generation
        if (data.obviousnessWarning) {
          setObviousnessWarning(data.obviousnessWarning)
        }
        
        // Reload session to get idea frames (skip stage update to prevent resetting to exploring)
        await loadSession(currentSession.id, false, true)
        
        // Progressive reveal of actual ideas (simulated streaming effect)
        const newIdeaFrames = data.ideaFrames || []
        if (newIdeaFrames.length > 0) {
          for (let i = 0; i < newIdeaFrames.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 300))
            const idea = newIdeaFrames[i]
            setStreamingIdeas(prev => {
              const updated = [...prev]
              if (updated[i]) {
                updated[i] = {
                  id: idea.id,
                  title: idea.ideaFrameJson?.title || idea.title || 'Untitled Idea',
                  problem: idea.ideaFrameJson?.problem || '',
                  principle: idea.ideaFrameJson?.principle || '',
                  status: 'ready',
                  noveltyScore: idea.noveltyScore,
                }
              }
              return updated
            })
          }
        }
        
        // Brief pause to show all ideas revealed
        await new Promise(resolve => setTimeout(resolve, 500))
        
        setStage('reviewing')
        setShowIdeaPanel(true)
      } else {
        throw new Error('Failed to generate ideas')
      }
    } catch (e) {
      setError('Failed to generate ideas')
      setStage('exploring')
    } finally {
      setLoading(false)
      setStreamingIdeas([])
    }
  }

  // Force generate despite obviousness warning
  const handleForceGenerate = async (
    count: number = 5, 
    intent: string = 'DIVERGENT', 
    selectedOperatorIds: string[] = [],
    buckets?: IdeaBucket[],
    userGuidance?: string
  ) => {
    setObviousnessWarning(null)
    await handleGenerateIdeas(count, intent, selectedOperatorIds, buckets, userGuidance, true)
  }

  // Check novelty with progress visualization
  const handleCheckNovelty = async (ideaFrameId: string) => {
    if (!currentSession) return

    // Set stage to show novelty checking view
    setNoveltyCheckingIdeaId(ideaFrameId)
    setStage('checking_novelty')
    
    // Initialize progress
    setNoveltyProgress({
      currentStep: 1,
      totalSteps: 5,
      message: 'Connecting to patent databases...',
      recordsSearched: 0,
      matchesFound: 0,
    })

    try {
      // Simulate progress updates while the API call runs
      const progressSimulation = setInterval(() => {
        setNoveltyProgress(prev => {
          if (!prev) return prev
          const newRecords = prev.recordsSearched! + Math.floor(Math.random() * 100000) + 50000
          const steps = [
            { step: 1, msg: 'Connecting to patent databases...' },
            { step: 2, msg: 'Executing semantic search across global records...' },
            { step: 3, msg: 'Analyzing prior art relevance...' },
            { step: 4, msg: 'Scoring novelty confidence...' },
            { step: 5, msg: 'Generating assessment report...' },
          ]
          const nextStep = Math.min(prev.currentStep + 1, 5)
          const stepInfo = steps.find(s => s.step === nextStep) || steps[steps.length - 1]
          return {
            ...prev,
            currentStep: nextStep,
            message: stepInfo.msg,
            recordsSearched: Math.min(newRecords, 2500000),
            matchesFound: prev.matchesFound! + (Math.random() > 0.7 ? 1 : 0),
          }
        })
      }, 1500)

      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/novelty`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ ideaFrameId }),
      })

      // Stop progress simulation
      clearInterval(progressSimulation)

      if (response.ok) {
        // Final progress state
        setNoveltyProgress({
          currentStep: 5,
          totalSteps: 5,
          message: 'Assessment complete!',
          recordsSearched: 2500000,
          matchesFound: (await response.json()).noveltyGate?.results?.length || 0,
        })
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        await loadSession(currentSession.id, false)
        setStage('reviewing')
      } else {
        throw new Error('Novelty check failed')
      }
    } catch (e) {
      setError('Failed to check novelty')
      setStage('reviewing')
    } finally {
      setNoveltyCheckingIdeaId(null)
      setNoveltyProgress(undefined)
    }
  }

  // Export to idea bank
  const handleExportToBank = async (ideaFrameIds: string[]) => {
    if (!currentSession || ideaFrameIds.length === 0) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ ideaFrameIds }),
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Successfully exported ${data.exportedCount} idea(s) to Idea Bank!`)
        onExportToBank()
      }
    } catch (e) {
      setError('Failed to export to Idea Bank')
    }
  }

  // Delete an idea
  const handleDeleteIdea = async (ideaId: string) => {
    if (!currentSession) return

    try {
      const response = await fetch(`/api/idea-bank/ideation/${currentSession.id}/ideas/${ideaId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (response.ok) {
        // Remove the idea from local state
        setIdeaFrames(prev => prev.filter(idea => idea.id !== ideaId))
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to delete idea')
      }
    } catch (e) {
      setError('Failed to delete idea')
    }
  }

  // Handle edge connection
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, eds)),
    [setEdges]
  )

  // Node click handler - single click to select
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Don't select seed nodes
    if (node.type === 'seed') return
    
    // Toggle selection
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (next.has(node.id)) {
        next.delete(node.id)
      } else {
        next.add(node.id)
      }
      return next
    })
  }, [])

  // Node double click to expand
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.data?.state === 'COLLAPSED') {
      handleExpandNode(node.id)
    }
  }, [currentSession])

  // Add constraint
  const handleAddConstraint = () => {
    if (newConstraint.trim()) {
      setSeedConstraints(prev => [...prev, newConstraint.trim()])
      setNewConstraint('')
    }
  }

  // Remove constraint
  const handleRemoveConstraint = (index: number) => {
    setSeedConstraints(prev => prev.filter((_, i) => i !== index))
  }

  // Reset workspace
  const handleReset = () => {
    // Clear persisted session data
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION_ID)
      localStorage.removeItem(STORAGE_KEYS.SELECTED_NODES)
      localStorage.removeItem(STORAGE_KEYS.COLLAPSED_NODES)
    } catch (e) {
      console.warn('Failed to clear session storage:', e)
    }
    
    setCurrentSession(null)
    setStage('idle')
    setSeedText('')
    setSeedGoal('')
    setSeedConstraints([])
    setNodes([])
    setEdges([])
    setSelectedNodes(new Set())
    setCollapsedNodes(new Set())
    setIdeaFrames([])
    setShowTray(false)
    setShowIdeaPanel(false)
    setError(null)
  }

  // ===== RESTORING SESSION VIEW =====
  // Shows while checking for and loading a saved session
  if (isRestoringSession) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <Loader2 className="w-8 h-8 animate-spin text-violet-500 mx-auto mb-4" />
          <p className="text-slate-500">Restoring your session...</p>
        </motion.div>
      </div>
    )
  }

  // ===== INPUT VIEW =====
  // Shows for: idle, seed_input, clarifying stages
  if (isInputView(stage) || (!currentSession && stage !== 'normalizing')) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl"
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 mb-4 shadow-lg shadow-violet-500/25">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              Patent Ideation Engine
            </h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Transform your invention concept into structured, patent-ready ideas 
              using AI-powered mind mapping and TRIZ operators.
            </p>
          </div>

          {/* Stage Indicator */}
          {currentSession && (
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm">
                {['Input', 'Analyze', 'Build', 'Explore'].map((step, idx) => {
                  const stageIdx = stage === 'idle' || stage === 'seed_input' ? 0 :
                                   stage === 'clarifying' ? 0 :
                                   stage === 'normalizing' || stage === 'classifying' ? 1 :
                                   stage === 'expanding' ? 2 : 3
                  const isActive = idx === stageIdx
                  const isComplete = idx < stageIdx
                  
                  return (
                    <div key={step} className="flex items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold
                        ${isComplete ? 'bg-green-500 text-white' : 
                          isActive ? 'bg-violet-500 text-white' : 
                          'bg-slate-200 text-slate-500'}`}>
                        {isComplete ? '✓' : idx + 1}
                      </div>
                      <span className={`text-xs ml-1 ${isActive ? 'font-semibold text-violet-700' : 'text-slate-500'}`}>
                        {step}
                      </span>
                      {idx < 3 && <ChevronRight className="w-3 h-3 text-slate-300 mx-1" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Input Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
            <div className="p-6 space-y-6">
              {/* Seed Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Describe Your Invention
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <Textarea
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                  placeholder="Example: A disposable syringe that prevents reuse by breaking the plunger after first use, using only mechanical means without electronics..."
                  rows={4}
                  className="w-full bg-slate-50 border-slate-200 focus:border-violet-500 focus:ring-violet-500/20 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
                <p className="text-xs text-slate-400 mt-2">
                  Minimum 10 characters. Be specific about the problem and desired solution.
                </p>
              </div>

              {/* Goal Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Primary Goal
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <Input
                  value={seedGoal}
                  onChange={(e) => setSeedGoal(e.target.value)}
                  placeholder="Example: Prevent needle reuse while keeping manufacturing cost under $0.10"
                  className="bg-slate-50 border-slate-200 focus:border-violet-500 rounded-xl"
                  disabled={stage === 'clarifying'}
                />
              </div>

              {/* Constraints */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Constraints
                  <span className="text-slate-400 text-xs ml-2">(optional)</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newConstraint}
                    onChange={(e) => setNewConstraint(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddConstraint()}
                    placeholder="Add a constraint (e.g., 'no electronics')"
                    className="bg-slate-50 border-slate-200 focus:border-violet-500 rounded-xl"
                    disabled={stage === 'clarifying'}
                  />
                  <Button
                    onClick={handleAddConstraint}
                    variant="outline"
                    className="rounded-xl"
                    disabled={stage === 'clarifying'}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {seedConstraints.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {seedConstraints.map((constraint, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="bg-violet-50 text-violet-700 hover:bg-violet-100 cursor-pointer"
                        onClick={() => stage !== 'clarifying' && handleRemoveConstraint(i)}
                      >
                        {constraint}
                        {stage !== 'clarifying' && <X className="w-3 h-3 ml-1" />}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* ===== CLARIFYING QUESTIONS SECTION ===== */}
              {stage === 'clarifying' && (
                <div className="border-t border-slate-200 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">AI Has Questions</h3>
                      <p className="text-xs text-slate-500">Help refine your invention concept</p>
                    </div>
                  </div>
                  
                  {/* Display questions with input fields */}
                  {currentSession?.normalization?.unknownsToAsk && 
                   (currentSession.normalization.unknownsToAsk as string[]).length > 0 ? (
                    <div className="space-y-4">
                      {(currentSession.normalization.unknownsToAsk as string[]).map((question: string, idx: number) => (
                        <div key={idx} className="p-4 bg-amber-50/50 rounded-xl border border-amber-100">
                          <label className="block text-sm font-medium text-amber-800 mb-2">
                            Q{idx + 1}: {question}
                          </label>
                          <Textarea
                            value={clarifyingAnswers[idx] || ''}
                            onChange={(e) => setClarifyingAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                            placeholder="Type your answer here..."
                            rows={2}
                            className="w-full bg-white border-amber-200 focus:border-amber-500 focus:ring-amber-500/20 rounded-lg text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-xl text-center text-slate-500">
                      <p>The AI is ready to proceed. Click continue to build the mind map.</p>
                    </div>
                  )}
                  
                  {/* Action Buttons for Clarifying Stage */}
                  <div className="flex gap-3 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Go back to seed input to allow editing
                        setStage('seed_input')
                        setClarifyingAnswers({})
                      }}
                      className="flex-1"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Edit Input
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => currentSession && handleClassify(currentSession.id)}
                      className="flex-1"
                    >
                      Skip & Continue
                    </Button>
                    <Button
                      onClick={handleSubmitClarifyingAnswers}
                      disabled={Object.keys(clarifyingAnswers).length === 0 && 
                        (currentSession?.normalization?.unknownsToAsk as string[] || []).length > 0}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      {Object.keys(clarifyingAnswers).length > 0 ? 'Submit & Continue' : 'Continue'}
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                  <button 
                    onClick={() => setError(null)}
                    className="ml-auto hover:bg-red-100 rounded p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Action Footer - Different states */}
            <div className="bg-slate-50 px-6 py-4 flex items-center justify-between border-t border-slate-100">
              <div className="text-sm text-slate-500">
                {currentSession ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Session Active
                  </span>
                ) : sessions.length > 0 ? (
                  <span>{sessions.length} previous session(s)</span>
                ) : (
                  <span>Ready to start</span>
                )}
              </div>
              
              {/* Main Action Buttons based on stage */}
              {stage === 'idle' || stage === 'seed_input' ? (
                <div className="flex gap-2">
                  {currentSession && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Resume to mind map if we have dimensions
                        if (nodes.length > 1) {
                          setStage('exploring')
                          setShowTray(true)
                        } else {
                          // Otherwise start fresh analysis
                          handleNormalize(currentSession.id)
                        }
                      }}
                      className="rounded-xl"
                    >
                      {nodes.length > 1 ? (
                        <>
                          <ArrowRight className="w-4 h-4 mr-2" />
                          Go to Mind Map
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Continue Analysis
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={handleCreateSession}
                    disabled={seedText.trim().length < 10 || loading}
                    className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-xl px-6 shadow-lg shadow-violet-500/25"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : currentSession ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Restart Fresh
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Ideation
                      </>
                    )}
                  </Button>
                </div>
              ) : null /* Clarifying stage has its own buttons above */}
            </div>
          </div>

          {/* Previous Sessions - On Demand */}
          {!currentSession && (
            <div className="mt-6">
              {!showHistory ? (
                <button
                  onClick={() => setShowHistory(true)}
                  className="w-full text-center p-3 bg-slate-50 hover:bg-slate-100 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 transition-all"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  View Previous Sessions
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">Previous Sessions</h3>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Hide
                    </button>
                  </div>
                  {!sessionsLoaded ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                      <span className="ml-2 text-sm text-slate-500">Loading...</span>
                    </div>
                  ) : sessions.length > 0 ? (
                    <div className="space-y-2">
                      {sessions.slice(0, 5).map((session) => (
                        <button
                          key={session.id}
                          onClick={() => loadSession(session.id)}
                          className="w-full text-left p-3 bg-white rounded-xl border border-slate-200 hover:border-violet-300 hover:shadow-md transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-900 truncate">
                              {session.seedText.slice(0, 50)}...
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {session.ideaCount} ideas
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {new Date(session.createdAt).toLocaleDateString()}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 text-center p-4">No previous sessions found</p>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    )
  }

  // ===== PROCESSING VIEW (Rich Animated Display) =====
  // Shows for: normalizing, classifying, mapping_contradictions, expanding, checking_obviousness, generating, checking_novelty stages
  if (isProcessingView(stage)) {
    return (
      <IdeationProcessingView
        stage={stage}
        seedText={currentSession?.seedText || seedText}
        onCancel={handleReset}
        streamingIdeas={streamingIdeas}
        noveltyProgress={noveltyProgress}
      />
    )
  }

  // ===== WORKSPACE VIEW (Mind Map) =====
  // Shows for: exploring, reviewing stages
  return (
    <div className="h-[calc(100vh-80px)] flex">
      {/* React Flow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes
            .filter(n => {
              // Hide children of collapsed nodes - check entire ancestor chain
              const isAnyAncestorCollapsed = (nodeId: string, visited = new Set<string>()): boolean => {
                if (visited.has(nodeId)) return false
                visited.add(nodeId)
                
                const node = nodes.find(nd => nd.id === nodeId)
                if (!node) return false
                
                const parentId = ((node.data as any)?.parentId || (node.data as any)?.parentNodeId) as string | undefined
                if (!parentId) return false
                
                // If parent is collapsed, this node should be hidden
                if (collapsedNodes.has(parentId)) return true
                
                // Recursively check parent's ancestors
                return isAnyAncestorCollapsed(parentId, visited)
              }
              
              // Hide if any ancestor is collapsed
              if (isAnyAncestorCollapsed(n.id)) {
                return false
              }
              return true
            })
            .map(n => {
              const nodeElement = {
                ...n,
                data: {
                  ...n.data,
                  selected: selectedNodes.has(n.id),
                  collapsed: collapsedNodes.has(n.id),
                  hasChildren: nodes.some(child => {
                    const parentId = (child.data as any)?.parentId || (child.data as any)?.parentNodeId
                    return parentId === n.id
                  }),
                  expanding: expandingNodes.has(n.id),
                  isNew: newNodes.has(n.id),
                  onSelect: () => {
                    if (n.type !== 'seed') {
                      setSelectedNodes(prev => {
                        const next = new Set(prev)
                        if (next.has(n.id)) {
                          next.delete(n.id)
                        } else {
                          next.add(n.id)
                        }
                        return next
                      })
                    }
                  },
                  onExpand: (userInput?: string) => handleExpandNode(n.id, userInput),
                  onCollapse: () => {
                    setCollapsedNodes(prev => {
                      const next = new Set(prev)
                      if (next.has(n.id)) {
                        next.delete(n.id)
                      } else {
                        next.add(n.id)
                      }
                      return next
                    })
                  },
                },
              }

              return nodeElement
            })}
          edges={edges
            .filter(e => {
              // Hide edges to nodes that have any collapsed ancestor
              const isAnyAncestorCollapsed = (nodeId: string, visited = new Set<string>()): boolean => {
                if (visited.has(nodeId)) return false
                visited.add(nodeId)
                
                const node = nodes.find(nd => nd.id === nodeId)
                if (!node) return false
                
                const parentId = ((node.data as any)?.parentId || (node.data as any)?.parentNodeId) as string | undefined
                if (!parentId) return false
                
                if (collapsedNodes.has(parentId)) return true
                return isAnyAncestorCollapsed(parentId, visited)
              }
              
              if (isAnyAncestorCollapsed(e.target)) {
                return false
              }
              return true
            })
            .map(e => {
              // Animate edges between selected nodes
              const sourceSelected = selectedNodes.has(e.source)
              const targetSelected = selectedNodes.has(e.target)
              const bothSelected = sourceSelected && targetSelected
              
              // Get the target node's family for edge coloring
              const targetNode = nodes.find(n => n.id === e.target)
              const targetFamily = (targetNode?.data as any)?.family
              const familyEdgeColor = getFamilyEdgeColor(targetFamily)
              
              return {
                ...e,
                animated: bothSelected,
                style: bothSelected 
                  ? { stroke: '#8b5cf6', strokeWidth: 3 }
                  : sourceSelected || targetSelected
                    ? { stroke: '#a78bfa', strokeWidth: 2 }
                    : { stroke: familyEdgeColor, strokeWidth: 2, opacity: 0.7 },
                className: bothSelected ? 'animate-pulse' : '',
                markerEnd: { 
                  type: MarkerType.ArrowClosed, 
                  color: bothSelected ? '#8b5cf6' : sourceSelected || targetSelected ? '#a78bfa' : familyEdgeColor 
                },
              }
            })}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          nodeTypes={nodeTypes}
          onInit={(instance) => setReactFlowInstance(instance)}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-gradient-to-br from-slate-50 to-slate-100"
        >
          <Background color="#cbd5e1" gap={30} size={1} />
          <Controls 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            showInteractive={false}
          />
          <MiniMap 
            className="bg-white border border-slate-200 shadow-lg rounded-xl"
            nodeColor={(node) => {
              if (selectedNodes.has(node.id)) return '#8b5cf6'
              if (node.type === 'seed') return '#06b6d4'
              if (node.type === 'operator') return '#f59e0b'
              // Use family color for dimension nodes
              const family = (node.data as any)?.family
              return getFamilyEdgeColor(family)
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            position="bottom-left"
          />

          {/* Compact Control Panel */}
          <Panel position="top-left" className="m-3">
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 w-64">
              {/* Session Info */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">Mind Map</span>
                    <p className="text-[10px] text-slate-400">{nodes.length} nodes</p>
                  </div>
                </div>
              </div>

              {/* Current Stage */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-700">
                  {stage === 'exploring' ? 'Explore & Select Dimensions' :
                   stage === 'reviewing' ? 'Review Generated Ideas' :
                   'Ready'}
                </span>
              </div>

              {/* Classification Badge */}
              {currentSession?.classification && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                    {(currentSession.classification as any).dominantClass?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {(currentSession.classification as any).archetype}
                  </span>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditSeed}
                  className="flex-1 text-xs h-8 border-violet-200 text-violet-700 hover:bg-violet-50"
                >
                  <ChevronLeft className="w-3 h-3 mr-1" />
                  Edit Input
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="flex-1 text-xs h-8"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  New
                </Button>
              </div>

              {/* Auto-Layout Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  autoLayoutNodes()
                  // Fit view after layout with a delay
                  setTimeout(() => {
                    if (reactFlowInstance) {
                      reactFlowInstance.fitView({ padding: 0.2, duration: 500 })
                    }
                  }, 100)
                }}
                className="w-full text-xs h-8 mt-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                <LayoutGrid className="w-3 h-3 mr-1" />
                Auto-Layout (Fix Spacing)
              </Button>

              {/* Tips */}
              <div className="mt-2 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-500">
                💡 Click to select • Double-click to expand • Press 'l' to auto-layout • Press 'i' for ideas
              </div>
            </div>
          </Panel>

          {/* Selection Panel - Compact floating widget */}
          {(stage === 'exploring' || stage === 'generating' || stage === 'reviewing') && (
            <Panel position="top-right" className="m-3">
              <div className={`
                bg-white/95 backdrop-blur-sm rounded-xl border shadow-lg p-3 w-48
                transition-all duration-200
                ${selectedNodes.size > 0 ? 'border-violet-400' : 'border-slate-200'}
              `}>
                {/* Selection Count */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedNodes.size > 0 ? `${selectedNodes.size} Selected` : 'No Selection'}
                  </span>
                  {selectedNodes.size > 0 && (
                    <button
                      onClick={() => setSelectedNodes(new Set())}
                      className="text-[10px] text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                
                {/* Selected Items Preview */}
                {selectedNodes.size > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2 max-h-16 overflow-y-auto">
                    {Array.from(selectedNodes).slice(0, 4).map(nodeId => {
                      const node = nodes.find(n => n.id === nodeId)
                      return (
                        <span
                          key={nodeId}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 truncate max-w-[70px]"
                        >
                          {(node?.data as any)?.title || nodeId}
                        </span>
                      )
                    })}
                    {selectedNodes.size > 4 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        +{selectedNodes.size - 4}
                      </span>
                    )}
                  </div>
                )}
                
                {/* Action Button */}
                <Button
                  onClick={() => setShowTray(true)}
                  disabled={selectedNodes.size === 0}
                  className={`w-full h-8 text-xs ${
                    selectedNodes.size > 0
                      ? 'bg-violet-500 hover:bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  {selectedNodes.size > 0 ? 'Generate Ideas' : 'Select Dimensions'}
                </Button>

                {/* Reopen Ideas Panel Button */}
                {ideaFrames.length > 0 && !showIdeaPanel && (
                  <Button
                    onClick={() => setShowIdeaPanel(true)}
                    variant="outline"
                    className="w-full h-8 text-xs mt-2 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300"
                  >
                    <Lightbulb className="w-3 h-3 mr-1 text-emerald-600" />
                    View Ideas ({ideaFrames.length})
                  </Button>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>

        {/* Loading Overlay */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"
            >
              <div className="text-center">
                <Loader2 className="w-12 h-12 animate-spin text-violet-500 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">
                  {stage === 'normalizing' && 'Analyzing your invention...'}
                  {stage === 'classifying' && 'Classifying invention type...'}
                  {stage === 'expanding' && 'Initializing dimensions...'}
                  {stage === 'generating' && 'Generating ideas...'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Combine Tray Sidebar */}
      <AnimatePresence>
        {showTray && (
          <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="w-80 border-l border-slate-200 bg-white overflow-hidden flex flex-col"
          >
            <CombineTray
              selectedNodes={selectedNodes}
              nodes={nodes}
              availableOperators={
                // Get operators from session classification
                ((currentSession?.classification as any)?.applicableOperators as any[]) || []
              }
              onGenerate={(count, intent, ops, buckets, guidance) => 
                handleGenerateIdeas(count, intent, ops, buckets, guidance, false)
              }
              onClear={() => {
                setSelectedNodes(new Set())
                setObviousnessWarning(null) // Clear warning when clearing selection
              }}
              onRemoveNode={(nodeId) => {
                setSelectedNodes(prev => {
                  const next = new Set(prev)
                  next.delete(nodeId)
                  return next
                })
                setObviousnessWarning(null) // Clear warning when removing dimension
              }}
              loading={loading}
              checkingObviousness={checkingObviousness}
              obviousnessWarning={obviousnessWarning}
              onForceGenerate={(count, intent, ops, buckets, guidance) => 
                handleForceGenerate(count, intent, ops, buckets, guidance)
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ideas Panel */}
      <AnimatePresence>
        {showIdeaPanel && ideaFrames.length > 0 && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="border-l border-slate-200 bg-white overflow-hidden flex flex-col relative"
            style={{ width: `${ideasPanelWidth}px` }}
          >
            <IdeaFramePanel
              ideas={ideaFrames}
              onSelectIdea={setSelectedIdea}
              onCheckNovelty={handleCheckNovelty}
              onExport={handleExportToBank}
              onClose={() => setShowIdeaPanel(false)}
              onDeleteIdea={handleDeleteIdea}
              feedbackLoopResults={feedbackLoopResults}
              qualityMetrics={qualityMetrics}
            />

            {/* Resize Handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 bg-slate-200 hover:bg-violet-400 cursor-col-resize transition-colors duration-200 group"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startWidth = ideasPanelWidth

                const handleMouseMove = (e: MouseEvent) => {
                  const deltaX = startX - e.clientX
                  const newWidth = Math.max(300, Math.min(800, startWidth + deltaX))
                  setIdeasPanelWidth(newWidth)
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                  document.body.style.cursor = ''
                  document.body.style.userSelect = ''
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
            >
              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-0.5 h-8 bg-violet-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Obviousness Warning Modal */}
      <AnimatePresence>
        {obviousnessWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setObviousnessWarning(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Low Novelty Warning</h3>
                  <p className="text-sm text-slate-500">This combination may be too obvious</p>
                </div>
              </div>

              {/* Novelty Score */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-600">Combination Novelty</span>
                  <span className={`text-lg font-bold ${
                    obviousnessWarning.score < 30 ? 'text-red-500' :
                    obviousnessWarning.score < 50 ? 'text-amber-500' :
                    'text-green-500'
                  }`}>
                    {obviousnessWarning.score}/100
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all ${
                      obviousnessWarning.score < 30 ? 'bg-red-500' :
                      obviousnessWarning.score < 50 ? 'bg-amber-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${obviousnessWarning.score}%` }}
                  />
                </div>
              </div>

              {/* Obviousness Flags */}
              {obviousnessWarning.flags && obviousnessWarning.flags.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">Issues Detected:</p>
                  <div className="space-y-1">
                    {obviousnessWarning.flags.map((flag: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-red-400">•</span>
                        {flag}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Wildcard Suggestion */}
              {obviousnessWarning.wildCard && (
                <div className="mb-4 p-3 bg-violet-50 rounded-xl border border-violet-200">
                  <p className="text-sm font-semibold text-violet-700 mb-1">
                    💡 Suggested Wildcard Dimension
                  </p>
                  <p className="text-sm text-violet-600">
                    <strong>{obviousnessWarning.wildCard.dimension}:</strong>{' '}
                    {obviousnessWarning.wildCard.reason}
                  </p>
                </div>
              )}

              {/* Analogy Suggestions */}
              {obviousnessWarning.analogySuggestions && obviousnessWarning.analogySuggestions.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">
                    Consider analogies from:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {obviousnessWarning.analogySuggestions.map((domain: string, idx: number) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {domain}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setObviousnessWarning(null)
                    setPendingGenerationParams(null)
                  }}
                  className="flex-1"
                >
                  Modify Selection
                </Button>
                <Button
                  onClick={() => {
                    setObviousnessWarning(null)
                    if (pendingGenerationParams) {
                      handleForceGenerate(
                        pendingGenerationParams.count,
                        pendingGenerationParams.intent,
                        pendingGenerationParams.selectedOperators,
                        pendingGenerationParams.buckets
                      )
                    }
                    setPendingGenerationParams(null)
                  }}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                >
                  Generate Anyway
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contradiction Insight Panel */}
      {contradictionMapping && (
        <ContradictionInsightPanel 
          data={contradictionMapping}
          onClose={() => setContradictionMapping(null)}
        />
      )}

      {/* Floating Help Button */}
      <button
        onClick={() => setShowHelp(true)}
        className="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        title="Help (Press ? for keyboard shortcut)"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Help Modal */}
      <IdeationHelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}

