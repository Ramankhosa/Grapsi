'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Sparkles,
  Network,
  Lightbulb,
  Target,
  Layers,
  Zap,
  GitBranch,
  Puzzle,
  FlaskConical,
  Scale,
  Rocket,
  Eye,
  CheckCircle2,
  ArrowRight,
  Database,
  Search,
  FileSearch,
  Shield,
  Fingerprint,
  Globe,
  Server,
  Cpu,
  CircuitBoard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProcessingStage {
  id: string
  name: string
  title: string
  description: string
  icon: React.ReactNode
  color: string
  bgGradient: string
  thinkingPhrases: string[]
  substeps: string[]
  tips: string[]
}

interface StreamingIdea {
  id: string
  title: string
  problem: string
  principle: string
  status: 'generating' | 'ready' | 'checking_novelty' | 'verified'
  noveltyScore?: number
}

interface IdeationProcessingViewProps {
  stage: string
  seedText?: string
  onCancel: () => void
  streamingIdeas?: StreamingIdea[]
  noveltyProgress?: {
    currentStep: number
    totalSteps: number
    message: string
    recordsSearched?: number
    matchesFound?: number
  }
}

const PROCESSING_STAGES: Record<string, ProcessingStage> = {
  normalizing: {
    id: 'normalizing',
    name: 'Analyze',
    title: 'Analyzing Your Invention',
    description: 'Extracting the core essence and identifying hidden assumptions',
    icon: <Brain className="w-8 h-8" />,
    color: 'violet',
    bgGradient: 'from-violet-500/10 via-purple-500/5 to-indigo-500/10',
    thinkingPhrases: [
      'Identifying the core entity...',
      'Extracting key components...',
      'Analyzing intent and goals...',
      'Finding constraints and limits...',
      'Detecting unstated assumptions...',
      'Discovering technical contradictions...',
      'Formulating patentable problem...',
      'Generating clarifying questions...',
    ],
    substeps: [
      'Parse invention description',
      'Identify core entity & goal',
      'Extract constraints',
      'Find hidden assumptions',
      'Map contradictions',
    ],
    tips: [
      'The AI looks for tradeoffs you might not have noticed',
      'Contradictions are where real inventions happen',
      'Better input = better patent ideas',
    ],
  },
  classifying: {
    id: 'classifying',
    name: 'Classify',
    title: 'Classifying Invention Type',
    description: 'Determining the patent category and technical domain',
    icon: <Layers className="w-8 h-8" />,
    color: 'blue',
    bgGradient: 'from-blue-500/10 via-cyan-500/5 to-sky-500/10',
    thinkingPhrases: [
      'Analyzing invention archetype...',
      'Mapping to patent classes...',
      'Identifying technical domain...',
      'Evaluating hybrid potential...',
      'Selecting applicable dimensions...',
      'Matching TRIZ operators...',
    ],
    substeps: [
      'Determine invention type',
      'Assign patent categories',
      'Select applicable operators',
      'Initialize mind map',
    ],
    tips: [
      'Your invention might span multiple categories',
      'The archetype determines which creativity tools apply',
      'Some inventions work best as method + device hybrids',
    ],
  },
  mapping_contradictions: {
    id: 'mapping_contradictions',
    name: 'Contradictions',
    title: 'Mapping Technical Contradictions',
    description: 'Applying TRIZ inventive principles to resolve conflicts',
    icon: <Scale className="w-8 h-8" />,
    color: 'amber',
    bgGradient: 'from-amber-500/10 via-orange-500/5 to-yellow-500/10',
    thinkingPhrases: [
      'Analyzing parameter conflicts...',
      'Mapping to TRIZ matrix...',
      'Identifying inventive principles...',
      'Finding separation strategies...',
      'Exploring resolution paths...',
      'Discovering second-order effects...',
    ],
    substeps: [
      'Identify contradictions',
      'Map to TRIZ principles',
      'Generate resolution strategies',
      'Check for side effects',
    ],
    tips: [
      'Every great invention resolves a contradiction',
      'TRIZ has 40 inventive principles used by top innovators',
      'Sometimes inverting the problem reveals the solution',
    ],
  },
  expanding: {
    id: 'expanding',
    name: 'Build',
    title: 'Building Mind Map',
    description: 'Creating dimension families and exploration paths',
    icon: <GitBranch className="w-8 h-8" />,
    color: 'emerald',
    bgGradient: 'from-emerald-500/10 via-green-500/5 to-teal-500/10',
    thinkingPhrases: [
      'Creating dimension families...',
      'Generating material options...',
      'Exploring form variations...',
      'Mapping energy alternatives...',
      'Analyzing spatial configurations...',
      'Building temporal sequences...',
    ],
    substeps: [
      'Initialize dimension tree',
      'Generate family nodes',
      'Position mind map layout',
      'Connect exploration paths',
    ],
    tips: [
      'Each dimension is a creative direction to explore',
      'The best ideas often come from unexpected combinations',
      'Don\'t just pick the obvious options!',
    ],
  },
  checking_obviousness: {
    id: 'checking_obviousness',
    name: 'Novelty Check',
    title: 'Checking Combination Novelty',
    description: 'Ensuring your selection is non-obvious and patentable',
    icon: <Eye className="w-8 h-8" />,
    color: 'rose',
    bgGradient: 'from-rose-500/10 via-pink-500/5 to-red-500/10',
    thinkingPhrases: [
      'Evaluating combination novelty...',
      'Checking for obvious patterns...',
      'Analyzing domain distance...',
      'Assessing inventive step...',
      'Suggesting improvements...',
    ],
    substeps: [
      'Score combination novelty',
      'Check for obvious patterns',
      'Suggest wild card options',
      'Validate inventive leap',
    ],
    tips: [
      'Combinations from distant domains score higher',
      'Removing something can be more inventive than adding',
      'The AI suggests wild cards to boost novelty',
    ],
  },
  generating: {
    id: 'generating',
    name: 'Generate',
    title: 'Generating Inventive Ideas',
    description: 'Creating patent-worthy concepts with forced analogy transfer',
    icon: <Rocket className="w-8 h-8" />,
    color: 'violet',
    bgGradient: 'from-violet-500/10 via-fuchsia-500/5 to-purple-500/10',
    thinkingPhrases: [
      'Forcing inventive leaps...',
      'Applying TRIZ operators...',
      'Generating cross-domain analogies...',
      'Creating claim hooks...',
      'Validating non-obviousness...',
      'Building technical specifications...',
      'Crafting patent language...',
      'Generating variants...',
    ],
    substeps: [
      'Apply creativity operators',
      'Force analogy transfer',
      'Generate idea frames',
      'Craft claim language',
      'Create variants',
    ],
    tips: [
      'Each idea includes a claim hook ready for patent drafting',
      'The AI explains WHY each idea is non-obvious',
      'Variants help you find the strongest angle',
    ],
  },
  checking_novelty: {
    id: 'checking_novelty',
    name: 'Verify',
    title: 'Verifying Patent Novelty',
    description: 'Searching through millions of patent records worldwide',
    icon: <Database className="w-8 h-8" />,
    color: 'cyan',
    bgGradient: 'from-cyan-500/10 via-teal-500/5 to-blue-500/10',
    thinkingPhrases: [
      'Connecting to patent databases...',
      'Searching through global records...',
      'Analyzing similar inventions...',
      'Cross-referencing citations...',
      'Evaluating prior art relevance...',
      'Calculating novelty confidence...',
      'Assessing patentability indicators...',
      'Generating differentiation strategy...',
    ],
    substeps: [
      'Connect to patent databases',
      'Execute semantic search',
      'Analyze prior art matches',
      'Score novelty confidence',
      'Generate assessment',
    ],
    tips: [
      'We search through millions of patents from USPTO, EPO, and more',
      'Prior art analysis helps strengthen your claims',
      'Higher novelty scores indicate stronger patent potential',
    ],
  },
}

// Intelligent particle system - subtle floating orbs
const IntelligentParticles = ({ color }: { color: string }) => {
  const particles = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 2 + Math.random() * 4,
      duration: 15 + Math.random() * 10,
      delay: Math.random() * 5,
    }))
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className={`absolute rounded-full bg-${color}-400/20 blur-sm`}
          style={{
            width: particle.size,
            height: particle.size,
            left: `${particle.x}%`,
            top: `${particle.y}%`,
          }}
          animate={{
            y: [0, -30, 0],
            x: [0, 10, -10, 0],
            opacity: [0.2, 0.5, 0.2],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

// Circuit board pattern animation
const CircuitPattern = ({ color }: { color: string }) => {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.03]">
      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Horizontal lines */}
        {[20, 40, 60, 80].map((y, i) => (
          <motion.line
            key={`h-${i}`}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="currentColor"
            strokeWidth="0.3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1, 0] }}
            transition={{
              duration: 4,
              delay: i * 0.5,
              repeat: Infinity,
              repeatDelay: 2,
            }}
          />
        ))}
        {/* Vertical lines */}
        {[25, 50, 75].map((x, i) => (
          <motion.line
            key={`v-${i}`}
            x1={x}
            y1="0"
            x2={x}
            y2="100"
            stroke="currentColor"
            strokeWidth="0.3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1, 0] }}
            transition={{
              duration: 3,
              delay: i * 0.3 + 1,
              repeat: Infinity,
              repeatDelay: 3,
            }}
          />
        ))}
        {/* Node points */}
        {[[25, 20], [50, 40], [75, 60], [25, 80], [50, 20], [75, 40]].map(([x, y], i) => (
          <motion.circle
            key={`node-${i}`}
            cx={x}
            cy={y}
            r="1.5"
            fill="currentColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 2,
              delay: i * 0.4,
              repeat: Infinity,
              repeatDelay: 4,
            }}
          />
        ))}
      </svg>
    </div>
  )
}

// DNA helix animation for generating stage
const DNAHelix = () => {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden opacity-10">
      <motion.div
        className="relative w-32 h-64"
        animate={{ rotateY: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
      >
        {Array.from({ length: 12 }, (_, i) => {
          const angle = (i / 12) * Math.PI * 2
          const y = (i / 12) * 100
          const x1 = Math.sin(angle) * 30 + 50
          const x2 = Math.sin(angle + Math.PI) * 30 + 50
          
          return (
            <motion.div
              key={i}
              className="absolute h-1 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-400 rounded-full"
              style={{
                top: `${y}%`,
                left: `${Math.min(x1, x2)}%`,
                width: `${Math.abs(x2 - x1)}%`,
              }}
              animate={{
                opacity: [0.3, 0.7, 0.3],
              }}
              transition={{
                duration: 2,
                delay: i * 0.1,
                repeat: Infinity,
              }}
            />
          )
        })}
      </motion.div>
    </div>
  )
}

// Database search visualization for novelty checking
const DatabaseSearchViz = ({ recordsSearched, matchesFound }: { recordsSearched?: number; matchesFound?: number }) => {
  const [displayRecords, setDisplayRecords] = useState(0)
  
  useEffect(() => {
    if (!recordsSearched) return
    const interval = setInterval(() => {
      setDisplayRecords(prev => {
        const next = prev + Math.floor(Math.random() * 50000) + 10000
        return next > recordsSearched ? recordsSearched : next
      })
    }, 100)
    return () => clearInterval(interval)
  }, [recordsSearched])

  return (
    <div className="relative h-32 w-full overflow-hidden rounded-xl bg-slate-900/50 border border-slate-700/50">
      {/* Scanning line */}
      <motion.div
        className="absolute inset-y-0 w-1 bg-gradient-to-b from-transparent via-cyan-400 to-transparent"
        animate={{ x: ['0%', '100%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
      />
      
      {/* Grid of "database records" */}
      <div className="absolute inset-0 grid grid-cols-20 gap-0.5 p-2 opacity-30">
        {Array.from({ length: 100 }, (_, i) => (
          <motion.div
            key={i}
            className="w-1 h-1 rounded-sm bg-cyan-400"
            animate={{
              opacity: [0.2, 0.8, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 0.5,
              delay: Math.random() * 2,
              repeat: Infinity,
              repeatDelay: Math.random() * 3,
            }}
          />
        ))}
      </div>
      
      {/* Stats overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl font-mono font-bold text-cyan-400">
            {displayRecords.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400 mt-1">records analyzed</div>
          {matchesFound !== undefined && matchesFound > 0 && (
            <div className="mt-2 text-sm text-amber-400">
              {matchesFound} potential matches found
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Pulse ring animation
const PulseRings = ({ color }: { color: string }) => (
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
    {[1, 2, 3].map((ring) => (
      <motion.div
        key={ring}
        className={`absolute rounded-full border border-${color}-400/30`}
        initial={{ width: 40, height: 40, opacity: 0.6 }}
        animate={{
          width: [40, 200],
          height: [40, 200],
          opacity: [0.6, 0],
        }}
        transition={{
          duration: 3,
          delay: ring * 1,
          repeat: Infinity,
          ease: 'easeOut',
        }}
      />
    ))}
  </div>
)

// Waveform animation for thinking
const ThinkingWaveform = () => (
  <div className="flex items-center justify-center gap-0.5 h-6">
    {Array.from({ length: 12 }, (_, i) => (
      <motion.div
        key={i}
        className="w-1 bg-current rounded-full"
        animate={{
          height: [4, 16, 4],
        }}
        transition={{
          duration: 0.8,
          delay: i * 0.08,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    ))}
  </div>
)

// Streaming idea card
const StreamingIdeaCard = ({ idea, index }: { idea: StreamingIdea; index: number }) => {
  const statusConfig = {
    generating: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-600', label: 'Generating...' },
    ready: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', label: 'Ready' },
    checking_novelty: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-600', label: 'Verifying novelty...' },
    verified: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600', label: 'Verified' },
  }
  
  const config = statusConfig[idea.status]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.15, duration: 0.4 }}
      className={`${config.bg} ${config.border} border rounded-xl p-4 backdrop-blur-sm`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold`}>
            {index + 1}
          </div>
          <span className={`text-xs font-medium ${config.text} px-2 py-0.5 rounded-full ${config.bg}`}>
            {idea.status === 'generating' || idea.status === 'checking_novelty' ? (
              <span className="flex items-center gap-1">
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  ●
                </motion.span>
                {config.label}
              </span>
            ) : config.label}
          </span>
        </div>
        {idea.noveltyScore !== undefined && (
          <div className={`text-xs font-bold ${idea.noveltyScore >= 60 ? 'text-green-600' : 'text-amber-600'}`}>
            {idea.noveltyScore}/100
          </div>
        )}
      </div>
      
      <h4 className="font-semibold text-slate-800 text-sm mb-1 line-clamp-1">
        {idea.title || 'Generating title...'}
      </h4>
      
      {idea.problem && (
        <p className="text-xs text-slate-500 line-clamp-2">
          {idea.problem}
        </p>
      )}
      
      {idea.status === 'generating' && (
        <div className="mt-2">
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-violet-400 to-purple-500"
              animate={{ width: ['0%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
        </div>
      )}
    </motion.div>
  )
}

// Extracted concepts display
const ExtractedConcepts = ({ seedText }: { seedText: string }) => {
  const [visibleConcepts, setVisibleConcepts] = useState<string[]>([])
  
  // Extract keywords from seed text
  const concepts = useMemo(() => {
    const words = seedText.toLowerCase().split(/\s+/)
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'that', 'this', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some', 'no', 'most', 'other', 'such'])
    return words
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 8)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  }, [seedText])

  useEffect(() => {
    let idx = 0
    const interval = setInterval(() => {
      if (idx < concepts.length) {
        setVisibleConcepts(prev => [...prev, concepts[idx]])
        idx++
      } else {
        clearInterval(interval)
      }
    }, 600)
    return () => clearInterval(interval)
  }, [concepts])

  if (!seedText || concepts.length === 0) return null

  return (
    <div className="mt-4">
      <div className="text-xs text-slate-400 mb-2 flex items-center justify-center">
        <Sparkles className="w-3 h-3 mr-1" />
        Analyzing concepts
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <AnimatePresence>
          {visibleConcepts.map((concept, i) => (
            <motion.span
              key={`concept-${i}-${concept}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="px-3 py-1 rounded-full bg-white/80 border border-slate-200 text-xs text-slate-600 font-medium shadow-sm"
            >
              {concept}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default function IdeationProcessingView({
  stage,
  seedText,
  onCancel,
  streamingIdeas = [],
  noveltyProgress,
}: IdeationProcessingViewProps) {
  const [currentThoughtIdx, setCurrentThoughtIdx] = useState(0)
  const [completedSubsteps, setCompletedSubsteps] = useState<number[]>([])
  const [currentTipIdx, setCurrentTipIdx] = useState(0)
  
  const stageConfig = PROCESSING_STAGES[stage] || PROCESSING_STAGES.normalizing

  // Cycle through thinking phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentThoughtIdx(prev => 
        (prev + 1) % stageConfig.thinkingPhrases.length
      )
    }, 2500)
    return () => clearInterval(interval)
  }, [stageConfig.thinkingPhrases.length])

  // Progress through substeps
  useEffect(() => {
    setCompletedSubsteps([])
    const substepCount = stageConfig.substeps.length
    let idx = 0
    const interval = setInterval(() => {
      if (idx < substepCount - 1) {
        setCompletedSubsteps(prev => [...prev, idx])
        idx++
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [stage, stageConfig.substeps.length])

  // Cycle through tips
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTipIdx(prev => (prev + 1) % stageConfig.tips.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [stageConfig.tips.length])

  // Stage progress
  const stageOrder = ['normalizing', 'classifying', 'mapping_contradictions', 'expanding', 'checking_obviousness', 'generating']
  const currentStageIdx = stageOrder.indexOf(stage)

  // If we have streaming ideas, show them in a side panel
  const hasStreamingIdeas = streamingIdeas.length > 0

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-4 md:p-8">
      <div className={`flex gap-6 ${hasStreamingIdeas ? 'max-w-5xl' : 'max-w-2xl'} w-full`}>
        {/* Main Processing Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={hasStreamingIdeas ? 'w-1/2' : 'w-full'}
        >
          {/* Main Card */}
          <div className={`relative bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden`}>
            {/* Background effects */}
            <div className={`absolute inset-0 bg-gradient-to-br ${stageConfig.bgGradient}`} />
            <IntelligentParticles color={stageConfig.color} />
            <CircuitPattern color={stageConfig.color} />
            {stage === 'generating' && <DNAHelix />}
            {stage === 'checking_novelty' && <PulseRings color="cyan" />}
            
            <div className="relative z-10 p-6 md:p-8">
              {/* Stage Icon with Pulse */}
              <div className="flex justify-center mb-6">
                <motion.div
                  className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-${stageConfig.color}-500 to-${stageConfig.color}-600 flex items-center justify-center text-white shadow-lg`}
                  animate={{
                    scale: [1, 1.03, 1],
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  {stageConfig.icon}
                </motion.div>
              </div>

              {/* Title */}
              <h2 className="text-xl md:text-2xl font-bold text-slate-800 text-center mb-2">
                {stageConfig.title}
              </h2>
              <p className="text-slate-500 text-center text-sm mb-6">
                {stageConfig.description}
              </p>

              {/* Thinking Display */}
              <div className="bg-slate-50/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-slate-100">
                <div className="flex items-center justify-center gap-3 text-slate-700">
                  <ThinkingWaveform />
                  <motion.span
                    key={currentThoughtIdx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="font-medium text-sm"
                  >
                    {stageConfig.thinkingPhrases[currentThoughtIdx]}
                  </motion.span>
                </div>
                
                {/* Show extracted concepts for normalization stage */}
                {stage === 'normalizing' && seedText && (
                  <ExtractedConcepts seedText={seedText} />
                )}
                
                {/* Database search visualization for novelty checking */}
                {stage === 'checking_novelty' && (
                  <div className="mt-4">
                    <DatabaseSearchViz 
                      recordsSearched={noveltyProgress?.recordsSearched || 2500000} 
                      matchesFound={noveltyProgress?.matchesFound}
                    />
                  </div>
                )}
              </div>

              {/* Substeps Progress */}
              <div className="bg-slate-50/50 backdrop-blur-sm rounded-xl p-4 mb-6">
                <div className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wide">
                  Progress
                </div>
                <div className="space-y-1.5">
                  {stageConfig.substeps.map((substep, idx) => {
                    const isCompleted = completedSubsteps.includes(idx)
                    const isActive = idx === completedSubsteps.length
                    
                    return (
                      <motion.div
                        key={substep}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                          isCompleted 
                            ? 'bg-emerald-50/80 text-emerald-700' 
                            : isActive 
                              ? `bg-${stageConfig.color}-50/80 text-${stageConfig.color}-700` 
                              : 'text-slate-300'
                        }`}
                        initial={{ opacity: 0.5 }}
                        animate={{ opacity: isCompleted || isActive ? 1 : 0.4 }}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                          isCompleted 
                            ? 'bg-emerald-500 text-white' 
                            : isActive 
                              ? `bg-${stageConfig.color}-500 text-white` 
                              : 'bg-slate-200 text-slate-400'
                        }`}>
                          {isCompleted ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : isActive ? (
                            <motion.div
                              className="w-2 h-2 rounded-full bg-white"
                              animate={{ scale: [1, 1.5, 1] }}
                              transition={{ duration: 0.8, repeat: Infinity }}
                            />
                          ) : (
                            <span className="text-[10px]">{idx + 1}</span>
                          )}
                        </div>
                        <span className="text-xs font-medium">{substep}</span>
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              {/* Overall Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-slate-400">Overall Progress</span>
                  <span className="text-xs text-slate-400">
                    {currentStageIdx + 1} / {stageOrder.length}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full bg-gradient-to-r from-${stageConfig.color}-400 to-${stageConfig.color}-600`}
                    initial={{ width: `${(currentStageIdx / stageOrder.length) * 100}%` }}
                    animate={{ 
                      width: `${((currentStageIdx + 0.5) / stageOrder.length) * 100}%` 
                    }}
                    transition={{ duration: 2 }}
                  />
                </div>
              </div>

              {/* Tip */}
              <div className="bg-amber-50/80 backdrop-blur-sm rounded-xl p-3 border border-amber-100/50">
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={currentTipIdx}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="text-xs text-amber-700"
                      >
                        {stageConfig.tips[currentTipIdx]}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Cancel Button */}
              <div className="mt-6 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>

          {/* Stage Pills */}
          <div className="flex justify-center gap-1 mt-4 flex-wrap">
            {stageOrder.slice(0, 4).map((s, idx) => {
              const config = PROCESSING_STAGES[s]
              const isActive = s === stage
              const isComplete = stageOrder.indexOf(s) < currentStageIdx
              
              return (
                <div
                  key={s}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                    isActive
                      ? 'bg-violet-100 text-violet-700'
                      : isComplete
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isComplete && <CheckCircle2 className="w-2.5 h-2.5" />}
                  {isActive && (
                    <motion.div
                      className="w-1.5 h-1.5 rounded-full bg-violet-500"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                  {config?.name || s}
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* Streaming Ideas Panel */}
        {hasStreamingIdeas && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="w-1/2"
          >
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 h-full">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">Ideas Emerging</h3>
                  <p className="text-xs text-slate-400">
                    {streamingIdeas.filter(i => i.status !== 'generating').length} of {streamingIdeas.length} ready
                  </p>
                </div>
              </div>
              
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                <AnimatePresence>
                  {streamingIdeas.map((idea, index) => (
                    <StreamingIdeaCard key={idea.id} idea={idea} index={index} />
                  ))}
                </AnimatePresence>
              </div>
              
              {streamingIdeas.some(i => i.status === 'generating') && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    >
                      <Cpu className="w-3 h-3" />
                    </motion.div>
                    Generating remaining ideas...
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
