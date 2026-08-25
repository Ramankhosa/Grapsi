// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useAuth } from '@/lib/auth-context';
import axios from 'axios';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import {
  FaFilter, FaPrint, FaShare, FaLink, FaFileWord, FaCheck, FaTimes, FaExclamationTriangle, FaFileExport,
} from 'react-icons/fa';
import { ReviewerText } from '@/components/reviewer/ReviewerText';
import { compareSections, reportFreshness } from '@/lib/reviewer/sectionGrouping';
import { normalizeVersionSelections } from '@/lib/reviewer/finalReport';
import ReviewerShell from '@/components/reviewer/ReviewerShell';
import PriorWorkList from '@/components/funding-intelligence/PriorWorkList';
import CoverageMap from '@/components/funding-intelligence/CoverageMap';
import {
  ComplianceBars,
  ConsistencyFlags,
  CriterionBars,
  EmptySections,
  NoveltyBlock,
  Panel,
  PriorityActions,
  ReportCover,
  ReportJumpBar,
  SectionReviewCard,
  SectionScoreBars,
  anchorFor,
} from '@/components/reviewer/report/ReportBlocks';

interface SectionReview {
  id: string;
  section_title: string;
  user_input: string;
  status: string;
  version: number;
  ai_review_json: Record<string, any>;
  [key: string]: any;
}

// Group sections by title and version (reviewed rows only — the picker's options)
interface GroupedSections {
  [title: string]: {
    [version: number]: SectionReview;
    versions: number[];
    latestVersion: number;
  };
}

const hasMeaningfulClientContent = (value: string) => {
  const text = String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[a-z0-9]/i.test(text);
};

const isScorableReviewedSection = (section: any) => {
  if (section.status !== 'reviewed' || !hasMeaningfulClientContent(section.user_input)) return false;
  const links = Array.isArray(section.mappingJson?.linkedSections) ? section.mappingJson.linkedSections : [];
  const declaresWorkflow = links.some((link: any) => typeof link.workflowMode === 'string');
  return !declaresWorkflow || links.some((link: any) => link.workflowMode === 'app_draft');
};

export default function FinalReview() {
  const router = useRouter();
  const { id } = router.query;
  const { status } = useSession();
  const { authFetch } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [callData, setCallData] = useState<any>(null);
  const [rawSections, setRawSections] = useState<SectionReview[]>([]);
  const [allSections, setAllSections] = useState<SectionReview[]>([]);
  const [sections, setSections] = useState<SectionReview[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeneratingATR, setIsGeneratingATR] = useState(false);

  // Version selection and comparison state
  const [groupedSections, setGroupedSections] = useState<GroupedSections>({});
  const [displayMode, setDisplayMode] = useState<'single' | 'parallel'>('single');
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({});
  const [compareVersions, setCompareVersions] = useState<Record<string, number[]>>({});
  const [showVersionSelector, setShowVersionSelector] = useState(false);
  const [includedSections, setIncludedSections] = useState<Record<string, boolean>>({});

  // Share link state
  const [shareLink, setShareLink] = useState<string>('');
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState<boolean>(false);
  const [shareLinkError, setShareLinkError] = useState<string>('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
    if (status !== 'authenticated' || !id) {
      return;
    }

    const fetchFinalReview = async () => {
      try {
        setLoading(true);
        const callResponse = await axios.get(`/api/reviewer/calls/${id}`);

        if (!callResponse.data.call?.overall_review_json) {
          setError('No final review is available yet. Please generate a final review first.');
          setLoading(false);
          return;
        }

        setCallData(callResponse.data.call);
        const reportPreferences = callResponse.data.call?.parsed_json?.report_preferences || null;

        const sectionsResponse = await axios.get(`/api/reviewer/calls/${id}/sections`);
        const processedSections: SectionReview[] = (sectionsResponse.data.sections || []).map((section: any) => ({
          ...section,
          ai_review_json: {
            score: 0, summary: '', strengths: [], weaknesses: [], suggestions: [], recommendations: [],
            ...(section.ai_review_json || {}),
          },
          user_input: section.user_input || '',
          version: section.version || 1,
        }));
        setRawSections(processedSections);

        const allReviewedSections = processedSections.filter(isScorableReviewedSection);
        setAllSections(allReviewedSections);

        // Group reviewed rows by title and version
        const grouped: GroupedSections = {};
        allReviewedSections.forEach((section) => {
          const title = section.section_title;
          if (!grouped[title]) grouped[title] = { versions: [], latestVersion: 0 };
          grouped[title][section.version] = section;
          if (!grouped[title].versions.includes(section.version)) grouped[title].versions.push(section.version);
          if (section.version > grouped[title].latestVersion) grouped[title].latestVersion = section.version;
        });
        setGroupedSections(grouped);

        // Defaults: the version the stored report scored (so the page agrees with
        // the report), else the latest reviewed version.
        const scored = callResponse.data.call?.overall_review_json?.score_basis?.scoredVersions || {};
        const initialSelected: Record<string, number> = {};
        const initialCompare: Record<string, number[]> = {};
        const initialIncluded: Record<string, boolean> = {};
        Object.keys(grouped).forEach((title) => {
          const scoredVersion = Number(scored[title]);
          initialSelected[title] = grouped[title][scoredVersion] ? scoredVersion : grouped[title].latestVersion;
          initialIncluded[title] = true;
          if (grouped[title].versions.length > 1) {
            initialCompare[title] = [...grouped[title].versions].sort((a, b) => b - a).slice(0, 2);
          }
        });

        // Saved picker preferences (both key shapes accepted)
        if (reportPreferences?.displayMode) {
          setDisplayMode(reportPreferences.displayMode === 'parallel' ? 'parallel' : 'single');
          const saved = normalizeVersionSelections(reportPreferences.versionSelections);
          Object.entries(saved).forEach(([title, version]) => {
            if (grouped[title]?.[version]) initialSelected[title] = version;
          });
          if (reportPreferences.displayMode === 'parallel') {
            Object.entries(reportPreferences.versionSelections || {}).forEach(([key, value]) => {
              if (!String(key).includes('|')) return;
              const title = String(key).slice(0, String(key).lastIndexOf('|'));
              const version = Number(value);
              if (!grouped[title]?.[version]) return;
              initialCompare[title] = Array.from(new Set([...(initialCompare[title] || []), version])).sort((a, b) => b - a).slice(0, 2);
            });
          }
          const excluded = new Set((reportPreferences.excludedTitles || []).map((title: string) => String(title).toLowerCase()));
          Object.keys(grouped).forEach((title) => { initialIncluded[title] = !excluded.has(title.toLowerCase()); });
        }

        setSelectedVersions(initialSelected);
        setCompareVersions(initialCompare);
        setIncludedSections(initialIncluded);
        setSections(Object.keys(grouped).map((title) => grouped[title][initialSelected[title]]).filter(Boolean));

        const initialExpanded: Record<string, boolean> = {};
        allReviewedSections.forEach((section) => { initialExpanded[section.id] = false; });
        setExpandedSections(initialExpanded);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching final review:', err);
        setError('Failed to load final review data');
        setLoading(false);
      }
    };

    fetchFinalReview();
  }, [id, status, router]);

  // Keep the displayed section list in step with the picker
  useEffect(() => {
    if (displayMode === 'single') {
      setSections(Object.keys(selectedVersions).map((title) => groupedSections[title]?.[selectedVersions[title]]).filter(Boolean));
    } else {
      setSections(Object.values(groupedSections).map((group) => group[group.latestVersion]).filter(Boolean));
    }
  }, [displayMode, selectedVersions, groupedSections]);

  const toggleSectionExpand = (sectionId: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handleVersionChange = (sectionTitle: string, version: number) => {
    setSelectedVersions((prev) => ({ ...prev, [sectionTitle]: version }));
    setIncludedSections((prev) => ({ ...prev, [sectionTitle]: true }));
  };

  const handleCompareVersionChange = (sectionTitle: string, versions: number[]) => {
    setCompareVersions((prev) => ({ ...prev, [sectionTitle]: versions }));
  };

  const getSortedSections = (list: SectionReview[]) => [...list].sort(compareSections);

  const overallReview = callData?.overall_review_json || {
    overall_score: 0, executive_summary: '', major_strengths: [], major_weaknesses: [], cross_sectional_recommendations: [], supplementary_materials: [],
  };
  const scoreBasis = overallReview.score_basis || {};
  const scoredVersions: Record<string, number> = scoreBasis.scoredVersions || {};
  const pendingDrafts: Record<string, number> = scoreBasis.pendingDrafts || {};
  const freshness = useMemo(() => reportFreshness(callData?.overall_review_json, rawSections), [callData, rawSections]);

  const supplementaryMaterials = Array.from(new Set([
    ...(Array.isArray(overallReview.supplementary_materials) ? overallReview.supplementary_materials : []),
    ...sections.flatMap((section) => [
      ...(Array.isArray(section.ai_review_json?.supplementary_materials) ? section.ai_review_json.supplementary_materials : []),
      ...(Array.isArray(section.ai_review_json?.non_scoring_reminders) ? section.ai_review_json.non_scoring_reminders : []),
    ]),
  ].map((item) => String(item || '').trim()).filter(Boolean)));

  // Rows for the score bars — the displayed version of each section, annotated
  // with what the stored report actually scored.
  const panelBySection = new Map<string, any>(
    (Array.isArray(overallReview.section_scorecard) ? overallReview.section_scorecard : []).map((entry: any) => [String(entry?.section || '').toLowerCase(), entry])
  );
  const scoreRows = getSortedSections(sections).map((section) => {
    const review = section.ai_review_json || {};
    return {
      title: section.section_title,
      version: section.version,
      score: typeof review.score === 'number' ? review.score : null,
      delta: typeof review.score_delta === 'number' ? review.score_delta : null,
      previousScore: typeof review.previous_score === 'number' ? review.previous_score : null,
      improvement: typeof review.improvement_over_previous === 'boolean' ? review.improvement_over_previous : null,
      pendingDraft: pendingDrafts[section.section_title] || null,
      inReport: Number(scoredVersions[section.section_title]) === Number(section.version),
      headline: panelBySection.get(section.section_title.toLowerCase())?.headline || null,
    };
  });

  const jumpItems = [
    { id: 'overview', label: 'Overview' },
    ...(overallReview.novelty_assessment ? [{ id: 'novelty', label: 'Novelty' }] : []),
    { id: 'scores', label: 'Scores' },
    { id: 'fix-first', label: 'Fix first' },
    { id: 'consistency', label: 'Consistency & compliance' },
    { id: 'assessment', label: 'Strengths & weaknesses' },
    { id: 'sections', label: 'Sections' },
    ...(overallReview.landscape ? [{ id: 'landscape', label: 'Landscape' }] : []),
  ];

  // --- actions --------------------------------------------------------------

  const generateShareLink = async () => {
    if (!id) return;
    try {
      setIsGeneratingShareLink(true);
      setShareLinkError('');
      const sharePreferences = {
        displayMode,
        versionSelections: displayMode === 'single'
          ? selectedVersions
          : Object.entries(compareVersions).reduce((acc, [title, versions]) => {
              versions.forEach((version) => { acc[`${title}|${version}`] = version; });
              return acc;
            }, {}),
      };
      const response = await axios.post(`/api/reviewer/calls/${id}/share-report`, sharePreferences);
      if (!response.data?.share_url) throw new Error('Failed to generate share link');
      setShareLink(response.data.share_url);
      toast.success('Public share link created');
    } catch (err) {
      console.error('Error generating share link:', err);
      setShareLinkError('Failed to generate shareable link');
      toast.error('Failed to generate share link');
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  const regenerateFinalReview = async () => {
    if (!id) return;
    try {
      setIsRegenerating(true);
      const response = await axios.post(`/api/reviewer/calls/${id}/final-review`);
      if (response.data && response.data.call) {
        toast.success('Final review regenerated');
        router.reload();
      }
    } catch (error) {
      console.error('Error regenerating final review:', error);
      toast.error(error?.response?.data?.error || 'Failed to regenerate final review. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const generateWithSelections = async () => {
    try {
      setLoading(true);
      const versionSelections: Record<string, number> = {};
      const excludedTitles: string[] = [];
      Object.keys(groupedSections).forEach((title) => {
        if (!includedSections[title]) { excludedTitles.push(title); return; }
        if (displayMode === 'single') {
          versionSelections[title] = selectedVersions[title] || groupedSections[title].latestVersion;
        } else {
          // A report scores one draft per section: the newest of the compared versions.
          const versions = compareVersions[title]?.length ? compareVersions[title] : [groupedSections[title].latestVersion];
          versionSelections[title] = Math.max(...versions);
        }
      });
      if (Object.keys(versionSelections).length === 0) {
        setError('Please select at least one section to include in the report');
        setLoading(false);
        return;
      }
      await axios.post(`/api/reviewer/calls/${id}/final-review`, { versionSelections, excludedTitles, displayMode });
      router.reload();
    } catch (err) {
      console.error('Error generating custom report:', err);
      setError(err?.response?.data?.error || 'Failed to generate custom report with selected versions');
      setLoading(false);
    }
  };

  const generateATR = async () => {
    if (!id) return;
    const toastId = toast.loading('Generating Action Taken Report...');
    setIsGeneratingATR(true);
    try {
      const response = await authFetch(`/api/reviewer/calls/${id}/export-atr`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ATR-${id}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Action Taken Report downloaded', { id: toastId });
    } catch (error) {
      toast.error(`Failed to generate ATR: ${error.message}`, { id: toastId });
      console.error('Error generating ATR:', error);
    } finally {
      setIsGeneratingATR(false);
    }
  };

  // --- states ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-nickel-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg max-w-md w-full">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Error</h2>
          <p className="mb-6 text-nickel-600">{error}</p>
          <div className="flex justify-between">
            <Link href={`/reviewer/${id}`} className="text-cobalt-700 hover:underline">Back to Project</Link>
            <button
              onClick={async () => {
                try {
                  setLoading(true);
                  await axios.post(`/api/reviewer/calls/${id}/final-review`);
                  router.reload();
                } catch (err) {
                  console.error('Error generating final review:', err);
                  setError(err?.response?.data?.error || 'Failed to generate final review. Make sure all sections are reviewed.');
                  setLoading(false);
                }
              }}
              className="px-4 py-2 bg-cobalt-600 text-white rounded-md hover:bg-cobalt-700"
            >
              Generate Final Review
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasMultipleVersions = Object.values(groupedSections).some((group) => group.versions.length > 1);
  const sortedTitles = Object.keys(groupedSections).sort((a, b) => compareSections(groupedSections[a][groupedSections[a].latestVersion], groupedSections[b][groupedSections[b].latestVersion]));

  return (
    <ReviewerShell
      call={callData || { id }}
      sections={rawSections}
      title="Panel report"
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowVersionSelector((open) => !open)} className="nk-btn-ghost nk-btn-sm" aria-expanded={showVersionSelector}>
            <FaFilter aria-hidden="true" /> {hasMultipleVersions ? 'Versions' : 'Sections'}
          </button>
          <button onClick={() => window.print()} className="nk-btn-ghost nk-btn-sm"><FaPrint aria-hidden="true" /> Print</button>
          <button onClick={generateATR} disabled={isGeneratingATR} className="nk-btn-ghost nk-btn-sm" title="Download the Action Taken Report (Word)">
            <FaFileWord aria-hidden="true" /> {isGeneratingATR ? 'Building…' : 'ATR'}
          </button>
          <button onClick={generateShareLink} disabled={isGeneratingShareLink} className="nk-btn-secondary nk-btn-sm">
            <FaShare aria-hidden="true" /> {isGeneratingShareLink ? 'Generating…' : 'Share'}
          </button>
          <button onClick={regenerateFinalReview} disabled={isRegenerating} className="nk-btn-primary nk-btn-sm">
            {isRegenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      }
    >
      <div id="top" className="space-y-6">
        <ReportJumpBar items={jumpItems} />

        {freshness === 'stale' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            <span><strong>Out of date.</strong> A section was reviewed after this report was written. Regenerate to bring the verdict in line with the current drafts.</span>
            <button onClick={regenerateFinalReview} disabled={isRegenerating} className="nk-btn-secondary nk-btn-sm">{isRegenerating ? 'Regenerating…' : 'Regenerate now'}</button>
          </div>
        ) : null}

        {/* Version / section picker — inline, same page */}
        {showVersionSelector ? (
          <div className="rounded-md border border-nickel-200 bg-white p-4 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-nickel-900">Choose what the report scores</h2>
                <p className="text-xs text-nickel-500">Pick a version per section and untick sections to leave out. The stored report scored: {Object.entries(scoredVersions).map(([title, version]) => `${title} v${version}`).join(', ') || '—'}.</p>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-nickel-200 p-0.5 text-sm">
                <button onClick={() => setDisplayMode('single')} className={`rounded px-3 py-1 ${displayMode === 'single' ? 'bg-nickel-800 text-white' : 'text-nickel-700'}`}>Single version</button>
                <button onClick={() => setDisplayMode('parallel')} className={`rounded px-3 py-1 ${displayMode === 'parallel' ? 'bg-nickel-800 text-white' : 'text-nickel-700'}`}>Compare versions</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {sortedTitles.map((title) => {
                const group = groupedSections[title];
                return (
                  <div key={title} className="rounded-md border border-nickel-200 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-nickel-900">
                      <input type="checkbox" checked={includedSections[title] ?? true} onChange={(e) => setIncludedSections((prev) => ({ ...prev, [title]: e.target.checked }))} className="h-4 w-4" />
                      {title}
                    </label>
                    {displayMode === 'single' ? (
                      <select value={selectedVersions[title] || group.latestVersion} onChange={(e) => handleVersionChange(title, Number(e.target.value))} className="mt-2 w-full rounded border border-nickel-300 px-2 py-1 text-sm">
                        {[...group.versions].sort((a, b) => b - a).map((version) => (
                          <option key={version} value={version}>
                            Version {version}{Number(scoredVersions[title]) === version ? ' (in report)' : ''}{typeof group[version]?.ai_review_json?.score === 'number' ? ` · ${group[version].ai_review_json.score.toFixed(1)}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {[...group.versions].sort((a, b) => b - a).map((version) => (
                          <label key={version} className="flex items-center gap-2 text-sm text-nickel-700">
                            <input
                              type="checkbox"
                              checked={compareVersions[title]?.includes(version) || false}
                              onChange={(e) => {
                                const current = compareVersions[title] || [];
                                if (e.target.checked) handleCompareVersionChange(title, current.length < 2 ? [...current, version] : [current[1], version]);
                                else handleCompareVersionChange(title, current.filter((v) => v !== version));
                              }}
                              className="h-4 w-4"
                            />
                            Version {version}
                          </label>
                        ))}
                        <p className="text-[11px] text-nickel-500">Up to two versions side by side; the report scores the newer one.</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={generateWithSelections} className="nk-btn-primary nk-btn-sm">Generate report with these choices</button>
            </div>
          </div>
        ) : null}

        {shareLink ? (
          <div className="rounded-md border border-cobalt-200 bg-cobalt-50 p-4 print:hidden">
            <h3 className="mb-1 flex items-center text-sm font-semibold text-cobalt-800"><FaLink className="mr-2" /> Public share link</h3>
            <p className="mb-2 text-xs text-cobalt-700">Anyone with this link can view the report without logging in.</p>
            <div className="flex">
              <input type="text" value={shareLink} readOnly className="flex-1 rounded-l-md border border-cobalt-300 p-2 text-sm" />
              <button onClick={() => { navigator.clipboard.writeText(shareLink); toast.success('Link copied'); }} className="rounded-r-md bg-cobalt-600 px-4 py-2 text-sm text-white hover:bg-cobalt-700">Copy</button>
            </div>
          </div>
        ) : null}
        {shareLinkError ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{shareLinkError}</div> : null}

        {/* 1. Overview */}
        <Panel id="overview" title="Overall assessment" note="Panel verdict, score and executive summary">
          <ReportCover
            overall={overallReview}
            projectTitle={callData?.project_title || 'Untitled proposal'}
            agencyName={callData?.agency_name || callData?.parsed_json?.agency_name || null}
            generatedAt={overallReview.generated_at}
            reviewedCount={Object.keys(scoredVersions).length || sections.length}
            pendingDrafts={pendingDrafts}
            scoredVersions={scoredVersions}
          />
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Executive summary</h3>
            <div className="rounded-md bg-nickel-50 p-4">
              <ReviewerText value={overallReview.executive_summary} fallback="No executive summary provided." />
            </div>
          </div>
        </Panel>

        {/* 2. Novelty */}
        {overallReview.novelty_assessment ? (
          <Panel id="novelty" title="Novelty & positioning" note="Where this idea sits against already-funded work and patents — reference only, not part of the score">
            <NoveltyBlock novelty={overallReview.novelty_assessment} />
          </Panel>
        ) : null}

        {/* 3. Scores */}
        <Panel id="scores" title="Scores" note="Section scores with version changes, and the call's criteria">
          <SectionScoreBars rows={scoreRows} />
          {overallReview.criterion_scorecard?.length ? (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Against the call's criteria</h3>
              <CriterionBars rows={overallReview.criterion_scorecard} />
            </div>
          ) : null}
          {scoreBasis && (typeof scoreBasis.weightedScore === 'number' || typeof scoreBasis.meanSectionScore === 'number') ? (
            <p className="mt-4 text-xs text-nickel-500">
              How the overall score was formed:
              {typeof scoreBasis.weightedScore === 'number' ? ` weighted score ${scoreBasis.weightedScore.toFixed(2)}` : ''}
              {typeof scoreBasis.meanSectionScore === 'number' ? ` · mean section score ${scoreBasis.meanSectionScore.toFixed(2)}` : ''}
              {typeof scoreBasis.anchorScore === 'number' ? ` · panel anchored at ${scoreBasis.anchorScore.toFixed(2)}` : ''}
            </p>
          ) : null}
        </Panel>

        {/* 4. Fix first */}
        <Panel id="fix-first" title="What to fix first" note="Ranked by how much the fix moves the funding decision">
          <PriorityActions actions={overallReview.priority_actions || []} />
        </Panel>

        {/* 5. Consistency + compliance */}
        <Panel id="consistency" title="Consistency & compliance" note="Contradictions between sections, and the counted compliance facts">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Cross-section consistency</h3>
              <ConsistencyFlags flags={overallReview.consistency_flags || []} />
            </div>
            <div id="compliance" className="scroll-mt-24">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Compliance check</h3>
              <ComplianceBars compliance={overallReview.compliance} />
            </div>
          </div>
        </Panel>

        {/* 6. Strengths, weaknesses, recommendations */}
        <Panel id="assessment" title="Strengths, weaknesses & recommendations" note="What to keep, what costs marks, and what applies across the whole proposal">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md bg-green-50 p-4">
              <h3 className="mb-2 flex items-center text-sm font-semibold text-green-800"><FaCheck className="mr-2" /> Major strengths — keep these</h3>
              <ul className="space-y-2 text-sm text-nickel-800">
                {(overallReview.major_strengths || []).map((item: string, index: number) => <li key={`str-${index}`} className="flex gap-2"><span className="text-green-600">•</span><span><ReviewerText value={item} /></span></li>)}
              </ul>
            </div>
            <div className="rounded-md bg-red-50 p-4">
              <h3 className="mb-2 flex items-center text-sm font-semibold text-red-800"><FaTimes className="mr-2" /> Major weaknesses</h3>
              <ul className="space-y-2 text-sm text-nickel-800">
                {(overallReview.major_weaknesses || []).map((item: string, index: number) => <li key={`wk-${index}`} className="flex gap-2"><span className="text-red-600">•</span><span><ReviewerText value={item} /></span></li>)}
              </ul>
            </div>
            <div className="rounded-md bg-amber-50 p-4 lg:col-span-2">
              <h3 className="mb-2 flex items-center text-sm font-semibold text-amber-800"><FaExclamationTriangle className="mr-2" /> Cross-sectional recommendations</h3>
              <ol className="space-y-2 text-sm text-nickel-800">
                {(overallReview.cross_sectional_recommendations || []).map((item: string, index: number) => <li key={`rec-${index}`} className="flex gap-2"><span className="font-semibold text-amber-700">{index + 1}.</span><span><ReviewerText value={item} /></span></li>)}
              </ol>
            </div>
            {supplementaryMaterials.length ? (
              <div className="rounded-md bg-cobalt-50 p-4 lg:col-span-2">
                <h3 className="mb-2 flex items-center text-sm font-semibold text-cobalt-800"><FaFileExport className="mr-2" /> Material to prepare separately (not scored)</h3>
                <ul className="space-y-1 text-sm text-nickel-800">
                  {supplementaryMaterials.map((item, index) => <li key={`sup-${index}`} className="flex gap-2"><span className="text-cobalt-600">•</span><span><ReviewerText value={item} /></span></li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>

        {/* 7. Sections */}
        <Panel
          id="sections"
          title="Section by section"
          note={displayMode === 'parallel' ? 'Compare two versions of each section side by side' : 'Each section in proposal order; revised sections show the change against the earlier version'}
          action={hasMultipleVersions ? (
            <button onClick={() => setDisplayMode(displayMode === 'single' ? 'parallel' : 'single')} className="nk-btn-ghost nk-btn-sm text-white">
              {displayMode === 'single' ? 'Compare versions' : 'Single version'}
            </button>
          ) : null}
        >
          {displayMode === 'single' ? (
            sections.length ? (
              <div className="space-y-6">
                {getSortedSections(sections).map((section) => (
                  <div key={section.id} id={anchorFor(section.section_title)} className="scroll-mt-24">
                    <SectionReviewCard
                      section={section}
                      inReportVersion={typeof scoredVersions[section.section_title] === 'number' ? scoredVersions[section.section_title] : null}
                      pendingDraft={pendingDrafts[section.section_title] || null}
                      expanded={Boolean(expandedSections[section.id])}
                      onToggleExpand={() => toggleSectionExpand(section.id)}
                    />
                  </div>
                ))}
              </div>
            ) : <EmptySections callId={String(id)} />
          ) : (
            <div className="space-y-8">
              {sortedTitles.map((title) => {
                const group = groupedSections[title];
                const versionsToCompare = compareVersions[title]?.length
                  ? compareVersions[title]
                  : [...group.versions].sort((a, b) => b - a).slice(0, 2);
                const sectionVersions = versionsToCompare.map((version) => group[version]).filter(Boolean).sort((a, b) => b.version - a.version);
                if (!sectionVersions.length) return null;
                return (
                  <div key={title} id={anchorFor(title)} className="scroll-mt-24">
                    <h3 className="mb-3 text-lg font-semibold text-nickel-900"><ReviewerText value={title} fallback="Untitled section" /></h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {sectionVersions.map((section) => (
                        <SectionReviewCard
                          key={section.id}
                          section={section}
                          inReportVersion={typeof scoredVersions[title] === 'number' ? scoredVersions[title] : null}
                          pendingDraft={pendingDrafts[title] || null}
                          expanded={Boolean(expandedSections[section.id])}
                          onToggleExpand={() => toggleSectionExpand(section.id)}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* 8. Landscape */}
        {overallReview.landscape ? (
          <Panel id="landscape" title="Research & patent landscape" note="Similar funded projects and Indian patents retrieved for reference — not part of the score">
            {overallReview.landscape.priorWork?.rows?.length > 0 ? (
              <>
                <PriorWorkList rows={overallReview.landscape.priorWork.rows} summary={overallReview.landscape.priorWork.summary} />
                {overallReview.landscape.priorWork.coverage?.length > 0 ? (
                  <CoverageMap
                    coverage={overallReview.landscape.priorWork.coverage}
                    rows={overallReview.landscape.priorWork.rows}
                    patentsSearched={overallReview.landscape.sources?.patents?.status === 'ok'}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-sm text-nickel-600">No closely comparable funded projects or Indian patents were retrieved for this proposal.</p>
            )}
            <p className="mt-4 text-xs text-nickel-500">
              {`Similar funded projects: ${overallReview.landscape.sources?.projects?.count ?? 0} retrieved from the sanctioned-project corpus. `}
              {overallReview.landscape.sources?.patents?.status === 'ok'
                ? `Indian patents searched via PatentNest (${overallReview.landscape.sources.patents.count} retrieved).`
                : overallReview.landscape.sources?.patents?.status === 'not_configured'
                  ? 'Indian patents not searched — patent search is not configured on this server.'
                  : 'Indian patent search was unavailable for this run.'}
            </p>
          </Panel>
        ) : null}

        <div className="hidden p-4 text-center text-[12px] text-nickel-500 print:block">
          <p>Panel report · {callData?.project_title || ''} · {overallReview.generated_at ? new Date(overallReview.generated_at).toLocaleDateString() : new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </ReviewerShell>
  );
}
