'use client'

import { ReactNode, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

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
  /** Actions for this context — "Assign call", "Shortlist" — beside Close. */
  children?: ReactNode
}

export default function FacultyProfileDrawer({
  userId,
  fallbackName,
  fallbackHint,
  onClose,
  children,
}: Props) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<FacultyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    ;(async () => {
      try {
        const response = await authFetch(
          `/api/researcher-matching?action=profile&userId=${encodeURIComponent(userId)}`
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
  }, [authFetch, userId])

  // Escape closes it. A drawer opened from a table row is dismissed far more
  // often than it is read through.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasAnyLink = data ? PROFILE_LINKS.some((link) => data.links[link.key]) : false

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-nickel-200 bg-white shadow-nk-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Faculty profile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-nickel-200 px-6 py-4">
          <div className="min-w-0">
            <p className="nk-eyebrow">Faculty profile</p>
            <h3 className="mt-1 text-[17px] font-semibold text-nickel-900">
              {data?.name || fallbackName}
            </h3>
            <p className="nk-sub mt-0.5">
              {[data?.designation, data?.department, data?.school].filter(Boolean).join(' · ') ||
                fallbackHint ||
                ''}
            </p>
          </div>
          <button
            type="button"
            className="nk-btn-ghost nk-btn-sm"
            onClick={onClose}
            aria-label="Close profile"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="animate-pulse space-y-3" aria-hidden>
              <div className="h-4 w-1/2 rounded bg-nickel-100" />
              <div className="h-3 w-2/3 rounded bg-nickel-100" />
              <div className="h-3 w-1/3 rounded bg-nickel-100" />
            </div>
          ) : error ? (
            <p className="text-[13px] text-red-700">{error}</p>
          ) : data ? (
            <div className="space-y-4">
              {/* External research profiles — the quick outbound checks, first
                  because they are what an officer opens the panel for. */}
              <div>
                <p className="nk-eyebrow mb-2">Research profiles</p>
                <div className="flex flex-wrap gap-2">
                  {PROFILE_LINKS.filter((link) => data.links[link.key]).map((link) => (
                    <a
                      key={link.key}
                      href={data.links[link.key] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="nk-btn-secondary nk-btn-sm"
                    >
                      {link.label} ↗
                    </a>
                  ))}
                  {!hasAnyLink && (
                    <p className="nk-sub">
                      No external profiles on file — ask them to add Google Scholar / Scopus / ORCID
                      links to their researcher profile.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="nk-panel-quiet px-3.5 py-2.5">
                  <p className="nk-eyebrow">Contact</p>
                  <a
                    href={`mailto:${data.email}`}
                    className="mt-1 block truncate text-[13px] font-medium text-cobalt-700 hover:underline"
                  >
                    {data.email}
                  </a>
                  {data.employeeId && (
                    <p className="nk-sub mt-0.5 text-[11.5px]">Employee ID {data.employeeId}</p>
                  )}
                </div>
                <div className="nk-panel-quiet px-3.5 py-2.5">
                  <p className="nk-eyebrow">Standing</p>
                  <p className="mt-1 text-[13px] text-nickel-800">
                    {[
                      data.careerStage?.replace(/_/g, ' '),
                      data.yearsOfExperience ? `${data.yearsOfExperience} yrs experience` : null,
                      data.country,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                  {data.languages.length > 0 && (
                    <p className="nk-sub mt-0.5 text-[11.5px]">
                      Applies in {data.languages.join(', ')}
                    </p>
                  )}
                </div>
              </div>

              {data.summary && (
                <div>
                  <p className="nk-eyebrow mb-1.5">Research summary</p>
                  <p className="text-[13px] leading-relaxed text-nickel-700">{data.summary}</p>
                </div>
              )}

              {data.researchAreas.length > 0 && (
                <div>
                  <p className="nk-eyebrow mb-1.5">Research areas</p>
                  <div className="flex flex-wrap gap-1">
                    {data.researchAreas.map((area) => (
                      <span
                        key={area}
                        className="nk-badge nk-badge-live normal-case tracking-normal"
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.keywords.length > 0 && (
                <div>
                  <p className="nk-eyebrow mb-1.5">Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {data.keywords.map((keyword) => (
                      <span key={keyword} className="nk-badge normal-case tracking-normal">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="nk-eyebrow mb-1.5">
                  Publications on file ({data.publications.length})
                </p>
                {data.publications.length === 0 ? (
                  <p className="nk-sub">
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
                        <li key={pub.id} className="border-l-2 border-nickel-200 pl-3">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[13px] font-medium text-nickel-900 hover:text-cobalt-700 hover:underline"
                            >
                              {pub.title}
                            </a>
                          ) : (
                            <p className="text-[13px] font-medium text-nickel-900">{pub.title}</p>
                          )}
                          <p className="nk-sub text-[11.5px]">
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

        <div className="flex justify-end gap-2 border-t border-nickel-200 px-6 py-4">
          <button type="button" className="nk-btn-secondary" onClick={onClose}>
            Close
          </button>
          {children}
        </div>
      </div>
    </div>
  )
}
