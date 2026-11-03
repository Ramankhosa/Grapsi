'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

import { useAuth } from '@/lib/auth-context'
import AllocateCallButton from '@/components/funding-dept/AllocateCallButton'

/**
 * One faculty member's stored profile, wherever the reader happens to be.
 *
 * The department's actual question about a person — "who are they, what have
 * they published, where can I check them" — used to be answerable on exactly
 * one screen. Everywhere else an officer had a name and a match tier and had to
 * leave to find out anything more, which in practice meant not finding out.
 *
 * Self-fetching on purpose: every caller has a userId and nothing else, and
 * threading profile state through three unrelated pages is how the one copy
 * became the only copy.
 */

export interface FacultyProfile {
  userId: string
  name: string
  email: string
  employeeId: string | null
  designation: string | null
  school: string | null
  department: string | null
  institution: string | null
  careerStage: string | null
  yearsOfExperience: number | null
  country: string | null
  languages: string[]
  summary: string | null
  researchAreas: string[]
  keywords: string[]
  links: {
    googleScholar: string | null
    scopus: string | null
    orcid: string | null
    linkedin: string | null
  }
  publications: Array<{
    id: string
    title: string
    authors: string[]
    year: number | null
    venue: string | null
    doi: string | null
    url: string | null
  }>
}

export const PROFILE_LINKS: Array<{ key: keyof FacultyProfile['links']; label: string }> = [
  { key: 'googleScholar', label: 'Google Scholar' },
  { key: 'scopus', label: 'Scopus' },
  { key: 'orcid', label: 'ORCID' },
  { key: 'linkedin', label: 'LinkedIn' },
]

/** Where a publication actually resolves to, DOI first. */
export function publicationHref(pub: FacultyProfile['publications'][number]): string | null {
  if (pub.doi) return `https://doi.org/${pub.doi}`
  return pub.url || null
}

interface Props {
  userId: string
  /** Shown in the header until the profile loads, and if it fails. */
  fallbackName: string
  /** Second header line before the profile arrives (department, institution…). */
  fallbackHint?: string | null
  onClose: () => void
  onAllocated?: () => void
  /** Actions for this context — "Assign call", "Shortlist" — beside Close. */
  children?: ReactNode
  /** Where the profile is read from; Research Discovery uses its own member-wide endpoint. */
  profileUrl?: string
  /** nickel: the department's centred panel. cobalt: a side sheet in the researcher workspace style. */
  tone?: 'nickel' | 'cobalt'
}

/** The few classes that differ between the two shells; content layout is shared. */
const TONES = {
  nickel: {
    overlay: 'fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/50 p-4',
    panel: 'flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-nickel-200 bg-white shadow-nk-sheet',
    rule: 'border-nickel-200', eyebrow: 'nk-eyebrow', sub: 'nk-sub', title: 'text-nickel-900', body: 'text-nickel-700',
    quiet: 'nk-panel-quiet', secondary: 'nk-btn-secondary', ghost: 'nk-btn-ghost nk-btn-sm', link: 'nk-btn-secondary nk-btn-sm',
    area: 'nk-badge nk-badge-live normal-case tracking-normal', keyword: 'nk-badge normal-case tracking-normal',
    bar: 'border-nickel-200', skeleton: 'bg-nickel-100',
  },
  cobalt: {
    overlay: 'fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-sm',
    panel: 'flex h-full w-[min(96vw,560px)] flex-col bg-white shadow-2xl',
    rule: 'border-slate-200', eyebrow: 'cb-eyebrow', sub: 'text-[13px] text-slate-500', title: 'text-slate-950', body: 'text-slate-600',
    quiet: 'rounded-xl bg-slate-50', secondary: 'cb-btn-secondary', ghost: 'cb-btn-ghost cb-btn-sm', link: 'cb-btn-secondary cb-btn-sm',
    area: 'cb-badge-cobalt', keyword: 'cb-badge',
    bar: 'border-slate-200', skeleton: 'bg-slate-100',
  },
} as const

export default function FacultyProfileDrawer({
  userId,
  fallbackName,
  fallbackHint,
  onClose,
  onAllocated,
  children,
  profileUrl,
  tone = 'nickel',
}: Props) {
  const t = TONES[tone]
  const { authFetch } = useAuth()
  const [data, setData] = useState<FacultyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    ;(async () => {
      try {
        const response = await authFetch(
          profileUrl || `/api/researcher-matching?action=profile&userId=${encodeURIComponent(userId)}`
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load the profile')
        if (!cancelled) setData(payload.profile)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authFetch, userId, profileUrl])

  // Escape closes it. A drawer opened from a table row is dismissed far more
  // often than it is read through.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A child allocation dialog owns Escape while it is open.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasAnyLink = data ? PROFILE_LINKS.some((link) => data.links[link.key]) : false

  const panel = (
      <div
        className={t.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Faculty profile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-3 border-b ${t.rule} px-6 py-4`}>
          <div className="min-w-0">
            {tone === 'cobalt' && <Dialog.Title className="sr-only">Faculty profile</Dialog.Title>}
            <p className={t.eyebrow}>Faculty profile</p>
            <h3 className={`mt-1 text-[17px] font-semibold ${t.title}`}>
              {data?.name || fallbackName}
            </h3>
            <p className={`${t.sub} mt-0.5`}>
              {[data?.designation, data?.department, data?.school].filter(Boolean).join(' · ') ||
                fallbackHint ||
                ''}
            </p>
          </div>
          <button
            type="button"
            className={t.ghost}
            onClick={onClose}
            aria-label="Close profile"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="animate-pulse space-y-3" aria-hidden>
              <div className={`h-4 w-1/2 rounded ${t.skeleton}`} />
              <div className={`h-3 w-2/3 rounded ${t.skeleton}`} />
              <div className={`h-3 w-1/3 rounded ${t.skeleton}`} />
            </div>
          ) : error ? (
            <p className="text-[13px] text-red-700">{error}</p>
          ) : data ? (
            <div className="space-y-4">
              {/* External research profiles — the quick outbound checks, first
                  because they are what an officer opens the panel for. */}
              <div>
                <p className={`${t.eyebrow} mb-2`}>Research profiles</p>
                <div className="flex flex-wrap gap-2">
                  {PROFILE_LINKS.filter((link) => data.links[link.key]).map((link) => (
                    <a
                      key={link.key}
                      href={data.links[link.key] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={t.link}
                    >
                      {link.label} ↗
                    </a>
                  ))}
                  {!hasAnyLink && (
                    <p className={t.sub}>
                      No external profiles on file — ask them to add Google Scholar / Scopus / ORCID
                      links to their researcher profile.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`${t.quiet} px-3.5 py-2.5`}>
                  <p className={t.eyebrow}>Contact</p>
                  <a
                    href={`mailto:${data.email}`}
                    className="mt-1 block truncate text-[13px] font-medium text-cobalt-700 hover:underline"
                  >
                    {data.email}
                  </a>
                  {data.employeeId && (
                    <p className={`${t.sub} mt-0.5 text-[11.5px]`}>Employee ID {data.employeeId}</p>
                  )}
                </div>
                <div className={`${t.quiet} px-3.5 py-2.5`}>
                  <p className={t.eyebrow}>Standing</p>
                  <p className={`mt-1 text-[13px] ${t.title}`}>
                    {[
                      data.careerStage?.replace(/_/g, ' '),
                      data.yearsOfExperience ? `${data.yearsOfExperience} yrs experience` : null,
                      data.country,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                  {data.languages.length > 0 && (
                    <p className={`${t.sub} mt-0.5 text-[11.5px]`}>
                      Applies in {data.languages.join(', ')}
                    </p>
                  )}
                </div>
              </div>

              {data.summary && (
                <div>
                  <p className={`${t.eyebrow} mb-1.5`}>Research summary</p>
                  <p className={`text-[13px] leading-relaxed ${t.body}`}>{data.summary}</p>
                </div>
              )}

              {data.researchAreas.length > 0 && (
                <div>
                  <p className={`${t.eyebrow} mb-1.5`}>Research areas</p>
                  <div className="flex flex-wrap gap-1">
                    {data.researchAreas.map((area) => (
                      <span
                        key={area}
                        className={t.area}
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.keywords.length > 0 && (
                <div>
                  <p className={`${t.eyebrow} mb-1.5`}>Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {data.keywords.map((keyword) => (
                      <span key={keyword} className={t.keyword}>
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className={`${t.eyebrow} mb-1.5`}>
                  Publications on file ({data.publications.length})
                </p>
                {data.publications.length === 0 ? (
                  <p className={t.sub}>
                    None recorded. Publications are the ones a researcher marks for funding matching
                    in their own profile, so an empty list means nobody has marked any — not that
                    they have not published.
                    {hasAnyLink ? ' Their research profiles above are the fastest check.' : ''}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.publications.map((pub) => {
                      const href = publicationHref(pub)
                      return (
                        <li key={pub.id} className={`border-l-2 ${t.rule} pl-3`}>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-[13px] font-medium ${t.title} hover:text-cobalt-700 hover:underline`}
                            >
                              {pub.title}
                            </a>
                          ) : (
                            <p className={`text-[13px] font-medium ${t.title}`}>{pub.title}</p>
                          )}
                          <p className={`${t.sub} text-[11.5px]`}>
                            {[
                              pub.authors.length > 0
                                ? pub.authors.slice(0, 4).join(', ') +
                                  (pub.authors.length > 4 ? ' et al.' : '')
                                : null,
                              pub.venue,
                              pub.year,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className={`flex flex-wrap justify-end gap-2 border-t ${t.bar} px-6 py-4`}>
          <button type="button" className={t.secondary} onClick={onClose}>
            Close
          </button>
          {tone === 'nickel' && <AllocateCallButton person={{ userId, name: data?.name || fallbackName, email: data?.email, school: data?.school, department: data?.department, employeeId: data?.employeeId }} onAssigned={onAllocated} />}
          {children}
        </div>
      </div>
  )
  if (tone === 'cobalt') return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm" />
    <Dialog.Content asChild aria-describedby={undefined} className="fixed inset-y-0 right-0 z-50 outline-none"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
      {panel}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
  return <div className={t.overlay} onClick={onClose}>{panel}</div>
}
