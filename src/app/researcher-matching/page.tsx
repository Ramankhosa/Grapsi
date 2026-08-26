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
}

// Fallback only. The authoritative answer is /api/funding-dept/me, which
// reports the server's own verdict: funding department members and org unit
// heads can assign while holding none of these roles, and this screen used to
// hide the assign button from exactly those people.
const ASSIGNER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN', 'CALL_ASSIGNER', 'CALL_ADMIN']

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: '#374151',
}

const checkboxListStyle: React.CSSProperties = {
  maxHeight: 116, overflowY: 'auto', border: '1px solid #e5e7eb',
  borderRadius: 6, padding: '6px 8px', background: '#fff',
}

export default function TenantResearcherMatchingPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const { me } = useFundingDeptMe()

  const [calls, setCalls] = useState<FundingCall[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [callSearchQuery, setCallSearchQuery] = useState('')
  const [selectedCall, setSelectedCall] = useState<FundingCall | null>(null)
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
  const [institutionType, setInstitutionType] = useState('')
  const [country, setCountry] = useState('')
  const [includeBelowThreshold, setIncludeBelowThreshold] = useState(false)

  // Assignment
  const [assignTarget, setAssignTarget] = useState<MatchResult | null>(null)
  const [assignDeadline, setAssignDeadline] = useState('')
  const [assignMessage, setAssignMessage] = useState('')
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignNotice, setAssignNotice] = useState<string | null>(null)
  const [assignedByCall, setAssignedByCall] = useState<Record<string, string[]>>({})

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

  const fetchCalls = useCallback(async (q = '') => {
    setLoadingCalls(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (q) params.set('q', q)
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
    const callId = new URLSearchParams(window.location.search).get('callId')
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
    (institutionType ? 1 : 0) +
    (country ? 1 : 0) +
    (includeBelowThreshold ? 1 : 0)
  ), [schoolIds, departmentIds, researchAreaText, careerStage, institutionType, country, includeBelowThreshold])

  const toggleValue = (list: string[], value: string) =>
    list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]

  const clearFilters = () => {
    setSchoolIds([])
    setDepartmentIds([])
    setResearchAreaText('')
    setCareerStage('')
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
    researchAreaText, careerStage, institutionType, country, includeBelowThreshold,
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
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
  }

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Sign in required</h2>
        <p>Please log in to find researchers in your organization.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        Find Researchers
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        Match colleagues in your organization to a funding call or research topic using semantic embeddings.
      </p>

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12, marginBottom: 24,
        }}>
          {[
            { label: 'Researchers', value: stats.researchers, sub: `${stats.researchersWithEmbedding} embedded` },
            { label: 'Research Areas', value: stats.researchAreas, sub: 'in your org' },
            { label: 'Publications', value: stats.publications, sub: `${stats.publicationsWithEmbedding} embedded` },
            { label: 'Funding Calls', value: stats.fundingCalls, sub: 'available' },
          ].map(s => (
            <div key={s.label} style={{
              background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '12px 16px',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode('call')}
          style={{
            padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 14,
            background: mode === 'call' ? '#2563eb' : '#e5e7eb',
            color: mode === 'call' ? '#fff' : '#374151',
          }}
        >
          Match by Funding Call
        </button>
        <button
          onClick={() => setMode('text')}
          style={{
            padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 14,
            background: mode === 'text' ? '#2563eb' : '#e5e7eb',
            color: mode === 'text' ? '#fff' : '#374151',
          }}
        >
          Match by Research Topic
        </button>
      </div>

      {/* Search input */}
      <div style={{
        border: '1px solid #d1d5db', borderRadius: 8, padding: 16,
        marginBottom: 24, background: '#fff',
      }}>
        {mode === 'call' ? (
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
              Select a Funding Call
            </label>
            <input
              type="text"
              value={callSearchQuery}
              onChange={e => {
                setCallSearchQuery(e.target.value)
                fetchCalls(e.target.value)
              }}
              placeholder="Search funding calls by title, agency, or description..."
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14, marginBottom: 8,
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              maxHeight: 240, overflowY: 'auto', border: '1px solid #e5e7eb',
              borderRadius: 6,
            }}>
              {loadingCalls ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
              ) : calls.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No funding calls found</div>
              ) : calls.map(call => (
                <div
                  key={call.id}
                  onClick={() => setSelectedCall(call)}
                  style={{
                    padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                    background: selectedCall?.id === call.id ? '#eff6ff' : 'transparent',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{call.schemeTitle}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {call.agencyName}
                    {call.closeDate && ` · Closes: ${new Date(call.closeDate).toLocaleDateString()}`}
                  </div>
                  {call.disciplines?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      {call.disciplines.slice(0, 3).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {selectedCall && (
              <div style={{
                marginTop: 12, padding: 12, background: '#f0f9ff', borderRadius: 6,
                border: '1px solid #bfdbfe',
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  Selected: {selectedCall.schemeTitle}
                </div>
                <div style={{ fontSize: 12, color: '#4b5563' }}>
                  {selectedCall.description?.slice(0, 200)}
                  {(selectedCall.description?.length || 0) > 200 ? '...' : ''}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
              Research Topic or Description
            </label>
            <textarea
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Describe the research area, e.g. 'machine learning for crop yield prediction using satellite imagery and drone data in Indian agriculture'..."
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14, resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Filters */}
        <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowFilters(v => !v)}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151',
              }}
            >
              {showFilters ? 'Hide filters' : 'Filters'}
              {activeFilterCount > 0 && (
                <span style={{
                  marginLeft: 6, background: '#2563eb', color: '#fff', borderRadius: 10,
                  padding: '1px 7px', fontSize: 11,
                }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                style={{
                  background: 'none', border: 'none', color: '#2563eb',
                  cursor: 'pointer', fontSize: 12, padding: 0,
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {showFilters && (
            <div style={{
              marginTop: 12, padding: 12, background: '#f9fafb',
              border: '1px solid #e5e7eb', borderRadius: 8,
            }}>
              <div style={{
                display: 'grid', gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              }}>
                {facets && facets.schools.length > 0 && (
                  <>
                    <div>
                      <label style={labelStyle}>School</label>
                      <div style={checkboxListStyle}>
                        {facets.schools.map(school => (
                          <label key={school.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 12, padding: '2px 0', cursor: 'pointer',
                          }}>
                            <input
                              type="checkbox"
                              checked={schoolIds.includes(school.id)}
                              onChange={() => {
                                const next = toggleValue(schoolIds, school.id)
                                setSchoolIds(next)
                                // Drop department picks that are no longer offered.
                                if (next.length > 0) {
                                  const allowed = new Set(
                                    facets.schools
                                      .filter(s => next.includes(s.id))
                                      .flatMap(s => s.departments.map(d => d.id))
                                  )
                                  setDepartmentIds(ids => ids.filter(id => allowed.has(id)))
                                }
                              }}
                            />
                            {school.name}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Department</label>
                      <div style={checkboxListStyle}>
                        {departmentOptions.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>No departments yet</div>
                        ) : departmentOptions.map(department => (
                          <label key={department.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 12, padding: '2px 0', cursor: 'pointer',
                          }}>
                            <input
                              type="checkbox"
                              checked={departmentIds.includes(department.id)}
                              onChange={() => setDepartmentIds(toggleValue(departmentIds, department.id))}
                            />
                            {department.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label style={labelStyle}>Discipline / research area</label>
                  <input
                    type="text"
                    value={researchAreaText}
                    onChange={e => setResearchAreaText(e.target.value)}
                    placeholder="e.g. machine learning, genomics"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                    Comma-separated; matches research areas and keywords.
                  </div>
                </div>

                {facets && facets.careerStages.length > 0 && (
                  <div>
                    <label style={labelStyle}>Career stage</label>
                    <select value={careerStage} onChange={e => setCareerStage(e.target.value)} style={inputStyle}>
                      <option value="">Any</option>
                      {facets.careerStages.map(stage => (
                        <option key={stage} value={stage}>{stage.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                )}

                {facets && facets.institutionTypes.length > 0 && (
                  <div>
                    <label style={labelStyle}>Institution type</label>
                    <select value={institutionType} onChange={e => setInstitutionType(e.target.value)} style={inputStyle}>
                      <option value="">Any</option>
                      {facets.institutionTypes.map(type => (
                        <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                )}

                {facets && facets.countries.length > 0 && (
                  <div>
                    <label style={labelStyle}>Country</label>
                    <select value={country} onChange={e => setCountry(e.target.value)} style={inputStyle}>
                      <option value="">Any</option>
                      {facets.countries.map(entry => (
                        <option key={entry} value={entry}>{entry}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12,
                fontSize: 13, color: '#374151', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={includeBelowThreshold}
                  onChange={e => setIncludeBelowThreshold(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>Broaden — include weaker matches</strong>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    Keeps candidates that fall below the relevance threshold, so you can still explore
                    options when no strong match exists. Results stay ranked and tiered.
                  </div>
                </span>
              </label>
            </div>
          )}
        </div>

        <button
          onClick={handleSearch}
          disabled={loading || (mode === 'call' && !selectedCall) || (mode === 'text' && !searchQuery.trim())}
          style={{
            marginTop: 12, padding: '10px 28px', borderRadius: 6, border: 'none',
            background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Searching...' : 'Find Matching Researchers'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: 12, background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 6, color: '#dc2626', marginBottom: 16, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Assignment confirmation */}
      {assignNotice && (
        <div style={{
          padding: 12, background: '#ecfdf5', border: '1px solid #a7f3d0',
          borderRadius: 6, color: '#047857', marginBottom: 16, fontSize: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span>{assignNotice}</span>
          <button
            onClick={() => setAssignNotice(null)}
            style={{ background: 'none', border: 'none', color: '#047857', cursor: 'pointer', fontSize: 18 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Results */}
      {results && (
        <MatchResults
          response={results}
          emptyMessage="No researchers in your organization passed the relevance threshold. Try a different funding call, relax the filters, or tick “Broaden — include weaker matches”."
          onAssign={canAssign && mode === 'call' && selectedCall ? openAssign : undefined}
          assignedUserIds={selectedCall ? assignedByCall[selectedCall.id] || [] : []}
          selectedUserIds={bulkSelection}
          onToggleSelect={
            canAssign && mode === 'call' && selectedCall ? toggleBulkSelection : undefined
          }
          onSelectVisible={setBulkSelection}
        />
      )}

      {/* Bulk circulation bar — appears once anyone is ticked */}
      {canAssign && mode === 'call' && selectedCall && bulkSelection.length > 0 && (
        <div
          style={{
            position: 'sticky', bottom: 16, marginTop: 16, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 16px', borderRadius: 10, background: '#111827',
            color: '#fff', boxShadow: '0 8px 24px rgba(17,24,39,0.24)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {bulkSelection.length} selected
          </span>
          <span style={{ fontSize: 13, color: '#d1d5db' }}>
            Circulate “{selectedCall.schemeTitle}” to all of them
          </span>
          <button
            onClick={() => setBulkSelection([])}
            style={{
              marginLeft: 'auto', background: 'none', border: '1px solid #4b5563',
              color: '#d1d5db', borderRadius: 6, padding: '6px 12px',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => setBulkOpen(true)}
            style={{
              background: '#2563eb', border: 'none', color: '#fff', borderRadius: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Assign to {bulkSelection.length}
          </button>
        </div>
      )}

      {/* Bulk assign modal */}
      {bulkOpen && selectedCall && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: '100%', maxWidth: 520 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Circulate to {bulkSelection.length} {bulkSelection.length === 1 ? 'person' : 'people'}
            </h3>
            <p style={{ marginTop: 6, marginBottom: 16, fontSize: 13, color: '#6b7280' }}>
              {selectedCall.schemeTitle}. Everyone gets the same internal deadline and note, and is
              emailed individually.
            </p>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Internal deadline
            </label>
            <input
              type="date"
              value={bulkDeadline}
              onChange={e => setBulkDeadline(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14, marginBottom: 12,
              }}
            />

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Note to everyone (optional)
            </label>
            <textarea
              value={bulkMessage}
              onChange={e => setBulkMessage(e.target.value)}
              rows={3}
              placeholder="e.g. Please confirm by Friday if you intend to apply — happy to help with the budget."
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14, marginBottom: 8,
              }}
            />

            {bulkError && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{bulkError}</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => setBulkOpen(false)}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#fff', fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitBulkAssignment}
                disabled={bulkSaving}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: bulkSaving ? '#93c5fd' : '#2563eb', color: '#fff',
                  fontSize: 13, fontWeight: 600,
                  cursor: bulkSaving ? 'default' : 'pointer',
                }}
              >
                {bulkSaving ? 'Assigning…' : `Assign to ${bulkSelection.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {assignTarget && selectedCall && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}
          onClick={() => !assignSaving && setAssignTarget(null)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 10, padding: 20,
              width: '100%', maxWidth: 480, boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>Assign funding call</h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
              Assigning <strong>{selectedCall.schemeTitle}</strong> to{' '}
              <strong>{assignTarget.displayName}</strong>.
            </p>

            <label style={labelStyle}>Internal deadline</label>
            <input
              type="date"
              value={assignDeadline}
              onChange={e => setAssignDeadline(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <label style={labelStyle}>Message to the faculty member</label>
            <textarea
              value={assignMessage}
              onChange={e => setAssignMessage(e.target.value)}
              rows={4}
              placeholder="Add context — why them, what to focus on, who to coordinate with..."
              style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }}
            />

            {assignError && (
              <div style={{
                padding: 10, background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 6, color: '#dc2626', marginBottom: 12, fontSize: 13,
              }}>
                {assignError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setAssignTarget(null)}
                disabled={assignSaving}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitAssignment}
                disabled={assignSaving}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: assignSaving ? 'wait' : 'pointer', opacity: assignSaving ? 0.7 : 1,
                }}
              >
                {assignSaving ? 'Assigning...' : 'Assign call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
