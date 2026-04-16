'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Cookies from 'js-cookie';

// Print styles for PDF generation
const printStyles = `
  @media print {
    @page {
      size: A4;
      margin: 1cm;
    }

    body {
      font-size: 12px !important;
      line-height: 1.4 !important;
    }

    .no-print {
      display: none !important;
    }

    .print-break-before {
      page-break-before: always;
    }

    .print-break-after {
      page-break-after: always;
    }

    .print-break-inside-avoid {
      break-inside: avoid;
    }

    /* Hide scrollbars */
    * {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }

    *::-webkit-scrollbar {
      display: none;
    }

    /* Ensure text is readable */
    .text-slate-900 {
      color: black !important;
    }

    .text-slate-600 {
      color: #374151 !important;
    }

    .text-slate-500 {
      color: #6b7280 !important;
    }

    /* Make sure backgrounds print properly */
    .bg-blue-50 {
      background-color: #eff6ff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .bg-green-50 {
      background-color: #f0fdf4 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .bg-red-50 {
      background-color: #fef2f2 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .bg-amber-50 {
      background-color: #fffbeb !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;

interface ConsolidatedNoveltyReportProps {
  searchId: string;
  searchData: any;
}

// --- Reusable Premium Components ---

function SectionCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mb-8 break-inside-avoid ${className}`}>
      <div className="flex items-center mb-4">
        <div className="h-6 w-1 bg-blue-600 rounded-full mr-3"></div>
        <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6">
          {children}
        </div>
      </div>
    </section>
  );
}

function MetricBadge({ label, value, subtext, trend }: { label: string; value: string; subtext?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="flex flex-col p-4 bg-slate-50 rounded-lg border border-slate-100">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {trend && (
          <span className={`text-xs font-medium ${trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-slate-600'}`}>
            {trend === 'up' ? 'High' : trend === 'down' ? 'Low' : 'Avg'}
          </span>
        )}
      </div>
      {subtext && <span className="text-xs text-slate-400 mt-1">{subtext}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let classes = 'bg-slate-100 text-slate-600';
  if (s === 'present' || s === 'p') classes = 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (s === 'partial' || s === 'pt') classes = 'bg-amber-100 text-amber-700 border-amber-200';
  if (s === 'absent' || s === 'a') classes = 'bg-rose-100 text-rose-700 border-rose-200';
  
  const label = s === 'p' ? 'Present' : s === 'pt' ? 'Partial' : s === 'a' ? 'Absent' : status;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {label}
    </span>
  );
}

export default function ConsolidatedNoveltyReport({ searchId, searchData }: ConsolidatedNoveltyReportProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // --- Data Parsing ---
  const stage0 = searchData?.stage0Results || searchData?.stage0 || {};
  const stage1 = searchData?.stage1Results || searchData?.stage1 || {};
  const stage35 = searchData?.stage35Results || searchData?.stage35 || {};
  const stage4 = searchData?.stage4Results || searchData?.stage4 || {};
  
  const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];
  const pqai: any[] = Array.isArray(stage1?.pqaiResults) ? stage1.pqaiResults : [];
  
  // Stage 3.5 Data
  const featureMaps: any[] = Array.isArray((stage35 as any)?.feature_map)
    ? (stage35 as any).feature_map
    : (Array.isArray(stage35) ? (stage35 as any) : []);
    
  const featureUniq: any[] = Array.isArray(stage35?.per_feature_uniqueness)
    ? stage35.per_feature_uniqueness
    : stage4?.per_feature_uniqueness || [];

  // Stage 4 Data
  const execSummary = stage4?.executive_summary || {};
  const finalRemarks = stage4?.final_remarks || stage4?.concluding_remarks || {};
  const riskFactors = stage4?.risk_factors || finalRemarks?.key_risks || [];
  const ideaSuggestions: any[] = Array.isArray(stage4?.idea_bank_suggestions) ? stage4.idea_bank_suggestions : [];
  
  // Enhanced per-patent analysis for inventor review
  const perPatentAnalysis: any[] = Array.isArray(finalRemarks?.per_patent_analysis) 
    ? finalRemarks.per_patent_analysis 
    : [];
  
  // Inventor action items
  const inventorActions: string[] = Array.isArray(finalRemarks?.inventor_action_items)
    ? finalRemarks.inventor_action_items
    : [];
  
  // Filing advice
  const filingAdvice = finalRemarks?.filing_advice || '';
  const whyNoveltyExists = finalRemarks?.why_novelty_exists || '';

  // Handle recommendations - could be in structured format or array format
  let recommendations = [];
  if (stage4?.recommendations) {
    // Structured format with filing_strategy and search_expansion
    const filingStrategy = stage4.recommendations.filing_strategy || [];
    const searchExpansion = stage4.recommendations.search_expansion || [];
    recommendations = [...filingStrategy, ...searchExpansion];
  } else if (finalRemarks?.strategic_recommendations) {
    // Array format
    recommendations = Array.isArray(finalRemarks.strategic_recommendations)
      ? finalRemarks.strategic_recommendations
      : [];
  }
  
  const sanitizedTitle = (searchData?.title || 'Novelty Assessment Report').toString();

  // Helper to resolve status for matrix
  const getMatrixStatus = (pm: any, feature: string): 'P' | 'Pt' | 'A' | '-' => {
    const fa = Array.isArray(pm?.feature_analysis) ? pm.feature_analysis : [];
    const cell = fa.find((c: any) => c.feature === feature);
    if (!cell) return '-';
    if (cell.status === 'Present') return 'P';
    if (cell.status === 'Partial') return 'Pt';
    if (cell.status === 'Absent') return 'A';
    return '-';
  };

  // Print webpage to PDF using browser's print feature
  const handleGeneratePDF = () => {
    window.print();
  };

  // Handle Share Link Generation
  const handleGenerateShareLink = async () => {
    try {
      setIsGeneratingShare(true);
      const token = Cookies.get('token') ||
                   localStorage.getItem('auth_token') ||
                   localStorage.getItem('token');

      const response = await fetch(`/api/novelty-search/${searchId}/share`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to generate share link');

      const data = await response.json();
      if (data.shareUrl) {
        setShareUrl(data.shareUrl);
        setShowShareModal(true);
        // Copy to clipboard automatically
        navigator.clipboard.writeText(data.shareUrl).catch(() => {
          // Silently fail if clipboard access is denied
        });
      }
    } catch (err) {
      console.error('Share link generation error:', err);
      alert('Failed to generate share link. Please try again.');
    } finally {
      setIsGeneratingShare(false);
    }
  };

  // Copy share link to clipboard
  const copyShareLink = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        alert('Share link copied to clipboard!');
      } catch (err) {
        alert('Failed to copy to clipboard. Please copy the link manually.');
      }
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div className="min-h-screen bg-slate-50/50 font-sans text-slate-900 print:bg-white print:p-0">
      {/* Print Controls */}
      <div className="no-print fixed bottom-6 right-6 z-50 flex gap-3">
        <button
          onClick={handleGenerateShareLink}
          disabled={isGeneratingShare}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-full shadow-xl hover:bg-green-700 transition-all font-bold text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isGeneratingShare ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating Link...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              Share Public Link
            </>
          )}
        </button>

        <button
          onClick={handleGeneratePDF}
          className="flex items-center gap-2 px-6 py-3 bg-blue-900 text-white rounded-full shadow-xl hover:bg-blue-800 transition-all font-bold text-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          Download Official Report
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-8 md:p-12 print:max-w-none print:p-0">
        
        {/* --- HEADER --- */}
        <header className="mb-12 border-b border-slate-200 pb-8">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2 py-1 rounded bg-slate-100 text-slate-600 text-[10px] font-bold tracking-wider uppercase border border-slate-200">Confidential</span>
                <span className="px-2 py-1 rounded bg-purple-100 text-purple-700 text-[10px] font-bold tracking-wider uppercase border border-purple-200">Inventor Review Copy</span>
                <span className="text-xs text-slate-400 uppercase tracking-wide">ID: {searchId.slice(0,8)}</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-2">{sanitizedTitle}</h1>
              <p className="text-sm text-slate-600 mb-2">Prior Art Analysis & Patentability Assessment</p>
              <div className="text-sm text-slate-500 flex flex-wrap gap-4">
                <span>Generated: {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                <span>•</span>
                <span>Jurisdiction: {stage0?.jurisdiction || 'US'}</span>
                {finalRemarks?.analysis_date && (
                  <>
                    <span>•</span>
                    <span>Analysis Date: {finalRemarks.analysis_date}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right hidden md:block">
              <div className="text-xl font-bold text-slate-900">PatentNest.ai</div>
              <div className="text-xs text-slate-400">AI-Powered Patent Intelligence</div>
              <div className="mt-2 px-3 py-1 bg-blue-50 text-blue-700 text-[10px] rounded-full border border-blue-100">
                Professional Assessment Report
              </div>
            </div>
          </div>
          
          {/* Report Purpose Notice */}
          <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold text-blue-900 mb-1">Purpose of This Report</h3>
                <p className="text-xs text-blue-800 leading-relaxed">
                  This comprehensive analysis evaluates the novelty and patentability of your invention against identified prior art. 
                  Review the highlighted overlapping elements and differentiators to understand how your invention compares to existing patents. 
                  Use the Inventor Action Items section to strengthen your application with additional details.
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* --- EXECUTIVE SUMMARY --- */}
        <SectionCard title="Executive Summary">
          <div className="grid md:grid-cols-3 gap-6 mb-6">
            <MetricBadge 
              label="Novelty Score" 
              value={execSummary.novelty_score || stage4.novelty_score || 'N/A'} 
              trend={(parseFloat(execSummary.novelty_score) > 70) ? 'up' : 'neutral'}
              subtext="Based on feature uniqueness"
            />
            <MetricBadge 
              label="Patents Analyzed" 
              value={pqai.length.toString()} 
              subtext={`${featureMaps.length} mapped in detail`}
            />
            <MetricBadge 
              label="Key Risk Level" 
              value={riskFactors.length > 2 ? 'High' : 'Moderate'} 
              trend={riskFactors.length > 2 ? 'down' : 'neutral'}
              subtext={`${riskFactors.length} risk factors identified`}
            />
          </div>
          
          <div className="prose prose-slate prose-sm max-w-none text-slate-700">
            <p className="lead text-base">{execSummary.summary || 'No executive summary available.'}</p>
            {execSummary.key_findings && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-slate-900 uppercase mb-2">Key Findings</h4>
                <ul className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                  {execSummary.key_findings.map((f: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0"></span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SectionCard>

        {/* --- INVENTION SCOPE --- */}
        <div className="grid md:grid-cols-3 gap-8 mb-8 break-inside-avoid">
          <div className="md:col-span-2">
            <SectionCard title="Invention Scope" className="h-full mb-0">
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Search Query</div>
                <div className="bg-slate-50 p-3 rounded text-xs font-mono text-slate-600 border border-slate-100 whitespace-pre-wrap">
                  {stage0?.searchQuery || 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Key Technical Features</div>
                <div className="flex flex-wrap gap-2">
                  {features.map((f, i) => (
                    <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-md border border-blue-100">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </SectionCard>
          </div>
          <div className="md:col-span-1">
            <SectionCard title="Prior Art Stats" className="h-full mb-0">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase">Total Hits</div>
                  <div className="text-2xl font-bold text-slate-900">{pqai.length}</div>
                </div>
                <div className="h-px bg-slate-100"></div>
                <div>
                  <div className="text-xs text-slate-400 uppercase">Relevant Citations</div>
                  <div className="text-2xl font-bold text-slate-900">{featureMaps.length}</div>
                </div>
                <div className="h-px bg-slate-100"></div>
                <div>
                  <div className="text-xs text-slate-400 uppercase">Top Assignees</div>
                  <div className="text-sm text-slate-600 mt-1">
                   {/* Simple extraction of assignees if available, else placeholder */}
                   Multiple entities
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        {/* --- STAGE 4 ANALYSIS --- */}
        <div className="grid md:grid-cols-2 gap-8 mb-8 break-inside-avoid">
          <SectionCard title="Key Strengths">
            <div className="space-y-3">
              {(finalRemarks.key_strengths || []).length > 0 ? (finalRemarks.key_strengths || []).map((s: string, i: number) => (
                <div key={i} className="flex gap-3">
                  <div className="mt-1 text-emerald-500 flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <p className="text-sm text-slate-700">{s}</p>
                </div>
              )) : (
                <div className="text-slate-500 text-sm italic">No key strengths identified.</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Key Risks">
            <div className="space-y-3">
              {riskFactors.length > 0 ? riskFactors.map((r: string, i: number) => (
                <div key={i} className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-800 flex gap-3">
                  <svg className="flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  <span>{r}</span>
                </div>
              )) : (
                <div className="text-slate-500 text-sm italic">No significant risks identified.</div>
              )}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Strategic Recommendations" className="mb-8">
          <div className="space-y-4">
            {recommendations.length > 0 ? recommendations.map((r: string, i: number) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 text-emerald-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <p className="text-sm text-slate-700">{r}</p>
              </div>
            )) : (
              <div className="text-slate-500 text-sm italic">No specific recommendations generated.</div>
            )}
          </div>
        </SectionCard>

        {/* --- FILING ADVICE FOR INVENTORS --- */}
        {filingAdvice && (
          <SectionCard title="Filing Advice" className="mb-8">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg p-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-blue-900 mb-2">Patent Filing Recommendation</h4>
                  <p className="text-sm text-blue-800 leading-relaxed">{filingAdvice}</p>
                </div>
              </div>
            </div>
            
            {whyNoveltyExists && (
              <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Novelty Basis</h4>
                <p className="text-sm text-slate-700">{whyNoveltyExists}</p>
              </div>
            )}
          </SectionCard>
        )}

        {/* --- INVENTOR ACTION ITEMS --- */}
        {inventorActions.length > 0 && (
          <SectionCard title="Inventor Action Items" className="mb-8">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-800">
                <strong>For the Inventor:</strong> Please review and respond to these items to strengthen the patent application.
              </p>
            </div>
            <div className="space-y-3">
              {inventorActions.map((action: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition-colors">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-xs font-bold">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-700">{action}</p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] rounded uppercase tracking-wider">Pending</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* --- FEATURE MATRIX --- */}
        <SectionCard title="Feature Comparison Matrix">
          {featureMaps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 font-semibold text-slate-900 bg-slate-50/50 min-w-[200px]">Patent Reference</th>
                    {features.map((f, i) => (
                      <th key={i} className="py-3 px-2 font-semibold text-slate-600 text-[10px] uppercase tracking-wide text-center min-w-[80px] max-w-[120px]">
                        Feature {i + 1}
                        <div className="font-normal normal-case truncate text-slate-400 mt-1" title={f}>
                          {f.length > 15 ? f.slice(0,15)+'...' : f}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {featureMaps.map((pm, idx) => {
                    const pn = pm.pn || pm.publicationNumber || 'Unknown';
                    return (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{pn}</div>
                          <div className="text-xs text-slate-500 truncate max-w-[180px]" title={pm.title}>{pm.title}</div>
                        </td>
                        {features.map((f, i) => {
                          const status = getMatrixStatus(pm, f);
                          return (
                            <td key={i} className="py-3 px-2 text-center">
                              <div className="flex justify-center">
                                <span className={`
                                  w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold
                                  ${status === 'P' ? 'bg-emerald-100 text-emerald-700' : 
                                    status === 'Pt' ? 'bg-amber-100 text-amber-700' : 
                                    status === 'A' ? 'bg-rose-50 text-rose-300' : 'bg-slate-100 text-slate-400'}
                                `}>
                                  {status}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4 flex gap-4 text-xs text-slate-500 justify-end">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Present</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span>Partial</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-300"></span>Absent</div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500 italic">No feature mapping data available.</div>
          )}
        </SectionCard>

        {/* Feature Novelty Analysis section removed - data shown in per-patent analysis */}

        {/* --- ENHANCED PER-PATENT ANALYSIS FOR INVENTOR REVIEW --- */}
        {perPatentAnalysis.length > 0 && (
          <section className="mb-8 print-break-before">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <div className="h-6 w-1 bg-purple-600 rounded-full mr-3"></div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Prior Art Analysis for Inventor Review</h2>
                  <p className="text-xs text-slate-500 mt-1">Detailed assessment of each relevant patent with actionable insights</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                {perPatentAnalysis.length} patent(s)
              </span>
            </div>

            <div className="space-y-6">
              {perPatentAnalysis.map((patent: any, idx: number) => {
                const pn = patent.pn || patent.patent_number || 'Unknown';
                const title = patent.title || 'Untitled Reference';
                const relevance = typeof patent.relevance === 'number' ? patent.relevance : 0.5;
                const noveltyThreat = patent.novelty_threat || 'unknown';
                const summary = patent.summary || '';
                const detailed = patent.detailedAnalysis || {};
                
                // Ensure arrays are arrays (defensive check)
                const relevantParts = Array.isArray(detailed.relevant_parts) ? detailed.relevant_parts : [];
                const irrelevantParts = Array.isArray(detailed.irrelevant_parts) ? detailed.irrelevant_parts : [];
                
                // Color coding for novelty threat levels
                const threatConfig: Record<string, { bg: string; border: string; text: string; label: string; icon: string }> = {
                  anticipates: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'HIGH RISK - May Anticipate', icon: '⚠️' },
                  obvious: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', label: 'MODERATE RISK - Obviousness Concern', icon: '⚡' },
                  adjacent: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', label: 'LOW RISK - Adjacent Art', icon: '📎' },
                  remote: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', label: 'MINIMAL RISK - Remote Reference', icon: '✓' },
                  unknown: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', label: 'Unassessed', icon: '?' }
                };
                
                const threat = threatConfig[noveltyThreat] || threatConfig.unknown;
                const relevancePercent = Math.round(relevance * 100);

                return (
                  <div key={idx} className={`rounded-xl border-2 ${threat.border} ${threat.bg} shadow-sm overflow-hidden break-inside-avoid`}>
                    {/* Header */}
                    <div className="p-5 border-b border-slate-200 bg-white/80">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 flex-wrap mb-1">
                            <span className="font-mono text-base font-bold text-slate-900">{pn}</span>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${threat.bg} ${threat.text} border ${threat.border}`}>
                              {threat.icon} {threat.label}
                            </span>
                          </div>
                          <h3 className="text-sm text-slate-700">{title}</h3>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <div className="text-xs text-slate-400 uppercase tracking-wider">Relevance</div>
                            <div className={`text-lg font-bold ${relevancePercent >= 70 ? 'text-red-600' : relevancePercent >= 50 ? 'text-orange-600' : 'text-slate-600'}`}>
                              {relevancePercent}%
                            </div>
                          </div>
                          <a 
                            href={`https://patents.google.com/patent/${encodeURIComponent(String(pn).replace(/\s+/g, ''))}`}
                            target="_blank" 
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors no-print"
                          >
                            View Patent →
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Analysis Content */}
                    <div className="p-5 space-y-4">
                      {/* Summary */}
                      {summary && (
                        <div>
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Analysis Summary</h4>
                          <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
                        </div>
                      )}

                      {/* Detailed Analysis Grid */}
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Overlapping Elements - RED */}
                        {relevantParts.length > 0 && (
                          <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                            <h5 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              Overlapping Elements (Requires Attention)
                            </h5>
                            <ul className="space-y-2">
                              {relevantParts.map((part: string, i: number) => (
                                <li key={i} className="text-xs text-red-800 flex items-start gap-2">
                                  <span className="text-red-400 mt-0.5">•</span>
                                  <span>{part}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Differentiators - GREEN */}
                        {irrelevantParts.length > 0 && (
                          <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                            <h5 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              Your Differentiators (Claim Focus Points)
                            </h5>
                            <ul className="space-y-2">
                              {irrelevantParts.map((part: string, i: number) => (
                                <li key={i} className="text-xs text-green-800 flex items-start gap-2">
                                  <span className="text-green-500 mt-0.5">✓</span>
                                  <span>{part}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Novelty Comparison */}
                      {detailed.novelty_comparison && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                          <h5 className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                            </svg>
                            Novelty Assessment vs This Reference
                          </h5>
                          <p className="text-xs text-blue-800 leading-relaxed">{detailed.novelty_comparison}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* --- DETAILED EVIDENCE (Prior Art) - LEGACY --- */}
        {perPatentAnalysis.length === 0 && featureMaps.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center mb-6">
            <div className="h-6 w-1 bg-blue-600 rounded-full mr-3"></div>
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Detailed Prior Art Evidence</h2>
          </div>
          
          <div className="space-y-6">
            {featureMaps.map((pm, idx) => {
              const pn = pm.pn || pm.publicationNumber || 'Unknown';
              const cpn = pn.replace(/[^A-Z0-9]/g, '');
              // Find matching metadata from stage1/stage4 remarks
              const meta = pqai.find((p: any) => (p.publicationNumber||p.pn||'').replace(/[^A-Z0-9]/g, '').includes(cpn)) || {};
              const remark = (stage4?.per_patent_remarks || []).find((r: any) => (r.pn||'').replace(/[^A-Z0-9]/g, '').includes(cpn));
              
              return (
                <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 break-inside-avoid">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Left: Meta */}
                    <div className="md:w-1/3 space-y-3">
                      <div>
                        <div className="text-lg font-bold text-slate-900 leading-tight">{pm.title || meta.title}</div>
                        <div className="text-sm font-mono text-blue-600 mt-1">{pn}</div>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge status={`Relevance: ${Math.round((meta.relevanceScore || meta.score || 0) * 100)}%`} />
                        <span className="text-xs text-slate-500 border border-slate-100 px-2 py-0.5 rounded">
                          {meta.publicationDate || meta.date || 'Date Unknown'}
                        </span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded text-xs text-slate-600 leading-relaxed italic border border-slate-100">
                        <span className="font-semibold not-italic text-slate-400 block mb-1 text-[10px] uppercase">Abstract Snippet</span>
                        {meta.abstract?.slice(0, 200) || pm.abstractSnippet || 'No abstract available.'}...
                      </div>
                      
                      <a 
                        href={pm.link || meta.link || `https://patents.google.com/patent/${pn}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline"
                      >
                        View Source Document →
                      </a>
                    </div>

                    {/* Right: Analysis */}
                    <div className="md:w-2/3 border-l border-slate-100 pl-0 md:pl-6 pt-4 md:pt-0">
                      <div className="mb-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">AI Analysis</h4>
                        <div className="prose prose-sm text-slate-700 leading-relaxed">
                          {remark?.remarks || pm.remarks || 'No detailed remarks available for this reference.'}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Feature Map</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {features.slice(0, 6).map((f, i) => {
                            const s = getMatrixStatus(pm, f);
                            if (s === '-') return null;
                            return (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s==='P'?'bg-emerald-500':s==='Pt'?'bg-amber-500':'bg-rose-400'}`}></span>
                                <span className="truncate text-slate-600" title={f}>{f}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* IDEA BANK SECTION HIDDEN - Ideas are saved silently to user's idea bank */}

        {/* --- FOOTER --- */}
        <footer className="mt-12 pt-8 border-t border-slate-200">
          {/* Disclaimer */}
          {finalRemarks?.disclaimer && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h4 className="text-sm font-semibold text-amber-900 mb-1">Important Legal Disclaimer</h4>
                  <p className="text-xs text-amber-800 leading-relaxed">{finalRemarks.disclaimer}</p>
                </div>
              </div>
            </div>
          )}
          
          <div className="text-center text-xs text-slate-400">
            <p className="mb-2">Generated by PatentNest.ai • AI-Powered Patent Intelligence</p>
            <p className="mb-2">Confidential • For Informational Purposes Only • Consult a Qualified Patent Attorney</p>
            <p className="text-slate-300">© {new Date().getFullYear()} PatentNest.ai - All Rights Reserved</p>
          </div>
        </footer>

      </div>

      {/* Share Link Modal */}
      {showShareModal && shareUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">Share Link Generated</h3>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-gray-600">
                  Your report is now publicly accessible. Share this link with others to view the report without requiring them to log in.
                </p>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Share URL</span>
                    <button
                      onClick={copyShareLink}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </button>
                  </div>
                  <div className="bg-white border border-gray-300 rounded p-3 font-mono text-sm text-gray-800 break-all">
                    {shareUrl}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <h4 className="text-sm font-medium text-amber-900 mb-1">Important Security Notice</h4>
                      <p className="text-sm text-amber-700">
                        This link will expire in 1 week for security reasons. After expiration, you'll need to generate a new share link.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      copyShareLink();
                      setShowShareModal(false);
                    }}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                  >
                    Copy & Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
