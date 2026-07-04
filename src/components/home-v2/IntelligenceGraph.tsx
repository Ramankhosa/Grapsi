'use client'

import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { graphEdges, graphNodes } from './data'

const nodeById = new Map(graphNodes.map((node) => [node.id, node]))

function nodeClass(kind: string) {
  if (kind === 'call') return 'fill-ai-graphite-950 stroke-ai-blue-400 stroke-[1.5]'
  if (kind === 'funded') return 'fill-emerald-300/90 stroke-emerald-200'
  if (kind === 'publication') return 'fill-violet-300/80 stroke-violet-200'
  return 'fill-white/90 stroke-white'
}

export default function IntelligenceGraph({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion()
  const springX = useSpring(0, { stiffness: 90, damping: 24 })
  const springY = useSpring(0, { stiffness: 90, damping: 24 })
  const x = useTransform(springX, [-1, 1], compact ? [-4, 4] : [-14, 14])
  const y = useTransform(springY, [-1, 1], compact ? [-3, 3] : [-10, 10])

  return (
    <div
      className="relative h-full min-h-[360px] w-full overflow-hidden"
      onMouseMove={(event) => {
        if (reduced) return
        const rect = event.currentTarget.getBoundingClientRect()
        springX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
        springY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
      }}
      onMouseLeave={() => {
        springX.set(0)
        springY.set(0)
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_45%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_45%_65%,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:18px_18px]" />
      <motion.svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        style={{ x, y }}
        role="img"
        aria-label="Animated funding intelligence graph"
      >
        <defs>
          <filter id="home-v2-glow">
            <feGaussianBlur stdDeviation="1.4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {graphEdges.map(([from, to], index) => {
          const a = nodeById.get(from)!
          const b = nodeById.get(to)!
          const isRoute = index === 0 || index === 4 || index === 5
          return (
            <motion.line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={isRoute ? 'stroke-ai-blue-300' : 'stroke-white'}
              strokeWidth={isRoute ? 0.5 : 0.28}
              initial={false}
              animate={
                reduced || !isRoute
                  ? { opacity: isRoute ? 0.42 : 0.14 }
                  : { opacity: [0.16, 0.8, 0.16], pathLength: [0.2, 1, 0.2] }
              }
              transition={{ duration: 3.4, repeat: Infinity, delay: index * 0.18, ease: 'easeInOut' }}
            />
          )
        })}

        {graphNodes.map((node, index) => {
          const radius = node.kind === 'call' ? 2.4 : node.kind === 'funded' ? 2 : node.kind === 'publication' ? 1.45 : 1.75
          return node.kind === 'publication' ? (
            <motion.rect
              key={node.id}
              x={node.x - radius}
              y={node.y - radius}
              width={radius * 2}
              height={radius * 2}
              transform={`rotate(45 ${node.x} ${node.y})`}
              className={nodeClass(node.kind)}
              initial={{ opacity: 0.8 }}
              animate={reduced ? {} : { opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 4, repeat: Infinity, delay: index * 0.11 }}
            />
          ) : (
            <motion.circle
              key={node.id}
              cx={node.x}
              cy={node.y}
              r={radius}
              className={nodeClass(node.kind)}
              filter={node.kind === 'call' || node.kind === 'funded' ? 'url(#home-v2-glow)' : undefined}
              initial={{ opacity: 0.8 }}
              animate={reduced ? {} : { opacity: [0.65, 1, 0.65], scale: [1, 1.08, 1] }}
              transition={{ duration: 3.5, repeat: Infinity, delay: index * 0.13 }}
            />
          )
        })}

        <motion.g
          initial={false}
          animate={reduced ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: [2, 0, 0, -2] }}
          transition={{ duration: 3.4, repeat: Infinity, repeatDelay: 0.8 }}
        >
          <rect x="54" y="27" width="31" height="8" rx="2" className="fill-ai-graphite-950/90 stroke-ai-blue-300/40" />
          <text x="57" y="32" className="fill-ai-blue-100 text-[2.4px] font-semibold tracking-[0.14em]">
            MATCH 92% · HORIZON-CL4-2026
          </text>
        </motion.g>
      </motion.svg>
    </div>
  )
}
