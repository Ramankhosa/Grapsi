'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  AlertCircle,
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
import {
  audienceCards,
  databaseRows,
  heroEligibility,
  heroMatches,
  heroPrecedents,
  platformStats,
} from './data'
import FieldMatrix from './FieldMatrix'
import FundedByFunder from './FundedByFunder'
import FundingPipeline from './FundingPipeline'
import { useHomeMotion } from './motion'

const BTN_BASE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ground'
const BTN_PRIMARY = `${BTN_BASE} bg-cobalt-600 text-white hover:bg-cobalt-700`
const BTN_SECONDARY = `${BTN_BASE} border border-hairline bg-ground text-ink-soft hover:border-muted-soft hover:bg-inset`
const LINK_QUIET =
  'inline-flex items-center gap-1.5 rounded text-sm font-medium text-cobalt-600 transition hover:text-cobalt-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 focus-visible:ring-offset-2'

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
    <main className="min-h-screen bg-ground font-home-v2-sans text-ink antialiased">
      <SiteNav />
      <Hero />
      <StatsStrip />
      <FundingPipeline />
      <IntelligenceSection />
      <PositioningSection />
      <PreparationSection />
      <EvidenceSection />
      <TrustSection />
      <AudienceSection />
      <DevelopersSection />
      <FinalCTA />
      <SiteFooter />
    </main>
  )
}

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`text-[15px] font-semibold tracking-[-0.01em] text-ink ${className}`}>
      <span className="text-cobalt-600">AI</span>GrantMentor
    </span>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.22em] text-cobalt-600">{children}</p>
}

function SiteNav() {
  const { user } = useCta()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
        scrolled ? 'border-hairline bg-ground/85 backdrop-blur-md' : 'border-transparent bg-ground'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link href="/" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex lg:gap-8">
          {[
            ['Platform', '#pipeline'],
            ['Intelligence', '#intelligence'],
            ['Evidence', '#evidence'],
            ['Security', '#security'],
            ['Developers', '#developers'],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="rounded text-sm text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href={user ? '/dashboard' : '/login'}
            className="hidden rounded px-1 text-sm text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 sm:inline-flex"
          >
            {user ? 'Dashboard' : 'Sign in'}
          </Link>
          <Link href="/contact" className={`${BTN_PRIMARY} h-10 px-4`}>
            Request a demo
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  const { primaryLabel, goPrimary } = useCta()
  const { reduced } = useHomeMotion()

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(29,78,216,0.055),transparent_72%)]"
      />
      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 md:pb-28 md:pt-24">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-ground px-3 py-1 font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cobalt-600" />
            Funding intelligence platform
          </span>

          <h1 className="mt-6 text-[clamp(2.25rem,5.4vw,4rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
            The command center for research funding.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-8 text-ink-soft md:text-lg">
            AIGrantMentor matches your research to the right calls, shows what has actually won funding, positions your
            idea in the gaps, and prepares a submission that survives review.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={goPrimary} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <a href="#pipeline" className={`${BTN_SECONDARY} w-full sm:w-auto`}>
              See how it works
            </a>
          </div>

          <p className="mt-6 text-[13px] text-muted">
            No credit card · Institution-wide pilots available ·{' '}
            <Link href="/funding/intelligence" className={LINK_QUIET}>
              Explore the Intelligence Layer
            </Link>
          </p>
        </motion.div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 20 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: 'easeOut' }}
          className="mt-14 md:mt-16"
        >
          <ScanPanel />
        </motion.div>
      </div>
    </section>
  )
}

function ScanPanel() {
  const selected = heroMatches[0]

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-ground shadow-nk-lift">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <div className="flex items-center gap-2 font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          Funding scan
        </div>
        <div className="font-home-v2-mono text-[11px] text-muted-soft">
          214 calls scanned · 38 eligible · 6 high alignment
        </div>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <ul className="divide-y divide-hairline border-b border-hairline md:border-b-0 md:border-r">
          {heroMatches.map((match, index) => (
            <li
              key={match.id}
              className={`flex items-start gap-5 px-5 py-4 ${
                index === 0 ? 'bg-cobalt-50/60 shadow-[inset_2px_0_0_#1d4ed8]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{match.title}</p>
                <p className="mt-1.5 truncate font-home-v2-mono text-[11px] text-muted">
                  {match.programme} · {match.id} · {match.closes}
                </p>
              </div>
              <div className="w-20 shrink-0 pt-0.5">
                <div className="text-right font-home-v2-mono text-xs font-semibold text-ink">{match.score}%</div>
                <div className="mt-2 h-1 rounded-full bg-nickel-100">
                  <div
                    className={`h-1 rounded-full ${index === 0 ? 'bg-cobalt-600' : 'bg-nickel-300'}`}
                    style={{ width: `${match.score}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="bg-inset p-5 sm:p-6">
          <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Why it matches</p>
          <h3 className="mt-3 text-[15px] font-semibold leading-6 text-ink">{selected.title}</h3>

          <ul className="mt-4 space-y-2.5">
            {heroEligibility.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5 text-[13px] text-ink-soft">
                {item.state === 'met' ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  {item.state === 'met' ? 'met' : 'to do'}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-hairline pt-4">
            <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Funded precedents</p>
            <ul className="mt-3 space-y-2">
              {heroPrecedents.map((precedent) => (
                <li
                  key={precedent}
                  className="truncate rounded-md border border-hairline bg-ground px-3 py-2 font-home-v2-mono text-[11px] text-ink-soft"
                >
                  {precedent}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-4 text-[11px] text-muted-soft">Illustrative data.</p>
        </div>
      </div>
    </div>
  )
}

function StatsStrip() {
  return (
    <section aria-label="Platform coverage" className="mx-auto max-w-6xl px-6 pb-4">
      <dl className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
        {platformStats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse bg-ground px-6 py-6">
            <dt className="mt-1.5 text-[13px] text-muted">{stat.label}</dt>
            <dd className="font-home-v2-mono text-2xl font-semibold tracking-tight text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function FeatureRows({ rows }: { rows: Array<[string, typeof Search]> }) {
  return (
    <ul className="mt-8 space-y-4">
      {rows.map(([label, Icon]) => (
        <li key={label} className="flex items-center gap-3 border-t border-hairline pt-4">
          <Icon className="h-[18px] w-[18px] shrink-0 text-cobalt-600" aria-hidden />
          <span className="text-[15px] font-medium text-ink-soft">{label}</span>
        </li>
      ))}
    </ul>
  )
}

function IntelligenceSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="intelligence" className="border-t border-hairline bg-ground py-20 md:py-28" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-20">
        <div>
          <Eyebrow>Intelligence</Eyebrow>
          <h2 className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
            Know what gets funded before you write a word.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-8 text-ink-soft">
            Matching is only useful when it is grounded in the record of prior awards. The intelligence layer connects
            profile fit, eligibility, funded precedents, and deadline pressure in a single view.
          </p>
          <FeatureRows
            rows={[
              ['Profile-aware call matching', Search],
              ['Funded-project database', Database],
              ['Eligibility screening', ShieldCheck],
            ]}
          />
        </div>

        <FundedByFunder />
      </div>
    </motion.section>
  )
}

function PositioningSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="positioning" className="border-t border-hairline bg-inset py-20 md:py-28" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-20">
        <div className="order-2 lg:order-1">
          <FieldMatrix />
        </div>

        <div className="order-1 lg:order-2">
          <Eyebrow>Positioning engine</Eyebrow>
          <h2 className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
            Find the white space between 2.8M funded projects.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-8 text-ink-soft">
            Gap analysis places your idea against everything the agency has already paid for, then sharpens it into the
            angle that is both novel and fundable.
          </p>

          <div className="mt-8 rounded-2xl border border-hairline bg-ground p-5">
            <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Before / after</p>
            <p className="mt-4 rounded-lg border border-hairline bg-inset px-4 py-3 text-[14px] leading-6 text-muted">
              AI tool for improving hospital workflows.
            </p>
            <div aria-hidden className="my-3 flex justify-center text-nickel-400">
              <ArrowRight className="h-4 w-4 rotate-90" />
            </div>
            <p className="rounded-lg border border-cobalt-100 bg-cobalt-50/70 px-4 py-3 text-[14px] leading-6 text-ink-soft">
              Explainable triage automation for resource-constrained care networks, aligned to open-science data
              obligations and health-system resilience criteria.
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function PreparationSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="preparation" className="border-t border-hairline bg-ground py-20 md:py-28" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-20">
        <div>
          <Eyebrow>Preparation studio</Eyebrow>
          <h2 className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
            From positioned idea to reviewer-ready submission.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-8 text-ink-soft">
            The studio drafts against the call&apos;s own structure, keeps every claim attached to a source, and scores
            the result before a reviewer ever sees it.
          </p>
          <FeatureRows
            rows={[
              ['Structured drafting', FileCheck2],
              ['Automatic citations and policy alignment', Check],
              ['AI review against call criteria', Gauge],
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
          <div className="rounded-2xl border border-hairline bg-ground p-5">
            <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Proposal outline</p>
            <ul className="mt-4 space-y-2">
              {['Objectives', 'WP1 · Evidence base', 'WP2 · Prototype', 'WP3 · Evaluation', 'Budget', 'Impact'].map(
                (item) => (
                  <li
                    key={item}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5 text-[13px] text-ink-soft"
                  >
                    <span className="truncate">{item}</span>
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  </li>
                ),
              )}
            </ul>
          </div>

          <div className="rounded-2xl border border-hairline bg-inset p-5">
            <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Evidence rail</p>
            <ul className="mt-4 space-y-2">
              {['Nature 2024', 'EU Green Deal S3', 'Funded: GA 101076xxx', 'NIH Data Mgmt 2025'].map((chip) => (
                <li
                  key={chip}
                  className="truncate rounded-full border border-hairline bg-ground px-3 py-2 font-home-v2-mono text-[11px] text-ink-soft"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function EvidenceSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="evidence" className="border-t border-hairline bg-inset py-20 md:py-28" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Built on data, not adjectives</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          The funded-project record becomes a working surface.
        </h2>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-2xl border border-hairline bg-ground p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap gap-2 font-home-v2-mono text-[11px] text-muted">
              {['programme: all', 'year: 2023–2026', 'topic: AI'].map((chip) => (
                <span key={chip} className="rounded-md border border-hairline bg-inset px-2 py-1">
                  {chip}
                </span>
              ))}
            </div>

            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[560px] text-left font-home-v2-mono text-xs">
                <thead>
                  <tr>
                    {['Programme', 'Topic', 'Award', 'Year', 'Partners'].map((head) => (
                      <th key={head} className="border-b border-hairline pb-3 pr-4 font-medium text-muted">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {databaseRows.map((row) => (
                    <tr key={row.join('-')}>
                      {row.map((cell, index) => (
                        <td
                          key={cell}
                          className={`border-b border-hairline py-3 pr-4 ${
                            index === 0 ? 'font-medium text-ink' : 'text-ink-soft'
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-5 text-[12px] text-muted">
              Funded-project intelligence layer — 96 programmes, updated continuously. Illustrative data.
            </p>
          </div>

          <div className="rounded-2xl border border-hairline bg-ground p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[15px] font-semibold text-ink">AI review scorecard</h3>
              <span className="rounded-md bg-cobalt-50 px-2.5 py-1 font-home-v2-mono text-[11px] font-semibold text-cobalt-700">
                4.6 / 5
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {[
                ['Excellence', 92],
                ['Impact', 88],
                ['Implementation', 84],
                ['Eligibility', 98],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="mb-2 flex justify-between font-home-v2-mono text-[11px] text-muted">
                    <span>{label as string}</span>
                    <span className="text-ink-soft">{value as number}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-nickel-100">
                    <div className="h-1.5 rounded-full bg-cobalt-600" style={{ width: `${value as number}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-7 border-l-2 border-cobalt-200 bg-inset px-4 py-3 text-[13px] leading-6 text-ink-soft">
              &quot;The methodology section should address data-management obligations under the call&apos;s open-science
              requirements.&quot;
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function TrustSection() {
  const { reveal } = useHomeMotion()

  const pillars: Array<[string, typeof LockKeyhole, string]> = [
    [
      'Data governance',
      LockKeyhole,
      'Your proposals and ideas are never used to train models or shared across institutions. Tenant-isolated by design.',
    ],
    [
      'Security',
      ShieldCheck,
      'Encryption in transit and at rest. Role-based access for research offices. SSO available on request.',
    ],
    [
      'Methodology',
      Target,
      'Every match, gap, and review score is explainable. The engine shows which calls, projects, and criteria drove its conclusion.',
    ],
  ]

  return (
    <motion.section id="security" className="border-t border-hairline bg-ground py-20 md:py-28" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Institutional trust</Eyebrow>

        <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          {pillars.map(([title, Icon, body]) => (
            <div key={title} className="border-t border-hairline pt-6">
              <Icon className="h-[18px] w-[18px] text-cobalt-600" aria-hidden />
              <h3 className="mt-5 text-[15px] font-semibold text-ink">{title}</h3>
              <p className="mt-3 text-[15px] leading-7 text-ink-soft">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-2xl border border-hairline bg-inset p-6 sm:p-8">
          <h3 className="text-[15px] font-semibold text-ink">How the intelligence is built</h3>
          <div className="mt-5 grid gap-6 text-[14px] leading-7 text-ink-soft md:grid-cols-3">
            <p>Public funding databases, calls, publications, and patent records are normalized into one evidence layer.</p>
            <p>Matching and gap analysis keep source records attached, so every conclusion can be inspected.</p>
            <p>Refresh cadence and source coverage are visible throughout institutional pilots.</p>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function AudienceSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section className="border-t border-hairline bg-inset py-20 md:py-28" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Who it is for</Eyebrow>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audienceCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-hairline bg-ground p-5">
              <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
              <p className="mt-3 text-[14px] leading-7 text-ink-soft">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

function DevelopersSection() {
  const { reveal } = useHomeMotion()

  const developers = [
    {
      name: 'Dr. Ramandeep Singh',
      role: 'Professor & Deputy Dean',
      unit: 'Division of Research & Development',
      institution: 'Lovely Professional University, India',
      photo: '/team/dr-ramandeep-singh.jpg',
    },
  ]

  return (
    <motion.section id="developers" className="border-t border-hairline bg-ground py-20 md:py-28" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Developers</Eyebrow>
        <h2 className="mt-5 max-w-2xl text-[clamp(1.5rem,2.6vw,2rem)] font-semibold leading-[1.18] tracking-[-0.02em] text-ink">
          Built inside a research office, for research offices.
        </h2>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {developers.map((person) => (
            <div
              key={person.name}
              className="flex items-start gap-4 rounded-2xl border border-hairline bg-inset p-5"
            >
              <img
                src={person.photo}
                alt={person.name}
                width={80}
                height={100}
                loading="lazy"
                className="h-[100px] w-20 shrink-0 rounded-xl border border-hairline object-cover object-top"
              />
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink">{person.name}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-ink-soft">{person.role}</p>
                <p className="mt-1 text-[13px] leading-6 text-muted">{person.unit}</p>
                <p className="text-[13px] leading-6 text-muted">{person.institution}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

function FinalCTA() {
  const { goPrimary } = useCta()

  return (
    <section className="border-t border-hairline bg-ground px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl rounded-2xl border border-hairline bg-inset px-6 py-16 text-center md:px-16">
        <h2 className="mx-auto max-w-2xl text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
          Your next funded project is already in the data.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-8 text-ink-soft">
          See what AIGrantMentor finds for your research profile in under five minutes.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={goPrimary} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
            Run your first funding scan
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <Link href="/contact" className={`${BTN_SECONDARY} w-full sm:w-auto`}>
            Request an institutional demo
          </Link>
        </div>
        <p className="mt-6 text-[13px] text-muted">No credit card · Institution-wide pilots available</p>
      </div>
    </section>
  )
}

function SiteFooter() {
  const columns: Array<{ title: string; links: Array<[string, string]> }> = [
    {
      title: 'Platform',
      links: [
        ['Funding pipeline', '#pipeline'],
        ['Preparation studio', '#preparation'],
        ['AI review', '#evidence'],
      ],
    },
    {
      title: 'Intelligence',
      links: [
        ['Call matching', '#intelligence'],
        ['Funded projects', '#evidence'],
        ['Gap positioning', '#positioning'],
      ],
    },
    {
      title: 'Institutions',
      links: [
        ['Security', '#security'],
        ['Intelligence layer', '/funding/intelligence'],
        ['Pilots', '/contact'],
      ],
    },
    {
      title: 'Company',
      links: [
        ['Developers', '#developers'],
        ['Contact', '/contact'],
        ['Privacy', '/privacy'],
        ['Terms', '/terms'],
      ],
    },
  ]

  return (
    <footer className="border-t border-hairline bg-ground px-6 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_2fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-[13px] leading-6 text-muted">
            Funding intelligence for research offices, labs, and the people who write the proposals.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-4">
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="font-home-v2-mono text-[11px] uppercase tracking-[0.2em] text-muted">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('#') ? (
                      <a
                        href={href}
                        className="rounded text-[13px] text-ink-soft transition hover:text-cobalt-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
                      >
                        {label}
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className="rounded text-[13px] text-ink-soft transition hover:text-cobalt-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col gap-2 border-t border-hairline pt-6 text-[12px] text-muted md:flex-row md:items-center md:justify-between">
        <span>© 2026 AIGrantMentor. All rights reserved.</span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          All systems operational
        </span>
      </div>
    </footer>
  )
}
