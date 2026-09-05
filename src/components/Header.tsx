'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useEntitlements } from '@/hooks/useEntitlements'
import { BrandLockup } from '@/components/ui/BrandMark'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { Library, Sparkles } from 'lucide-react'
import NotificationBell from '@/components/notifications/NotificationBell'

/**
 * Menu model: sections hold groups, groups hold entries. The menu renders it as
 * a multi-level flyout, so a person only ever reads one short list at a time.
 */
interface MenuEntry {
  href: string
  icon: string
  title: string
  description?: string
}

interface MenuSubgroup {
  label: string
  items: MenuEntry[]
}

interface MenuSectionDef {
  key: string
  label: string
  icon: string
  /** One line saying what the whole section is for. */
  blurb: string
  groups: MenuSubgroup[]
}

/** Flyout panel width in pixels; mirrors the `w-64` on the panels themselves. */
const PANEL_WIDTH_PX = 256

/** What the hover hint is currently describing, and where to draw it. */
interface MenuHintState {
  title: string
  description: string
  top: number
  right: number
}

function hintFrom(element: HTMLElement, title: string, description?: string): MenuHintState | null {
  if (!description || typeof window === 'undefined') return null
  const rect = element.getBoundingClientRect()
  return {
    title,
    description,
    // Drawn to the left of the row it describes, clamped so a row near the
    // bottom of a long menu does not push the hint off screen.
    top: Math.min(rect.top, Math.max(8, window.innerHeight - 140)),
    right: Math.max(8, window.innerWidth - rect.left + 8),
  }
}

/**
 * The hover hint.
 *
 * Rows carry only their name now, so the description has to live somewhere: it
 * appears beside whatever the pointer is on. Positioned `fixed` from the row's
 * own rect rather than absolutely inside the panel, because every panel
 * scrolls and an absolutely positioned hint would be clipped by that scroll.
 * `title` on each row keeps the same text available to keyboard and screen
 * readers, and on touch devices where nothing hovers.
 */
function MenuHint({ hint }: { hint: MenuHintState | null }) {
  if (!hint) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] hidden w-64 rounded-md border border-gpt-gray-200 bg-white p-2.5 shadow-lg sm:block"
      style={{ top: hint.top, right: hint.right }}
    >
      <p className="text-xs font-semibold text-gpt-gray-800">{hint.title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-gpt-gray-500">{hint.description}</p>
    </div>
  )
}

/** A leaf: one link. One line, with its explanation on hover. */
function MenuItem({
  href,
  icon,
  title,
  description,
  onClick,
  onHint,
}: {
  href: string
  icon: string
  title: string
  description?: string
  onClick: () => void
  onHint: (hint: MenuHintState | null) => void
}) {
  return (
    <Link
      href={href}
      title={description}
      className="flex w-full items-center space-x-2 px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50"
      onClick={onClick}
      onMouseEnter={(event) => onHint(hintFrom(event.currentTarget, title, description))}
      onMouseLeave={() => onHint(null)}
      onFocus={(event) => onHint(hintFrom(event.currentTarget, title, description))}
      onBlur={() => onHint(null)}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </Link>
  )
}

/**
 * A row that opens the next level to its left.
 *
 * Leftwards because the menu is anchored to the right edge of the window;
 * opening rightwards would run the panel off screen. Below `sm` the panel
 * drops inline underneath the row instead, since a flyout needs a pointer and
 * room, and a phone has neither.
 */
function MenuBranch({
  icon,
  label,
  description,
  open,
  onOpen,
  onClose,
  onToggle,
  onHint,
  count,
  clip = true,
  children,
}: {
  icon?: string
  label: string
  description?: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  onToggle: () => void
  onHint: (hint: MenuHintState | null) => void
  count?: number
  /**
   * Whether this panel may scroll on a desktop pointer. A panel that scrolls
   * also clips, and a clipped panel swallows the next level's flyout - so a
   * branch whose children are themselves branches must not scroll.
   */
  clip?: boolean
  children: React.ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(false)

  /**
   * Panels open leftwards from a menu anchored to the right edge, so by the
   * third level there may be no room left. Measure once on open and flip that
   * panel to the other side rather than letting it run off screen.
   */
  useEffect(() => {
    if (!open || !rowRef.current || typeof window === 'undefined') {
      setFlip(false)
      return
    }
    const rect = rowRef.current.getBoundingClientRect()
    setFlip(rect.left < PANEL_WIDTH_PX + 8)
  }, [open])

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={() => {
        onClose()
        onHint(null)
      }}
    >
      {/* A branch's own explanation is printed at the top of the panel it opens,
          not floated beside it: the panel occupies exactly the space a floating
          hint would, and the two covered each other. */}
      <button
        type="button"
        onClick={onToggle}
        title={description}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gpt-gray-50 ${
          open ? 'bg-gpt-gray-50' : ''
        }`}
        onMouseEnter={() => onHint(null)}
      >
        <span className="flex min-w-0 items-center space-x-2">
          {icon ? <span className="text-sm leading-none">{icon}</span> : null}
          <span className="truncate text-sm font-medium text-gpt-gray-800">{label}</span>
        </span>
        <span className="ml-2 flex shrink-0 items-center space-x-1.5">
          {typeof count === 'number' ? (
            <span className="rounded-full bg-gpt-gray-100 px-1.5 text-[10px] font-semibold text-gpt-gray-500">
              {count}
            </span>
          ) : null}
          <svg
            className={`h-3 w-3 text-gpt-gray-400 transition-transform duration-200 max-sm:${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          className={`absolute top-0 z-10 max-h-[70vh] w-64 overflow-y-auto overscroll-contain rounded-lg border border-gpt-gray-200 bg-white py-1 shadow-lg max-sm:static max-sm:mx-0 max-sm:w-full max-sm:rounded-none max-sm:border-0 max-sm:border-t max-sm:bg-gpt-gray-50/60 max-sm:shadow-none ${
            flip ? 'left-full ml-1' : 'right-full mr-1'
          } ${clip ? '' : 'sm:max-h-none sm:overflow-visible'}`}
        >
          {description ? (
            <div className="mb-1 border-b border-gpt-gray-100 px-3 pb-2 pt-1">
              <p className="text-xs font-semibold text-gpt-gray-800">{label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-gpt-gray-500">{description}</p>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  )
}

export default function Header() {
  const { user, logout, isLoading } = useAuth()
  const { me: fundingDept } = useFundingDeptMe()
  // Plan-gated product modules: hide nav entries the tenant's plan does not
  // include so users don't click into a 403 (enforcement stays server-side).
  const { hasModule } = useEntitlements()
  const canUseGrantStudio = hasModule('GRANT_STUDIO')
  const canUseFundingIntelligence = hasModule('FUNDING_INTELLIGENCE')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const menuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const platformPermissions = user?.platformPermissions || []
  const isPlatformAdmin = Boolean(user?.roles?.includes('ADMIN') && user?.ati_id === 'PLATFORM')
  const canOpenPlatformFunding =
    Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER') || isPlatformAdmin) ||
    platformPermissions.includes('platform.support.read') ||
    platformPermissions.includes('funding.operations.write') ||
    platformPermissions.includes('funding.publisher.write')

  const [openSection, setOpenSection] = useState<string | null>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [hint, setHint] = useState<MenuHintState | null>(null)

  /**
   * The menu, as a hierarchy: the sections a person actually holds, each with
   * labelled sub-blocks. Everything is role- and plan-gated here so a link
   * never leads to a 403 - the server enforces the same rules again.
   */
  const menuSections = useMemo<MenuSectionDef[]>(() => {
    if (!user) return []

    const roles: string[] = (user.roles as string[]) || []
    const has = (...wanted: string[]) => wanted.some((role) => roles.includes(role))
    const isOwnerOrAdmin = has('OWNER', 'ADMIN')
    const isAuditor = has('QUALITY_AUDITOR')
    const isSuperAdmin = has('SUPER_ADMIN', 'SUPER_ADMIN_VIEWER')
    const sections: MenuSectionDef[] = []

    sections.push({
      key: 'workspace',
      label: 'My workspace',
      icon: '\u{1F9ED}',
      blurb: 'Your own screens: funding, projects and reading',
      groups: [
        {
          label: 'Everyday',
          items: [
            { href: '/dashboard', icon: '\u{1F3E0}', title: 'Dashboard', description: 'Your home screen and what is waiting on you' },
            { href: '/guide', icon: '\u{1F5FA}\uFE0F', title: 'Where everything is', description: 'A directory of every screen and who it is for' },
            { href: '/funding/my-areas', icon: '\u{1F3AF}', title: 'Funding in My Areas', description: 'Open calls matching your profile and papers, no query needed' },
            ...(canUseGrantStudio
              ? [{ href: '/projects', icon: '\u{1F4C1}', title: 'Projects', description: 'Your grant projects and their drafting workspaces' }]
              : []),
            ...(canUseFundingIntelligence
              ? [
                  { href: '/funding/intelligence', icon: '\u2728', title: 'Funding Intelligence', description: 'Test an idea against funded work and find the openings' },
                  { href: '/funding/intelligence/patents', icon: '\u{1F50E}', title: 'Patent Search', description: 'Search the patent corpus and shortlist what matters' },
                ]
              : []),
            { href: '/assignments', icon: '\u{1F4CB}', title: 'Assignments', description: 'Calls assigned to you, with their deadlines and follow-ups' },
            { href: '/proposals', icon: '\u{1F4DD}', title: 'My Proposals', description: 'Your applications: drafts, the reviews sent back, budget and submission' },
            ...(isFeatureEnabled('ENABLE_PAPER_WRITING_UI')
              ? [{ href: '/library', icon: '\u{1F4DA}', title: 'Reference Library', description: 'Shared references and reading across your work' }]
              : []),
            { href: '/personas', icon: '\u270D\uFE0F', title: 'Writing Personas', description: 'The voices the writing tools can draft in' },
          ],
        },
      ],
    })

    // Dean / Head of Department. Headship is an org-unit grant rather than a
    // role, so like department membership it has to be answered by the server.
    if (fundingDept.managedUnits.length > 0) {
      sections.push({
        key: 'school',
        label: 'My school',
        icon: '\u{1F3EB}',
        blurb: 'Funding reaching your faculty, and how they respond',
        groups: [
          {
            label: 'My school',
            items: [
              { href: '/school-head', icon: '\u{1F3EB}', title: 'School home', description: 'Calls reaching your faculty, and how they are responding' },
              { href: '/school-head/proposals', icon: '\u{1F4DD}', title: 'Proposals from My School', description: 'What your faculty are applying for, and where each application stands' },
            ],
          },
        ],
      })
    }

    if (fundingDept.isMember) {
      sections.push({
        key: 'funding-dept',
        label: 'Funding department',
        icon: '\u{1F9F0}',
        blurb: 'Your worklist, your schools and the chasing',
        groups: [
          {
            label: 'Day to day',
            items: [
              { href: '/funding-dept', icon: '\u{1F9ED}', title: 'My Worklist', description: 'Deadlines, follow-ups due and open calls in your schools' },
              { href: '/funding-dept/queue', icon: '\u{1F9EA}', title: "My Schools' Calls", description: 'Open calls matching your schools, and what is still unassigned' },
              { href: '/funding-dept/chase', icon: '\u23F0', title: 'Chase Queue', description: 'Everything overdue, unanswered or gone quiet, worst first' },
              { href: '/funding-dept/proposals', icon: '\u{1F4DD}', title: 'Proposal Desk', description: 'Every application in your schools: drafts, reviews, clearance and the agency outcome' },
              { href: '/funding-dept/assignments', icon: '\u{1F5C2}\uFE0F', title: 'Calls I Assigned', description: 'Track, chase and update the assignments you handed out' },
              { href: '/funding-dept/faculty', icon: '\u{1F393}', title: 'Faculty in My Schools', description: 'Directory of the faculty your coverage lets you assign to' },
              { href: '/researcher-matching', icon: '\u{1F3AF}', title: 'Find Researchers', description: 'Match faculty to a funding call and assign or circulate it' },
              {
                href: '/funding-dept/accountability',
                icon: '\u{1F4CA}',
                title: fundingDept.isHead ? 'Accountability' : 'My Schools at a Glance',
                description: fundingDept.isHead
                  ? 'Member by member: what is pending, what is late, what has been submitted'
                  : 'Pendency, silent allocations and submissions across the schools you cover',
              },
            ],
          },
          ...(fundingDept.isHead
            ? [
                {
                  label: 'Head of department',
                  items: [
                    { href: '/funding-dept/overview', icon: '\u{1F4CB}', title: 'Department Overview', description: "Each member's workload, school coverage and gaps" },
                    { href: '/funding-dept/calls', icon: '\u{1F4C8}', title: 'Call Funnel', description: 'Every call with matched, assigned and submitted counts' },
                  ],
                },
              ]
            : []),
        ],
      })
    }

    // Oversight for an auditor who is not an admin. Admins reach the same two
    // screens inside Administration, so nobody sees them listed twice.
    if (isAuditor && !isOwnerOrAdmin) {
      sections.push({
        key: 'oversight',
        label: 'Oversight',
        icon: '\u{1F50D}',
        blurb: 'Read the AI output your organization has produced',
        groups: [
          {
            label: 'Oversight',
            items: [
              { href: '/tenant-admin/reports', icon: '\u{1F5C4}\uFE0F', title: 'Report Archive', description: 'Every grant-reviewer and funding-intelligence report run in your organization' },
              { href: '/quality-audit', icon: '\u{1F50D}', title: 'Quality Audit', description: "Review AI output quality across the organization's projects" },
            ],
          },
        ],
      })
    }

    // OWNER/ADMIN see everything; CALL_ADMIN sees the scoped surfaces only.
    if (isOwnerOrAdmin || has('CALL_ADMIN')) {
      sections.push({
        key: 'administration',
        label: 'Administration',
        icon: '\u{1F3E2}',
        blurb: 'Your organization: people, calls and reporting',
        groups: [
          {
            label: 'People & structure',
            items: [
              ...(isOwnerOrAdmin
                ? [
                    { href: '/tenant-admin/users', icon: '\u{1F465}', title: 'User Management', description: 'Create accounts, change roles and issue activation links' },
                    { href: '/admin', icon: '\u2709\uFE0F', title: 'Invite Members', description: 'Send email invitations for one-off or external people' },
                    { href: '/tenant-admin/teams', icon: '\u{1F3E2}', title: 'Team Management', description: 'Group people into teams and control what each team can use' },
                  ]
                : []),
              { href: '/tenant-admin/faculty', icon: '\u{1F393}', title: 'Faculty & Organization', description: 'Build the school/department tree and import the faculty roster' },
              ...(isOwnerOrAdmin
                ? [{ href: '/tenant-admin/funding-dept', icon: '\u{1F9ED}', title: 'Funding Department', description: 'Staff the sponsored-research office and assign each member schools' }]
                : []),
            ],
          },
          {
            label: 'Calls & assignment',
            items: [
              { href: '/funding/imports', icon: '\u{1F4E5}', title: 'Import Funding Calls', description: "Upload call documents or URLs into your organization's catalog" },
              { href: '/researcher-matching', icon: '\u{1F3AF}', title: 'Find Researchers', description: 'Match faculty to a funding call, then assign or bulk-circulate it' },
              { href: '/funding-dept/overview', icon: '\u{1F4CB}', title: 'Department Overview', description: 'Pendency, load and coverage, by member and by school' },
              { href: '/funding-dept/accountability', icon: '\u{1F4CA}', title: 'Accountability', description: 'Member by member: pendency, chasing, submissions and who is behind' },
              { href: '/funding-dept/calls', icon: '\u{1F4C8}', title: 'Call Funnel', description: 'Every call with who it reached: matched, assigned, submitted, awarded' },
            ],
          },
          {
            label: 'Reports & quality',
            items: [
              { href: '/tenant-admin/grant-dashboard', icon: '\u{1F4CA}', title: 'Grant Dashboard', description: 'Allocation, deadlines, outcomes and downloadable CSV reports' },
              ...(isOwnerOrAdmin
                ? [
                    { href: '/tenant-admin/reports', icon: '\u{1F5C4}\uFE0F', title: 'Report Archive', description: 'Every grant-reviewer and funding-intelligence report your members have run' },
                    { href: '/tenant-admin/analytics', icon: '\u{1F4C9}', title: 'Usage Analytics', description: 'Who is using which service, and how much' },
                    { href: '/quality-audit', icon: '\u{1F50D}', title: 'Quality Audit', description: "Review AI output quality across the organization's projects" },
                  ]
                : []),
            ],
          },
        ],
      })
    }

    if (canOpenPlatformFunding || isSuperAdmin) {
      sections.push({
        key: 'platform',
        label: isSuperAdmin ? 'Platform administration' : 'Platform funding',
        icon: '\u{1F6E0}\uFE0F',
        blurb: isSuperAdmin
          ? 'Across every tenant: oversight, catalog and models'
          : 'Platform-wide call intake and publishing',
        groups: [
          ...(isSuperAdmin
            ? [
                {
                  label: 'Oversight',
                  items: [
                    { href: '/super-admin/reports', icon: '\u{1F5C4}\uFE0F', title: 'Report Archive', description: 'Every reviewer and funding-intelligence report, across all tenants' },
                    { href: '/super-admin/analytics', icon: '\u{1F4C8}', title: 'Platform Analytics', description: 'Usage, cost and growth across the platform' },
                    { href: '/super-admin/jobs', icon: '\u23F1\uFE0F', title: 'Jobs & Schedules', description: 'Scheduled sweeps and digests, and whether they are still running' },
                  ],
                },
              ]
            : []),
          {
            label: 'Funding catalog',
            items: [
              { href: '/super-admin/funding', icon: '\u{1F4BC}', title: 'Funding Control', description: 'Platform-wide call intake, catalog curation and publishing' },
              { href: '/funding/monitor', icon: '\u{1F4E1}', title: 'Source Watch', description: 'Watch funder websites and confirm what they publish' },
            ],
          },
          ...(isSuperAdmin
            ? [
                {
                  label: 'Configuration',
                  items: [
                    { href: '/super-admin/users', icon: '\u{1F465}', title: 'Users & Roles', description: 'Every account on the platform, and what it may do' },
                    { href: '/super-admin/llm-config', icon: '\u{1F916}', title: 'LLM Model Control', description: 'Which AI model runs each stage, and its settings' },
                    { href: '/super-admin/jurisdiction-config', icon: '\u{1F3D7}\uFE0F', title: 'Jurisdiction Config', description: 'Per-country drafting rules and requirements' },
                    { href: '/super-admin/countries', icon: '\u{1F30D}', title: 'Country Profiles', description: 'Import and activate country jurisdiction profiles' },
                    { href: '/super-admin/section-prompts', icon: '\u{1F4DD}', title: 'Section Prompts', description: 'Prompt templates behind each generated section' },
                    { href: '/super-admin/jurisdiction-styles', icon: '\u{1F3A8}', title: 'Jurisdiction Styles', description: 'Formatting and style rules per jurisdiction' },
                  ],
                },
                {
                  label: 'Paper writing',
                  items: [
                    { href: '/admin/paper-types', icon: '\u{1F4D1}', title: 'Paper Types', description: 'Manage the catalog of paper types authors can pick' },
                    { href: '/admin/citation-styles', icon: '\u{1F4DA}', title: 'Citation Styles', description: 'Citation formats available in the writing tools' },
                    { href: '/admin/publication-venues', icon: '\u{1F3DB}\uFE0F', title: 'Publication Venues', description: 'Journals and conferences authors can target' },
                  ],
                },
              ]
            : []),
        ],
      })
    }

    return sections
  }, [user, fundingDept, canUseGrantStudio, canUseFundingIntelligence, canOpenPlatformFunding])

  // Close menu function
  const closeMenu = useCallback(() => {
    setShowUserMenu(false)
    setOpenSection(null)
    setOpenGroup(null)
    setHint(null)
  }, [])

  // Clear any pending timeout
  const clearMenuTimeout = useCallback(() => {
    if (menuTimeoutRef.current) {
      clearTimeout(menuTimeoutRef.current)
      menuTimeoutRef.current = null
    }
  }, [])

  // Start auto-close timeout
  const startMenuTimeout = useCallback(() => {
    clearMenuTimeout()
    menuTimeoutRef.current = setTimeout(() => {
      closeMenu()
    }, 8000) // Auto-close once the pointer has been away this long
  }, [closeMenu, clearMenuTimeout])

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }

    // Handle escape key to close dropdown
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    // Close when the page behind the menu scrolls away, but never when the
    // menu itself is being scrolled: this listener runs in the capture phase,
    // so it also sees scroll events from inside the panel. A page scroll
    // targets `document`, which is not contained by the menu, so it still closes.
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null
      if (target && userMenuRef.current?.contains(target)) return
      closeMenu()
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscapeKey)
      window.addEventListener('scroll', handleScroll, true)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscapeKey)
      window.removeEventListener('scroll', handleScroll, true)
      clearMenuTimeout()
    }
  }, [showUserMenu, closeMenu, clearMenuTimeout])

  // Reset menu state when user changes (after login/logout)
  useEffect(() => {
    closeMenu()
  }, [user?.user_id, closeMenu])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMenuTimeout()
    }
  }, [clearMenuTimeout])

  const handleSignOut = () => {
    closeMenu()
    logout()
  }

  const handlePasswordReset = async () => {
    if (!user?.email || isSendingReset) return
    try {
      setIsSendingReset(true)
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      })
      if (!res.ok) throw new Error('Failed to request reset')
      closeMenu()
      alert('Password reset link sent to ' + user.email)
    } catch (e) {
      console.error('Reset request failed', e)
      alert('Could not send reset email. Please try again.')
    } finally {
      setIsSendingReset(false)
    }
  }

  const handleMenuToggle = () => {
    if (showUserMenu) {
      closeMenu()
    } else {
      const path = typeof window !== 'undefined' ? window.location.pathname : ''
      const active = menuSections.find((section) =>
        section.groups.some((group) =>
          group.items.some((item) => item.href !== '/dashboard' && path.startsWith(item.href))
        )
      )
      setOpenSection(active?.key || null)
      setOpenGroup(null)
      setShowUserMenu(true)
    }
  }

  // Reset auto-close timeout when user interacts with menu
  const handleMenuMouseEnter = () => {
    clearMenuTimeout()
  }

  const handleMenuMouseLeave = () => {
    startMenuTimeout()
  }

  if (isLoading) {
    return (
      <header className="bg-white shadow-sm border-b border-gpt-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link href="/" className="rounded focus:outline-none focus:ring-2 focus:ring-cobalt-500">
                <BrandLockup size="sm" />
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gpt-blue-600"></div>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white shadow-sm border-b border-gpt-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <Link href="/" className="rounded focus:outline-none focus:ring-2 focus:ring-cobalt-500">
              <BrandLockup size="sm" />
            </Link>
          </div>

          {user ? (
            <div className="relative inline-block" ref={userMenuRef}>
              {/* Quick Navigation Links */}
              <div className="flex items-center space-x-3">
                {/* Quick links give way to the menu on a phone: they used to
                    push the notification bell and the menu itself off screen. */}
                <Link
                  href="/dashboard"
                  className="hidden items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200 sm:inline-flex"
                >
                  🏠 Dashboard
                </Link>

                {canUseFundingIntelligence && (
                  <Link
                    href="/funding/intelligence"
                    className="hidden items-center px-3 py-2 text-sm font-medium text-gpt-gray-700 transition-all duration-200 hover:text-teal-700 lg:inline-flex"
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Funding Intelligence
                  </Link>
                )}

                {/* Shared research library navigation */}
                {isFeatureEnabled('ENABLE_PAPER_WRITING_UI') && (
                  <>
                    <Link
                      href="/library"
                      className="hidden items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200 sm:inline-flex"
                    >
                      <Library className="w-4 h-4 mr-1" />
                      Library
                    </Link>
                  </>
                )}

                <NotificationBell />

                {/* Compact User Dropdown */}
                <button
                  onClick={handleMenuToggle}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gpt-gray-50 transition-all duration-200 border border-gpt-gray-200"
                  aria-expanded={showUserMenu}
                  aria-haspopup="true"
                >
                  <div className="w-6 h-6 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                    {user.email?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <svg
                    className={`w-3 h-3 text-gpt-gray-500 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Compact User Dropdown Menu */}
              {showUserMenu && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-gpt-gray-200 bg-white shadow-lg max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain sm:max-h-none sm:overflow-visible"
                  onMouseEnter={handleMenuMouseEnter}
                  onMouseLeave={handleMenuMouseLeave}
                >
                  {/* User Info */}
                  <div className="px-3 py-2 border-b border-gpt-gray-200 bg-gpt-gray-50">
                    <div className="text-sm text-gpt-gray-900 font-medium truncate">{user.email}</div>
                    <div className="text-xs text-gpt-gray-600">Role: {user.roles?.join(', ') || 'None'}</div>
                  </div>

                  {/* Menu items: sections open their groups to the left, and
                      groups open their links. Hovering any row explains it. */}
                  <div className="py-1">
                    {menuSections.map((section) => (
                      <MenuBranch
                        key={section.key}
                        icon={section.icon}
                        label={section.label}
                        description={section.blurb}
                        count={section.groups.reduce((total, group) => total + group.items.length, 0)}
                        open={openSection === section.key}
                        onOpen={() => {
                          setOpenSection(section.key)
                          setOpenGroup(null)
                        }}
                        onClose={() => setOpenSection((current) => (current === section.key ? null : current))}
                        onToggle={() =>
                          setOpenSection((current) => (current === section.key ? null : section.key))
                        }
                        onHint={setHint}
                        clip={section.groups.length === 1}
                      >
                        {/* A section with one group would otherwise make the
                            reader open a level to find a single child. */}
                        {section.groups.length === 1
                          ? section.groups[0].items.map((item) => (
                              <MenuItem
                                key={item.href}
                                href={item.href}
                                icon={item.icon}
                                title={item.title}
                                description={item.description}
                                onClick={closeMenu}
                                onHint={setHint}
                              />
                            ))
                          : section.groups.map((group) => {
                              const groupKey = `${section.key}:${group.label}`
                              return (
                                <MenuBranch
                                  key={groupKey}
                                  label={group.label}
                                  count={group.items.length}
                                  open={openGroup === groupKey}
                                  onOpen={() => setOpenGroup(groupKey)}
                                  onClose={() =>
                                    setOpenGroup((current) => (current === groupKey ? null : current))
                                  }
                                  onToggle={() =>
                                    setOpenGroup((current) => (current === groupKey ? null : groupKey))
                                  }
                                  onHint={setHint}
                                >
                                  {group.items.map((item) => (
                                    <MenuItem
                                      key={item.href}
                                      href={item.href}
                                      icon={item.icon}
                                      title={item.title}
                                      description={item.description}
                                      onClick={closeMenu}
                                      onHint={setHint}
                                    />
                                  ))}
                                </MenuBranch>
                              )
                            })}
                      </MenuBranch>
                    ))}

                    {/* Account actions stay outside the sections: they are the
                        two things a person must never have to hunt for. */}
                    <div className="border-t border-gpt-gray-200 pt-1">
                      <button
                        onClick={handlePasswordReset}
                        disabled={isSendingReset}
                        className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2 disabled:opacity-50"
                      >
                        <span>🔒</span>
                        <span>{isSendingReset ? 'Sending reset link\u2026' : 'Reset Password'}</span>
                      </button>

                      <button
                        onClick={handleSignOut}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                      >
                        <span>🚪</span>
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                  <MenuHint hint={hint} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Sign In
              </Link>

              <Link
                href="/register"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
