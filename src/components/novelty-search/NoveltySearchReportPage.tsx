'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Printer } from 'lucide-react';

interface NoveltySearchReportPageProps {
  searchId: string;
  searchData: any; // All stage results
  title?: string;
}

export default function NoveltySearchReportPage({ 
  searchId, 
  searchData,
  title = 'Novelty Search Report'
}: NoveltySearchReportPageProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [patentDetailsMap, setPatentDetailsMap] = useState<Record<string, any>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Extract stage data
  const stage0 = searchData?.stage0Results || searchData?.stage0 || {};
  const stage1 = searchData?.stage1Results || searchData?.stage1 || {};
  const stage35 = searchData?.stage35Results || searchData?.stage35 || [];
  const stage4 = searchData?.stage4Results || searchData?.stage4 || {};

  // Get feature maps and features
  const featureMaps: any[] = Array.isArray(stage35?.feature_map)
    ? stage35.feature_map
    : (Array.isArray(stage35) ? stage35 : []);
  const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];

  // Get PQAI results and shortlisted patents
  const pqai = Array.isArray(stage1?.pqaiResults) ? stage1.pqaiResults : [];
  const aiRelevance = stage1?.aiRelevance || null;

  // Compute fallback shortlist target (top 50%, min 10, max 20) when Stage 3.5 shortlist is unavailable
  const totalPQAI = Array.isArray(pqai) ? pqai.length : 0;
  const targetCount = Math.ceil(totalPQAI * 0.5);
  const selectedCount = Math.min(Math.max(targetCount, 10), Math.min(totalPQAI, 20));
  
  // Fetch detailed patent information from database
  useEffect(() => {
    const fetchPatentDetails = async () => {
      if (featureMaps.length === 0) return;

      // Collect ALL patent numbers from Stage 3.5 featureMaps
      // Include all variations to ensure we don't miss any
      const patentNumbersSet = new Set<string>();
      featureMaps.forEach((pm: any) => {
        const pn1 = pm.pn;
        const pn2 = pm.publicationNumber;
        const pn3 = pm.publication_number;
        const pn4 = pm.id;
        
        if (pn1) patentNumbersSet.add(String(pn1));
        if (pn2) patentNumbersSet.add(String(pn2));
        if (pn3) patentNumbersSet.add(String(pn3));
        if (pn4) patentNumbersSet.add(String(pn4));
      });

      const patentNumbers = Array.from(patentNumbersSet);
      
      console.log(`ðŸ” Fetching database details for ${patentNumbers.length} patents:`, patentNumbers);

      if (patentNumbers.length === 0) return;

      setDetailsLoading(true);
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/patents/details/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ publicationNumbers: patentNumbers })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.patents) {
            console.log(`✅ Database returned ${Object.keys(data.patents).length} patents`);
            setPatentDetailsMap(data.patents);
          } else {
            console.warn('⚠️ Database fetch succeeded but no patents returned');
          }
        } else {
          console.error('❌ Database fetch failed:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('❌ Failed to fetch patent details:', error);
      } finally {
        setDetailsLoading(false);
      }
    };

    fetchPatentDetails();
  }, [featureMaps.length]);

  // Debug: Log Stage 1 data structure
  useEffect(() => {
    if (pqai.length > 0) {
      console.log('Stage 1 PQAI Results Sample:', {
        totalResults: pqai.length,
        firstResult: {
          keys: Object.keys(pqai[0]),
          publicationNumber: pqai[0].publicationNumber,
          pn: pqai[0].pn,
          title: pqai[0].title,
          abstract: pqai[0].abstract?.substring(0, 100),
          snippet: pqai[0].snippet?.substring(0, 100),
          inventors: pqai[0].inventors,
          assignees: pqai[0].assignees
        }
      });
    }
  }, [pqai.length]);
  
  // Create set of shortlisted patent numbers from Stage 3.5
  const canonicalizePn = (pn?: string | null) => {
    if (!pn) return '';
    const s = String(pn).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.replace(/[A-Z]\d*$/, ''); // strip kind code suffix
  };
  
  const shortlistedPns = new Set<string>();
  featureMaps.forEach((pm: any) => {
    const pn = canonicalizePn(pm.pn || pm.publicationNumber || pm.publication_number);
    if (pn) shortlistedPns.add(pn);
  });
  
  // Filter and deduplicate patents to show
  const patentsToShowRaw = shortlistedPns.size > 0
    ? pqai.filter((r: any) => {
        const pn = canonicalizePn(r.publicationNumber || r.pn || r.publication_number);
        return pn && shortlistedPns.has(pn);
      })
    : pqai.slice(0, selectedCount);
  
  // Deduplicate by canonicalized patent number
  const seenPatentsStage1 = new Set<string>();
  const patentsToShow = patentsToShowRaw.filter((r: any) => {
    const pn = canonicalizePn(r.publicationNumber || r.pn || r.publication_number);
    if (!pn || seenPatentsStage1.has(pn)) {
      return false;
    }
    seenPatentsStage1.add(pn);
    return true;
  });
  
  console.log(`Stage 1 deduplicated patents: ${patentsToShowRaw.length} -> ${patentsToShow.length}`);

  const gateCount = aiRelevance && (Array.isArray(aiRelevance.accepted) || Array.isArray(aiRelevance.borderline))
    ? ((aiRelevance.accepted?.length || 0) + (aiRelevance.borderline?.length || 0))
    : null;
  const shortlistedCount = shortlistedPns.size > 0 ? shortlistedPns.size : (gateCount ?? selectedCount);

  // Stage 4 data
  const executiveSummary = stage4?.executive_summary || {};
  const concludingRemarks = stage4?.concluding_remarks || {};
  const structuredNarrative = stage4?.structured_narrative || {};

  // Handle print
  const handlePrint = () => {
    setIsPrinting(true);
    window.print();
    setTimeout(() => setIsPrinting(false), 1000);
  };

  // Handle PDF download using html2canvas + jsPDF

  // Helper to get status for feature matrix
  const getStatus = (pm: any, feature: string): 'P' | 'Pt' | 'A' | '-' => {
    const fa = Array.isArray(pm?.feature_analysis) ? pm.feature_analysis : [];
    const cell = fa.find((c: any) => c.feature === feature);
    if (!cell) return '-';
    if (cell.status === 'Present') return 'P';
    if (cell.status === 'Partial') return 'Pt';
    if (cell.status === 'Absent') return 'A';
    return '-';
  };

  // Format relevance as percentage
  const formatRelevance = (value: any): string => {
    const relValue = parseFloat(String(value || '0'));
    let relPercent = relValue;
    if (relPercent < 1 && relPercent > 0) {
      relPercent = relPercent * 100;
    }
    relPercent = Math.min(100, Math.max(0, relPercent));
    return relPercent.toFixed(2) + '%';
  };

  return (
    <>
      {/* Print/Download Controls - Hidden when printing */}
      <div className="no-print mb-4 flex gap-2 justify-end">
        <Button onClick={handlePrint} variant="outline" disabled={isPrinting}>
          <Printer className="mr-2 h-4 w-4" />
          Print / Save as PDF
        </Button>
      </div>

      {/* Report Content */}
      <div ref={reportRef} className="report-container bg-white p-8 max-w-5xl mx-auto">
        {/* Print Styles */}
        <style jsx global>{`
          @media print {
            @page {
              margin: 15mm;
              size: A4;
            }
            .no-print {
              display: none !important;
            }
            .report-container {
              max-width: 100%;
              padding: 0;
              background: white;
            }
            .page-break {
              page-break-before: always;
            }
            .avoid-break {
              page-break-inside: avoid;
            }
            .section-header {
              page-break-after: avoid;
            }
            body {
              background: white;
            }
            table {
              page-break-inside: auto;
            }
            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
            thead {
              display: table-header-group;
            }
            tfoot {
              display: table-footer-group;
            }
            a {
              color: #2563eb;
              text-decoration: underline;
            }
            a[href]:after {
              content: " (" attr(href) ")";
              font-size: 0.7em;
              color: #666;
            }
          }
          
          /* Screen styles */
          .report-container {
            font-family: 'Helvetica', 'Arial', sans-serif;
            color: #1a1a1a;
            line-height: 1.5;
          }
          
          .report-container a {
            color: #2563eb;
            text-decoration: underline;
          }
          
          .report-container a:hover {
            color: #1d4ed8;
          }
          
          .section-header {
            font-weight: bold;
            color: white;
          }
          
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.75rem;
          }
          
          table td, table th {
            padding: 0.5rem;
            border: 1px solid #d1d5db;
            vertical-align: top;
          }
          
          table th {
            background-color: #f3f4f6;
            font-weight: bold;
            text-align: left;
          }
          
          .text-justify {
            text-align: justify;
            text-justify: inter-word;
          }
        `}</style>

        {/* Title Page */}
        <div className="title-page avoid-break mb-8 pb-8 border-b-2 border-gray-300">
          <h1 className="text-4xl font-bold text-center mb-4 text-gray-900">NOVELTY SEARCH REPORT</h1>
          <h2 className="text-2xl font-semibold text-center mb-6 text-gray-700">{title}</h2>
          <div className="text-center space-y-2 text-gray-600">
            <p>Search ID: {searchId}</p>
            <p>Generated: {new Date().toLocaleString()}</p>
            <p>Jurisdiction: {searchData?.jurisdiction || 'IN'}</p>
          </div>
        </div>

        {/* Stage 0 â€” Idea & Key Features */}
        <div className="section page-break avoid-break mb-8">
          <div className="section-header bg-blue-600 text-white p-3 mb-4">
            <h2 className="text-xl font-bold">STAGE 0 â€” IDEA & KEY FEATURES</h2>
          </div>
          
          {stage0?.searchQuery && (
            <div className="mb-4">
              <h3 className="font-bold text-sm mb-2 text-gray-700">Search Query</h3>
              <p className="text-sm text-gray-800">{stage0.searchQuery}</p>
            </div>
          )}

          {Array.isArray(stage0?.inventionFeatures) && stage0.inventionFeatures.length > 0 && (
            <div>
              <h3 className="font-bold text-sm mb-2 text-gray-700">Key Features</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-800">
                {stage0.inventionFeatures.map((f: string, idx: number) => (
                  <li key={idx} className="mb-1">{f}</li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Stage 1 â€” Prior Art Search Overview */}
        <div className="section page-break avoid-break mb-8">
          <div className="section-header bg-blue-700 text-white p-3 mb-4">
            <h2 className="text-xl font-bold">STAGE 1 â€” PRIOR ART SEARCH OVERVIEW</h2>
          </div>

          <div className="mb-4 text-sm text-gray-700">
            <p>Total patent database results: {pqai.length}</p>
            <p>Patents shortlisted for detailed analysis: {shortlistedCount}</p>
          </div>

          {patentsToShow.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300 text-xs">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border border-gray-300 p-2 text-left font-bold">Patent Number</th>
                    <th className="border border-gray-300 p-2 text-center font-bold">Relevance</th>
                    <th className="border border-gray-300 p-2 text-left font-bold">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {[...patentsToShow]
                    .sort((a: any, b: any) => 
                      ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0))
                    )
                    .map((r: any, idx: number) => {
                      const pn = String(r.publicationNumber || r.pn || r.publication_number || 'â€”');
                      const title = String(r.title || 'â€”');
                      const relevance = formatRelevance(r.relevanceScore || r.score || r.relevance);
                      
                      return (
                        <tr key={idx} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                          <td className="border border-gray-300 p-2 align-top">{pn}</td>
                          <td className="border border-gray-300 p-2 text-center align-top">{relevance}</td>
                          <td className="border border-gray-300 p-2 align-top">{title}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stage 1 â€” Prior Art Details */}
        {patentsToShow.length > 0 && (
          <div className="section page-break avoid-break mb-8">
            <div className="section-header bg-blue-700 text-white p-3 mb-4">
              <h2 className="text-xl font-bold">STAGE 1 â€” PRIOR ART DETAILS</h2>
            </div>

            {[...patentsToShow]
              .sort((a: any, b: any) => 
                ((b.relevanceScore || b.score || b.relevance || 0) - (a.relevanceScore || a.score || a.relevance || 0))
              )
              .map((r: any, idx: number) => {
                const pnFull = String(r.publicationNumber || r.pn || r.publication_number || r.id || 'Unknown');
                const title = String(r.title || 'Untitled Patent');
                const abstract = String(
                  r.abstract ||
                  r.snippet ||
                  r.description ||
                  (r as any).abstract_text ||
                  (r as any).abstractText ||
                  (r as any).abstract_en ||
                  (r as any).abstractEnglish ||
                  ''
                ).trim();
                const pubDate = String(r.publication_date || r.pub_date || r.date || 'â€”');
                const appNo = String(r.application_number || r.applicationNumber || 'â€”');
                const appDate = String(r.application_date || r.filing_date || r.filingDate || 'â€”');
                const priorityNo = String(r.priority_number || r.priorityNumber || 'null');
                const priorityDate = String(r.priority_date || r.priorityDate || pubDate || 'â€”');
                const inventors = Array.isArray(r.inventors) ? r.inventors.join(' | ') : 
                                 (r.inventor ? String(r.inventor) : 'â€”');
                const familyMembers = String(r.family_members || r.familyMembers || pnFull);

                return (
                  <div key={idx} className="mb-6 avoid-break">
                    {/* Red Header */}
                    <div className="bg-red-600 text-white p-2 mb-2">
                      <h3 className="font-bold text-sm">Reference {idx + 1}: {pnFull}</h3>
                    </div>

                    {/* Two-column table */}
                    <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
                      <tbody>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4">Publication No:</td>
                          <td className="border border-gray-300 p-2">{pnFull}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Publication Date:</td>
                          <td className="border border-gray-300 p-2">{pubDate}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Application No:</td>
                          <td className="border border-gray-300 p-2">{appNo}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Application Date:</td>
                          <td className="border border-gray-300 p-2">{appDate}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Priority No:</td>
                          <td className="border border-gray-300 p-2">{priorityNo}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Priority Date:</td>
                          <td className="border border-gray-300 p-2">{priorityDate}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top">Inventor(s):</td>
                          <td className="border border-gray-300 p-2">{inventors}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Family Member(s):</td>
                          <td className="border border-gray-300 p-2">{familyMembers}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top">Title:</td>
                          <td className="border border-gray-300 p-2">{title}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top">Abstract:</td>
                          <td className="border border-gray-300 p-2 text-justify">{abstract || 'No abstract available.'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
          </div>
        )}

        {/* Stage 3.5a â€” Patent-wise Feature Comparison Matrix */}
        {featureMaps.length > 0 && features.length > 0 && (
          <div className="section page-break avoid-break mb-8">
            <div className="section-header bg-blue-500 text-white p-3 mb-4">
              <h2 className="text-xl font-bold">PATENT-WISE FEATURE COMPARISON MATRIX</h2>
            </div>

            {/* Legend */}
            <div className="mb-4 flex gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 bg-green-500 text-white text-center leading-4 font-bold">P</span>
                <span>Present</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 bg-yellow-500 text-white text-center leading-4 font-bold">Pt</span>
                <span>Partial</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 bg-red-500 text-white text-center leading-4 font-bold">A</span>
                <span>Absent</span>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto">
              {(() => {
                // Log matrix patents for debugging
                const matrixPatentNumbers = featureMaps.map((pm: any) => 
                  String(pm.pn || pm.publicationNumber || pm.publication_number || 'PN')
                );
                console.log(`Matrix showing ${matrixPatentNumbers.length} patents:`, matrixPatentNumbers);
                
                return (
                  <table className="w-full border-collapse border border-gray-300 text-xs">
                    <thead>
                      <tr className="bg-gray-200">
                        <th className="border border-gray-300 p-2 text-left font-bold">Feature</th>
                        {featureMaps.map((pm: any, c: number) => {
                          const pn = String(pm.pn || pm.publicationNumber || pm.publication_number || 'PN');
                          return (
                            <th key={c} className="border border-gray-300 p-1 text-center font-bold text-[10px]">
                              {pn.length > 12 ? pn.substring(0, 10) + '..' : pn}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {features.map((feature: string, r: number) => (
                        <tr key={r} className={r % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="border border-gray-300 p-2 align-top text-[10px]">{feature}</td>
                          {featureMaps.map((pm: any, c: number) => {
                            const status = getStatus(pm, feature);
                            const bgColor = 
                              status === 'P' ? 'bg-green-500' :
                              status === 'Pt' ? 'bg-yellow-500' :
                              status === 'A' ? 'bg-red-500' : 'bg-gray-200';
                            const textColor = (status === 'A' || status === 'P') ? 'text-white' : 'text-black';
                            
                            return (
                              <td key={c} className={`border border-gray-300 p-1 text-center ${bgColor} ${textColor} font-bold`}>
                                {status}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}

        {/* Stage 3.5 â€” Prior Art Patent Details (Patents Analyzed for Feature Comparison) */}
        {featureMaps.length > 0 && (
          <div className="section page-break avoid-break mb-8">
            <div className="section-header bg-blue-500 text-white p-3 mb-4">
              <h2 className="text-xl font-bold">STAGE 3.5 â€” PRIOR ART PATENT DETAILS</h2>
              <p className="text-sm mt-1 opacity-90">Patents analyzed for feature-by-feature comparison</p>
            </div>

            {/* Build index of PQAI results for matching */}
            {(() => {
              console.log(`📦 Building PQAI index from ${pqai.length} results`);
              
              const pqaiIndex: Record<string, any> = {};
              // Build index with multiple keys for better matching
              pqai.forEach((r: any, idx: number) => {
                const pn1 = canonicalizePn(r.publicationNumber);
                const pn2 = canonicalizePn(r.pn);
                const pn3 = canonicalizePn(r.publication_number);
                const pn4 = canonicalizePn(r.id);
                const pn5 = canonicalizePn(r.patent_number);
                
                // Also index by raw values (case-insensitive)
                const rawPn1 = String(r.publicationNumber || '').toUpperCase();
                const rawPn2 = String(r.pn || '').toUpperCase();
                const rawPn3 = String(r.publication_number || '').toUpperCase();
                
                if (pn1) pqaiIndex[pn1] = r;
                if (pn2 && pn2 !== pn1) pqaiIndex[pn2] = r;
                if (pn3 && pn3 !== pn1 && pn3 !== pn2) pqaiIndex[pn3] = r;
                if (pn4 && pn4 !== pn1 && pn4 !== pn2 && pn4 !== pn3) pqaiIndex[pn4] = r;
                if (pn5 && pn5 !== pn1 && pn5 !== pn2 && pn5 !== pn3 && pn5 !== pn4) pqaiIndex[pn5] = r;
                
                // Also index by raw values
                if (rawPn1) pqaiIndex[rawPn1] = r;
                if (rawPn2 && rawPn2 !== rawPn1) pqaiIndex[rawPn2] = r;
                if (rawPn3 && rawPn3 !== rawPn1 && rawPn3 !== rawPn2) pqaiIndex[rawPn3] = r;
                
                // Log first few for debugging
                if (idx < 3) {
                  console.log(`   PQAI[${idx}]:`, {
                    publicationNumber: r.publicationNumber,
                    pn: r.pn,
                    publication_number: r.publication_number,
                    canonicalized: pn1 || pn2 || pn3
                  });
                }
              });
              
              console.log(`   PQAI index built with ${Object.keys(pqaiIndex).length} keys`);

              // Get patents that appear in the matrix - use ALL patents from featureMaps
              // Deduplicate by canonicalized patent number, preserving the first occurrence
              // IMPORTANT: Show ALL patents from matrix, even if they don't have database/PQAI data
              // NOTE: PQAI results are NOT persisted to database - they're only in stage1Results JSON
              const seenPatents = new Set<string>();
              const uniqueFeatureMaps: any[] = [];
              
              console.log(`🔍 Processing ${featureMaps.length} patents from featureMaps`);
              
              featureMaps.forEach((pm: any, idx: number) => {
                const pnRaw = String(pm.pn || pm.publicationNumber || pm.publication_number || 'Unknown');
                const cpn = canonicalizePn(pnRaw);
                
                // Use canonicalized number if available, otherwise use raw number
                const dedupKey = cpn || pnRaw.toUpperCase();
                
                if (!seenPatents.has(dedupKey)) {
                  seenPatents.add(dedupKey);
                  uniqueFeatureMaps.push(pm);
                  
                  // Log first few for debugging
                  if (idx < 3) {
                    console.log(`   FeatureMap[${idx}]:`, {
                      pn: pm.pn,
                      publicationNumber: pm.publicationNumber,
                      publication_number: pm.publication_number,
                      raw: pnRaw,
                      canonicalized: cpn,
                      dedupKey
                    });
                  }
                } else {
                  console.log(`   Skipping duplicate: ${pnRaw} (already seen as ${dedupKey})`);
                }
              });

              console.log(`ðŸ“Š Patent Analysis:`);
              console.log(`   - Total featureMaps: ${featureMaps.length}`);
              console.log(`   - After deduplication: ${uniqueFeatureMaps.length}`);
              
              const detailPatentNumbers = uniqueFeatureMaps.map((pm: any) => 
                String(pm.pn || pm.publicationNumber || pm.publication_number || 'Unknown')
              );
              console.log(`   - Patents to show in details:`, detailPatentNumbers);
              
              // Log database patent map keys
              const dbKeys = Object.keys(patentDetailsMap);
              console.log(`   - Patents found in database: ${dbKeys.length}`, dbKeys.slice(0, 10));

              // Verify we have the same patents as the matrix
              if (detailPatentNumbers.length !== featureMaps.length) {
                console.warn(`âš ï¸ Patent count mismatch: Matrix has ${featureMaps.length} patents, Details will show ${detailPatentNumbers.length}`);
                const matrixPns = featureMaps.map((pm: any) => 
                  String(pm.pn || pm.publicationNumber || pm.publication_number || 'PN')
                );
                const missingPns = matrixPns.filter(pn => !detailPatentNumbers.includes(pn));
                if (missingPns.length > 0) {
                  console.warn(`   Missing patents in details:`, missingPns);
                }
              }

              // Show ALL unique patents from the matrix, regardless of PQAI/database matching
              // Use the SAME order as the matrix to ensure consistency
              // CRITICAL: Don't filter out patents - show them all even with minimal data
              // IMPORTANT: PQAI results are the source of truth since matrix patents come from Stage 1 PQAI
              return uniqueFeatureMaps.map((pm: any, idx: number) => {
                const pnRaw = String(pm.pn || pm.publicationNumber || pm.publication_number || 'Unknown');
                const cpn = canonicalizePn(pnRaw);
                
                // Try multiple matching strategies to find PQAI data
                // Since matrix patents come from Stage 1 PQAI, they MUST be in pqai array
                let pqaiData = pqaiIndex[cpn] || {};
                
                // If no match found in index, try direct search in pqai array with multiple strategies
                if (!pqaiData || Object.keys(pqaiData).length === 0) {
                  const directMatch = pqai.find((r: any) => {
                    const rpn1 = canonicalizePn(r.publicationNumber);
                    const rpn2 = canonicalizePn(r.pn);
                    const rpn3 = canonicalizePn(r.publication_number);
                    const rpn4 = canonicalizePn(r.id);
                    const rpn5 = canonicalizePn(r.patent_number);
                    return rpn1 === cpn || rpn2 === cpn || rpn3 === cpn || rpn4 === cpn || rpn5 === cpn ||
                           String(r.publicationNumber || '').toUpperCase() === pnRaw.toUpperCase() ||
                           String(r.pn || '').toUpperCase() === pnRaw.toUpperCase() ||
                           String(r.publication_number || '').toUpperCase() === pnRaw.toUpperCase();
                  });
                  if (directMatch) {
                    pqaiData = directMatch;
                    console.log(`✅ Found PQAI match for ${pnRaw} via direct search`);
                  } else {
                    console.warn(`⚠️ No PQAI match found for ${pnRaw} (cpn: ${cpn})`);
                    console.warn(`   Available PQAI patents:`, pqai.slice(0, 5).map((r: any) => 
                      String(r.publicationNumber || r.pn || r.publication_number || 'N/A')
                    ));
                  }
                }
                
                // Get detailed patent data from database (if available)
                // Try multiple lookup strategies to find database data
                let dbPatentData = patentDetailsMap[cpn] || 
                                  patentDetailsMap[canonicalizePn(pnRaw)] ||
                                  patentDetailsMap[pnRaw] ||
                                  patentDetailsMap[pnRaw.toUpperCase()] ||
                                  {};
                
                // Also try looking up by original patent number variations
                if (Object.keys(dbPatentData).length === 0) {
                  const variations = [
                    pnRaw,
                    pnRaw.toUpperCase(),
                    cpn,
                    pm.pn,
                    pm.publicationNumber,
                    pm.publication_number
                  ].filter(Boolean);
                  
                  for (const variant of variations) {
                    if (patentDetailsMap[variant]) {
                      dbPatentData = patentDetailsMap[variant];
                      break;
                    }
                    // Also try canonicalized version
                    const variantCpn = canonicalizePn(String(variant));
                    if (variantCpn && patentDetailsMap[variantCpn]) {
                      dbPatentData = patentDetailsMap[variantCpn];
                      break;
                    }
                  }
                }
                
                // Debug: log first patent's data structure
                if (idx === 0) {
                  console.log('Stage 3.5 Patent Data:', {
                    pnRaw,
                    cpn,
                    pmKeys: Object.keys(pm),
                    pqaiDataKeys: Object.keys(pqaiData),
                    dbPatentDataKeys: Object.keys(dbPatentData),
                    hasDbData: Object.keys(dbPatentData).length > 0,
                    pqaiDataSample: pqaiData ? {
                      title: pqaiData.title,
                      abstract: pqaiData.abstract?.substring(0, 50),
                      inventors: pqaiData.inventors,
                      snippet: pqaiData.snippet?.substring(0, 50)
                    } : 'No PQAI data found',
                    dbDataSample: dbPatentData ? {
                      title: dbPatentData.title,
                      abstract: dbPatentData.abstract?.substring(0, 50),
                      inventors: dbPatentData.inventors
                    } : 'No DB data found'
                  });
                }
                
                // Get patent details - PRIORITIZE Database data, then Stage 1 PQAI data, fallback to Stage 3.5 data
                // Publication Number
                const pnFull = String(dbPatentData.publicationNumber || pqaiData.publicationNumber || pqaiData.pn || pqaiData.patent_number || pqaiData.publication_number || pqaiData.id || pnRaw || 'Unknown');
                
                // Title - prioritize DB, then PQAI, then Stage 3.5
                const title = String(dbPatentData.title || pqaiData.title || pqaiData.invention_title || pm.title || 'Untitled Patent');
                
                // Abstract - prioritize DB, then PQAI, then Stage 3.5
                let abstract = '';
                if (dbPatentData.abstract) {
                  abstract = String(dbPatentData.abstract).trim();
                } else if (dbPatentData.description) {
                  abstract = String(dbPatentData.description).trim();
                } else if (pqaiData.abstract) {
                  abstract = String(pqaiData.abstract).trim();
                } else if (pqaiData.abstract_text) {
                  abstract = String(pqaiData.abstract_text).trim();
                } else if (pqaiData.abstractText) {
                  abstract = String(pqaiData.abstractText).trim();
                } else if (pqaiData.abstract_en) {
                  abstract = String(pqaiData.abstract_en).trim();
                } else if (pqaiData.abstractEnglish) {
                  abstract = String(pqaiData.abstractEnglish).trim();
                } else if (pqaiData.snippet) {
                  abstract = String(pqaiData.snippet).trim();
                } else if (pqaiData.description) {
                  abstract = String(pqaiData.description).trim();
                } else if (pqaiData.summary) {
                  abstract = String(pqaiData.summary).trim();
                } else if (pm.abstract) {
                  abstract = String(pm.abstract).trim();
                } else if (pm.snippet) {
                  abstract = String(pm.snippet).trim();
                }
                
                // Publication Date - prioritize DB, then PQAI
                let pubDate = 'â€”';
                if (dbPatentData.publicationDate) {
                  pubDate = new Date(dbPatentData.publicationDate).toLocaleDateString();
                } else if (pqaiData.publication_date) {
                  pubDate = String(pqaiData.publication_date);
                } else if (pqaiData.pub_date) {
                  pubDate = String(pqaiData.pub_date);
                } else if (pqaiData.date) {
                  pubDate = String(pqaiData.date);
                } else if (pqaiData.year) {
                  pubDate = String(pqaiData.year);
                } else if (pm.publication_date) {
                  pubDate = String(pm.publication_date);
                }
                
                // Application/Filing Date - prioritize DB
                let appDate = 'â€”';
                if (dbPatentData.filingDate) {
                  appDate = new Date(dbPatentData.filingDate).toLocaleDateString();
                } else if (pqaiData.application_date) {
                  appDate = String(pqaiData.application_date);
                } else if (pqaiData.filing_date) {
                  appDate = String(pqaiData.filing_date);
                } else if (pqaiData.filingDate) {
                  appDate = String(pqaiData.filingDate);
                } else if (pqaiData.app_date) {
                  appDate = String(pqaiData.app_date);
                } else if (pm.application_date) {
                  appDate = String(pm.application_date);
                }
                
                // Application Number - try to extract from worldwide applications if available
                let appNo = 'â€”';
                if (dbPatentData.worldwideApplications && Array.isArray(dbPatentData.worldwideApplications) && dbPatentData.worldwideApplications.length > 0) {
                  const firstApp = dbPatentData.worldwideApplications[0];
                  appNo = String(firstApp.application_number || firstApp.app_no || 'â€”');
                } else if (pqaiData.application_number) {
                  appNo = String(pqaiData.application_number);
                } else if (pqaiData.applicationNumber) {
                  appNo = String(pqaiData.applicationNumber);
                } else if (pqaiData.app_no) {
                  appNo = String(pqaiData.app_no);
                } else if (pm.application_number) {
                  appNo = String(pm.application_number);
                }
                
                // Priority Date - prioritize DB
                let priorityDate = 'â€”';
                if (dbPatentData.priorityDate) {
                  priorityDate = new Date(dbPatentData.priorityDate).toLocaleDateString();
                } else if (pqaiData.priority_date) {
                  priorityDate = String(pqaiData.priority_date);
                } else if (pqaiData.priorityDate) {
                  priorityDate = String(pqaiData.priorityDate);
                } else if (pm.priority_date) {
                  priorityDate = String(pm.priority_date);
                } else if (pubDate !== 'â€”') {
                  priorityDate = pubDate; // Fallback to publication date
                }
                
                // Priority Number - try to extract from worldwide applications
                let priorityNo = 'â€”';
                if (dbPatentData.worldwideApplications && Array.isArray(dbPatentData.worldwideApplications) && dbPatentData.worldwideApplications.length > 0) {
                  const firstApp = dbPatentData.worldwideApplications[0];
                  priorityNo = String(firstApp.priority_number || firstApp.priority_no || 'â€”');
                } else if (pqaiData.priority_number) {
                  priorityNo = String(pqaiData.priority_number);
                } else if (pqaiData.priorityNumber) {
                  priorityNo = String(pqaiData.priorityNumber);
                } else if (pqaiData.priority_no) {
                  priorityNo = String(pqaiData.priority_no);
                } else if (pm.priority_number) {
                  priorityNo = String(pm.priority_number);
                }
                
                // Inventors - prioritize DB data, then PQAI, then Stage 3.5
                let inventors = 'â€”';
                if (Array.isArray(dbPatentData.inventors) && dbPatentData.inventors.length > 0) {
                  inventors = dbPatentData.inventors.filter((inv: any) => inv && String(inv).trim()).join(' | ');
                } else if (Array.isArray(pqaiData.inventors) && pqaiData.inventors.length > 0) {
                  inventors = pqaiData.inventors.filter((inv: any) => inv && String(inv).trim()).join(' | ');
                } else if (pqaiData.inventor) {
                  inventors = String(pqaiData.inventor).trim();
                } else if (pqaiData.inventor_names && Array.isArray(pqaiData.inventor_names)) {
                  inventors = pqaiData.inventor_names.filter((inv: any) => inv && String(inv).trim()).join(' | ');
                } else if (pm.inventors) {
                  if (Array.isArray(pm.inventors)) {
                    inventors = pm.inventors.filter((inv: any) => inv && String(inv).trim()).join(' | ');
                  } else {
                    inventors = String(pm.inventors).trim();
                  }
                }
                // If still empty, set to dash
                if (!inventors || inventors.trim() === '') {
                  inventors = 'â€”';
                }
                
                // Assignees - prioritize DB data, then PQAI
                let assignees = 'â€”';
                if (Array.isArray(dbPatentData.assignees) && dbPatentData.assignees.length > 0) {
                  assignees = dbPatentData.assignees.filter((a: any) => a && String(a).trim()).join(' | ');
                } else if (Array.isArray(pqaiData.assignees) && pqaiData.assignees.length > 0) {
                  assignees = pqaiData.assignees.join(' | ');
                } else if (pqaiData.assignee) {
                  assignees = String(pqaiData.assignee);
                } else if (pqaiData.assignee_names && Array.isArray(pqaiData.assignee_names)) {
                  assignees = pqaiData.assignee_names.join(' | ');
                }
                if (!assignees || assignees.trim() === '') {
                  assignees = 'â€”';
                }
                
                // CPC Codes - prioritize DB data
                const cpcCodes = Array.isArray(dbPatentData.cpcs) && dbPatentData.cpcs.length > 0 ? dbPatentData.cpcs :
                                (Array.isArray(pqaiData.cpcCodes) ? pqaiData.cpcCodes : 
                                (Array.isArray(pqaiData.cpc_codes) ? pqaiData.cpc_codes : []));
                const cpcCodesStr = cpcCodes.length > 0 ? cpcCodes.join(', ') : 'â€”';
                
                // IPC Codes - prioritize DB data
                const ipcCodes = Array.isArray(dbPatentData.ipcs) && dbPatentData.ipcs.length > 0 ? dbPatentData.ipcs :
                                (Array.isArray(pqaiData.ipcCodes) ? pqaiData.ipcCodes : 
                                (Array.isArray(pqaiData.ipc_codes) ? pqaiData.ipc_codes : []));
                const ipcCodesStr = ipcCodes.length > 0 ? ipcCodes.join(', ') : 'â€”';
                
                // Family Members
                const familyMembers = String(pqaiData.family_members || pqaiData.familyMembers || pm.family_members || pnFull);
                
                // Link - prioritize DB data
                const link = String(dbPatentData.link || dbPatentData.pdfLink || pqaiData.link || pm.link || `https://patents.google.com/patent/${pnFull}`);
                
                // Relevance Score
                const relevanceScore = pqaiData.relevanceScore || pqaiData.score || pqaiData.relevance || null;
                const relevanceStr = relevanceScore !== null ? formatRelevance(relevanceScore) : 'â€”';

                // Calculate coverage statistics
                const coverage = pm.coverage || {};
                const presentCount = coverage.present || 0;
                const partialCount = coverage.partial || 0;
                const absentCount = coverage.absent || 0;
                const totalFeatures = features.length;
                const coverageScore = totalFeatures > 0 ? ((presentCount + partialCount * 0.5) / totalFeatures * 100).toFixed(1) : '0.0';

                return (
                  <div key={idx} className="mb-6 avoid-break">
                    {/* Blue Header with Coverage Info */}
                    <div className="bg-blue-600 text-white p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-sm">Patent {idx + 1}: {pnFull}</h3>
                          {title && title !== 'Untitled Patent' && (
                            <p className="text-xs mt-1 opacity-90">{title}</p>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-semibold">Coverage: {coverageScore}%</div>
                          <div className="mt-1 opacity-90">
                            P: {presentCount} | Pt: {partialCount} | A: {absentCount}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Two-column table */}
                    <table className="w-full border-collapse border border-gray-300 text-xs mb-4">
                      <tbody>
                        {/* Publication No and Date in one row */}
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50" style={{ width: '20%' }}>Publication No:</td>
                          <td className="border border-gray-300 p-2" style={{ width: '30%' }}>
                            {pnFull}
                            {link && (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 hover:underline text-[10px]">
                                [View Patent]
                              </a>
                            )}
                          </td>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50" style={{ width: '20%' }}>Publication Date:</td>
                          <td className="border border-gray-300 p-2" style={{ width: '30%' }}>{pubDate}</td>
                        </tr>
                        {/* Application No and Date in one row */}
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Application No:</td>
                          <td className="border border-gray-300 p-2">{appNo}</td>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Application Date:</td>
                          <td className="border border-gray-300 p-2">{appDate}</td>
                        </tr>
                        {/* Priority No and Date in one row */}
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Priority No:</td>
                          <td className="border border-gray-300 p-2">{priorityNo}</td>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50">Priority Date:</td>
                          <td className="border border-gray-300 p-2">{priorityDate}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top" colSpan={2}>Inventor(s):</td>
                          <td className="border border-gray-300 p-2 align-top" colSpan={2}>{inventors}</td>
                        </tr>
                        {assignees !== 'â€”' && (
                          <tr>
                            <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top" colSpan={2}>Assignee(s):</td>
                            <td className="border border-gray-300 p-2 align-top" colSpan={2}>{assignees}</td>
                          </tr>
                        )}
                        {cpcCodesStr !== 'â€”' && (
                          <tr>
                            <td className="border border-gray-300 p-2 font-bold bg-gray-50" colSpan={2}>CPC Codes:</td>
                            <td className="border border-gray-300 p-2" colSpan={2}>{cpcCodesStr}</td>
                          </tr>
                        )}
                        {ipcCodesStr !== 'â€”' && (
                          <tr>
                            <td className="border border-gray-300 p-2 font-bold bg-gray-50" colSpan={2}>IPC Codes:</td>
                            <td className="border border-gray-300 p-2" colSpan={2}>{ipcCodesStr}</td>
                          </tr>
                        )}
                        {relevanceStr !== 'â€”' && (
                          <tr>
                            <td className="border border-gray-300 p-2 font-bold bg-gray-50" colSpan={2}>Relevance Score:</td>
                            <td className="border border-gray-300 p-2" colSpan={2}>{relevanceStr}</td>
                          </tr>
                        )}
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50" colSpan={2}>Family Member(s):</td>
                          <td className="border border-gray-300 p-2" colSpan={2}>{familyMembers}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top" colSpan={2}>Title:</td>
                          <td className="border border-gray-300 p-2 align-top" colSpan={2}>{title}</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top" colSpan={2}>Abstract:</td>
                          <td className="border border-gray-300 p-2 text-justify align-top" colSpan={2}>
                            {abstract && abstract.length > 0 ? abstract : 'No abstract available.'}
                          </td>
                        </tr>
                        {/* Feature Coverage Summary */}
                        {totalFeatures > 0 && (
                          <tr>
                            <td className="border border-gray-300 p-2 font-bold bg-gray-50 align-top" colSpan={2}>Feature Coverage:</td>
                            <td className="border border-gray-300 p-2 align-top" colSpan={2}>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 bg-green-500 inline-block"></span>
                                  <span className="text-xs">Present: {presentCount} feature{presentCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 bg-yellow-500 inline-block"></span>
                                  <span className="text-xs">Partial: {partialCount} feature{partialCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 bg-red-500 inline-block"></span>
                                  <span className="text-xs">Absent: {absentCount} feature{absentCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                  <span className="text-xs font-semibold">Overall Coverage Score: {coverageScore}%</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Stage 4 â€” Final Concluding Remarks */}
        <div className="section page-break avoid-break mb-8">
          <div className="section-header bg-blue-600 text-white p-3 mb-4">
            <h2 className="text-xl font-bold">STAGE 4 â€” FINAL CONCLUDING REMARKS</h2>
          </div>

          {/* Executive Summary */}
          {(executiveSummary.summary || executiveSummary.text) && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Executive Summary:</td>
                    <td className="border border-gray-300 p-2 text-justify">
                      {executiveSummary.summary || executiveSummary.text || 'No summary provided.'}
                    </td>
                  </tr>
                  {(executiveSummary.novelty_score || executiveSummary.confidence) && (
                    <tr>
                      <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4">Novelty Score:</td>
                      <td className="border border-gray-300 p-2">
                        {executiveSummary.novelty_score || 'â€”'} {executiveSummary.confidence ? `â€¢ Confidence: ${executiveSummary.confidence}` : ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Overall Novelty Assessment */}
          {(concludingRemarks.overall_novelty_assessment || stage4?.decision) && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4">Overall Novelty Assessment:</td>
                    <td className="border border-gray-300 p-2">
                      {concludingRemarks.overall_novelty_assessment || stage4.decision || 'Novelty Assessment'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Why Novelty Exists */}
          {(concludingRemarks.why_novelty_exists || executiveSummary.summary || executiveSummary.text || structuredNarrative.verdict) && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Why Novelty Exists:</td>
                    <td className="border border-gray-300 p-2 text-justify">
                      {concludingRemarks.why_novelty_exists || 
                       executiveSummary.summary || 
                       executiveSummary.text ||
                       structuredNarrative.verdict || 
                       'Novelty assessment based on feature analysis.'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Key Strengths */}
          {Array.isArray(concludingRemarks.key_strengths) && concludingRemarks.key_strengths.length > 0 && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Key Strengths:</td>
                    <td className="border border-gray-300 p-2">
                      <ul className="list-disc list-inside space-y-1">
                        {concludingRemarks.key_strengths.map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Key Risks */}
          {Array.isArray(concludingRemarks.key_risks) && concludingRemarks.key_risks.length > 0 && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Key Risks:</td>
                    <td className="border border-gray-300 p-2">
                      <ul className="list-disc list-inside space-y-1">
                        {concludingRemarks.key_risks.map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Strategic Recommendations */}
          {Array.isArray(concludingRemarks.strategic_recommendations) && concludingRemarks.strategic_recommendations.length > 0 && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Strategic Recommendations:</td>
                    <td className="border border-gray-300 p-2">
                      <ul className="list-disc list-inside space-y-1">
                        {concludingRemarks.strategic_recommendations.map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Filing Advice */}
          {concludingRemarks.filing_advice && (
            <div className="mb-3 avoid-break">
              <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                <tbody>
                  <tr>
                    <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Filing Advice:</td>
                    <td className="border border-gray-300 p-2 text-justify">
                      {concludingRemarks.filing_advice}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Fallback: Structured Narrative sections */}
          {!concludingRemarks.overall_novelty_assessment && structuredNarrative && (
            <>
              {structuredNarrative.integration && (
                <div className="mb-3 avoid-break">
                  <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                    <tbody>
                      <tr>
                        <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Integration Analysis:</td>
                        <td className="border border-gray-300 p-2 text-justify">{structuredNarrative.integration}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {structuredNarrative.feature_insights && (
                <div className="mb-3 avoid-break">
                  <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                    <tbody>
                      <tr>
                        <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Feature Insights:</td>
                        <td className="border border-gray-300 p-2 text-justify">{structuredNarrative.feature_insights}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {structuredNarrative.verdict && (
                <div className="mb-3 avoid-break">
                  <table className="w-full border-collapse border border-gray-300 text-xs mb-2">
                    <tbody>
                      <tr>
                        <td className="border border-gray-300 p-2 font-bold bg-gray-50 w-1/4 align-top">Verdict:</td>
                        <td className="border border-gray-300 p-2 text-justify">{structuredNarrative.verdict}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-gray-300 text-xs text-gray-500 text-center">
          <p>This report is AI-assisted; verify cited prior art and consult a registered patent attorney for legal conclusions.</p>
          <p className="mt-2">Generated by AI Patent Assistant</p>
        </div>
      </div>
    </>
  );
}


