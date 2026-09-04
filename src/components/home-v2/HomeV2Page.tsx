'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Check,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileCheck2,
  GraduationCap,
  LockKeyhole,
  MessageSquare,
  Search,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { MENTOR } from '@/lib/persona'
import {
  audienceCards,
  faqs,
  fundingMistakes,
  heroEligibility,
  heroMatches,
  heroPrecedents,
  journeySteps,
  platformStats,
  trainingSessions,
} from './data'
import AlertPreview from './AlertPreview'
import ChatPreview from './ChatPreview'
import CorpusTable from './CorpusTable'
import FieldMatrix from './FieldMatrix'
import FundedByFunder from './FundedByFunder'
import MappingDiagram from './MappingDiagram'
import OfficeBoard from './OfficeBoard'
import PatentSearch from './PatentSearch'
import ReviewScorecard from './ReviewScorecard'
import TemplateStack from './TemplateStack'
import { useHomeMotion } from './motion'

const BTN_BASE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ground'
const BTN_PRIMARY = `${BTN_BASE} bg-cobalt-600 text-white hover:bg-cobalt-700`
const BTN_SECONDARY = `${BTN_BASE} border border-hairline bg-ground text-ink-soft hover:border-muted-soft hover:bg-inset`

function useCta() {
  const router = useRouter()
  const { user } = useAuth()

  return {
    user,
    goPrimary: () => router.push(user ? '/dashboard' : '/register'),
    primaryLabel: user ? 'Go to my dashboard' : 'See my matched calls — free',
  }
}

export default function HomeV2Page() {
  return (
    <main className="min-h-screen bg-ground font-home-v2-sans text-ink antialiased">
      <SiteNav />
      <Hero />
      <StatsStrip />
      <MistakesSection />
      <JourneySection />
      <MappingSection />
      <AlertsSection />
      <AssistantSection />
      <ReviewerSection />
      <EvidenceSection />
      <PatentsSection />
      <TemplatesSection />
      <TrainingSection />
      <OfficeSection />
      <AudienceSection />
      <FaqSection />
      <FinalCTA />
      <SiteFooter />
    </main>
  )
}

/* ─── shared furniture ──────────────────────────────────────────────────── */

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`text-[15px] font-semibold tracking-[-0.01em] text-ink ${className}`}>
      <span className="text-cobalt-600">AI</span>GrantMentor
    </span>
  )
}

function Eyebrow({ children, tone = 'cobalt' }: { children: React.ReactNode; tone?: 'cobalt' | 'amber' }) {
  return (
    <p
      className={`font-home-v2-mono text-[11px] uppercase tracking-[0.22em] ${
        tone === 'amber' ? 'text-amber-700' : 'text-cobalt-600'
      }`}
    >
      {children}
    </p>
  )
}

/** Section headline + explanation. Every headline carries the message on its own. */
function SectionHead({
  eyebrow,
  title,
  body,
  tone = 'cobalt',
}: {
  eyebrow: string
  title: string
  body: string
  tone?: 'cobalt' | 'amber'
}) {
  return (
    <>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-[clamp(1.75rem,3.3vw,2.6rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <p className="mt-5 max-w-xl text-[17px] leading-8 text-ink-soft">{body}</p>
    </>
  )
}

/** A concrete worked example. Marked off so a skimmer can find the "for instance". */
function Example({ children, tone = 'cobalt' }: { children: React.ReactNode; tone?: 'cobalt' | 'amber' }) {
  return (
    <div
      className={`mt-8 rounded-xl border-l-[3px] px-5 py-4 ${
        tone === 'amber' ? 'border-l-amber-500 bg-amber-50/70' : 'border-l-cobalt-500 bg-cobalt-50/60'
      }`}
    >
      <p
        className={`font-home-v2-mono text-[10px] uppercase tracking-[0.18em] ${
          tone === 'amber' ? 'text-amber-800' : 'text-cobalt-700'
        }`}
      >
        For example
      </p>
      <p className="mt-2.5 text-[15px] leading-7 text-ink-soft">{children}</p>
    </div>
  )
}

function Benefits({ rows }: { rows: Array<[string, typeof Target]> }) {
  return (
    <ul className="mt-8 space-y-3.5">
      {rows.map(([label, Icon]) => (
        <li key={label} className="flex items-start gap-3">
          <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-cobalt-600" aria-hidden />
          <span className="text-[15px] leading-7 text-ink-soft">{label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ─── nav ───────────────────────────────────────────────────────────────── */

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

        <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex lg:gap-7">
          {[
            ['How it works', '#how'],
            ['Matching', '#mapping'],
            ['AI review', '#reviewer'],
            ['Patent search', '#patents'],
            ['Training', '#training'],
            ['For institutions', '#office'],
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
          <Link href="/register" className={`${BTN_PRIMARY} h-10 px-4`}>
            Start free
          </Link>
        </div>
      </div>
    </header>
  )
}

/* ─── hero ──────────────────────────────────────────────────────────────── */

function Hero() {
  const { primaryLabel, goPrimary } = useCta()
  const { reduced } = useHomeMotion()

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(29,78,216,0.06),transparent_72%)]"
      />
      <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-14 md:pb-20 md:pt-20">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-ground px-3 py-1 font-home-v2-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cobalt-600" />
            For researchers and research offices
          </span>

          <h1 className="mt-6 text-[clamp(2.25rem,5.4vw,4rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-ink">
            The grants you can actually win, found for you.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-8 text-ink-soft md:text-[19px] md:leading-9">
            AIGrantMentor reads your papers, matches you to live calls from ANRF, DST, DBT, ICMR and 1,000+ funding
            agencies and opportunities a year, tells you on WhatsApp the day one opens, and scores your draft against
            the agency&apos;s own rubric before you submit.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={goPrimary} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <Link href="/contact" className={`${BTN_SECONDARY} w-full sm:w-auto`}>
              Book an institution demo
            </Link>
          </div>

          <p className="mt-6 text-[13px] leading-6 text-muted">
            Free to start · No credit card · Your drafts are never used to train models
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
          Your matched calls
        </div>
        <div className="font-home-v2-mono text-[11px] text-muted-soft">
          214 calls scanned · 38 you are eligible for · 6 strong matches
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
                  {match.programme} · {match.closes}
                </p>
              </div>
              <div className="w-20 shrink-0 pt-0.5">
                <div className="text-right font-home-v2-mono text-xs font-semibold text-ink">{match.score}%</div>
                <div className="mt-2 h-1 rounded-full bg-nickel-100">
                  <div
                    className={`h-1 rounded-full ${match.tier === 'strong' ? 'bg-cobalt-600' : 'bg-nickel-300'}`}
                    style={{ width: `${match.score}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="bg-inset p-5 sm:p-6">
          <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">Why this one matched</p>
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
            <p className="font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              What they funded before
            </p>
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
    <section aria-label="Coverage" className="mx-auto max-w-6xl px-6 pb-4">
      <dl className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
        {platformStats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse bg-ground px-6 py-6">
            <dt className="mt-1.5 text-[13px] leading-5 text-muted">{stat.label}</dt>
            <dd className="font-home-v2-mono text-[26px] font-semibold tracking-tight text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ─── the problem, and where each fix lives ─────────────────────────────── */

function MistakesSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="mistakes" className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <Eyebrow>Why proposals fail</Eyebrow>
          <h2 className="mt-4 text-[clamp(1.75rem,3.3vw,2.6rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
            Most proposals lose before anyone reads the science.
          </h2>
          <p className="mt-5 text-[17px] leading-8 text-ink-soft">
            Seven mistakes account for most rejections, and none of them are about the quality of your research. Each one
            has a fix, and each fix is a part of this platform.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {fundingMistakes.map((item) => (
            <li
              key={item.n}
              className="flex flex-col rounded-2xl border border-hairline bg-ground p-5 transition hover:border-cobalt-200"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-home-v2-mono text-xs font-semibold text-nickel-400">{item.n}</span>
                <h3 className="text-[16px] font-semibold leading-6 text-ink">{item.mistake}</h3>
              </div>
              <p className="mt-3 text-[14px] leading-7 text-muted">{item.body}</p>

              <div className="mt-5 flex-1 border-t border-hairline pt-4">
                <a
                  href={item.href}
                  className="inline-flex items-center gap-1.5 rounded font-home-v2-mono text-[10px] uppercase tracking-[0.16em] text-cobalt-700 transition hover:text-cobalt-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500"
                >
                  {item.fixLabel}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </a>
                <p className="mt-2.5 text-[14px] leading-7 text-ink-soft">{item.fix}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </motion.section>
  )
}

/* ─── how it works ──────────────────────────────────────────────────────── */

function JourneySection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="how" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="gap-10 md:flex md:items-end md:justify-between">
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 text-[clamp(1.75rem,3.3vw,2.6rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
              You do the research. We do the chasing.
            </h2>
          </div>
          <p className="mt-5 max-w-sm text-[15px] leading-7 text-muted md:mt-0">
            Setup is one afternoon&apos;s coffee break. After that it runs whether you log in or not.
          </p>
        </div>

        <ol className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {journeySteps.map((step) => (
            <li key={step.step} className="border-t-2 border-cobalt-600 pt-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-home-v2-mono text-xs font-semibold text-cobalt-600">{step.step}</span>
                <span className="rounded-md bg-inset px-2 py-0.5 font-home-v2-mono text-[10px] text-muted">
                  {step.time}
                </span>
              </div>
              <p className="mt-4 font-home-v2-mono text-[11px] uppercase tracking-[0.18em] text-muted">{step.label}</p>
              <h3 className="mt-2.5 text-[17px] font-semibold leading-6 text-ink">{step.title}</h3>
              <p className="mt-2.5 text-[15px] leading-7 text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </motion.section>
  )
}

/* ─── 1. profile mapping ────────────────────────────────────────────────── */

function MappingSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="mapping" className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHead
            eyebrow="Profile mapping"
            title="We read your papers so you never read a call list again."
            body="Keyword search hands you two hundred calls and makes you the filter. Instead, your publications and research areas are placed on a 49-discipline map — and so is every incoming call. Fit becomes a number you can trust, and the call’s eligibility rules are checked against you before it ever reaches your list."
          />
          <Benefits
            rows={[
              ['Import from Scopus, ORCID or Google Scholar — you do not retype anything.', Database],
              ['Every call scored against your profile, with the terms it matched on shown.', Target],
              ['Eligibility checked line by line, so you never spend a month on a call you cannot enter.', ClipboardCheck],
            ]}
          />
          <Example>
            Dr. Rao uploads 14 papers on perovskite stability. She is mapped to materials science, renewable energy and
            condensed-matter physics. Of 214 open calls, 38 are ones she is eligible for and 6 score above 70%. She reads
            six, not two hundred.
          </Example>
        </div>

        <MappingDiagram />
      </div>
    </motion.section>
  )
}

/* ─── 2. alerts ─────────────────────────────────────────────────────────── */

function AlertsSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="alerts" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <AlertPreview />
        </div>

        <div className="order-1 lg:order-2">
          <SectionHead
            eyebrow="Alerts"
            title="The call comes to you, the day it opens."
            body="The most expensive thing you can do is find out about the right call in its last week. New calls are matched against every profile as they are published, and the people they fit are told immediately — on WhatsApp and by email, with the fit score, the deadline and the reason it matched."
          />
          <Benefits
            rows={[
              ['WhatsApp and email, whichever you actually read.', BellRing],
              ['Instantly, a daily summary, or one digest a week — your choice.', Check],
              ['Deadline reminders as the closing date approaches, so nothing lapses quietly.', AlertCircle],
            ]}
          />
          <Example>
            The ANRF Early Career call is published on a Tuesday morning. By 09:12 the eleven faculty it fits have it on
            their phones, with 38 days still on the clock — not eight.
          </Example>
        </div>
      </div>
    </motion.section>
  )
}

/* ─── 3. AI assistant ───────────────────────────────────────────────────── */

function AssistantSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="assistant" className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHead
            eyebrow={`Meet ${MENTOR.name}`}
            title="A mentor who has read every call, so you do not have to."
            body={`You have questions a search box cannot answer: who funds this, how much do they give, what did the funded ones do differently, am I eligible. Ask ${MENTOR.name} the way you would ask a senior colleague. She answers from the calls and the funded-project record — and shows the records behind every number, so you can check her.`}
          />
          <Benefits
            rows={[
              [`${MENTOR.name} cites real award records, never a general web search.`, MessageSquare],
              ['Compare agencies, amounts, success patterns and deadlines in one question.', Database],
              ['Ask about a specific call and she reads that call’s own documents back to you.', FileCheck2],
            ]}
          />
          <Example>
            &ldquo;Which agencies funded solid-state battery work in the last three years, and what did they pay?&rdquo;
            — four funders, 61 projects, average award per agency, and the one call that is still open.
          </Example>
        </div>

        <ChatPreview />
      </div>
    </motion.section>
  )
}

/* ─── 4. AI grant reviewer ──────────────────────────────────────────────── */

function ReviewerSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="reviewer" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <SectionHead
            eyebrow="AI grant reviewer"
            title="Get rejected here. It is much cheaper."
            body="A real panel gives you a decision and, if you are lucky, one line of feedback a year later. The AI reviewer marks your draft against that specific call’s criteria and weights, tells you which sentence is costing you points and what to put there instead — while you can still change it."
          />
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Benefits
              rows={[
                ['Scored on the call’s own criteria and weights, not a generic checklist.', Target],
                ['Every finding names the criterion it costs you points under.', ClipboardCheck],
                ['Re-run it after each edit and watch the weak criteria come up.', FileCheck2],
                ['Export the full review as a Word document for your co-PIs and your office.', FileCheck2],
              ]}
            />
            <Example>
              A first draft scores 2.8 out of 5. The reviewer finds an ageing claim with no test standard behind it,
              ₹18L of equipment tied to no work package, and impact written for scientists instead of for the mission
              the call funds. Three fixes, one afternoon, and the same draft scores 4.3.
            </Example>
          </div>

          <ReviewScorecard />
        </div>
      </div>
    </motion.section>
  )
}

/* ─── 5. the funded-project record ──────────────────────────────────────── */

function EvidenceSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="evidence" className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <SectionHead
            eyebrow="The evidence"
            title="50,000 projects your agencies have already paid for."
            body="Every match, every gap and every template on this page is grounded in the same thing: what Indian government agencies actually funded, in your field, in the last decade. Search it by agency, topic, year and amount — and see both the crowded ground and the pocket nobody has claimed."
          />
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <CorpusTable />
          <div className="grid gap-6">
            <FundedByFunder />
            <FieldMatrix />
          </div>
        </div>

        <Example>
          Perovskite synthesis has been funded 135 times in five years — that ground is crowded. Ageing of tandem
          modules in humid climates has been funded six times, and still sits inside the call&apos;s scope. That is
          where the same idea becomes fundable.
        </Example>
      </div>
    </motion.section>
  )
}

/* ─── 6. patent search ──────────────────────────────────────────────────── */

function PatentsSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="patents" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <PatentSearch />
        </div>

        <div className="order-1 lg:order-2">
          <SectionHead
            eyebrow="Patent search"
            title="Check the idea is new before you spend six months on it."
            body="Every panel scores novelty, and novel means novel against the patent record, not only against papers. Search granted and published patents for prior art on your idea before you commit — then use what you did not find as the novelty claim the proposal needs."
          />
          <Benefits
            rows={[
              ['Search by concept, not just keywords, and see what each hit actually overlaps with.', Search],
              ['Shortlist the closest prior art and keep it attached to the idea you are developing.', ShieldCheck],
              ['Turn the gap into a novelty paragraph a reviewer can check.', FileCheck2],
            ]}
          />
          <Example>
            A search on humid-climate encapsulation for tandem modules returns 34 Indian patents. The closest scores
            71% and covers silicon single-junction only — nothing reads on the tandem stack she is proposing. That
            absence is the novelty paragraph.
          </Example>
        </div>
      </div>
    </motion.section>
  )
}

/* ─── 7. templates ──────────────────────────────────────────────────────── */

function TemplatesSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="templates" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <SectionHead
            eyebrow="Proven templates"
            title="Start from a structure that has already been funded."
            body="A blank agency form tells you the section names and nothing about what belongs in them. These templates carry the structure of proposals that this agency has funded: how objectives were phrased, which annexures were attached, how the budget was tied to the work, and the sections where proposals usually get returned."
          />
        </div>

        <div className="mt-12">
          <TemplateStack />
        </div>
      </div>
    </motion.section>
  )
}

/* ─── 7. training ───────────────────────────────────────────────────────── */

function TrainingSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="training" className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHead
            tone="amber"
            eyebrow="Live training"
            title="Learn from the people who used to sit on the panel."
            body="Software can tell you what the rubric says. It cannot tell you what a review committee argues about at 4pm on the second day. We run regular sessions with retired agency scientists and former programme officers — one agency and one call type at a time, with live questions from your faculty."
          />
          <Benefits
            rows={[
              ['Sessions built around a specific agency and call, not general grant-writing advice.', GraduationCap],
              ['Led by retired scientists and programme officers from ANRF, DST, DBT and ICMR.', Users],
              ['Live Q&A, and the recording stays available to everyone at your institution.', Check],
            ]}
          />
        </div>

        <ul className="space-y-3">
          {trainingSessions.map((session) => (
            <li key={session.title} className="rounded-2xl border border-hairline bg-ground p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-amber-100 px-2 py-0.5 font-home-v2-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                  {session.agency}
                </span>
                <span className="font-home-v2-mono text-[11px] text-muted">{session.cadence}</span>
              </div>
              <h3 className="mt-3 text-[16px] font-semibold leading-6 text-ink">{session.title}</h3>
              <p className="mt-2 flex items-center gap-2 text-[14px] leading-6 text-ink-soft">
                <GraduationCap className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                {session.host}
              </p>
            </li>
          ))}
          <li className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-5 text-[14px] leading-7 text-amber-900">
            Institution plans include the full session calendar, recordings, and a session run for your campus on the
            agency your faculty apply to most.
          </li>
        </ul>
      </div>
    </motion.section>
  )
}

/* ─── 8. research administration ────────────────────────────────────────── */

function OfficeSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="office" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <OfficeBoard />
        </div>

        <div className="order-1 lg:order-2">
          <SectionHead
            eyebrow="Research administration"
            title="Your research office finally sees the whole board."
            body="A DSR office usually learns about a submission when someone needs a signature. Here, every open call is already matched to the faculty it fits, assigned to a school, and tracked from claim to submission — so the office spends its time chasing the calls nobody has taken, not building spreadsheets."
          />
          <Benefits
            rows={[
              ['Assign calls to schools and faculty, with accept, decline and follow-up tracked.', Users],
              ['See where the drop-off is: matched, claimed, submitted, school by school.', Target],
              ['Automatic reminders and weekly digests instead of chasing people by email.', BellRing],
              ['Report submissions by school and by funding window, on your own academic calendar.', ClipboardCheck],
            ]}
          />
          <Example>
            A DST call closes in twelve days. Nine faculty match it and nobody has claimed it. The office sees that on
            its board on day one, not on day eleven.
          </Example>
        </div>
      </div>
    </motion.section>
  )
}

/* ─── audience ──────────────────────────────────────────────────────────── */

function AudienceSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section className="border-t border-hairline bg-inset py-20 md:py-24" {...reveal}>
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Who it is for</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-[clamp(1.5rem,2.6vw,2rem)] font-semibold leading-[1.18] tracking-[-0.02em] text-ink">
          One platform, four very different jobs.
        </h2>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audienceCards.map((card) => (
            <div key={card.title} className="flex flex-col rounded-2xl border border-hairline bg-ground p-5">
              <h3 className="text-[15px] font-semibold text-ink">{card.title}</h3>
              <p className="mt-3 flex-1 text-[14px] leading-7 text-ink-soft">{card.body}</p>
              <p className="mt-5 border-t border-hairline pt-4 font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-cobalt-700">
                {card.cta}
              </p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

/* ─── objections ────────────────────────────────────────────────────────── */

function FaqSection() {
  const { reveal } = useHomeMotion()

  return (
    <motion.section id="faq" className="border-t border-hairline bg-ground py-20 md:py-24" {...reveal}>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <Eyebrow>Before you ask</Eyebrow>
          <h2 className="mt-4 text-[clamp(1.75rem,3.3vw,2.6rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
            The five questions everyone asks.
          </h2>
          <p className="mt-5 flex items-start gap-2.5 text-[15px] leading-7 text-muted">
            <LockKeyhole className="mt-1 h-4 w-4 shrink-0 text-cobalt-600" aria-hidden />
            Tenant-isolated by design. Encrypted in transit and at rest. SSO on request.
          </p>
        </div>

        <div className="divide-y divide-hairline border-t border-hairline">
          {faqs.map((faq) => (
            <details key={faq.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded text-[16px] font-medium leading-7 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500">
                {faq.q}
                <ChevronDown
                  className="mt-1 h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 max-w-2xl pr-8 text-[15px] leading-7 text-ink-soft">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </motion.section>
  )
}

/* ─── close ─────────────────────────────────────────────────────────────── */

function FinalCTA() {
  const { primaryLabel, goPrimary } = useCta()

  return (
    <section className="border-t border-hairline bg-ground px-6 py-20 md:py-24">
      <div className="mx-auto max-w-6xl rounded-2xl border border-hairline bg-inset px-6 py-16 text-center md:px-16">
        <h2 className="mx-auto max-w-2xl text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold leading-[1.14] tracking-[-0.02em] text-ink">
          Your next funded project is already in the data.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-8 text-ink-soft">
          Add your papers and see the calls you match, the money your agencies have already paid for work like yours,
          and what a reviewer would say about your draft.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={goPrimary} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
            {primaryLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <Link href="/contact" className={`${BTN_SECONDARY} w-full sm:w-auto`}>
            Book an institution demo
          </Link>
        </div>
        <p className="mt-6 text-[13px] text-muted">Free to start · No credit card · Campus-wide pilots available</p>
      </div>
    </section>
  )
}

function SiteFooter() {
  const columns: Array<{ title: string; links: Array<[string, string]> }> = [
    {
      title: 'For researchers',
      links: [
        ['Matched calls', '#mapping'],
        ['WhatsApp and email alerts', '#alerts'],
        ['AI funding assistant', '#assistant'],
        ['AI grant reviewer', '#reviewer'],
      ],
    },
    {
      title: 'Evidence',
      links: [
        ['Funded-project record', '#evidence'],
        ['Patent search', '#patents'],
        ['Agency templates', '#templates'],
        ['Live training', '#training'],
      ],
    },
    {
      title: 'For institutions',
      links: [
        ['Research administration', '#office'],
        ['Security and data', '#faq'],
        ['Book a demo', '/contact'],
      ],
    },
    {
      title: 'Company',
      links: [
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
            Funding intelligence for research offices, labs, and the people who write the proposals. Built inside a
            university research office.
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
