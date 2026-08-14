'use client'

import { motion } from 'framer-motion'
import { pipelineSteps } from './data'
import { useHomeMotion } from './motion'

export default function FundingPipeline() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="pipeline" className="border-t border-hairline bg-inset py-20 md:py-28" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.22em] text-cobalt-600">Funding pipeline</p>
        <div className="mt-4 gap-10 md:flex md:items-end md:justify-between">
          <h2 className="max-w-2xl text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
            One continuous path from profile to reviewer-ready submission.
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-7 text-muted md:mt-0">
            Six stages, one evidence trail. Nothing is re-entered, and every step keeps the records it was based on.
          </p>
        </div>

        <ol className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {pipelineSteps.map((step) => (
            <li key={step.step} className="border-t border-hairline pt-5">
              <div className="flex items-center gap-3">
                <span className="font-home-v2-mono text-xs font-semibold text-cobalt-600">{step.step}</span>
                <span className="font-home-v2-mono text-[11px] uppercase tracking-[0.2em] text-muted">{step.label}</span>
              </div>
              <h3 className="mt-4 text-[17px] font-semibold leading-6 text-ink">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-7 text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </motion.section>
  )
}
