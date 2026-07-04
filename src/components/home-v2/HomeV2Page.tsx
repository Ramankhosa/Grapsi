'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  Database,
  FileCheck2,
  Gauge,
  LockKeyhole,
  Search,
  ShieldCheck,
  Target,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { audienceCards, databaseRows, signals } from './data'
import FundingPipeline from './FundingPipeline'
import IntelligenceGraph from './IntelligenceGraph'
import { useHomeMotion } from './motion'

const terminalLines = [
  '> scanning 214 open calls against profile...',
  '> 38 eligible · 6 high-alignment · 2 closing <30d',
  '> nearest funded neighbor: GA-101094521 (2024, €1.2M)',
]

function useCta() {
  const router = useRouter()
  const { user } = useAuth()

  return {
    user,
    goPrimary: () => router.push(user ? '/dashboard' : '/register'),
    primaryLabel: user ? 'Go to dashboard' : 'Run a funding scan',
  }
}

export default function HomeV2Page() {
  return (
    <main className="min-h-screen bg-white font-[var(--font-home-v2-sans)] text-ai-graphite-900">
      <HomeV2Nav />
      <Hero />
      <SignalStrip />
      <FundingPipeline />
      <PillarIntelligence />
      <PillarPositioning />
      <PillarPreparation />
      <EvidenceSection />
      <TrustSection />
      <AudienceSection />
      <FinalCTA />
      <HomeV2Footer />
    </main>
  )
}

function HomeV2Nav() {
  const { user } = useCta()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-40 transition duration-300 ${
        scrolled ? 'border-b border-white/10 bg-ai-graphite-950/80 backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white md:text-base">
          <span className="text-ai-blue-300">AI</span>GrantMentor
        </Link>
        <div className="hidden items-center gap-7 text-sm text-ai-graphite-300 md:flex">
          <a href="#pipeline" className="transition hover:text-white">
            Platform
          </a>
          <a href="#intelligence" className="transition hover:text-white">
            Intelligence
          </a>
          <a href="#security" className="transition hover:text-white">
            Security
          </a>
          <Link href={user ? '/dashboard' : '/login'} className="transition hover:text-white">
            {user ? 'Dashboard' : 'Sign in'}
          </Link>
        </div>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-400 px-4 py-2 text-sm font-semibold text-ai-graphite-950 transition hover:bg-ai-blue-300 focus:outline-none focus:ring-2 focus:ring-ai-blue-200 focus:ring-offset-2 focus:ring-offset-ai-graphite-950"
        >
          Request a demo
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  )
}

function Hero() {
  const { primaryLabel, goPrimary } = useCta()
  const reduced = useReducedMotion()

  return (
    <section className="relative min-h-screen overflow-hidden bg-ai-graphite-950 text-white">
      <div className="absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="absolute inset-y-0 right-0 w-full opacity-70 md:w-[64%]">
        <IntelligenceGraph />
      </div>
      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:px-8">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 18 }}
          animate={reduced ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.32em] text-ai-blue-200">
            Funding intelligence platform
          </p>
          <p className="mb-5 max-w-2xl text-sm font-semibold text-ai-blue-100">
            We turn the world&apos;s funding record into your unfair advantage.
          </p>
          <h1 className="text-5xl font-semibold leading-[0.95] tracking-normal text-white md:text-7xl">
            The command center for research funding.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-ai-graphite-200 md:text-xl">
            AIGrantMentor matches your research to the right calls, shows you what has actually won funding, positions
            your idea in the gaps, and prepares a submission that survives review.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={goPrimary}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ai-blue-400 px-6 py-3 text-sm font-semibold text-ai-graphite-950 transition hover:bg-ai-blue-300 focus:outline-none focus:ring-2 focus:ring-ai-blue-200 focus:ring-offset-2 focus:ring-offset-ai-graphite-950"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
            <a
              href="#pipeline"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              See the platform
            </a>
            <Link
              href="/funding/intelligence"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/0 px-2 py-3 text-sm font-semibold text-ai-blue-200 transition hover:text-ai-blue-100 focus:outline-none focus:ring-2 focus:ring-white/30 sm:px-4"
            >
              Explore the Intelligence Layer
            </Link>
          </div>
          <TerminalStrip />
        </motion.div>
      </div>
    </section>
  )
}

function TerminalStrip() {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (reduced) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % terminalLines.length)
    }, 3600)
    return () => window.clearInterval(timer)
  }, [reduced])

  return (
    <div className="mt-8 max-w-2xl rounded-lg border border-white/10 bg-ai-graphite-950/80 p-4 font-mono text-xs text-ai-graphite-300">
      {reduced ? (
        terminalLines[0]
      ) : (
        <motion.span
          key={terminalLines[index]}
          initial={{ opacity: 0, width: '0ch' }}
          animate={{ opacity: 1, width: `${terminalLines[index].length}ch` }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="inline-block max-w-full overflow-hidden whitespace-nowrap align-bottom"
        >
          {terminalLines[index]}
        </motion.span>
      )}
    </div>
  )
}

function SignalStrip() {
  return (
    <div className="overflow-hidden border-y border-white/10 bg-ai-graphite-950 py-4 font-mono text-xs text-ai-graphite-300">
      <div className="flex min-w-max animate-home-v2-marquee gap-8 hover:[animation-play-state:paused] motion-reduce:animate-none">
        {[...signals, ...signals].map((signal, index) => (
          <span key={`${signal}-${index}`} className="whitespace-nowrap">
            {signal}
          </span>
        ))}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.28em] text-ai-blue-600">{children}</p>
}

function PillarIntelligence() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="intelligence" className="bg-white py-28" {...reveal}>
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:px-8">
        <div>
          <SectionLabel>Intelligence</SectionLabel>
          <h2 className="mt-4 font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-ai-graphite-950 md:text-6xl">
            Know what gets funded before you write a word.
          </h2>
          <p className="mt-6 text-lg leading-8 text-ai-graphite-600">
            Matching is only useful when it is grounded in the record of prior awards. The intelligence layer connects
            profile fit, eligibility, funded precedents, and deadline pressure in one view.
          </p>
          <FeatureRows
            rows={[
              ['Profile-aware call matching', Search],
              ['Funded-project database', Database],
              ['Eligibility screening', ShieldCheck],
            ]}
          />
        </div>
        <div className="rounded-xl border border-ai-graphite-200 bg-ai-graphite-50 p-4">
          <div className="rounded-lg border border-ai-graphite-200 bg-white p-5">
            <div className="mb-5 flex items-center justify-between border-b border-ai-graphite-200 pb-4 font-mono text-xs text-ai-graphite-500">
              <span>HORIZON-CL4-2026-DATA-02</span>
              <span>illustrative data</span>
            </div>
            <div className="grid gap-6 md:grid-cols-[180px_1fr]">
              <div className="grid place-items-center">
                <div className="relative grid h-36 w-36 place-items-center rounded-full border-[10px] border-ai-blue-100">
                  <div className="absolute inset-[-10px] rounded-full border-[10px] border-ai-blue-500 [clip-path:polygon(50%_50%,100%_0,100%_100%,0_100%,0_18%)]" />
                  <div className="text-center">
                    <div className="font-mono text-3xl font-bold text-ai-graphite-950">92%</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ai-graphite-500">match</div>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-ai-graphite-950">AI systems for adaptive health infrastructure</h3>
                <p className="mt-2 text-sm leading-6 text-ai-graphite-600">
                  Strong alignment across implementation priorities, data governance requirements, and consortium profile.
                </p>
                <div className="mt-5 space-y-3">
                  {['GA-101094521 · €1.2M · 2024', 'GA-101076883 · €870K · 2023', 'GA-101119044 · €1.5M · 2025'].map(
                    (project) => (
                      <div key={project} className="rounded border border-ai-graphite-200 bg-ai-graphite-50 px-3 py-2 font-mono text-xs text-ai-graphite-700">
                        {project}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function PillarPositioning() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section className="bg-ai-graphite-50 py-28" {...reveal}>
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:px-8">
        <div className="relative min-h-[440px] rounded-xl border border-ai-graphite-200 bg-white p-5">
          <div className="absolute inset-8 border-l border-b border-ai-graphite-200" />
          {Array.from({ length: 46 }).map((_, index) => (
            <span
              key={index}
              className={`absolute h-2.5 w-2.5 rounded-full ${
                index % 5 === 0 ? 'bg-violet-400' : index % 3 === 0 ? 'bg-emerald-500' : 'bg-ai-blue-400'
              }`}
              style={{ left: `${10 + ((index * 19) % 78)}%`, top: `${13 + ((index * 31) % 68)}%` }}
            />
          ))}
          <motion.div
            className="absolute left-[61%] top-[43%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500"
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-emerald-500/60" />
            <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-emerald-500/60" />
          </motion.div>
          <div className="absolute left-[64%] top-[58%] rounded bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-ai-graphite-200">
            142 funded projects · avg award €1.2M · last call 2025
          </div>
        </div>
        <div>
          <SectionLabel>Positioning engine</SectionLabel>
          <h2 className="mt-4 font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-ai-graphite-950 md:text-6xl">
            Find the white space between 2.8M funded projects.
          </h2>
          <div className="mt-8 rounded-xl border border-ai-graphite-200 bg-white p-5">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-ai-graphite-500">Before / after idea</div>
            <div className="rounded border border-ai-graphite-200 bg-ai-graphite-50 p-3 text-sm text-ai-graphite-500">
              Rough idea: AI tool for improving hospital workflows.
            </div>
            <div className="my-3 flex justify-center text-ai-blue-600">
              <ArrowRight className="h-5 w-5 rotate-90" />
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-ai-graphite-800">
              Positioned concept: explainable triage automation for resource-constrained care networks, aligned to open-science
              data obligations and health-system resilience criteria.
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function PillarPreparation() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section className="bg-white py-28" {...reveal}>
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <SectionLabel>Preparation studio</SectionLabel>
          <h2 className="mt-4 font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-ai-graphite-950 md:text-6xl">
            From positioned idea to reviewer-ready submission.
          </h2>
          <FeatureRows
            rows={[
              ['Structured drafting', FileCheck2],
              ['Automatic citations and policy alignment', Check],
              ['AI review against call criteria', Gauge],
            ]}
          />
        </div>
        <div className="grid gap-4 rounded-xl border border-ai-graphite-200 bg-ai-graphite-50 p-4 md:grid-cols-[1fr_0.8fr]">
          <div className="rounded-lg border border-ai-graphite-200 bg-white p-5">
            {['Objectives', 'WP1 / Evidence base', 'WP2 / Prototype', 'WP3 / Evaluation', 'Budget', 'Impact'].map((item) => (
              <div key={item} className="mb-3 flex items-center justify-between rounded border border-ai-graphite-200 px-3 py-2 text-sm">
                <span>{item}</span>
                <Check className="h-4 w-4 text-emerald-600" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-ai-graphite-200 bg-white p-5">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-ai-graphite-500">Evidence rail</div>
            {['[Nature 2024]', '[EU Policy: Green Deal S3]', '[Funded: GA 101076xxx]', '[NIH Data Mgmt 2025]'].map((chip) => (
              <div key={chip} className="mb-3 rounded-full border border-ai-blue-200 bg-ai-blue-50 px-3 py-2 font-mono text-xs text-ai-blue-800">
                {chip}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function EvidenceSection() {
  return (
    <section className="bg-ai-graphite-950 py-28 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>This is built on data, not adjectives</SectionLabel>
        <h2 className="mt-4 max-w-3xl font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight text-white md:text-6xl">
          The funded-project record becomes a working surface.
        </h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ['2.8', 'M', 'funded-project records'],
            ['96', '', 'programmes normalized'],
            ['14', '', 'source families connected'],
          ].map(([value, suffix, label]) => (
            <div key={label} className="border-t border-white/10 pt-4">
              <div className="font-mono text-3xl font-semibold text-ai-blue-200">
                <CountUp value={Number(value)} decimals={value.includes('.') ? 1 : 0} />
                {suffix}
              </div>
              <div className="mt-1 font-mono text-xs text-ai-graphite-400">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex flex-wrap gap-2 font-mono text-[11px] text-ai-graphite-300">
              {['programme: all', 'year: 2023-2026', 'topic: AI'].map((chip) => (
                <span key={chip} className="rounded border border-white/10 px-2 py-1">
                  {chip}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left font-mono text-xs">
                <thead className="text-ai-graphite-400">
                  <tr>
                    {['Programme', 'Topic', 'Award', 'Year', 'Consortium'].map((head) => (
                      <th key={head} className="border-b border-white/10 py-2 font-medium">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {databaseRows.map((row) => (
                    <tr key={row.join('-')} className="text-ai-graphite-200">
                      {row.map((cell) => (
                        <td key={cell} className="border-b border-white/5 py-3 pr-4">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-ai-graphite-400">
              Funded-project intelligence layer — n programmes, updated continuously. Illustrative data.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xl font-semibold">AI review scorecard</h3>
              <span className="rounded bg-emerald-300 px-3 py-1 font-mono text-xs font-bold text-ai-graphite-950">4.6 / 5</span>
            </div>
            {[
              ['Excellence', '92%'],
              ['Impact', '88%'],
              ['Implementation', '84%'],
              ['Eligibility', '98%'],
            ].map(([label, value]) => (
              <div key={label} className="mb-4">
                <div className="mb-1 flex justify-between font-mono text-xs text-ai-graphite-300">
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-ai-blue-300" style={{ width: value }} />
                </div>
              </div>
            ))}
            <div className="mt-6 rounded border border-white/10 bg-ai-graphite-950 p-4 text-sm leading-6 text-ai-graphite-200">
              &quot;The methodology section should address data-management obligations under the call&apos;s open-science
              requirements.&quot;
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TrustSection() {
  return (
    <section id="security" className="bg-white py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>Institutional trust</SectionLabel>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            ['DATA GOVERNANCE', LockKeyhole, 'Your proposals and ideas are never used to train models or shared across institutions. Tenant-isolated by design.'],
            ['SECURITY', ShieldCheck, 'Encryption in transit and at rest. Role-based access for research offices. SSO available on request.'],
            ['METHODOLOGY', Target, 'Every match, gap, and review score is explainable. The engine shows which calls, projects, and criteria drove its conclusion.'],
          ].map(([title, Icon, body]) => {
            const TypedIcon = Icon as typeof LockKeyhole
            return (
              <div key={title as string} className="border-t border-ai-graphite-200 pt-6">
                <TypedIcon className="mb-5 h-5 w-5 text-ai-blue-600" />
                <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-ai-graphite-500">{title as string}</h3>
                <p className="mt-4 leading-7 text-ai-graphite-700">{body as string}</p>
              </div>
            )
          })}
        </div>
        <div className="mt-12 rounded-xl border border-ai-graphite-200 bg-ai-graphite-50 p-6">
          <h3 className="font-semibold text-ai-graphite-950">How the intelligence is built</h3>
          <div className="mt-4 grid gap-3 font-mono text-xs leading-6 text-ai-graphite-600 md:grid-cols-3">
            <p>Public funding databases, calls, publications, and patent records are normalized into one evidence layer.</p>
            <p>Matching and gap analysis keep source records attached so conclusions can be inspected.</p>
            <p>Refresh cadence and source coverage are visible during institutional pilots.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function AudienceSection() {
  return (
    <section className="bg-ai-graphite-50 py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>Who it is for</SectionLabel>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {audienceCards.map((card) => (
            <div key={card.title} className="rounded-lg border border-ai-graphite-200 bg-white p-5">
              <h3 className="font-semibold text-ai-graphite-950">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-ai-graphite-600">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  const { goPrimary } = useCta()

  return (
    <section className="relative overflow-hidden bg-ai-graphite-950 py-28 text-white">
      <div className="absolute inset-0 opacity-35">
        <IntelligenceGraph compact />
      </div>
      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="font-[var(--font-home-v2-serif)] text-4xl font-semibold leading-tight md:text-6xl">
          Your next funded project is already in the data.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-ai-graphite-200">
          See what AIGrantMentor finds for your research profile in under five minutes.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={goPrimary}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-ai-blue-400 px-6 py-3 text-sm font-semibold text-ai-graphite-950 transition hover:bg-ai-blue-300"
          >
            Run your first funding scan
            <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
          >
            Request an institutional demo
          </Link>
        </div>
        <p className="mt-5 font-mono text-xs text-ai-graphite-400">No credit card · Institution-wide pilots available</p>
      </div>
    </section>
  )
}

function HomeV2Footer() {
  const columns = [
    ['Platform', 'Pipeline', 'Preparation Studio', 'AI Review'],
    ['Intelligence', 'Call Matching', 'Funded Projects', 'Gap Positioning'],
    ['Institutions', 'Security', 'Governance', 'Pilots'],
    ['Company', 'Contact', 'Privacy', 'Status'],
  ]

  return (
    <footer className="bg-ai-graphite-950 px-4 py-12 text-ai-graphite-300 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1fr_2fr]">
        <div>
          <div className="font-semibold text-white">
            <span className="text-ai-blue-300">AI</span>GrantMentor
          </div>
          <div className="mt-4 font-mono text-xs text-emerald-300">system operational</div>
        </div>
        <div className="grid gap-6 sm:grid-cols-4">
          {columns.map(([title, ...items]) => (
            <div key={title}>
              <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-white">{title}</h3>
              <div className="space-y-2 text-sm">
                {items.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-7xl flex-col gap-2 border-t border-white/10 pt-6 font-mono text-xs text-ai-graphite-500 md:flex-row md:items-center md:justify-between">
        <span>© 2026 AIGrantMentor. All rights reserved.</span>
        <span>Privacy · Terms · Security</span>
      </div>
    </footer>
  )
}

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)

  useEffect(() => {
    if (!inView || reduced) {
      if (reduced) setDisplay(value)
      return
    }

    let frame = 0
    const total = 36
    const timer = window.setInterval(() => {
      frame += 1
      const progress = Math.min(frame / total, 1)
      setDisplay(value * (1 - Math.pow(1 - progress, 3)))
      if (progress === 1) window.clearInterval(timer)
    }, 24)

    return () => window.clearInterval(timer)
  }, [decimals, inView, reduced, value])

  return <span ref={ref}>{display.toFixed(decimals)}</span>
}

function FeatureRows({ rows }: { rows: Array<[string, typeof Search]> }) {
  return (
    <div className="mt-8 space-y-3">
      {rows.map(([label, Icon]) => (
        <div key={label} className="flex items-center gap-3 border-t border-ai-graphite-200 pt-3">
          <Icon className="h-5 w-5 text-ai-blue-600" />
          <span className="font-medium text-ai-graphite-800">{label}</span>
        </div>
      ))}
    </div>
  )
}
