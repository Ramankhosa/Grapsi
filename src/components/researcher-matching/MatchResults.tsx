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
  /** Reasons this person may not qualify for the call, when it says. */
  eligibilityFlags?: string[]
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

const TIER_BADGES: Record<MatchResult['matchTier'], { label: string; className: string }> = {
  strong: { label: 'strong match', className: 'nk-badge nk-badge-ok' },
  moderate: { label: 'moderate match', className: 'nk-badge nk-badge-warn' },
  weak: { label: 'weak match', className: 'nk-badge' },
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
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-nickel-900">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

/** How each shortlist state reads on the button. */
const SHORTLIST_LABEL: Record<string, string> = {
  SHORTLISTED: 'Shortlisted',
  APPROACHED: 'Approached',
  ASSIGNED: 'Assigned',
  DECLINED: 'Declined',
  PASSED_OVER: 'Passed over',
}

function ResultCard({
  result,
  rank,
  scoreBasis,
  onAssign,
  onShortlist,
  onViewProfile,
  isAssigned,
  shortlistState,
  selectable,
  isSelected,
  onToggleSelect,
}: {
  result: MatchResult
  rank: number
  scoreBasis: string
  onAssign?: (result: MatchResult) => void
  onShortlist?: (result: MatchResult) => void
  onViewProfile?: (result: MatchResult) => void
  isAssigned?: boolean
  shortlistState?: string | null
  selectable?: boolean
  isSelected?: boolean
  onToggleSelect?: (userId: string) => void
}) {
  const tier = TIER_BADGES[result.matchTier] || TIER_BADGES.weak
  const scorePct = Math.round(result.score * 100)
  return (
    <div
      className={`nk-panel px-5 py-4 transition ${
        isSelected ? 'border-cobalt-300 bg-cobalt-50/40' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {selectable && (
            <input
              type="checkbox"
              className="mt-2 h-4 w-4 shrink-0 accent-cobalt-600"
              checked={Boolean(isSelected)}
              disabled={isAssigned}
              onChange={() => onToggleSelect?.(result.userId)}
              aria-label={`Select ${result.displayName}`}
            />
          )}
          <span className="nk-tile h-8 w-8 text-[12.5px] font-semibold" aria-hidden>
            {rank}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-nickel-900">
              {result.displayName}
            </p>
            <p className="nk-sub mt-0.5">
              {[result.department, result.institutionName, result.countryOfResidence]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
            {result.careerStage && (
              <p className="nk-sub mt-0.5 text-[11.5px]">{result.careerStage.replace(/_/g, ' ')}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={tier.className}>{tier.label}</span>
          <div className="flex items-center gap-2">
            <div className="nk-meter w-24">
              <div className="nk-meter-fill" style={{ width: `${scorePct}%` }} />
            </div>
            <span className="nk-mono text-nickel-600">
              {scorePct}% {scoreBasis === 'rerank' ? 'relevance' : 'similarity'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {onViewProfile && (
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                onClick={() => onViewProfile(result)}
              >
                View profile
              </button>
            )}
            {onShortlist && !isAssigned && (
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                onClick={() => onShortlist(result)}
                title="Keep them on the list for this call without committing yet"
              >
                {shortlistState ? SHORTLIST_LABEL[shortlistState] || 'On the list' : 'Shortlist'}
              </button>
            )}
            {onAssign && (
              <button
                type="button"
                className={isAssigned ? 'nk-btn-secondary nk-btn-sm' : 'nk-btn-primary nk-btn-sm'}
                onClick={() => onAssign(result)}
                disabled={isAssigned}
              >
                {isAssigned ? 'Assigned' : 'Assign call'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Flagged, never hidden: agency eligibility wording is inconsistent
          enough that a hard filter would quietly drop the right person. */}
      {result.eligibilityFlags && result.eligibilityFlags.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          {result.eligibilityFlags.map((flag) => (
            <p key={flag} className="text-[12.5px] text-amber-800">
              <span className="font-semibold">Check eligibility:</span> {flag}
            </p>
          ))}
        </div>
      )}

      {result.researchSummary && (
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-nickel-700">
          {result.researchSummary.length > 300
            ? result.researchSummary.slice(0, 300) + '…'
            : result.researchSummary}
        </p>
      )}

      {result.researchAreas?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {result.researchAreas.map((area) => (
            <span key={area} className="nk-badge nk-badge-live normal-case tracking-normal">
              {area}
            </span>
          ))}
        </div>
      )}

      {result.keywords?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {result.keywords.slice(0, 8).map((kw) => (
            <span key={kw} className="nk-badge normal-case tracking-normal">
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Evidence: what actually matched, per source */}
      {result.evidence?.length > 0 && (
        <div className="nk-panel-quiet mt-3 px-4 py-3">
          <p className="nk-eyebrow mb-1.5">Why this match</p>
          {result.evidence.map((ev, i) => (
            <div
              key={`${ev.source}-${i}`}
              className={`flex items-start gap-2.5 py-1.5 ${i > 0 ? 'border-t border-nickel-100' : ''}`}
            >
              <span className="nk-badge nk-badge-live mt-0.5 shrink-0 normal-case tracking-normal">
                {SOURCE_LABELS[ev.source] || ev.source}
              </span>
              <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-nickel-700">
                {ev.title && (
                  <p className="font-medium text-nickel-900">
                    {ev.title}
                    {ev.detail && <span className="font-normal text-nickel-500"> ({ev.detail})</span>}
                  </p>
                )}
                {ev.snippet ? (
                  <p>
                    <HighlightedSnippet text={ev.snippet} />
                  </p>
                ) : !ev.title ? (
                  <p>Overall profile content is semantically similar to this search.</p>
                ) : null}
              </div>
              {ev.source !== 'text' && (
                <span className="nk-mono mt-0.5 shrink-0 text-nickel-500">
                  {(ev.similarity * 100).toFixed(0)}%
                </span>
              )}
            </div>
          ))}
          {result.sharedTerms?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-nickel-100 pt-2">
              <span className="nk-sub text-[11.5px]">Overlapping topics:</span>
              {result.sharedTerms.map((term) => (
                <span key={term} className="nk-badge nk-badge-ok normal-case tracking-normal">
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
  onShortlist,
  onViewProfile,
  assignedUserIds,
  shortlistByUserId,
  selectedUserIds,
  onToggleSelect,
  onSelectVisible,
}: {
  response: SearchResponse
  emptyMessage?: string
  /** When provided, each card gets an "Assign call" button. */
  onAssign?: (result: MatchResult) => void
  /** When provided, each card gets a "Shortlist" button. */
  onShortlist?: (result: MatchResult) => void
  /** When provided, each card gets a "View profile" button. */
  onViewProfile?: (result: MatchResult) => void
  /** Users already assigned to the selected call — shown as "Assigned". */
  assignedUserIds?: string[]
  /** Shortlist state per user for the selected call, keyed by user id. */
  shortlistByUserId?: Record<string, string>
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-nickel-900">
            {response.totalResults} matching researcher{response.totalResults !== 1 ? 's' : ''}
          </h2>
          <p className="nk-sub mt-1">
            Screened {response.totalCandidates} candidate{response.totalCandidates !== 1 ? 's' : ''}
            {screenedOut > 0 && ` · ${screenedOut} below the relevance threshold`}
            {' · '}
            {response.scoreBasis === 'rerank' ? 'ranked by AI reranker' : 'ranked by embedding similarity'}
          </p>
          {response.results.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {counts.strong > 0 && (
                <span className="nk-badge nk-badge-ok">{counts.strong} strong</span>
              )}
              {counts.moderate > 0 && (
                <span className="nk-badge nk-badge-warn">{counts.moderate} moderate</span>
              )}
              {counts.weak > 0 && <span className="nk-badge">{counts.weak} weak</span>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {response.degradedMode && (
            <span className="nk-badge nk-badge-warn normal-case tracking-normal">
              Degraded mode: {response.degradedMode}
            </span>
          )}
          {response.results.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="nk-sub">Relevance</span>
              <select
                className="nk-select w-40"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as TierFilter)}
              >
                {TIER_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {selectable && selectableVisibleIds.length > 0 && (
        <label className="nk-panel-quiet mb-3 flex cursor-pointer items-center gap-2.5 px-4 py-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-cobalt-600"
            checked={allVisibleSelected}
            onChange={() => onSelectVisible?.(allVisibleSelected ? [] : selectableVisibleIds)}
            aria-label="Select all shown"
          />
          <span className="text-[13px] text-nickel-700">
            Select all {selectableVisibleIds.length} shown
          </span>
          {selected.size > 0 && (
            <span className="ml-auto text-[13px] font-semibold text-cobalt-700">
              {selected.size} selected
            </span>
          )}
        </label>
      )}

      {response.results.length === 0 ? (
        <div className="rounded-xl border border-dashed border-nickel-300 px-6 py-10 text-center">
          <p className="nk-sub mx-auto max-w-md">{emptyMessage}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-nickel-300 px-6 py-10 text-center">
          <p className="nk-sub">No researchers in this relevance band. Choose a broader option above.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((r, idx) => (
            <ResultCard
              key={r.userId}
              result={r}
              rank={idx + 1}
              scoreBasis={response.scoreBasis}
              onAssign={onAssign}
              onShortlist={onShortlist}
              shortlistState={shortlistByUserId?.[r.userId] ?? null}
              onViewProfile={onViewProfile}
              isAssigned={assigned.has(r.userId)}
              selectable={selectable}
              isSelected={selected.has(r.userId)}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {hiddenByFilter > 0 && (
            <p className="nk-sub py-1 text-center text-[12px]">
              {hiddenByFilter} more match{hiddenByFilter !== 1 ? 'es' : ''} hidden by the relevance
              filter.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
