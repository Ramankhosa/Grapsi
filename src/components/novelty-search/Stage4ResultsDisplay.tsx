'use client';

import React from 'react';
import Link from 'next/link';

interface Stage4ResultsProps {
  stage4Results: any;
  searchId: string;
  onRerun?: () => Promise<void> | void;
  hidePerPatentRemarks?: boolean;
  hideIdeaBank?: boolean;
  hideConsolidatedButton?: boolean;
}

export default function Stage4ResultsDisplay({ stage4Results, searchId, onRerun, hidePerPatentRemarks = true, hideIdeaBank = true, hideConsolidatedButton = true }: Stage4ResultsProps) {
  const r: any = stage4Results || {};
  const exec = r.executive_summary || {};
  const cards = exec.visual_cards || {};
  const remarks: any[] = Array.isArray(r.per_patent_remarks) ? r.per_patent_remarks : [];
  const metadata = r.report_metadata || {};
  const concl = r.concluding_remarks || {};
  
  // New final concluding remarks fields
  const honestAssessment = concl.honest_assessment || '';
  const courseCorrections = Array.isArray(concl.course_corrections) ? concl.course_corrections : [];
  const inventorActions = Array.isArray(concl.inventor_action_items) ? concl.inventor_action_items : [];
  const overallAssessment = concl.overall_novelty_assessment || '';
  const filingAdvice = concl.filing_advice || '';

  // Basic sanitizer to avoid mojibake while preserving content
  const sanitize = (t: any) => (typeof t === 'string' ? t.normalize('NFKC').replace(/\uFFFD/g, '') : t);

  // Derive search trail counts if present
  const trail = r.search_trail || {};
  const pqaiInitial = trail.pqai_initial_count ?? r?.search_metadata?.pqai_initial_count ?? undefined;
  const aiAccepted = trail.ai_relevance_accepted ?? r?.search_metadata?.ai_relevance_accepted ?? undefined;
  const aiBorderline = trail.ai_relevance_borderline ?? r?.search_metadata?.ai_relevance_borderline ?? undefined;
  const deepAnalyzed = trail.deeply_analyzed_count ?? (Array.isArray(remarks) ? remarks.length : undefined);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-r from-teal-600 to-purple-700 text-white">
        <div className="p-6">
          <div className="text-sm opacity-90">AI Novelty Assessment</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">
            {metadata.title || 'AI-Backed Novelty Assessment Report'}
          </div>
          <div className="mt-1 text-xs opacity-90">
            Search ID: {metadata.search_id || searchId} • {metadata.date || new Date().toISOString().slice(0, 10)}
          </div>
        </div>
        <div className="absolute right-0 top-0 opacity-20 pointer-events-none select-none">
          <svg width="240" height="120" viewBox="0 0 240 120" fill="none"><circle cx="120" cy="60" r="56" stroke="white" strokeWidth="2"/><circle cx="120" cy="60" r="40" stroke="white" strokeWidth="1"/></svg>
        </div>
      </div>

      {/* Controls */}
      <div className="flex justify-end gap-2">
        {!hideConsolidatedButton && (
          <Link
            href={`/novelty-search/${metadata.search_id || searchId}/consolidated`}
            target="_blank"
            className="inline-flex items-center px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
          >
            Consolidated Report
          </Link>
        )}
        {onRerun && (
          <button
            type="button"
            onClick={() => onRerun()}
            className="inline-flex items-center px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
          >
            Re-run Report Generation
          </button>
        )}
      </div>

      {/* KPI Cards if available */}
      {cards && Object.keys(cards).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(cards).map(([k, v], idx) => (
            <div key={idx} className="rounded-lg border bg-white p-3">
              <div className="text-xs text-gray-500">{k}</div>
              <div className="text-xl font-semibold text-gray-900">{String(v)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Overall Novelty Assessment */}
      {overallAssessment && (
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">Overall Assessment</div>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              overallAssessment === 'Novel' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
              overallAssessment === 'Partially Novel' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
              overallAssessment === 'Not Novel' ? 'bg-red-100 text-red-700 border border-red-200' :
              'bg-slate-100 text-slate-700 border border-slate-200'
            }`}>
              {overallAssessment}
            </span>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm font-medium text-gray-900 mb-1">Executive Summary</div>
        <div className="text-sm text-gray-800 whitespace-pre-wrap">
          {sanitize(exec.summary) || 'Summary not available.'}
        </div>
      </div>

      {/* Honest Assessment - Candid verdict */}
      {honestAssessment && (
        <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-indigo-900 mb-1">Honest Assessment</div>
              <div className="text-sm text-indigo-800">{sanitize(honestAssessment)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Search Trail */}
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm font-medium text-gray-900 mb-2">Search Trail</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TrailCard label="Patent Database Screened" value={pqaiInitial} />
          <TrailCard label="AI Accepted" value={aiAccepted} />
          <TrailCard label="AI Borderline" value={aiBorderline} />
          <TrailCard label="Deeply Analyzed" value={deepAnalyzed} />
        </div>
      </div>

      {/* Strengths / Risks */}
      {(concl.key_strengths || concl.key_risks) && (
        <div className="grid md:grid-cols-2 gap-3">
          <BulletsCard title="Key Strengths" bullets={concl.key_strengths} color="emerald" />
          <BulletsCard title="Key Risks" bullets={concl.key_risks} color="amber" />
        </div>
      )}

      {/* Strategic Recommendations */}
      {concl.strategic_recommendations && (
        <BulletsCard title="Strategic Recommendations" bullets={concl.strategic_recommendations} color="indigo" />
      )}

      {/* Course Corrections - If novelty is weak */}
      {courseCorrections.length > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <div className="text-sm font-semibold text-purple-900">Course Corrections</div>
          </div>
          <ul className="space-y-2">
            {courseCorrections.map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-purple-800">
                <span className="text-purple-400 mt-1 flex-shrink-0">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inventor Action Items */}
      {inventorActions.length > 0 && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <div className="text-sm font-semibold text-teal-900">Inventor Action Items</div>
          </div>
          <ul className="space-y-2">
            {inventorActions.map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-teal-800">
                <span className="w-5 h-5 rounded bg-teal-600 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filing Advice */}
      {filingAdvice && (
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 mb-1">Filing Advice</div>
              <div className="text-sm text-slate-700">{sanitize(filingAdvice)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Per-Patent Analysis (Professional Format) */}
      {!hidePerPatentRemarks && Array.isArray(concl.per_patent_analysis) && concl.per_patent_analysis.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">Prior Art Analysis</div>
              <div className="text-xs text-gray-500">Detailed patent-by-patent assessment for inventor review</div>
            </div>
            <div className="text-xs text-gray-400">{concl.per_patent_analysis.length} patent(s) analyzed</div>
          </div>
          <div className="space-y-4 max-h-[40rem] overflow-auto pr-1">
            {concl.per_patent_analysis.map((patent: any, idx: number) => (
              <PatentAnalysisCard key={idx} patent={patent} sanitize={sanitize} />
            ))}
          </div>
        </div>
      )}

      {/* Legacy Per-Patent Remarks (fallback if no enhanced analysis) */}
      {!hidePerPatentRemarks && (!concl.per_patent_analysis || concl.per_patent_analysis.length === 0) && Array.isArray(remarks) && remarks.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm font-medium text-gray-900 mb-2">Per-Patent Remarks</div>
          <div className="space-y-2 max-h-[28rem] overflow-auto pr-1">
            {remarks.map((it, idx) => (
              <div key={idx} className="rounded border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {it.pn || it.patent_number || 'Unknown PN'}
                    </div>
                    {it.title && <div className="text-xs text-gray-700">{it.title}</div>}
                  </div>
                  {(() => {
                    const pn = it.pn || it.patent_number;
                    if (!pn) return null;
                    const href = `https://patents.google.com/patent/${encodeURIComponent(String(pn).replace(/\s+/g, ''))}`;
                    return (
                      <Link
                        href={href}
                        target="_blank"
                        className="text-[11px] text-indigo-600 hover:underline flex-shrink-0"
                      >
                        Open in Google Patents
                      </Link>
                    );
                  })()}
                </div>
                <div className="mt-1 text-xs text-gray-800 whitespace-pre-wrap">{sanitize(it.remarks) || '-'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Disclaimer */}
      <div className="text-[11px] text-gray-600 border rounded-md bg-yellow-50 px-3 py-2">
        Disclaimer: This report is AI-generated to assist novelty assessment. Please review cited prior art before
        making legal or business decisions and consult a registered patent attorney.
      </div>
    </div>
  );
}

function TrailCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900">{value ?? '—'}</div>
    </div>
  );
}

function BulletsCard({ title, bullets, color }: { title: string; bullets: string[]; color: 'emerald'|'amber'|'indigo' }) {
  const border = color === 'emerald' ? 'border-emerald-200' : color === 'amber' ? 'border-amber-200' : 'border-indigo-200';
  const bg = color === 'emerald' ? 'bg-emerald-50/30' : color === 'amber' ? 'bg-amber-50/30' : 'bg-indigo-50/30';
  return (
    <div className={`rounded-lg border ${border} ${bg} p-4`}>
      <div className="text-sm font-medium text-gray-900 mb-2">{title}</div>
      {Array.isArray(bullets) && bullets.length > 0 ? (
        <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
          {bullets.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-gray-600">No items.</div>
      )}
    </div>
  );
}

// Professional patent analysis card for inventor review
function PatentAnalysisCard({ patent, sanitize }: { patent: any; sanitize: (t: any) => any }) {
  if (!patent) return null;
  
  const pn = patent.pn || patent.patent_number || 'Unknown';
  const title = patent.title || 'Untitled Reference';
  const relevance = typeof patent.relevance === 'number' ? patent.relevance : 0.5;
  const noveltyThreat = patent.novelty_threat || 'unknown';
  const summary = patent.summary || '';
  const detailed = patent.detailedAnalysis || {};
  
  // Ensure arrays are arrays
  const relevantParts = Array.isArray(detailed.relevant_parts) ? detailed.relevant_parts : [];
  const irrelevantParts = Array.isArray(detailed.irrelevant_parts) ? detailed.irrelevant_parts : [];
  
  // Color coding for novelty threat levels
  const threatColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    anticipates: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'High Risk - Anticipates' },
    obvious: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'Moderate Risk - Obviousness' },
    adjacent: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', label: 'Low Risk - Adjacent Art' },
    remote: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'Minimal Risk - Remote' },
    unknown: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: 'Unassessed' }
  };
  
  const threat = threatColors[noveltyThreat] || threatColors.unknown;
  const relevancePercent = Math.round(relevance * 100);
  const relevanceColor = relevance >= 0.7 ? 'bg-red-500' : relevance >= 0.5 ? 'bg-orange-400' : relevance >= 0.3 ? 'bg-yellow-400' : 'bg-green-400';

  return (
    <div className={`rounded-lg border ${threat.border} ${threat.bg} p-4`}>
      {/* Header with patent info and threat badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-gray-900">{pn}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${threat.bg} ${threat.text} border ${threat.border}`}>
              {threat.label}
            </span>
          </div>
          <div className="text-sm text-gray-700 mt-0.5 line-clamp-2">{sanitize(title)}</div>
        </div>
        <Link
          href={`https://patents.google.com/patent/${encodeURIComponent(String(pn).replace(/\s+/g, ''))}`}
          target="_blank"
          className="flex-shrink-0 text-[11px] text-indigo-600 hover:underline"
        >
          View Patent →
        </Link>
      </div>
      
      {/* Relevance Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>Relevance Score</span>
          <span className="font-medium">{relevancePercent}%</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full ${relevanceColor} rounded-full transition-all`} style={{ width: `${relevancePercent}%` }} />
        </div>
      </div>
      
      {/* Summary */}
      {summary && (
        <div className="mb-3">
          <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">Analysis Summary</div>
          <div className="text-sm text-gray-800">{sanitize(summary)}</div>
        </div>
      )}
      
      {/* Detailed Analysis Accordion */}
      {(relevantParts.length > 0 || irrelevantParts.length > 0 || detailed.novelty_comparison) && (
        <details className="group">
          <summary className="cursor-pointer text-[11px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            <span>Show Detailed Analysis</span>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </summary>
          <div className="mt-2 pt-2 border-t border-gray-200 space-y-3">
            {/* Relevant Parts - What overlaps */}
            {relevantParts.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-red-600 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Overlapping Elements (Action Required)
                </div>
                <ul className="text-xs text-gray-700 space-y-1">
                  {relevantParts.map((part: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-red-400 mt-0.5">•</span>
                      <span>{sanitize(part)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Irrelevant Parts - Your differentiators */}
            {irrelevantParts.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-green-600 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Your Differentiators (Claim Focus Points)
                </div>
                <ul className="text-xs text-gray-700 space-y-1">
                  {irrelevantParts.map((part: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span>{sanitize(part)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Novelty Comparison */}
            {detailed.novelty_comparison && (
              <div>
                <div className="text-[11px] font-medium text-blue-600 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  Novelty Assessment
                </div>
                <div className="text-xs text-gray-700 bg-white/50 rounded p-2 border border-gray-100">
                  {sanitize(detailed.novelty_comparison)}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
