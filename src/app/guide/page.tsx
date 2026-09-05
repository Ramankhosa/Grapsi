'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'

/**
 * Where everything is.
 *
 * The product grew a screen at a time and the navigation followed it, so a new
 * user's first question — "where do I do X?" — is currently answered by opening
 * the account menu and reading twenty links whose names assume you already
 * know. This is the map: every screen, what it is for, and who can open it.
 *
 * Screens the reader cannot open are shown greyed rather than hidden. Knowing
 * that a capability exists and belongs to somebody else is the answer to half
 * the questions a new user asks; hiding it just makes them ask a person.
 */

/** Who a screen belongs to. Also the section a screen is filed under. */
type Audience =
  | 'everyone'
  | 'fundingDept'
  | 'fundingDeptHead'
  | 'schoolHead'
  | 'deptOrSchoolHead'
  | 'orgAdmin'
  | 'qualityAuditor'
  | 'superAdmin'

interface Entry {
  href: string | null
  name: string
  /** One sentence, in the reader's terms, not the code's. */
  what: string
  /** Shown when the reader cannot open it, so the answer is "ask them", not "it's broken". */
  restrictedTo?: string
  audience: Audience
}

interface Section {
  id: string
  title: string
  blurb: string
  entries: Entry[]
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Start here',
    blurb: 'The three screens everyone uses, whatever their role.',
    entries: [
      {
        href: '/dashboard',
        name: 'Dashboard',
        what: 'Your home screen: work in progress, what needs you, and the way into every module.',
        audience: 'everyone',
      },
      {
        href: '/notifications',
        name: 'Notifications',
        what: 'Funding matches, assignment requests, deadline nudges and digests, in one list.',
        audience: 'everyone',
      },
      {
        href: '/library',
        name: 'Reference library',
        what: 'Papers and references you have saved, reused across proposals.',
        audience: 'everyone',
      },
    ],
  },
  {
    id: 'find',
    title: 'Finding funding',
    blurb: 'Everything between "I have an idea" and "this is the call I am applying to".',
    entries: [
      {
        href: '/funding/my-areas',
        name: 'Funding in my areas',
        what: 'Calls matched to your own profile, saved research areas and tagged papers — nothing to type. Toggle between what is open now and what has closed.',
        audience: 'everyone',
      },
      {
        href: '/funding/intelligence',
        name: 'Funding intelligence',
        what: 'The hub: search the call catalogue, review your own idea against it, and open a call.',
        audience: 'everyone',
      },
      {
        href: '/funding/intelligence/idea/new',
        name: 'Match an idea to calls',
        what: 'Describe what you want to do and get the calls, evidence and gaps for it.',
        audience: 'everyone',
      },
      {
        href: '/finder',
        name: 'Call finder (chat)',
        what: 'Ask for funding in plain language and narrow it down by conversation.',
        audience: 'everyone',
      },
      {
        href: '/funding/intelligence/patents',
        name: 'Patent search',
        what: 'Search patents around your idea and shortlist what matters for the proposal.',
        audience: 'everyone',
      },
      {
        href: '/idea-bank',
        name: 'Idea bank',
        what: 'Park ideas before they are proposals, and come back to them when a call fits.',
        audience: 'everyone',
      },
      {
        href: '/researcher-matching',
        name: 'Researcher matching',
        what: 'Given a call, who in the institution best fits it — across schools, not just yours.',
        audience: 'everyone',
      },
    ],
  },
  {
    id: 'write',
    title: 'Writing the proposal',
    blurb:
      'A grant lives inside a project. Create the project first; the stages below open from it.',
    entries: [
      {
        href: '/projects',
        name: 'Your projects',
        what: 'Every project you own or collaborate on. Open one to reach its grants.',
        audience: 'everyone',
      },
      {
        href: '/projects/new/grant',
        name: 'Start a grant proposal',
        what: 'Creates the project and its first grant application in one go.',
        audience: 'everyone',
      },
      {
        href: null,
        name: 'Prep → Blueprint → Draft',
        what: 'The writing stages inside a grant: gather context, agree the structure, then draft and review section by section. Reached from the project, never from the menu.',
        audience: 'everyone',
      },
      {
        href: '/assignments',
        name: 'Calls assigned to me',
        what: 'Calls the funding department has asked you to apply for — accept, decline, or record your submission here.',
        audience: 'everyone',
      },
      {
        href: '/proposals',
        name: 'My proposals',
        what: 'Your applications with the funding department: upload each draft, read the review they send back, download your endorsement letter, see what still has to be attached, keep the budget and co-investigators, record the date you submitted, and follow the certificates due once it is funded.',
        audience: 'everyone',
      },
      {
        href: '/personas',
        name: 'Writing personas',
        what: 'Teach the drafting tools your voice from samples of your own writing.',
        audience: 'everyone',
      },
    ],
  },
  {
    id: 'dept',
    title: 'The funding department (DSR office)',
    blurb:
      'For officers who source calls and push them to faculty. You see the schools you cover.',
    entries: [
      {
        href: '/funding-dept',
        name: 'My desk',
        what: 'What needs you today across the schools you cover.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/queue',
        name: 'Call queue',
        what: 'New calls relevant to your schools, waiting for a decision: pursue it or say it is not this school’s business.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/calls',
        name: 'Call funnel',
        what: 'Every call by school and stage — relevant, needing somebody, live, submitted.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: null,
        name: 'Call dossier',
        what: 'One call in one school: best-matching faculty with their load and submissions over your period of consideration, who is on it, and the whole history. Opens from the queue or the funnel.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/assignments',
        name: 'Assignments',
        what: 'Every call you have handed out, and where each one has got to.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/chase',
        name: 'Chase list',
        what: 'Who is overdue, who has not answered, and the follow-ups you have logged.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/proposals',
        name: 'Proposal desk',
        what: 'Every application from your schools: run the AI review on a draft, send the report back, set the cut-off for revisions, tick off the attachments, issue the endorsement letter, clear it for submission, log what the researcher tells you, and track the utilisation certificates once it is sanctioned. Exports as a spreadsheet.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/faculty',
        name: 'Faculty directory',
        what: 'The people in the schools you cover, with their areas and current load.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: '/funding-dept/overview',
        name: 'Department overview',
        what: 'The head’s view: what each officer is carrying, what each school has picked up and submitted, and which schools nobody covers.',
        restrictedTo: 'the department head and org admins',
        audience: 'fundingDeptHead',
      },
      {
        href: '/funding-dept/accountability',
        name: 'Accountability',
        what: 'Officer by officer, school by school: how many relevant calls are waiting, how many are allocated and to whom, what has gone quiet and what has been submitted. The head sees everyone ranked worst first; an officer sees their own schools.',
        restrictedTo: 'funding department members',
        audience: 'fundingDept',
      },
      {
        href: null,
        name: 'School call ledger',
        what: 'One school, every call it could apply for, who is on each and where that application has got to. A Dean sees the same states and contact dates; the department’s own notes stay inside the department. Opens from the accountability view, the department overview or your school dashboard.',
        restrictedTo: 'funding department members and the school’s head',
        audience: 'deptOrSchoolHead',
      },
    ],
  },
  {
    id: 'school',
    title: 'Heading a school or department',
    blurb:
      'For a Dean or Head of Department: what funding reached your people, and what they did with it.',
    entries: [
      {
        href: '/school-head',
        name: 'My school',
        what: 'Calls open to your school, how many nobody has taken up, who your funding department contact is, and how your faculty are responding to what they are sent.',
        restrictedTo: 'Deans and Heads of Department',
        audience: 'schoolHead',
      },
      {
        href: '/school-head/proposals',
        name: 'Proposals from my school',
        what: 'What your faculty are applying for and where each application stands. Read-only, and without the funding department’s internal notes.',
        restrictedTo: 'Deans and Heads of Department',
        audience: 'schoolHead',
      },
      {
        href: '/assignments',
        name: 'Assignments I manage',
        what: 'Every call sent to your faculty, with its status and internal deadline.',
        restrictedTo: 'Deans and Heads of Department',
        audience: 'schoolHead',
      },
      {
        href: '/tenant-admin/grant-dashboard',
        name: 'Reports & CSV',
        what: 'Allocation, deadlines and outcomes for your branch, downloadable as a spreadsheet.',
        restrictedTo: 'Deans, Heads of Department and org admins',
        audience: 'schoolHead',
      },
    ],
  },
  {
    id: 'org',
    title: 'Running the organisation',
    blurb: 'Owner and admin screens: people, structure, and what the institution is doing overall.',
    entries: [
      {
        href: '/tenant-admin/users',
        name: 'Users',
        what: 'Add people, set roles, resend activation links.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/faculty',
        name: 'Faculty & schools',
        what: 'Import the faculty roster, and map each school to the research areas that make call relevance work.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/funding-dept',
        name: 'Funding department setup',
        what: 'Staff the department, assign school coverage and deputies, and set the period of consideration used for workload and submission counts.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/teams',
        name: 'Teams',
        what: 'Group people for shared access to projects.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/grant-dashboard',
        name: 'Grant dashboard',
        what: 'Institution-wide grant activity: what is in flight, submitted and won.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/analytics',
        name: 'Analytics',
        what: 'Usage and outcomes across your organisation.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/funding/imports',
        name: 'Import funding calls',
        what: 'Bring calls in from files or links, for your organisation only.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/admin',
        name: 'Content settings',
        what: 'Paper types, citation styles and publication venues used by the writing tools.',
        restrictedTo: 'owners and admins',
        audience: 'orgAdmin',
      },
      {
        href: '/tenant-admin/reports',
        name: 'Report archive',
        what: 'Every AI grant-reviewer and funding-intelligence report your members have run, with who ran it and from which school. Read-only.',
        restrictedTo: 'owners, admins and quality auditors',
        audience: 'qualityAuditor',
      },
      {
        href: '/quality-audit',
        name: 'Quality audit',
        what: 'Review generated output against the source material.',
        restrictedTo: 'quality auditors',
        audience: 'qualityAuditor',
      },
    ],
  },
  {
    id: 'platform',
    title: 'Platform administration',
    blurb: 'Anthropic-of-the-institution stuff: the catalogue, the models, the money, the jobs.',
    entries: [
      {
        href: '/super-admin/reports',
        name: 'Report archive (all tenants)',
        what: 'Every grant-reviewer and funding-intelligence report run on the platform, filterable by tenant, school, person and date.',
        restrictedTo: 'super admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/funding',
        name: 'Funding catalogue',
        what: 'The master call catalogue every organisation searches, and its imports.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/research-areas',
        name: 'Research areas',
        what: 'The discipline catalogue that call-to-school relevance is computed against.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/users',
        name: 'User directory',
        what: 'Every user on the platform, across organisations.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/plans',
        name: 'Plans & features',
        what: 'What each plan includes, and which modules are switched on.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/quota-controller',
        name: 'Quotas',
        what: 'Per-organisation limits and overrides.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/user-service-usage',
        name: 'Service usage',
        what: 'Who used what, by service and organisation.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/llm-config',
        name: 'LLM configuration',
        what: 'Which model runs each stage, and its prompts.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/model-costs',
        name: 'Model costs',
        what: 'Per-model pricing behind the usage and cost reporting.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/jobs',
        name: 'Background jobs',
        what: 'Sweeps, digests and imports: what ran, what failed, and when.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
      {
        href: '/super-admin/analytics',
        name: 'Platform analytics',
        what: 'Activity across every organisation.',
        restrictedTo: 'platform admins',
        audience: 'superAdmin',
      },
    ],
  },
]

export default function GuidePage() {
  const { user, isLoading } = useAuth()
  const { isSuperAdmin, isTenantAdmin, canQualityAudit } = useRoleAccess()
  const { me } = useFundingDeptMe()
  const [query, setQuery] = useState('')

  /** Can this reader actually open it? Mirrors each screen's own gate. */
  const canOpen = (audience: Audience): boolean => {
    switch (audience) {
      case 'everyone':
        return Boolean(user)
      case 'fundingDept':
        return Boolean(me?.isMember) || isTenantAdmin || isSuperAdmin
      case 'fundingDeptHead':
        return Boolean(me?.isHead) || isTenantAdmin || isSuperAdmin
      // Headship is an org-unit grant, not a role, so the server answers this
      // the same way it answers department membership.
      case 'schoolHead':
        return (me?.managedUnits?.length ?? 0) > 0 || isTenantAdmin || isSuperAdmin
      // Two ways in, and the screen serves both: the officer who works the
      // school and the head who answers for it. Greying it for one of them
      // would be telling a Dean they cannot open a page they can.
      case 'deptOrSchoolHead':
        return (
          Boolean(me?.isMember) ||
          (me?.managedUnits?.length ?? 0) > 0 ||
          isTenantAdmin ||
          isSuperAdmin
        )
      case 'orgAdmin':
        return isTenantAdmin || isSuperAdmin
      case 'qualityAuditor':
        return canQualityAudit || isSuperAdmin
      case 'superAdmin':
        return isSuperAdmin
      default:
        return false
    }
  }

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      entries: section.entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.what.toLowerCase().includes(needle) ||
          section.title.toLowerCase().includes(needle)
      ),
    })).filter((section) => section.entries.length > 0)
  }, [query])

  const yoursCount = SECTIONS.reduce(
    (sum, section) => sum + section.entries.filter((entry) => canOpen(entry.audience)).length,
    0
  )

  return (
    <main className="nk-ground nk-wash min-h-screen">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Orientation</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em] text-nickel-900">
            Where everything is
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            Every screen in the product, what it is for, and who can open it. Anything greyed out
            exists but belongs to another role — the note says whose.
            {!isLoading && user ? ` ${yoursCount} of these are open to you.` : ''}
          </p>
          {!isLoading && !user && (
            <p className="nk-sub mt-2">
              You are not signed in, so nothing here is open yet.{' '}
              <Link href="/login" className="underline">
                Sign in
              </Link>{' '}
              and this page will mark what your account can reach.
            </p>
          )}
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="sticky top-0 z-10 -mx-4 mb-6 bg-nickel-25/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          <input
            className="nk-input w-full max-w-md"
            placeholder="Search — “assign”, “deadline”, “import”…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the guide"
          />
          {!query && (
            <nav className="mt-2 flex flex-wrap gap-2" aria-label="Jump to a section">
              {SECTIONS.map((section) => (
                <a key={section.id} href={`#${section.id}`} className="nk-btn-secondary nk-btn-xs">
                  {section.title}
                </a>
              ))}
            </nav>
          )}
        </div>

        {sections.length === 0 && (
          <p className="nk-sub">
            Nothing matches “{query}”. Try a word from what you are trying to do — “submit”,
            “relevance”, “roster”.
          </p>
        )}

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="mb-8 scroll-mt-24">
            <h2 className="nk-title text-lg">{section.title}</h2>
            <p className="nk-sub mt-0.5 max-w-2xl">{section.blurb}</p>

            <ul className="nk-panel mt-3 divide-y divide-nickel-100">
              {section.entries.map((entry) => {
                const open = canOpen(entry.audience)
                const body = (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          open ? 'text-nickel-900' : 'text-nickel-500'
                        }`}
                      >
                        {entry.name}
                      </span>
                      {entry.href ? (
                        <span className="nk-mono text-[11px] text-nickel-500">{entry.href}</span>
                      ) : (
                        <span className="nk-badge">opens from inside</span>
                      )}
                      {!open && entry.restrictedTo && (
                        <span className="nk-badge nk-badge-warn">{entry.restrictedTo}</span>
                      )}
                    </div>
                    <p className="nk-sub mt-1 max-w-3xl">{entry.what}</p>
                  </>
                )

                return (
                  <li key={entry.name} className="px-4 py-3.5">
                    {open && entry.href ? (
                      <Link href={entry.href} className="block hover:opacity-80">
                        {body}
                      </Link>
                    ) : (
                      <div>{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <p className="nk-sub mt-10">
          Something here not matching what you see? Roles and plan features both change what is
          available — ask whoever administers your organisation, or{' '}
          <Link href="/contact" className="underline">
            contact us
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
