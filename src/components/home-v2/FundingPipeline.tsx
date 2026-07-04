'use client'

import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useRef, useState } from 'react'
import { pipelineSteps } from './data'

function PipelineVisual({ active = 0 }: { active?: number }) {
  const reduced = useReducedMotion()
  const showMap = active >= 3
  const showDoc = active >= 4
  const showReview = active >= 5

  return (
    <div className="relative min-h-[480px] overflow-hidden rounded-xl border border-white/10 bg-ai-graphite-950 p-5 text-white shadow-2xl shadow-ai-graphite-950/30">
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="relative flex items-center justify-between border-b border-white/10 pb-3 font-mono text-[11px] text-ai-graphite-300">
        <span>FUNDING PIPELINE / LIVE MODEL</span>
        <span className="text-emerald-300">stage {active + 1}/6</span>
      </div>

      <div className="relative mt-6 h-[390px]">
        {!showMap && !showDoc && (
          <svg viewBox="0 0 500 340" className="h-full w-full">
            <defs>
              <filter id="pipe-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle cx="95" cy="170" r="20" className="fill-white stroke-white" />
            <text x="72" y="222" className="fill-white/80 text-[12px] font-semibold">
              researcher profile
            </text>
            {['publications', 'h-index', 'prior grants', 'institution'].map((chip, index) => (
              <motion.g
                key={chip}
                initial={false}
                animate={reduced ? {} : { y: [0, -4, 0] }}
                transition={{ duration: 3, repeat: Infinity, delay: index * 0.2 }}
              >
                <rect x={42 + index * 18} y={64 + index * 34} width="92" height="24" rx="12" className="fill-white/8 stroke-white/15" />
                <text x={53 + index * 18} y={80 + index * 34} className="fill-white/70 text-[10px]">
                  {chip}
                </text>
              </motion.g>
            ))}
            {(active >= 1 ? [0, 1, 2] : []).map((_, index) => (
              <g key={index}>
                <circle cx={265 + index * 48} cy={90 + index * 72} r="26" className="fill-ai-graphite-950 stroke-ai-blue-300 stroke-2" />
                <text x={246 + index * 48} y={94 + index * 72} className="fill-ai-blue-100 text-[11px] font-semibold">
                  {index === 0 ? '92%' : index === 1 ? '84%' : '77%'}
                </text>
                <motion.line
                  x1="115"
                  y1="170"
                  x2={265 + index * 48}
                  y2={90 + index * 72}
                  className="stroke-ai-blue-300"
                  strokeWidth="1"
                  animate={reduced ? {} : { opacity: [0.25, 0.85, 0.25] }}
                  transition={{ duration: 2.8, repeat: Infinity, delay: index * 0.3 }}
                />
              </g>
            ))}
            {(active >= 2 ? [0, 1, 2, 3, 4, 5, 6, 7] : []).map((_, index) => (
              <circle
                key={index}
                cx={330 + Math.cos(index) * 85}
                cy={170 + Math.sin(index * 1.7) * 95}
                r={index < 3 ? 8 : 4}
                className={index < 3 ? 'fill-emerald-300' : 'fill-emerald-300/25'}
                filter={index < 3 ? 'url(#pipe-glow)' : undefined}
              />
            ))}
          </svg>
        )}

        {showMap && !showDoc && (
          <div className="relative h-full rounded-lg border border-white/10 bg-white/[0.03]">
            <div className="absolute inset-8 border-l border-b border-white/20" />
            <motion.span
              className="absolute left-[58%] top-[42%] h-[38%] w-px origin-bottom bg-gradient-to-t from-emerald-300/70 to-transparent"
              animate={reduced ? {} : { rotate: [0, 320], opacity: [0, 1, 0] }}
              transition={{ duration: 1.8, ease: 'easeOut' }}
            />
            {Array.from({ length: 34 }).map((_, index) => (
              <span
                key={index}
                className={`absolute h-2 w-2 rounded-full ${
                  index % 5 === 0 ? 'bg-violet-300' : index % 3 === 0 ? 'bg-emerald-300' : 'bg-ai-blue-300/70'
                }`}
                style={{
                  left: `${14 + ((index * 17) % 70)}%`,
                  top: `${18 + ((index * 29) % 60)}%`,
                }}
              />
            ))}
            <motion.div
              className="absolute left-[58%] top-[42%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/80"
              animate={reduced ? {} : { scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-emerald-300/60" />
              <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-emerald-300/60" />
            </motion.div>
            <div className="absolute left-[61%] top-[56%] rounded bg-ai-graphite-950 px-3 py-2 font-mono text-[11px] text-emerald-200 ring-1 ring-emerald-300/30">
              your fundable angle
            </div>
          </div>
        )}

        {showDoc && (
          <div className="grid h-full gap-4 md:grid-cols-[1fr_220px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-center justify-between font-mono text-[11px] text-white/50">
                <span>PROPOSAL CONCEPT</span>
                <span>call-aligned</span>
              </div>
              {['Objective 1: Validate adaptive AI workflow', 'WP1: Dataset and ethics readiness', 'WP2: Deployment across partner labs', 'Budget logic: personnel, compute, evaluation', 'Impact: policy-aligned dissemination'].map(
                (line, index) => (
                  <motion.div
                    key={line}
                    className="mb-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
                    initial={reduced ? false : { opacity: 0, x: -10 }}
                    whileInView={reduced ? {} : { opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.08 }}
                  >
                    {line}
                  </motion.div>
                ),
              )}
            </div>
            {showReview && (
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
                <div className="mb-4 rounded bg-emerald-300 px-3 py-2 text-center font-mono text-[11px] font-bold text-ai-graphite-950">
                  REVIEW PASSED / 4.6
                </div>
                {[
                  ['Excellence', '92%'],
                  ['Impact', '88%'],
                  ['Implementation', '84%'],
                  ['Eligibility', '98%'],
                ].map(([label, value]) => (
                  <div key={label} className="mb-3">
                    <div className="mb-1 flex justify-between font-mono text-[10px] text-white/60">
                      <span>{label}</span>
                      <span>{value}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10">
                      <div className="h-1.5 rounded-full bg-emerald-300" style={{ width: value }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function FundingPipeline() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const background = useTransform(scrollYProgress, [0, 0.75, 1], ['#020617', '#0f172a', '#ffffff'])

  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    setActive(Math.max(0, Math.min(5, Math.floor(latest * 6))))
  })

  return (
    <motion.section id="pipeline" ref={ref} style={{ background }} className="relative md:min-h-[420vh]">
      <div className="mx-auto px-4 py-20 md:hidden">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-ai-blue-300">Funding pipeline</p>
        <h2 className="mt-4 font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-white">
          One continuous path from profile to reviewer-ready submission.
        </h2>
        <div className="mt-8 space-y-8">
          {pipelineSteps.map((step, index) => (
            <div key={step.eyebrow} className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                <div className="mb-2 font-mono text-[11px] text-ai-blue-200">{step.eyebrow}</div>
                <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-ai-graphite-300">{step.body}</p>
              </div>
              <PipelineVisual active={index} />
            </div>
          ))}
        </div>
      </div>
      <div className="sticky top-16 mx-auto hidden min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-10 px-4 py-20 md:grid md:grid-cols-[0.82fr_1.18fr] sm:px-6 lg:px-8">
        <div className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-ai-blue-300">Funding pipeline</p>
          <h2 className="max-w-xl font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-white md:text-6xl">
            One continuous path from profile to reviewer-ready submission.
          </h2>
          <div className="space-y-3 pt-4">
            {pipelineSteps.map((step, index) => (
              <motion.div
                key={step.eyebrow}
                className={`rounded-lg border p-4 transition duration-300 ${
                  active === index
                    ? 'border-ai-blue-300/40 bg-white/[0.08]'
                    : 'border-white/10 bg-white/[0.035] opacity-45'
                }`}
              >
                <div className="mb-2 font-mono text-[11px] text-ai-blue-200">{step.eyebrow}</div>
                <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-ai-graphite-300">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div>
          <motion.div
            style={{
              opacity: useTransform(scrollYProgress, [0, 0.04], [0, 1]),
            }}
          >
            <PipelineVisual active={active} />
          </motion.div>
        </motion.div>
      </div>
    </motion.section>
  )
}
