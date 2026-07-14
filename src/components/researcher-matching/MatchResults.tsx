'use client'

import { useState } from 'react'

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

function ResultCard({ result, rank, scoreBasis }: { result: MatchResult; rank: number; scoreBasis: string }) {
  const tier = TIER_STYLES[result.matchTier] || TIER_STYLES.weak
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
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
}: {
  response: SearchResponse
  emptyMessage?: string
}) {
  const [showWeak, setShowWeak] = useState(false)

  const strongerResults = response.results.filter(r => r.matchTier !== 'weak')
  const weakResults = response.results.filter(r => r.matchTier === 'weak')
  // If nothing cleared the moderate bar, show the weak matches rather than an empty page.
  const hasStronger = strongerResults.length > 0
  const visible = !hasStronger || showWeak ? response.results : strongerResults
  const screenedOut = Math.max(0, response.totalCandidates - response.totalResults)

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
        </div>
        {response.degradedMode && (
          <span style={{
            fontSize: 12, background: '#fef3c7', color: '#92400e',
            padding: '4px 8px', borderRadius: 4,
          }}>
            Degraded mode: {response.degradedMode}
          </span>
        )}
      </div>

      {response.results.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: '#9ca3af',
          border: '1px dashed #d1d5db', borderRadius: 8,
        }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((r, idx) => (
            <ResultCard key={r.userId} result={r} rank={idx + 1} scoreBasis={response.scoreBasis} />
          ))}
          {hasStronger && weakResults.length > 0 && (
            <button
              onClick={() => setShowWeak(v => !v)}
              style={{
                padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                border: '1px dashed #d1d5db', background: '#f9fafb',
                color: '#6b7280', fontSize: 13, fontWeight: 600,
              }}
            >
              {showWeak
                ? 'Hide weaker matches'
                : `Show ${weakResults.length} weaker match${weakResults.length !== 1 ? 'es' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
