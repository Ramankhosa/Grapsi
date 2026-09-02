'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import MatchResults, { MatchResult, SearchResponse } from '@/components/researcher-matching/MatchResults'

interface FundingCall {
  id: string
  schemeTitle: string
  agencyName: string | null
  description: string | null
  closeDate: string | null
  disciplines: string[]
  fundingKinds: string[]
}

interface Stats {
  researchers: number
  researchersWithEmbedding: number
  researchAreas: number
  publications: number
  publicationsWithEmbedding: number
  fundingCalls: number
}

interface Facets {
  schools: Array<{ id: string; name: string; departments: Array<{ id: string; name: string }> }>
  careerStages: string[]
  institutionTypes: string[]
  countries: string[]
  designations: string[]
  /** Attributes of the calls in the picker, not of the people. */
  callAgencies: string[]
  callDisciplines: string[]
  callFundingKinds: string[]
}

const CALL_CLOSING_WINDOWS = [
  { value: '', label: 'Any deadline' },
  { value: '7', label: 'Closing in 7 days' },
  { value: '30', label: 'Closing in 30 days' },
  { value: '90', label: 'Closing in 90 days' },
] as const

/** The stored faculty profile shown in the "View profile" panel. */
interface FacultyProfile {
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

const PROFILE_LINKS: Array<{ key: keyof FacultyProfile['links']; label: string }> = [
  { key: 'googleScholar', label: 'Google Scholar' },
  { key: 'scopus', label: 'Scopus' },
  { key: 'orcid', label: 'ORCID' },
  { key: 'linkedin', label: 'LinkedIn' },
]

// Fallback only. The authoritative answer is /api/funding-dept/me, which
// reports the server's own verdict: funding department members and org unit
// heads can assign while holding none of these roles, and this screen used to
// hide the assign button from exactly those people.
const ASSIGNER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN', 'CALL_ASSIGNER', 'CALL_ADMIN']

/** Scroll container for the school / department checkbox facets. */
const checkboxListClass =
  'max-h-32 overflow-y-auto rounded-lg border border-nickel-200 bg-white px-2.5 py-1.5'

export default function TenantResearcherMatchingPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const { me } = useFundingDeptMe()

  const [calls, setCalls] = useState<FundingCall[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [callSearchQuery, setCallSearchQuery] = useState('')
  const [selectedCall, setSelectedCall] = useState<FundingCall | null>(null)
  // Once a call is chosen the picker list collapses to a compact card;
  // "Change call" reopens it. Keeps the screen focused on the results.
  const [changingCall, setChangingCall] = useState(false)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'call' | 'text'>('call')

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [schoolIds, setSchoolIds] = useState<string[]>([])
  const [departmentIds, setDepartmentIds] = useState<string[]>([])
  const [researchAreaText, setResearchAreaText] = useState('')
  const [careerStage, setCareerStage] = useState('')
  const [designation, setDesignation] = useState('')
  // Name / email / employee ID — turns the search into "does THIS person fit
  // this call", which is what an assigner asks when a name comes up in a meeting.
  const [personLookup, setPersonLookup] = useState('')
  const [institutionType, setInstitutionType] = useState('')
  const [country, setCountry] = useState('')
  const [includeBelowThreshold, setIncludeBelowThreshold] = useState(false)

  // Call-picker filters (attributes of the call, not of the people).
  const [callAgency, setCallAgency] = useState('')
  const [callDiscipline, setCallDiscipline] = useState('')
  const [callFundingKind, setCallFundingKind] = useState('')
  const [callClosingInDays, setCallClosingInDays] = useState('')

  // Assignment
  const [assignTarget, setAssignTarget] = useState<MatchResult | null>(null)
  const [assignDeadline, setAssignDeadline] = useState('')
  const [assignMessage, setAssignMessage] = useState('')
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignNotice, setAssignNotice] = useState<string | null>(null)
  const [assignedByCall, setAssignedByCall] = useState<Record<string, string[]>>({})

  // Shortlist for the selected call: who is being kept in play without being
  // committed yet, so a colleague working the same call sees the thinking.
  const [shortlist, setShortlist] = useState<Record<string, string>>({})

  // Profile viewer: the stored faculty profile plus external research links.
  const [profileTarget, setProfileTarget] = useState<MatchResult | null>(null)
  const [profileData, setProfileData] = useState<FacultyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Bulk circulation: one call to many faculty in a single action.
  const [bulkSelection, setBulkSelection] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeadline, setBulkDeadline] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const canAssign = useMemo(
    () =>
      me.capabilities.canAssign ||
      Boolean(user?.roles?.some((role: string) => ASSIGNER_ROLES.includes(role))),
    [user, me]
  )

  const fetchStats = useCallback(async () => {
    try {
      const res = await authFetch('/api/researcher-matching?action=stats')
      if (res.ok) setStats(await res.json())
    } catch {}
  }, [authFetch])

  const fetchFacets = useCallback(async () => {
    try {
      const res = await authFetch('/api/researcher-matching?action=facets')
      if (res.ok) setFacets(await res.json())
    } catch {}
  }, [authFetch])

  const fetchCalls = useCallback(async (
    q = '',
    callFilters: { agency?: string; discipline?: string; fundingKind?: string; closingInDays?: string } = {}
  ) => {
    setLoadingCalls(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (q) params.set('q', q)
      if (callFilters.agency) params.set('agency', callFilters.agency)
      if (callFilters.discipline) params.set('discipline', callFilters.discipline)
      if (callFilters.fundingKind) params.set('fundingKind', callFilters.fundingKind)
      if (callFilters.closingInDays) params.set('closingInDays', callFilters.closingInDays)
      const res = await authFetch(`/api/researcher-matching?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCalls(data.calls || [])
      }
    } catch {} finally {
      setLoadingCalls(false)
    }
  }, [authFetch])

  /** Existing assignments so already-assigned faculty show as "Assigned". */
  const fetchAssignments = useCallback(async () => {
    if (!canAssign) return
    try {
      const res = await authFetch('/api/assignments?view=managed')
      if (!res.ok) return
      const data = await res.json()
      const map: Record<string, string[]> = {}
      for (const assignment of data.assignments || []) {
        // A declined or cancelled assignment must not grey the person out —
        // they are exactly who you may want to approach again, or replace.
        if (
          !assignment.call?.id ||
          !assignment.assignee?.id ||
          assignment.status === 'CANCELLED' ||
          assignment.status === 'DECLINED'
        )
          continue
        map[assignment.call.id] = [...(map[assignment.call.id] || []), assignment.assignee.id]
      }
      setAssignedByCall(map)
    } catch {}
  }, [authFetch, canAssign])

  useEffect(() => {
    if (user) {
      fetchStats()
      fetchCalls()
      fetchFacets()
      fetchAssignments()
    }
  }, [user, fetchStats, fetchCalls, fetchFacets, fetchAssignments])

  // Deep link: /researcher-matching?callId=… (the DSR dashboards' "find
  // faculty for this call") preselects that call and runs the match, instead
  // of dropping the user on an empty picker. Read from window.location rather
  // than useSearchParams so the page needs no Suspense boundary.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false)
  const [autoSearchArmed, setAutoSearchArmed] = useState(false)
  useEffect(() => {
    if (!user || deepLinkHandled) return
    setDeepLinkHandled(true)
    const query = new URLSearchParams(window.location.search)
    // ?school=… arrives from a school desk: preselect it and open the filter
    // panel, so the officer lands on their own people rather than the whole org.
    const school = query.get('school')
    if (school) {
      setSchoolIds([school])
      setShowFilters(true)
    }
    const callId = query.get('callId')
    if (!callId) return
    void (async () => {
      try {
        const res = await authFetch(`/api/researcher-matching?callId=${encodeURIComponent(callId)}`)
        if (!res.ok) return
        const data = await res.json()
        const call: FundingCall | undefined = (data.calls || [])[0]
        if (call) {
          setMode('call')
          setSelectedCall(call)
          setAutoSearchArmed(true)
        }
      } catch {}
    })()
  }, [user, deepLinkHandled, authFetch])

  /** The shortlist for whichever call is selected. */
  const loadShortlist = useCallback(async (callId: string) => {
    try {
      const res = await authFetch(`/api/funding-dept/calls/${callId}/candidates`)
      if (!res.ok) {
        setShortlist({})
        return
      }
      const data = await res.json()
      const map: Record<string, string> = {}
      for (const row of data.candidates || []) map[row.user.id] = row.status
      setShortlist(map)
    } catch {
      setShortlist({})
    }
  }, [authFetch])

  useEffect(() => {
    if (!selectedCall) {
      setShortlist({})
      return
    }
    void loadShortlist(selectedCall.id)
  }, [selectedCall, loadShortlist])

  /** Add someone to the shortlist, or take them off it again. */
  const toggleShortlist = useCallback(async (target: MatchResult) => {
    if (!selectedCall) return
    const already = shortlist[target.userId]
    // Only a plain shortlist entry can be undone by the same button — someone
    // who has already been approached or has answered is history, not a draft.
    const removable = already === 'SHORTLISTED'
    try {
      const res = removable
        ? await authFetch(
            `/api/funding-dept/calls/${selectedCall.id}/candidates?userId=${encodeURIComponent(target.userId)}`,
            { method: 'DELETE' }
          )
        : await authFetch(`/api/funding-dept/calls/${selectedCall.id}/candidates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: target.userId,
              status: 'SHORTLISTED',
              matchScore: target.score ?? null,
              matchTier: target.matchTier ?? null,
            }),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setAssignError(data.error || 'Could not update the shortlist.')
        return
      }
      setShortlist((current) => {
        const next = { ...current }
        if (removable) delete next[target.userId]
        else next[target.userId] = 'SHORTLISTED'
        return next
      })
    } catch {
      setAssignError('Could not update the shortlist.')
    }
  }, [authFetch, selectedCall, shortlist])

  const departmentOptions = useMemo(() => {
    if (!facets) return []
    const schools = schoolIds.length > 0
      ? facets.schools.filter(school => schoolIds.includes(school.id))
      : facets.schools
    return schools.flatMap(school =>
      school.departments.map(department => ({ ...department, schoolName: school.name }))
    )
  }, [facets, schoolIds])

  /** Departments are what faculty actually belong to, so a School selection
   *  expands into its departments before hitting the API. */
  const effectiveOrgUnitIds = useMemo(() => {
    if (departmentIds.length > 0) return departmentIds
    if (schoolIds.length === 0 || !facets) return []
    return facets.schools
      .filter(school => schoolIds.includes(school.id))
      .flatMap(school => school.departments.map(department => department.id))
  }, [departmentIds, schoolIds, facets])

  const activeFilterCount = useMemo(() => (
    (schoolIds.length > 0 ? 1 : 0) +
    (departmentIds.length > 0 ? 1 : 0) +
    (researchAreaText.trim() ? 1 : 0) +
    (careerStage ? 1 : 0) +
    (designation ? 1 : 0) +
    (personLookup.trim() ? 1 : 0) +
    (institutionType ? 1 : 0) +
    (country ? 1 : 0) +
    (includeBelowThreshold ? 1 : 0)
  ), [
    schoolIds, departmentIds, researchAreaText, careerStage, designation, personLookup,
    institutionType, country, includeBelowThreshold,
  ])

  const toggleValue = (list: string[], value: string) =>
    list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]

  const clearFilters = () => {
    setSchoolIds([])
    setDepartmentIds([])
    setResearchAreaText('')
    setCareerStage('')
    setDesignation('')
    setPersonLookup('')
    setInstitutionType('')
    setCountry('')
    setIncludeBelowThreshold(false)
  }

  const handleSearch = useCallback(async () => {
    if (mode === 'call' && !selectedCall) return
    if (mode === 'text' && !searchQuery.trim()) return

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const body: any = {
        limit: 20,
        filters: {
          orgUnitIds: effectiveOrgUnitIds,
          researchAreas: researchAreaText
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean),
          careerStages: careerStage ? [careerStage] : [],
          designations: designation ? [designation] : [],
          person: personLookup.trim() || null,
          institutionTypes: institutionType ? [institutionType] : [],
          countries: country ? [country] : [],
          includeBelowThreshold,
        },
      }
      if (mode === 'call' && selectedCall) {
        body.fundingCallId = selectedCall.id
      } else {
        body.query = searchQuery
      }

      const res = await authFetch('/api/researcher-matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Search failed')
      }

      setResults(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [
    mode, selectedCall, searchQuery, authFetch, effectiveOrgUnitIds,
    researchAreaText, careerStage, designation, personLookup, institutionType, country,
    includeBelowThreshold,
  ])

  // Fires exactly once after a deep-linked call lands in state, so the page
  // arrives showing matches rather than an armed-but-idle picker.
  useEffect(() => {
    if (autoSearchArmed && mode === 'call' && selectedCall) {
      setAutoSearchArmed(false)
      void handleSearch()
    }
  }, [autoSearchArmed, mode, selectedCall, handleSearch])

  const openAssign = (result: MatchResult) => {
    setAssignTarget(result)
    setAssignDeadline('')
    setAssignMessage('')
    setAssignError(null)
  }

  const openProfile = useCallback(
    async (result: MatchResult) => {
      setProfileTarget(result)
      setProfileData(null)
      setProfileError(null)
      setProfileLoading(true)
      try {
        const res = await authFetch(
          `/api/researcher-matching?action=profile&userId=${encodeURIComponent(result.userId)}`
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not load the profile')
        setProfileData(data.profile)
      } catch (e: any) {
        setProfileError(e.message)
      } finally {
        setProfileLoading(false)
      }
    },
    [authFetch]
  )

  const toggleBulkSelection = (userId: string) => {
    setBulkSelection(current =>
      current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]
    )
  }

  const submitBulkAssignment = async () => {
    if (!selectedCall || bulkSelection.length === 0) return
    setBulkSaving(true)
    setBulkError(null)
    try {
      // Carry each person's own match score through, so provenance survives a
      // bulk circulation exactly as it does for a single assignment.
      const byUser = new Map((results?.results || []).map(r => [r.userId, r]))
      const res = await authFetch('/api/assignments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundingCallId: selectedCall.id,
          assignees: bulkSelection.map(userId => ({
            userId,
            matchScore: byUser.get(userId)?.score ?? null,
            matchTier: byUser.get(userId)?.matchTier ?? null,
          })),
          deadlineAt: bulkDeadline || null,
          message: bulkMessage || null,
          matchBasis: results?.scoreBasis || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not circulate the call')

      const createdIds: string[] = (data.created || []).map((row: any) => row.userId)
      setAssignedByCall(prev => ({
        ...prev,
        [selectedCall.id]: [...(prev[selectedCall.id] || []), ...createdIds],
      }))

      const skipped = data.skippedCount || 0
      setAssignNotice(
        `Assigned "${selectedCall.schemeTitle}" to ${data.createdCount} ${
          data.createdCount === 1 ? 'person' : 'people'
        }.` + (skipped > 0 ? ` ${skipped} skipped — see below.` : '')
      )
      if (skipped > 0) {
        // Skips are not failures, but they are the thing the officer needs to
        // read: "already assigned" and "outside your schools" mean different
        // follow-up actions.
        setBulkError(
          (data.skipped || [])
            .map((s: any) => `${s.name || s.userId}: ${s.reason}`)
            .join('\n')
        )
        setBulkSelection(bulkSelection.filter(id => !createdIds.includes(id)))
      } else {
        setBulkOpen(false)
        setBulkSelection([])
        setBulkMessage('')
        setBulkDeadline('')
      }
    } catch (e: any) {
      setBulkError(e.message)
    } finally {
      setBulkSaving(false)
    }
  }

  const submitAssignment = async () => {
    if (!assignTarget || !selectedCall) return
    setAssignSaving(true)
    setAssignError(null)
    try {
      const res = await authFetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundingCallId: selectedCall.id,
          assigneeUserId: assignTarget.userId,
          deadlineAt: assignDeadline || null,
          message: assignMessage || null,
          matchScore: assignTarget.score,
          matchTier: assignTarget.matchTier,
          matchBasis: results?.scoreBasis || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the assignment')

      setAssignedByCall(prev => ({
        ...prev,
        [selectedCall.id]: [...(prev[selectedCall.id] || []), assignTarget.userId],
      }))
      setAssignNotice(`Assigned "${selectedCall.schemeTitle}" to ${assignTarget.displayName}.`)
      setAssignTarget(null)
    } catch (e: any) {
      setAssignError(e.message)
    } finally {
      setAssignSaving(false)
    }
  }

  if (authLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Sign in required</h1>
          <p className="nk-sub mt-2">Log in to find researchers in your organization.</p>
        </div>
      </main>
    )
  }

  const searchDisabled =
    loading || (mode === 'call' && !selectedCall) || (mode === 'text' && !searchQuery.trim())

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-5">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Find researchers
          </h1>
          <p className="nk-sub mt-1">
            Match colleagues to a funding call or research topic, then assign it or circulate it in
            bulk.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        {/* Instrument row: what the matcher has to work with. */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: 'Researchers',
              value: stats?.researchers,
              sub: `${stats?.researchersWithEmbedding ?? 0} matchable`,
            },
            { label: 'Research areas', value: stats?.researchAreas, sub: 'saved in your org' },
            {
              label: 'Publications',
              value: stats?.publications,
              sub: `${stats?.publicationsWithEmbedding ?? 0} matchable`,
            },
            { label: 'Funding calls', value: stats?.fundingCalls, sub: 'available to match' },
          ].map((s) => (
            <div key={s.label} className="nk-panel px-4 py-3">
              <p className="nk-eyebrow">{s.label}</p>
              <p className="nk-readout mt-2">{s.value ?? '—'}</p>
              <p className="nk-sub mt-1 text-[11.5px]">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Mode: one segmented control, not two loose buttons. */}
        <div className="mb-4 inline-flex rounded-lg border border-nickel-200 bg-white p-0.5">
          {(
            [
              { key: 'call', label: 'Match by funding call' },
              { key: 'text', label: 'Match by research topic' },
            ] as const
          ).map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setMode(entry.key)}
              aria-pressed={mode === entry.key}
              className={
                mode === entry.key
                  ? 'rounded-md bg-cobalt-600 px-4 py-1.5 text-[13px] font-medium text-white'
                  : 'rounded-md px-4 py-1.5 text-[13px] font-medium text-nickel-600 transition hover:text-nickel-900'
              }
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* Step panel: pick the call (or describe the topic) and search. */}
        <section className="nk-panel px-5 py-4">
          {mode === 'call' ? (
            selectedCall && !changingCall ? (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-cobalt-200 bg-cobalt-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="nk-eyebrow text-cobalt-700">Selected call</p>
                  <p className="mt-1 text-[14.5px] font-semibold text-nickel-900">
                    {selectedCall.schemeTitle}
                  </p>
                  <p className="nk-sub mt-0.5">
                    {selectedCall.agencyName || 'Unknown agency'}
                    {selectedCall.closeDate
                      ? ` · closes ${new Date(selectedCall.closeDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : ''}
                  </p>
                  {selectedCall.description ? (
                    <p className="nk-sub mt-1.5 max-w-2xl text-[12.5px]">
                      {selectedCall.description.slice(0, 180)}
                      {selectedCall.description.length > 180 ? '…' : ''}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="nk-btn-secondary nk-btn-sm shrink-0"
                  onClick={() => setChangingCall(true)}
                >
                  Change call
                </button>
              </div>
            ) : (
              <div>
                <label className="nk-label mb-2" htmlFor="call-search">
                  Select a funding call
                </label>
                <input
                  id="call-search"
                  type="text"
                  className="nk-input"
                  value={callSearchQuery}
                  onChange={(e) => {
                    setCallSearchQuery(e.target.value)
                    fetchCalls(e.target.value, {
                      agency: callAgency,
                      discipline: callDiscipline,
                      fundingKind: callFundingKind,
                      closingInDays: callClosingInDays,
                    })
                  }}
                  placeholder="Search by title, agency, or description…"
                />

                {/* Narrowing the call list matters most where it is longest —
                    a tenant with hundreds of published calls. */}
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {facets && facets.callAgencies.length > 0 && (
                    <select
                      className="nk-select"
                      aria-label="Filter calls by agency"
                      value={callAgency}
                      onChange={(e) => {
                        setCallAgency(e.target.value)
                        fetchCalls(callSearchQuery, {
                          agency: e.target.value,
                          discipline: callDiscipline,
                          fundingKind: callFundingKind,
                          closingInDays: callClosingInDays,
                        })
                      }}
                    >
                      <option value="">All agencies</option>
                      {facets.callAgencies.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  )}

                  {facets && facets.callDisciplines.length > 0 && (
                    <select
                      className="nk-select"
                      aria-label="Filter calls by discipline"
                      value={callDiscipline}
                      onChange={(e) => {
                        setCallDiscipline(e.target.value)
                        fetchCalls(callSearchQuery, {
                          agency: callAgency,
                          discipline: e.target.value,
                          fundingKind: callFundingKind,
                          closingInDays: callClosingInDays,
                        })
                      }}
                    >
                      <option value="">All disciplines</option>
                      {facets.callDisciplines.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  )}

                  {facets && facets.callFundingKinds.length > 0 && (
                    <select
                      className="nk-select"
                      aria-label="Filter calls by funding kind"
                      value={callFundingKind}
                      onChange={(e) => {
                        setCallFundingKind(e.target.value)
                        fetchCalls(callSearchQuery, {
                          agency: callAgency,
                          discipline: callDiscipline,
                          fundingKind: e.target.value,
                          closingInDays: callClosingInDays,
                        })
                      }}
                    >
                      <option value="">All funding kinds</option>
                      {facets.callFundingKinds.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    className="nk-select"
                    aria-label="Filter calls by deadline"
                    value={callClosingInDays}
                    onChange={(e) => {
                      setCallClosingInDays(e.target.value)
                      fetchCalls(callSearchQuery, {
                        agency: callAgency,
                        discipline: callDiscipline,
                        fundingKind: callFundingKind,
                        closingInDays: e.target.value,
                      })
                    }}
                  >
                    {CALL_CLOSING_WINDOWS.map((window) => (
                      <option key={window.value} value={window.value}>
                        {window.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-nickel-200">
                  {loadingCalls ? (
                    <p className="nk-sub px-4 py-6 text-center">Loading calls…</p>
                  ) : calls.length === 0 ? (
                    <p className="nk-sub px-4 py-6 text-center">
                      No funding calls match that search.
                    </p>
                  ) : (
                    calls.map((call) => (
                      <button
                        key={call.id}
                        type="button"
                        onClick={() => {
                          if (selectedCall?.id !== call.id) {
                            // Stale results and ticked people belong to the old
                            // call — carrying them over would circulate the
                            // wrong thing.
                            setResults(null)
                            setBulkSelection([])
                          }
                          setSelectedCall(call)
                          setChangingCall(false)
                        }}
                        className={`block w-full border-b border-nickel-100 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-nickel-50 ${
                          selectedCall?.id === call.id ? 'bg-cobalt-50' : 'bg-white'
                        }`}
                      >
                        <span className="block text-[13.5px] font-medium text-nickel-900">
                          {call.schemeTitle}
                        </span>
                        <span className="nk-sub mt-0.5 block text-[12px]">
                          {call.agencyName || 'Unknown agency'}
                          {call.closeDate
                            ? ` · closes ${new Date(call.closeDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : ''}
                        </span>
                        {call.disciplines?.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {call.disciplines.slice(0, 3).map((d) => (
                              <span key={d} className="nk-badge normal-case tracking-normal">
                                {d}
                              </span>
                            ))}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          ) : (
            <div>
              <label className="nk-label mb-2" htmlFor="topic-search">
                Research topic or description
              </label>
              <textarea
                id="topic-search"
                className="nk-input resize-y"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                rows={4}
                placeholder="Describe the research area, e.g. 'machine learning for crop yield prediction using satellite imagery and drone data in Indian agriculture'…"
              />
            </div>
          )}

          {/* Filters */}
          <div className="mt-4 border-t border-nickel-100 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                {showFilters ? 'Hide filters' : 'Filters'}
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-cobalt-600 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="text-[12.5px] font-medium text-cobalt-700 hover:underline"
                  onClick={clearFilters}
                >
                  Clear all
                </button>
              )}
            </div>

            {showFilters && (
              <div className="nk-panel-quiet mt-3 px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {facets && facets.schools.length > 0 && (
                    <>
                      <div>
                        <span className="nk-label mb-1.5">School</span>
                        <div className={checkboxListClass}>
                          {facets.schools.map((school) => (
                            <label
                              key={school.id}
                              className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-nickel-700"
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-cobalt-600"
                                checked={schoolIds.includes(school.id)}
                                onChange={() => {
                                  const next = toggleValue(schoolIds, school.id)
                                  setSchoolIds(next)
                                  // Drop department picks that are no longer offered.
                                  if (next.length > 0) {
                                    const allowed = new Set(
                                      facets.schools
                                        .filter((s) => next.includes(s.id))
                                        .flatMap((s) => s.departments.map((d) => d.id))
                                    )
                                    setDepartmentIds((ids) => ids.filter((id) => allowed.has(id)))
                                  }
                                }}
                              />
                              {school.name}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="nk-label mb-1.5">Department</span>
                        <div className={checkboxListClass}>
                          {departmentOptions.length === 0 ? (
                            <p className="nk-sub py-1 text-[12px]">No departments yet</p>
                          ) : (
                            departmentOptions.map((department) => (
                              <label
                                key={department.id}
                                className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-nickel-700"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-cobalt-600"
                                  checked={departmentIds.includes(department.id)}
                                  onChange={() =>
                                    setDepartmentIds(toggleValue(departmentIds, department.id))
                                  }
                                />
                                {department.name}
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="nk-label mb-1.5" htmlFor="filter-areas">
                      Discipline / research area
                    </label>
                    <input
                      id="filter-areas"
                      type="text"
                      className="nk-input"
                      value={researchAreaText}
                      onChange={(e) => setResearchAreaText(e.target.value)}
                      placeholder="e.g. machine learning, genomics"
                    />
                    <p className="nk-sub mt-1 text-[11.5px]">
                      Comma-separated; matches research areas and keywords.
                    </p>
                  </div>

                  <div>
                    <label className="nk-label mb-1.5" htmlFor="filter-person">
                      Name, email or employee ID
                    </label>
                    <input
                      id="filter-person"
                      type="text"
                      className="nk-input"
                      value={personLookup}
                      onChange={(e) => setPersonLookup(e.target.value)}
                      placeholder="e.g. 21345 or Sharma"
                    />
                    <p className="nk-sub mt-1 text-[11.5px]">
                      Pins the search to one person — use it to check whether a specific faculty
                      member fits this call.
                    </p>
                  </div>

                  {facets && facets.designations.length > 0 && (
                    <div>
                      <label className="nk-label mb-1.5" htmlFor="filter-designation">
                        Designation
                      </label>
                      <select
                        id="filter-designation"
                        className="nk-select"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                      >
                        <option value="">Any</option>
                        {facets.designations.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {facets && facets.careerStages.length > 0 && (
                    <div>
                      <label className="nk-label mb-1.5" htmlFor="filter-stage">
                        Career stage
                      </label>
                      <select
                        id="filter-stage"
                        className="nk-select"
                        value={careerStage}
                        onChange={(e) => setCareerStage(e.target.value)}
                      >
                        <option value="">Any</option>
                        {facets.careerStages.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {facets && facets.institutionTypes.length > 0 && (
                    <div>
                      <label className="nk-label mb-1.5" htmlFor="filter-institution">
                        Institution type
                      </label>
                      <select
                        id="filter-institution"
                        className="nk-select"
                        value={institutionType}
                        onChange={(e) => setInstitutionType(e.target.value)}
                      >
                        <option value="">Any</option>
                        {facets.institutionTypes.map((type) => (
                          <option key={type} value={type}>
                            {type.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {facets && facets.countries.length > 0 && (
                    <div>
                      <label className="nk-label mb-1.5" htmlFor="filter-country">
                        Country
                      </label>
                      <select
                        id="filter-country"
                        className="nk-select"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      >
                        <option value="">Any</option>
                        {facets.countries.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-cobalt-600"
                    checked={includeBelowThreshold}
                    onChange={(e) => setIncludeBelowThreshold(e.target.checked)}
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-nickel-800">
                      Broaden — include weaker matches
                    </span>
                    <span className="nk-sub block text-[11.5px]">
                      Keeps candidates below the relevance threshold so you can still explore when no
                      strong match exists. Results stay ranked and tiered.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-nickel-100 pt-4">
            <button
              type="button"
              className="nk-btn-primary"
              onClick={() => void handleSearch()}
              disabled={searchDisabled}
            >
              {loading ? 'Searching…' : 'Find matching researchers'}
            </button>
            {mode === 'call' && !selectedCall && (
              <p className="nk-sub">Select a funding call first.</p>
            )}
            {mode === 'text' && !searchQuery.trim() && (
              <p className="nk-sub">Describe a topic first.</p>
            )}
          </div>
        </section>

        {error && (
          <div className="nk-panel mt-4 border-red-200 bg-red-50 px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        {assignNotice && (
          <div className="nk-panel mt-4 flex items-center justify-between gap-3 border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[13px] text-emerald-700">{assignNotice}</p>
            <button
              type="button"
              className="text-[16px] leading-none text-emerald-700 hover:text-emerald-900"
              onClick={() => setAssignNotice(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Skeletons while the match runs, so the page never jumps. */}
        {loading && !results && (
          <div className="mt-6 space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="nk-panel animate-pulse px-5 py-4">
                <div className="h-4 w-1/3 rounded bg-nickel-100" />
                <div className="mt-3 h-3 w-2/3 rounded bg-nickel-100" />
                <div className="mt-2 h-3 w-1/2 rounded bg-nickel-100" />
              </div>
            ))}
          </div>
        )}

        {results && (
          <div className="mt-6">
            <MatchResults
              response={results}
              emptyMessage="No researchers in your organization passed the relevance threshold. Try a different funding call, relax the filters, or tick “Broaden — include weaker matches”."
              onAssign={canAssign && mode === 'call' && selectedCall ? openAssign : undefined}
              onShortlist={
                canAssign && mode === 'call' && selectedCall ? toggleShortlist : undefined
              }
              onViewProfile={openProfile}
              assignedUserIds={selectedCall ? assignedByCall[selectedCall.id] || [] : []}
              shortlistByUserId={shortlist}
              selectedUserIds={bulkSelection}
              onToggleSelect={
                canAssign && mode === 'call' && selectedCall ? toggleBulkSelection : undefined
              }
              onSelectVisible={setBulkSelection}
            />
          </div>
        )}

        {/* Bulk circulation bar — appears once anyone is ticked */}
        {canAssign && mode === 'call' && selectedCall && bulkSelection.length > 0 && (
          <div className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-nickel-700 bg-nickel-900 px-4 py-3 text-white shadow-nk-sheet">
            <span className="text-[14px] font-semibold">{bulkSelection.length} selected</span>
            <span className="hidden text-[13px] text-nickel-300 sm:inline">
              Circulate “{selectedCall.schemeTitle}” to all of them
            </span>
            <button
              type="button"
              className="ml-auto rounded-md border border-nickel-600 px-3 py-1.5 text-[12.5px] text-nickel-300 transition hover:border-nickel-500 hover:text-white"
              onClick={() => setBulkSelection([])}
            >
              Clear
            </button>
            <button type="button" className="nk-btn-primary nk-btn-sm" onClick={() => setBulkOpen(true)}>
              Assign to {bulkSelection.length}
            </button>
          </div>
        )}

        {/* Bulk assign modal */}
        {bulkOpen && selectedCall && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/50 p-4"
            onClick={() => !bulkSaving && setBulkOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-nickel-200 bg-white p-6 shadow-nk-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Circulate call"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[17px] font-semibold text-nickel-900">
                Circulate to {bulkSelection.length} {bulkSelection.length === 1 ? 'person' : 'people'}
              </h3>
              <p className="nk-sub mt-1">
                {selectedCall.schemeTitle}. Everyone gets the same internal deadline and note, and is
                emailed individually.
              </p>

              <label className="nk-label mt-4" htmlFor="bulk-deadline">
                Internal deadline
              </label>
              <input
                id="bulk-deadline"
                type="date"
                className="nk-input mt-1"
                value={bulkDeadline}
                onChange={(e) => setBulkDeadline(e.target.value)}
              />

              <label className="nk-label mt-3" htmlFor="bulk-message">
                Note to everyone (optional)
              </label>
              <textarea
                id="bulk-message"
                className="nk-input mt-1 resize-y"
                rows={3}
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                placeholder="e.g. Please confirm by Friday if you intend to apply — happy to help with the budget."
              />

              {bulkError && <p className="mt-3 text-[13px] text-red-700">{bulkError}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="nk-btn-secondary"
                  onClick={() => setBulkOpen(false)}
                  disabled={bulkSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="nk-btn-primary"
                  onClick={() => void submitBulkAssignment()}
                  disabled={bulkSaving}
                >
                  {bulkSaving ? 'Assigning…' : `Assign to ${bulkSelection.length}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Profile viewer */}
        {profileTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/50 p-4"
            onClick={() => setProfileTarget(null)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-nickel-200 bg-white shadow-nk-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Faculty profile"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-nickel-200 px-6 py-4">
                <div className="min-w-0">
                  <p className="nk-eyebrow">Faculty profile</p>
                  <h3 className="mt-1 text-[17px] font-semibold text-nickel-900">
                    {profileData?.name || profileTarget.displayName}
                  </h3>
                  <p className="nk-sub mt-0.5">
                    {[
                      profileData?.designation,
                      profileData?.department,
                      profileData?.school,
                    ]
                      .filter(Boolean)
                      .join(' · ') ||
                      [profileTarget.department, profileTarget.institutionName]
                        .filter(Boolean)
                        .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="nk-btn-ghost nk-btn-sm"
                  onClick={() => setProfileTarget(null)}
                  aria-label="Close profile"
                >
                  ✕
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                {profileLoading ? (
                  <div className="animate-pulse space-y-3" aria-hidden>
                    <div className="h-4 w-1/2 rounded bg-nickel-100" />
                    <div className="h-3 w-2/3 rounded bg-nickel-100" />
                    <div className="h-3 w-1/3 rounded bg-nickel-100" />
                  </div>
                ) : profileError ? (
                  <p className="text-[13px] text-red-700">{profileError}</p>
                ) : profileData ? (
                  <div className="space-y-4">
                    {/* External research profiles — the quick outbound checks. */}
                    <div>
                      <p className="nk-eyebrow mb-2">Research profiles</p>
                      <div className="flex flex-wrap gap-2">
                        {PROFILE_LINKS.filter((l) => profileData.links[l.key]).map((l) => (
                          <a
                            key={l.key}
                            href={profileData.links[l.key] as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="nk-btn-secondary nk-btn-sm"
                          >
                            {l.label} ↗
                          </a>
                        ))}
                        {PROFILE_LINKS.every((l) => !profileData.links[l.key]) && (
                          <p className="nk-sub">
                            No external profiles on file — ask them to add Google Scholar / Scopus /
                            ORCID links to their researcher profile.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="nk-panel-quiet px-3.5 py-2.5">
                        <p className="nk-eyebrow">Contact</p>
                        <a
                          href={`mailto:${profileData.email}`}
                          className="mt-1 block truncate text-[13px] font-medium text-cobalt-700 hover:underline"
                        >
                          {profileData.email}
                        </a>
                        {profileData.employeeId && (
                          <p className="nk-sub mt-0.5 text-[11.5px]">
                            Employee ID {profileData.employeeId}
                          </p>
                        )}
                      </div>
                      <div className="nk-panel-quiet px-3.5 py-2.5">
                        <p className="nk-eyebrow">Standing</p>
                        <p className="mt-1 text-[13px] text-nickel-800">
                          {[
                            profileData.careerStage?.replace(/_/g, ' '),
                            profileData.yearsOfExperience
                              ? `${profileData.yearsOfExperience} yrs experience`
                              : null,
                            profileData.country,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </p>
                        {profileData.languages.length > 0 && (
                          <p className="nk-sub mt-0.5 text-[11.5px]">
                            Applies in {profileData.languages.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>

                    {profileData.summary && (
                      <div>
                        <p className="nk-eyebrow mb-1.5">Research summary</p>
                        <p className="text-[13px] leading-relaxed text-nickel-700">
                          {profileData.summary}
                        </p>
                      </div>
                    )}

                    {profileData.researchAreas.length > 0 && (
                      <div>
                        <p className="nk-eyebrow mb-1.5">Research areas</p>
                        <div className="flex flex-wrap gap-1">
                          {profileData.researchAreas.map((area) => (
                            <span key={area} className="nk-badge nk-badge-live normal-case tracking-normal">
                              {area}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {profileData.keywords.length > 0 && (
                      <div>
                        <p className="nk-eyebrow mb-1.5">Keywords</p>
                        <div className="flex flex-wrap gap-1">
                          {profileData.keywords.map((kw) => (
                            <span key={kw} className="nk-badge normal-case tracking-normal">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="nk-eyebrow mb-1.5">
                        Publications on file ({profileData.publications.length})
                      </p>
                      {profileData.publications.length === 0 ? (
                        <p className="nk-sub">
                          None uploaded yet — publications strengthen matching, so worth nudging.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {profileData.publications.map((pub) => {
                            const link = pub.doi
                              ? `https://doi.org/${pub.doi}`
                              : pub.url || null
                            return (
                              <li key={pub.id} className="border-l-2 border-nickel-200 pl-3">
                                {link ? (
                                  <a
                                    href={link}
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
                                    pub.authors.slice(0, 4).join(', ') +
                                      (pub.authors.length > 4 ? ' et al.' : ''),
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
                <button type="button" className="nk-btn-secondary" onClick={() => setProfileTarget(null)}>
                  Close
                </button>
                {canAssign &&
                  mode === 'call' &&
                  selectedCall &&
                  profileTarget &&
                  !(assignedByCall[selectedCall.id] || []).includes(profileTarget.userId) && (
                    <button
                      type="button"
                      className="nk-btn-primary"
                      onClick={() => {
                        const target = profileTarget
                        setProfileTarget(null)
                        openAssign(target)
                      }}
                    >
                      Assign call
                    </button>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Single assign modal */}
        {assignTarget && selectedCall && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-nickel-900/50 p-4"
            onClick={() => !assignSaving && setAssignTarget(null)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-nickel-200 bg-white p-6 shadow-nk-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Assign funding call"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[17px] font-semibold text-nickel-900">Assign funding call</h3>
              <p className="nk-sub mt-1">
                Assigning <span className="font-medium text-nickel-800">{selectedCall.schemeTitle}</span>{' '}
                to <span className="font-medium text-nickel-800">{assignTarget.displayName}</span>.
              </p>

              <label className="nk-label mt-4" htmlFor="assign-deadline">
                Internal deadline
              </label>
              <input
                id="assign-deadline"
                type="date"
                className="nk-input mt-1"
                value={assignDeadline}
                onChange={(e) => setAssignDeadline(e.target.value)}
              />

              <label className="nk-label mt-3" htmlFor="assign-message">
                Message to the faculty member
              </label>
              <textarea
                id="assign-message"
                className="nk-input mt-1 resize-y"
                rows={4}
                value={assignMessage}
                onChange={(e) => setAssignMessage(e.target.value)}
                placeholder="Add context — why them, what to focus on, who to coordinate with…"
              />

              {assignError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[12.5px] text-red-700">{assignError}</p>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="nk-btn-secondary"
                  onClick={() => setAssignTarget(null)}
                  disabled={assignSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="nk-btn-primary"
                  onClick={() => void submitAssignment()}
                  disabled={assignSaving}
                >
                  {assignSaving ? 'Assigning…' : 'Assign call'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
