'use client'

import { useMemo, useState } from 'react'

export interface MatchEvidence {
  source: 'profile' | 'research_area' | 'publication' | 'text'
  similarity: number
  snippet: string | null
  title: string | null
  detail: string | null
}

export interface MatchResult {
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
  rerankScore: number | null
  matchTier: 'strong' | 'moderate' | 'weak'
  semanticSimilarity: number
  textRank: number
  matchedSources: string[]
  matchReason: string
  evidence: MatchEvidence[]
  sharedTerms: string[]
}

export interface SearchResponse {
  query: string
  fundingCallId: string | null
  totalResults: number
  totalCandidates: number
  scoreBasis: 'rerank' | 'vector'
  results: MatchResult[]
  degradedMode: string | null
}

type TierFilter = 'auto' | 'strong' | 'moderate' | 'weak' | 'all'

const TIER_STYLES: Record<MatchResult['matchTier'], { label: string; bg: string; color: string }> = {
  strong: { label: 'Strong match', bg: '#dcfce7', color: '#166534' },
  moderate: { label: 'Moderate match', bg: '#fef3c7', color: '#92400e' },
  weak: { label: 'Weak match', bg: '#f3f4f6', color: '#6b7280' },
}

const SOURCE_LABELS: Record<MatchEvidence['source'], string> = {
  profile: 'Profile',
  research_area: 'Research area',
  publication: 'Publication',
  text: 'Keyword match',
}

const TIER_FILTER_OPTIONS: Array<{ value: TierFilter; label: string }> = [
  { value: 'auto', label: 'Best available' },
  { value: 'strong', label: 'Strong only' },
  { value: 'moderate', label: 'Moderate & above' },
  { value: 'weak', label: 'Weak only' },
  { value: 'all', label: 'Show all' },
]

/** Text-branch snippets carry **term** markers around the matched query words. */
function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split('**')
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} style={{ background: '#fef08a', padding: '0 2px', borderRadius: 2 }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function ResultCard({
  result,
  rank,
  scoreBasis,
  onAssign,
  isAssigned,
  selectable,
  isSelected,
  onToggleSelect,
}: {
  result: MatchResult
  rank: number
  scoreBasis: string
  onAssign?: (result: MatchResult) => void
  isAssigned?: boolean
  selectable?: boolean
  isSelected?: boolean
  onToggleSelect?: (userId: string) => void
}) {
  const tier = TIER_STYLES[result.matchTier] || TIER_STYLES.weak
  return (
    <div
      style={{
        border: isSelected ? '1px solid #2563eb' : '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        background: isSelected ? '#f5f8ff' : '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {selectable && (
              <input
                type="checkbox"
                checked={Boolean(isSelected)}
                disabled={isAssigned}
                onChange={() => onToggleSelect?.(result.userId)}
                aria-label={`Select ${result.displayName}`}
                style={{ width: 16, height: 16, flexShrink: 0, cursor: isAssigned ? 'default' : 'pointer' }}
              />
            )}
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#2563eb', color: '#fff', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, flexShrink: 0,
            }}>
              {rank}
            </span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{result.displayName}</span>
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginLeft: 36 }}>
            {[result.department, result.institutionName, result.countryOfResidence].filter(Boolean).join(' · ')}
          </div>
          {result.careerStage && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginLeft: 36, marginTop: 2 }}>
              {result.careerStage.replace(/_/g, ' ')}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{
            display: 'inline-block', fontSize: 12, fontWeight: 700,
            padding: '4px 10px', borderRadius: 12,
            background: tier.bg, color: tier.color, whiteSpace: 'nowrap',
          }}>
            {tier.label}
          </span>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {(result.score * 100).toFixed(0)}% {scoreBasis === 'rerank' ? 'relevance' : 'similarity'}
          </div>
          {onAssign && (
            <button
              onClick={() => onAssign(result)}
              disabled={isAssigned}
              style={{
                marginTop: 8, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: isAssigned ? 'default' : 'pointer', whiteSpace: 'nowrap',
                border: isAssigned ? '1px solid #d1d5db' : 'none',
                background: isAssigned ? '#f3f4f6' : '#2563eb',
                color: isAssigned ? '#6b7280' : '#fff',
              }}
            >
              {isAssigned ? 'Assigned' : 'Assign call'}
            </button>
          )}
        </div>
      </div>

      {/* Research summary */}
      {result.researchSummary && (
        <div style={{ marginTop: 8, marginLeft: 36, fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
          {result.researchSummary.length > 300
            ? result.researchSummary.slice(0, 300) + '...'
            : result.researchSummary}
        </div>
      )}

      {/* Research areas */}
      {result.researchAreas?.length > 0 && (
        <div style={{ marginTop: 8, marginLeft: 36, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {result.researchAreas.map(area => (
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
      {result.keywords?.length > 0 && (
        <div style={{ marginTop: 4, marginLeft: 36, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {result.keywords.slice(0, 8).map(kw => (
            <span key={kw} style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8,
              background: '#f3f4f6', color: '#6b7280',
            }}>
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Evidence: what actually matched, per source */}
      {result.evidence?.length > 0 && (
        <div style={{
          marginTop: 10, marginLeft: 36, border: '1px solid #e5e7eb',
          borderRadius: 6, background: '#f9fafb', padding: '8px 10px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 0.5, color: '#6b7280', marginBottom: 4,
          }}>
            Why this match
          </div>
          {result.evidence.map((ev, i) => (
            <div key={`${ev.source}-${i}`} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              padding: '5px 0',
              borderTop: i > 0 ? '1px solid #eef0f2' : 'none',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: '#eef2ff', color: '#4338ca', whiteSpace: 'nowrap', flexShrink: 0,
                marginTop: 1,
              }}>
                {SOURCE_LABELS[ev.source] || ev.source}
              </span>
              <div style={{ flex: 1, fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                {ev.title && (
                  <div style={{ fontWeight: 600 }}>
                    {ev.title}
                    {ev.detail && <span style={{ fontWeight: 400, color: '#6b7280' }}> ({ev.detail})</span>}
                  </div>
                )}
                {ev.snippet ? (
                  <div style={{ color: '#4b5563' }}><HighlightedSnippet text={ev.snippet} /></div>
                ) : !ev.title ? (
                  <div style={{ color: '#4b5563' }}>Overall profile content is semantically similar to this search.</div>
                ) : null}
              </div>
              {ev.source !== 'text' && (
                <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
                  {(ev.similarity * 100).toFixed(0)}% similar
                </span>
              )}
            </div>
          ))}
          {result.sharedTerms?.length > 0 && (
            <div style={{
              marginTop: 6, paddingTop: 6, borderTop: '1px solid #eef0f2',
              display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>Overlapping topics:</span>
              {result.sharedTerms.map(term => (
                <span key={term} style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: '#dcfce7', color: '#166534',
                }}>
                  {term}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MatchResults({
  response,
  emptyMessage = 'No researchers passed the relevance threshold. Try a different funding call or broaden the search.',
  onAssign,
  assignedUserIds,
  selectedUserIds,
  onToggleSelect,
  onSelectVisible,
}: {
  response: SearchResponse
  emptyMessage?: string
  /** When provided, each card gets an "Assign call" button. */
  onAssign?: (result: MatchResult) => void
  /** Users already assigned to the selected call — shown as "Assigned". */
  assignedUserIds?: string[]
  /**
   * When provided, cards become selectable for a bulk circulation. Selection
   * lives in the parent because the assign dialog and the request both need it.
   */
  selectedUserIds?: string[]
  onToggleSelect?: (userId: string) => void
  /** Receives the currently visible, not-yet-assigned ids — powers "select all". */
  onSelectVisible?: (userIds: string[]) => void
}) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('auto')

  const counts = useMemo(() => ({
    strong: response.results.filter(r => r.matchTier === 'strong').length,
    moderate: response.results.filter(r => r.matchTier === 'moderate').length,
    weak: response.results.filter(r => r.matchTier === 'weak').length,
  }), [response.results])

  const visible = useMemo(() => {
    switch (tierFilter) {
      case 'strong':
        return response.results.filter(r => r.matchTier === 'strong')
      case 'moderate':
        return response.results.filter(r => r.matchTier !== 'weak')
      case 'weak':
        return response.results.filter(r => r.matchTier === 'weak')
      case 'all':
        return response.results
      default: {
        // "Best available": hide weak matches, unless nothing stronger exists —
        // an empty page is less useful than a caveated one.
        const stronger = response.results.filter(r => r.matchTier !== 'weak')
        return stronger.length > 0 ? stronger : response.results
      }
    }
  }, [response.results, tierFilter])

  const assigned = useMemo(() => new Set(assignedUserIds || []), [assignedUserIds])
  const selected = useMemo(() => new Set(selectedUserIds || []), [selectedUserIds])
  const screenedOut = Math.max(0, response.totalCandidates - response.totalResults)
  const hiddenByFilter = response.results.length - visible.length

  const selectable = Boolean(onToggleSelect)
  // "Select all" means all of what you can currently see, minus the people
  // already on this call — offering to re-assign them would only produce skips.
  const selectableVisibleIds = useMemo(
    () => visible.filter((r) => !assigned.has(r.userId)).map((r) => r.userId),
    [visible, assigned]
  )
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selected.has(id))

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 16, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {response.totalResults} Matching Researcher{response.totalResults !== 1 ? 's' : ''} Found
          </h2>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Screened {response.totalCandidates} candidate{response.totalCandidates !== 1 ? 's' : ''}
            {screenedOut > 0 && ` · ${screenedOut} below the relevance threshold`}
            {' · '}
            {response.scoreBasis === 'rerank' ? 'ranked by AI reranker' : 'ranked by embedding similarity'}
          </div>
          {response.results.length > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {counts.strong} strong · {counts.moderate} moderate · {counts.weak} weak
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {response.degradedMode && (
            <span style={{
              fontSize: 12, background: '#fef3c7', color: '#92400e',
              padding: '4px 8px', borderRadius: 4,
            }}>
              Degraded mode: {response.degradedMode}
            </span>
          )}
          {response.results.length > 0 && (
            <label style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
              Relevance
              <select
                value={tierFilter}
                onChange={e => setTierFilter(e.target.value as TierFilter)}
                style={{
                  padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db',
                  fontSize: 12, background: '#fff', color: '#374151',
                }}
              >
                {TIER_FILTER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {selectable && selectableVisibleIds.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
            padding: '8px 12px', borderRadius: 8, background: '#f9fafb',
            border: '1px solid #e5e7eb', fontSize: 13, color: '#374151',
          }}
        >
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={() =>
              onSelectVisible?.(allVisibleSelected ? [] : selectableVisibleIds)
            }
            aria-label="Select all shown"
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span>
            Select all {selectableVisibleIds.length} shown
          </span>
          {selected.size > 0 && (
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#2563eb' }}>
              {selected.size} selected
            </span>
          )}
        </div>
      )}

      {response.results.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: '#9ca3af',
          border: '1px dashed #d1d5db', borderRadius: 8,
        }}>
          {emptyMessage}
        </div>
      ) : visible.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: '#9ca3af',
          border: '1px dashed #d1d5db', borderRadius: 8,
        }}>
          No researchers in this relevance band. Choose a broader option above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((r, idx) => (
            <ResultCard
              key={r.userId}
              result={r}
              rank={idx + 1}
              scoreBasis={response.scoreBasis}
              onAssign={onAssign}
              isAssigned={assigned.has(r.userId)}
              selectable={selectable}
              isSelected={selected.has(r.userId)}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {hiddenByFilter > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', padding: '4px 0' }}>
              {hiddenByFilter} more match{hiddenByFilter !== 1 ? 'es' : ''} hidden by the relevance filter.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
