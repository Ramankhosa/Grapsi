'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

interface FundingCall {
  id: string
  schemeTitle: string
  agencyName: string | null
  description: string | null
  closeDate: string | null
  disciplines: string[]
  fundingKinds: string[]
}

interface MatchResult {
  userId: string
  displayName: string
  countryOfResidence: string | null
  institutionName: string | null
  institutionType: string | null
  department: string | null
  careerStage: string | null
  researchSummary: string | null
  researchAreas: string[]
  keywords: string[]
  score: number
  semanticSimilarity: number
  textRank: number
  matchedSources: string[]
  matchReason: string
}

interface SearchResponse {
  query: string
  fundingCallId: string | null
  totalResults: number
  results: MatchResult[]
  degradedMode: string | null
}

interface Stats {
  researchers: number
  researchersWithEmbedding: number
  researchAreas: number
  publications: number
  publicationsWithEmbedding: number
  fundingCalls: number
}

export default function TenantResearcherMatchingPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()

  const [calls, setCalls] = useState<FundingCall[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [callSearchQuery, setCallSearchQuery] = useState('')
  const [selectedCall, setSelectedCall] = useState<FundingCall | null>(null)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'call' | 'text'>('call')

  const fetchStats = useCallback(async () => {
    try {
      const res = await authFetch('/api/researcher-matching?action=stats')
      if (res.ok) setStats(await res.json())
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

  useEffect(() => {
    if (user) {
      fetchStats()
      fetchCalls()
    }
  }, [user, fetchStats, fetchCalls])

  const handleSearch = useCallback(async () => {
    if (mode === 'call' && !selectedCall) return
    if (mode === 'text' && !searchQuery.trim()) return

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const body: any = { limit: 50 }
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
  }, [mode, selectedCall, searchQuery, authFetch])

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

      {/* Results */}
      {results && (
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 16,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>
              {results.totalResults} Matching Researcher{results.totalResults !== 1 ? 's' : ''} Found
            </h2>
            {results.degradedMode && (
              <span style={{
                fontSize: 12, background: '#fef3c7', color: '#92400e',
                padding: '4px 8px', borderRadius: 4,
              }}>
                Degraded mode: {results.degradedMode}
              </span>
            )}
          </div>

          {results.results.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center', color: '#9ca3af',
              border: '1px dashed #d1d5db', borderRadius: 8,
            }}>
              No matching researchers found in your organization. Try a different funding call or broaden the search.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {results.results.map((r, idx) => (
                <div
                  key={r.userId}
                  style={{
                    border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: '#2563eb', color: '#fff', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 13, flexShrink: 0,
                        }}>
                          {idx + 1}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{r.displayName}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginLeft: 36 }}>
                        {[r.department, r.institutionName, r.countryOfResidence].filter(Boolean).join(' · ')}
                      </div>
                      {r.careerStage && (
                        <div style={{ fontSize: 12, color: '#9ca3af', marginLeft: 36, marginTop: 2 }}>
                          {r.careerStage.replace(/_/g, ' ')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{
                        fontSize: 20, fontWeight: 700,
                        color: r.score >= 0.7 ? '#059669' : r.score >= 0.4 ? '#d97706' : '#6b7280',
                      }}>
                        {(r.score * 100).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>match score</div>
                    </div>
                  </div>

                  {/* Research summary */}
                  {r.researchSummary && (
                    <div style={{
                      marginTop: 8, marginLeft: 36, fontSize: 13, color: '#374151',
                      lineHeight: 1.5,
                    }}>
                      {r.researchSummary.length > 300
                        ? r.researchSummary.slice(0, 300) + '...'
                        : r.researchSummary}
                    </div>
                  )}

                  {/* Research areas */}
                  {r.researchAreas?.length > 0 && (
                    <div style={{ marginTop: 8, marginLeft: 36, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {r.researchAreas.map(area => (
                        <span key={area} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 12,
                          background: '#eff6ff', color: '#1d4ed8', fontWeight: 500,
                        }}>
                          {area}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Keywords */}
                  {r.keywords?.length > 0 && (
                    <div style={{ marginTop: 4, marginLeft: 36, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {r.keywords.slice(0, 8).map(kw => (
                        <span key={kw} style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 8,
                          background: '#f3f4f6', color: '#6b7280',
                        }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Match details */}
                  <div style={{
                    marginTop: 8, marginLeft: 36, fontSize: 12, color: '#6b7280',
                    display: 'flex', gap: 16, flexWrap: 'wrap',
                  }}>
                    <span>Semantic: {(r.semanticSimilarity * 100).toFixed(0)}%</span>
                    <span>Text: {(r.textRank * 100).toFixed(0)}%</span>
                    {r.matchedSources?.length > 0 && (
                      <span>Sources: {r.matchedSources.join(', ')}</span>
                    )}
                  </div>
                  {r.matchReason && (
                    <div style={{
                      marginTop: 4, marginLeft: 36, fontSize: 12, color: '#059669',
                      fontStyle: 'italic',
                    }}>
                      {r.matchReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
