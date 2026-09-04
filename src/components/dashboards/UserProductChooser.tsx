'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { ProductModuleKey } from '@/lib/access/modules'
import { GRANT_PREP_ENABLED } from '@/lib/access/killSwitches'
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  ClipboardList,
  Compass,
  FileSearch,
  FileText,
  Filter,
  GraduationCap,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Search,
  ShieldCheck,
  Target,
  UserCircle,
  Users,
  Sparkles
} from 'lucide-react'
import GettingStartedCard from '@/components/dashboards/GettingStartedCard'
import WorkshopAccessBanner from '@/components/dashboards/WorkshopAccessBanner'

interface ProductOption {
  title: string
  description: string
  href: string
  icon: typeof Search
  tag: string
  /** Product module this card maps to (for plan gating). Undefined = always available. */
  moduleKey?: ProductModuleKey
  /** Lowest tier that unlocks it, shown on the locked overlay. */
  minTier?: string
}

interface ProductGroup {
  /** Section eyebrow. */
  title: string
  /** One line explaining what this band of the workspace is for. */
  caption: string
  options: ProductOption[]
}

const productGroups: ProductGroup[] = [
  {
    title: 'Discover',
    caption: 'Find the calls worth your time',
    options: [
      {
        // First in Discover on purpose: it is the only card that needs nothing
        // typed. The finder and the chatbot both ask a researcher to describe
        // work the system has already embedded.
        title: 'Funding in My Areas',
        description:
          'Calls matched to your profile, saved areas and papers. No searching — just open it.',
        href: '/funding/my-areas',
        icon: Target,
        tag: 'For you',
        moduleKey: 'FUNDING_DIRECTORY',
        minTier: 'Starter'
      },
      {
        title: 'Fund Finder',
        description:
          'Search the funding directory with AI ranking and eligibility-aware matching.',
        href: '/finder',
        icon: Search,
        tag: 'Discovery',
        moduleKey: 'FUNDING_DIRECTORY',
        minTier: 'Starter'
      },
      {
        title: 'AI Funding Chatbot',
        description:
          'Ask for calls in plain language and get grounded answers with citations.',
        href: '/finder?tab=ai',
        icon: MessageSquare,
        tag: 'Assistant',
        moduleKey: 'FUNDING_CHAT',
        minTier: 'Pro'
      },
      {
        title: 'Funding Intelligence',
        description:
          'Deep call intelligence, document Q&A, and idea analysis over the funding corpus.',
        href: '/funding/intelligence',
        icon: Sparkles,
        tag: 'Intelligence',
        moduleKey: 'FUNDING_INTELLIGENCE',
        minTier: 'Pro'
      },
      {
        title: 'Patent Search',
        description:
          'Search patents related to your proposal by meaning and build a prior-art shortlist you can cite.',
        href: '/funding/intelligence/patents',
        icon: FileSearch,
        tag: 'Intelligence',
        moduleKey: 'FUNDING_INTELLIGENCE',
        minTier: 'Pro'
      }
    ]
  },
  {
    title: 'Build',
    caption: 'Draft, review, and get the proposal out',
    options: [
      {
        title: 'Grant Writer',
        description:
          'Build and manage grant applications with structured, AI-assisted drafting.',
        href: '/projects',
        icon: FileText,
        tag: 'Writing',
        moduleKey: 'GRANT_STUDIO',
        minTier: 'Pro'
      },
      {
        title: 'Grant Reviewer',
        description:
          'Run structured reviews, context summaries, and generate final review reports.',
        href: '/reviewer',
        icon: ShieldCheck,
        tag: 'Analysis',
        moduleKey: 'GRANT_REVIEW',
        minTier: 'Pro'
      }
    ]
  },
  {
    title: 'Calibrate',
    caption: 'What the system knows about your research',
    options: [
      {
        title: 'Researcher Profile',
        description:
          'Define your profile and eligibility so discovery is filtered to what you can actually win.',
        href: '/profile/researcher',
        icon: UserCircle,
        tag: 'Identity'
      },
      {
        title: 'Research Fit',
        description:
          'Manage research areas and key publications that drive match quality.',
        href: '/profile/research-fit',
        icon: Compass,
        tag: 'Focus'
      }
    ]
  }
]

const adminGroup: ProductGroup = {
  title: 'Administer',
  caption: 'Your workspace and the people in it',
  options: [
    {
      title: 'Faculty & Organization',
      description: 'Upload your faculty roster (CSV/Excel) and build your org structure.',
      href: '/tenant-admin/faculty',
      icon: GraduationCap,
      tag: 'Admin'
    },
    {
      title: 'Funding Department',
      description: 'Staff the sponsored-research office and assign schools to its members.',
      href: '/tenant-admin/funding-dept',
      icon: Compass,
      tag: 'Admin'
    },
    {
      title: 'Team & Workspace Admin',
      description: 'Invite members, manage access codes, and oversee workspace usage.',
      href: '/admin',
      icon: Users,
      tag: 'Admin'
    }
  ]
}

/**
 * Shown to funding department members. Membership is not a role, so this group
 * is gated on the server's answer rather than on anything in the JWT.
 */
const fundingDeptGroup: ProductGroup = {
  title: 'Funding department',
  caption: 'The calls you are placing, and the people you place them with',
  options: [
    {
      title: 'My Worklist',
      description: 'Deadlines, overdue calls and the follow-ups you scheduled.',
      href: '/funding-dept',
      icon: Compass,
      tag: 'Department'
    },
    {
      title: "My Schools' Calls",
      description: "Open calls matching your schools' disciplines that still need somebody.",
      href: '/funding-dept/queue',
      icon: Filter,
      tag: 'Department'
    },
    {
      title: 'Calls I Assigned',
      description: 'Track replies and record what you did about them.',
      href: '/funding-dept/assignments',
      icon: ClipboardList,
      tag: 'Department'
    },
    {
      title: 'Faculty in My Schools',
      description: 'The researchers you look after, and how matchable their profiles are.',
      href: '/funding-dept/faculty',
      icon: GraduationCap,
      tag: 'Department'
    },
    {
      title: 'My Schools at a Glance',
      description: 'What is pending, what has gone quiet, and what has been submitted.',
      href: '/funding-dept/accountability',
      icon: BarChart3,
      tag: 'Department'
    }
  ]
}

/**
 * Shown to a Dean or Head of Department. Headship is an OrgUnitManager grant,
 * not a role, so this is gated on the server's answer for the same reason the
 * department group is — and until now these people had report access at the API
 * with no way to reach it.
 */
const schoolHeadGroup: ProductGroup = {
  title: 'My school',
  caption: 'What funding reached your faculty, and what they did with it',
  options: [
    {
      title: 'My School',
      description: 'Calls open to your school, who is on them, and how your faculty respond.',
      href: '/school-head',
      icon: Building2,
      tag: 'Head'
    },
    {
      title: 'Assignments I Manage',
      description: 'Every call sent to your faculty, with its status and deadline.',
      href: '/assignments',
      icon: ClipboardList,
      tag: 'Head'
    },
    {
      title: 'Reports & CSV',
      description: 'Allocation, deadlines and outcomes for your branch, downloadable.',
      href: '/tenant-admin/grant-dashboard',
      icon: BarChart3,
      tag: 'Head'
    }
  ]
}

/* ── A single readout in the status strip ─────────────────────────────────── */
function Readout({
  label,
  value,
  pending,
  live
}: {
  label: string
  value: string
  pending?: boolean
  live?: boolean
}) {
  return (
    // Negative offsets collapse each cell's border into its neighbour's (and
    // into the panel edge), so the strip reads as one ruled grid at any
    // column count.
    <div className="-ml-px -mt-px flex min-w-0 flex-col gap-1.5 border-l border-t border-nickel-200 px-5 py-3.5">
      <span className="nk-eyebrow">{label}</span>
      {pending ? (
        <span className="h-[19px] w-16 animate-pulse rounded bg-nickel-100" aria-hidden />
      ) : (
        <span className="flex items-center gap-2">
          {live && <span className="nk-lamp" aria-hidden />}
          <span className="nk-readout-sm truncate">{value}</span>
        </span>
      )}
    </div>
  )
}

/* ── Product card ─────────────────────────────────────────────────────────── */
function ProductCard({
  option,
  index,
  locked
}: {
  option: ProductOption
  index: number
  locked?: boolean
}) {
  const Icon = option.icon
  const tier = option.minTier || 'Pro'

  if (locked) {
    return (
      <div
        className="nk-panel nk-hatch nk-enter flex h-full flex-col p-5"
        style={{ '--nk-i': index } as React.CSSProperties}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="nk-tile h-10 w-10 opacity-60">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="nk-badge nk-badge-warn">
            <Lock className="h-3 w-3" aria-hidden />
            {tier}
          </span>
        </div>

        <div className="mt-4 flex-1">
          <h3 className="nk-title text-nickel-600">{option.title}</h3>
          <p className="mt-1.5 text-[13px] leading-5 text-nickel-500">{option.description}</p>
        </div>

        <div className="nk-rule mt-4 flex items-center justify-between gap-3 pt-3">
          <span className="nk-eyebrow">{option.tag}</span>
          <span className="text-[12.5px] font-medium text-nickel-500">
            Requires {tier}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Link
      href={option.href}
      style={{ '--nk-i': index } as React.CSSProperties}
      className="nk-panel nk-enter group flex h-full flex-col p-5 transition duration-150
                 hover:-translate-y-px hover:border-nickel-300 hover:shadow-nk-lift
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                 focus-visible:outline-cobalt-600 motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="nk-tile h-10 w-10 transition duration-150 group-hover:nk-tile-live">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md text-nickel-300
                     transition duration-150 group-hover:bg-cobalt-50 group-hover:text-cobalt-600"
          aria-hidden
        >
          <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
      </div>

      <div className="mt-4 flex-1">
        <h3 className="nk-title">{option.title}</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-nickel-500">{option.description}</p>
      </div>

      <div className="nk-rule mt-4 flex items-center justify-between gap-3 pt-3">
        <span className="nk-eyebrow">{option.tag}</span>
        <span className="text-[12.5px] font-medium text-nickel-500 transition-colors duration-150 group-hover:text-cobalt-700">
          Open
        </span>
      </div>
    </Link>
  )
}

export default function UserProductChooser() {
  const { user } = useAuth()
  const { isTenantAdmin } = useRoleAccess()
  const { me: fundingDept } = useFundingDeptMe()
  const { hasModule, plan, isLoading: entitlementsLoading, isPlatform } = useEntitlements()
  // Grant Prep is withdrawn from the product: its card disappears entirely
  // rather than rendering as locked.
  const visibleProductGroups = productGroups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => GRANT_PREP_ENABLED || option.moduleKey !== 'GRANT_STUDIO'),
    }))
    .filter((group) => group.options.length > 0)
  const groups = [
    ...visibleProductGroups,
    ...(fundingDept.isMember ? [fundingDeptGroup] : []),
    ...(fundingDept.managedUnits.length > 0 ? [schoolHeadGroup] : []),
    ...(isTenantAdmin ? [adminGroup] : []),
  ]

  // A card is locked when its module is not in the tenant's plan. While
  // entitlements load (or for platform/super-admin users) nothing is locked.
  const isOptionLocked = (option: ProductOption) =>
    Boolean(option.moduleKey) && !entitlementsLoading && !isPlatform && !hasModule(option.moduleKey!)

  const firstName =
    user?.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, (c: string) => c.toUpperCase()) ?? ''

  // Local time is only correct on the client — render it after hydration so the
  // server and the browser never disagree.
  const [clock, setClock] = useState<string | null>(null)
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      )
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [])

  // Count modules, not cards: two cards can sit on one module (Funding
  // Intelligence + Patent Search), and the readout is "modules unlocked".
  const gatedModules = Array.from(
    new Set(visibleProductGroups.flatMap(g => g.options).map(o => o.moduleKey).filter((key): key is ProductModuleKey => Boolean(key)))
  )
  const unlockedCount = isPlatform
    ? gatedModules.length
    : gatedModules.filter(key => hasModule(key)).length

  const planLabel = isPlatform ? 'Platform' : plan?.name || 'Trial'

  // Cards animate in document order across every group, so the stagger reads as
  // one sweep down the page rather than restarting per section.
  let cardIndex = 0

  return (
    <div className="nk-ground nk-wash">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] nk-grid" aria-hidden />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {/* ── Masthead ───────────────────────────────────────────────────── */}
        <header className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="nk-eyebrow">Grapsi · Research Funding Workspace</p>
              <h1 className="mt-2.5 text-[30px] font-semibold leading-tight tracking-[-0.025em] text-nickel-900 sm:text-[34px]">
                Welcome back{firstName ? <>, <span className="text-cobalt-700">{firstName}</span></> : ''}
              </h1>
              <p className="mt-2 max-w-xl text-[14px] leading-6 text-nickel-500">
                Every module below reads from the same profile and the same funding corpus.
                Sharpen one and the rest get better.
              </p>
            </div>

            <div className="nk-mono flex items-center gap-2 text-nickel-500" suppressHydrationWarning>
              <span className="nk-lamp" aria-hidden />
              <span>{clock ?? '--:--'} local</span>
            </div>
          </div>

          <div className="nk-ticks mt-6" aria-hidden />
        </header>

        {/* ── Status strip ───────────────────────────────────────────────── */}
        <div className="nk-panel mb-8 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
          <Readout label="Plan" value={planLabel} pending={entitlementsLoading} live />
          <Readout
            label="Modules unlocked"
            value={`${unlockedCount} / ${gatedModules.length}`}
            pending={entitlementsLoading}
          />
          <Readout label="Workspace" value={user?.ati_id || '—'} />
          <Readout label="Signed in as" value={user?.email || '—'} />
        </div>

        <WorkshopAccessBanner />

        <GettingStartedCard />

        {/* Near the top on purpose: the reader who does not recognise any card
            below needs this before they start guessing at the cards. */}
        <Link
          href="/guide"
          className="nk-panel-quiet group mb-8 flex items-center justify-between gap-4 p-4 transition duration-150
                     hover:border-nickel-300 hover:bg-white
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-cobalt-600"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="nk-tile h-9 w-9">
              <Compass className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-nickel-700">Where everything is</p>
              <p className="truncate text-[12.5px] text-nickel-500">
                Every screen in the product, what it is for, and who can open it
              </p>
            </div>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-nickel-300 transition duration-150 group-hover:text-cobalt-600"
            aria-hidden
          />
        </Link>

        {/* ── Module bands ───────────────────────────────────────────────── */}
        <div className="space-y-10">
          {groups.map(group => (
            <section key={group.title}>
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="nk-eyebrow text-nickel-700">{group.title}</h2>
                <span className="h-px flex-1 bg-nickel-200" aria-hidden />
                <p className="text-[12.5px] text-nickel-500">{group.caption}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.options.map(option => (
                  <ProductCard
                    key={option.title}
                    option={option}
                    index={cardIndex++}
                    locked={isOptionLocked(option)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* ── Escape hatch ───────────────────────────────────────────────── */}
        <Link
          href="/dashboard/workspace"
          className="nk-panel-quiet group mt-10 flex items-center justify-between gap-4 p-4 transition duration-150
                     hover:border-nickel-300 hover:bg-white
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-cobalt-600"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="nk-tile h-9 w-9">
              <LayoutDashboard className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-nickel-700">Classic workspace</p>
              <p className="truncate text-[12.5px] text-nickel-500">
                The original dashboard, with uploaded calls and quick actions
              </p>
            </div>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-nickel-300 transition duration-150 group-hover:text-cobalt-600"
            aria-hidden
          />
        </Link>
      </div>
    </div>
  )
}
