'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import TopicEntryStage from '@/components/stages/TopicEntryStage';
import BlueprintStage from '@/components/stages/BlueprintStage';
import LiteratureSearchStage from '@/components/stages/LiteratureSearchStage';
import FullTextEvidenceExtractionStage from '@/components/stages/FullTextEvidenceExtractionStage';
import OutlinePlanningStage from '@/components/stages/OutlinePlanningStage';
import PaperFigurePlannerStage from '@/components/stages/PaperFigurePlannerStage';
import PaperReviewStage from '@/components/stages/PaperReviewStage';
import PaperImproveStage from '@/components/stages/PaperImproveStage';
import SectionDraftingStage from '@/components/stages/SectionDraftingStage';
import HumanizationStage from '@/components/stages/HumanizationStage';
import ReviewExportStage from '@/components/stages/ReviewExportStage';
import PaperVerticalStageNav from '@/components/stages/PaperVerticalStageNav';
import { getLatestPaperReview } from '@/lib/paper-review-utils';
import { STAGE_ORDER } from '@/lib/stage-navigation-config';

const STAGES = [
  { key: 'OUTLINE_PLANNING', label: 'Paper Foundation', description: 'Set up paper type & structure' },
  { key: 'TOPIC_ENTRY', label: 'Research Topic', description: 'Define your research question' },
  { key: 'BLUEPRINT', label: 'Paper Blueprint', description: 'Define paper structure & dimensions' },
  { key: 'LITERATURE_SEARCH', label: 'Literature Search', description: 'Search and import citations' },
  { key: 'FULL_TEXT_EVIDENCE_EXTRACTION', label: 'Full-Text Evidence Extraction', description: 'Extract and validate grounded evidence from full text' },
  { key: 'FIGURE_PLANNER', label: 'Figure Planning', description: 'Plan figures and tables' },
  { key: 'SECTION_DRAFTING', label: 'Section Drafting', description: 'Generate and edit sections' },
  { key: 'MANUSCRIPT_REVIEW', label: 'Review', description: 'Audit the drafted manuscript' },
  { key: 'MANUSCRIPT_IMPROVE', label: 'Improve', description: 'Apply review recommendations with diff preview' },
  { key: 'HUMANIZATION', label: 'Humanization', description: 'Humanize sections and validate citations' },
  { key: 'REVIEW_EXPORT', label: 'Adaptive Export', description: 'Extract formatting and export' }
] as const;

type StageKey = typeof STAGES[number]['key'];

const HIDDEN_STAGE_KEYS = new Set<StageKey>([
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION'
]);

const VISIBLE_STAGES = STAGES.filter(stage => !HIDDEN_STAGE_KEYS.has(stage.key));

type StageProps = {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  onTopicSaved?: (topic: any) => void;
  onNavigateToStage?: (stage: string) => void;
};

type StageComponent = (props: StageProps) => JSX.Element;

const STAGE_COMPONENTS: Record<StageKey, StageComponent> = {
  TOPIC_ENTRY: TopicEntryStage as any,
  BLUEPRINT: BlueprintStage as any,
  LITERATURE_SEARCH: LiteratureSearchStage as any,
  FULL_TEXT_EVIDENCE_EXTRACTION: FullTextEvidenceExtractionStage as any,
  OUTLINE_PLANNING: OutlinePlanningStage as any,
  FIGURE_PLANNER: PaperFigurePlannerStage as any,
  SECTION_DRAFTING: SectionDraftingStage as any,
  MANUSCRIPT_REVIEW: PaperReviewStage as any,
  MANUSCRIPT_IMPROVE: PaperImproveStage as any,
  HUMANIZATION: HumanizationStage as any,
  REVIEW_EXPORT: ReviewExportStage as any
};

export default function PaperDraftingPage() {
  const params = useParams();
  const paperId = params?.paperId as string;
  const { isLoading: authLoading, token: authToken } = useAuth() as any;
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<StageKey>('OUTLINE_PLANNING');
  const [hasHydratedStage, setHasHydratedStage] = useState(false);
  const [pendingStage, setPendingStage] = useState<StageKey | null>(null);
  const [stageWarning, setStageWarning] = useState<string | null>(null);
  const resolvedCurrentStage = (
    STAGE_ORDER.includes(currentStage)
      ? currentStage
      : STAGE_ORDER[0]
  ) as StageKey;

  const loadSession = useCallback(async () => {
    if (!paperId || !authToken) {
      // If no auth token, stop loading state but don't error (user may need to login)
      if (!authLoading && !authToken) {
        setLoading(false);
      }
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`/api/papers/${paperId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load paper session');
      }

      setSession(data.session);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paper session');
    } finally {
      setLoading(false);
    }
  }, [paperId, authToken, authLoading]);

  useEffect(() => {
    setHasHydratedStage(false);
    if (!paperId) return;

    const stored = typeof window !== 'undefined'
      ? localStorage.getItem(`paper_stage_${paperId}`)
      : null;
    if (stored && VISIBLE_STAGES.some(stage => stage.key === stored)) {
      setCurrentStage(stored as StageKey);
    }
    setHasHydratedStage(true);
  }, [paperId]);

  useEffect(() => {
    if (!paperId || !hasHydratedStage) return;
    localStorage.setItem(`paper_stage_${paperId}`, currentStage);
  }, [paperId, currentStage, hasHydratedStage]);

  useEffect(() => {
    if (!authLoading) {
      loadSession();
    }
  }, [authLoading, loadSession]);

  const StageComponent = STAGE_COMPONENTS[resolvedCurrentStage];
  const handleSessionUpdated = useCallback((updated: any) => {
    setSession(updated);
  }, []);
  const handleTopicSaved = useCallback((topic: any) => {
    setSession((prev: any) => ({ ...prev, researchTopic: topic }));
  }, []);
  const citationsCount = Array.isArray(session?.citations) ? session.citations.length : 0;
  const deepCandidatesCount = useMemo(() => {
    const citations = Array.isArray(session?.citations) ? session.citations : [];
    return citations.filter((citation: any) => {
      const explicit = String(citation?.deepAnalysisLabel || '').trim().toUpperCase();
      const fromMeta = citation?.aiMeta && typeof citation.aiMeta === 'object'
        ? String((citation.aiMeta as any).deepAnalysisRecommendation || '').trim().toUpperCase()
        : '';
      const score = Number(citation?.aiMeta && typeof citation.aiMeta === 'object'
        ? (citation.aiMeta as any).relevanceScore
        : 0);
      const label = explicit
        || fromMeta
        || (score >= 85 ? 'DEEP_ANCHOR' : score >= 65 ? 'DEEP_SUPPORT' : score >= 45 ? 'DEEP_STRESS_TEST' : 'LIT_ONLY');
      return Boolean(label) && label !== 'LIT_ONLY';
    }).length;
  }, [session?.citations]);
  const hasTopic = !!session?.researchTopic?.researchQuestion;
  const hasPaperType = !!session?.paperType?.code;
  const hasFrozenBlueprint = session?.paperBlueprint?.status === 'FROZEN';
  const hasSectionConfig = useMemo(() => {
    const sectionOrder = session?.paperType?.sectionOrder;
    if (Array.isArray(sectionOrder)) return sectionOrder.length > 0;
    if (typeof sectionOrder === 'string') {
      try {
        const parsed = JSON.parse(sectionOrder);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  }, [session?.paperType?.sectionOrder]);

  const paperSections = useMemo(() => {
    const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : [];
    const paperDraft = drafts
      .filter((draft: any) => (draft.jurisdiction || '').toUpperCase() === 'PAPER')
      .sort((a: any, b: any) => (b?.version || 0) - (a?.version || 0))[0];

    if (!paperDraft?.extraSections) return {};
    if (typeof paperDraft.extraSections === 'string') {
      try {
        return JSON.parse(paperDraft.extraSections) as Record<string, string>;
      } catch {
        return {};
      }
    }
    if (typeof paperDraft.extraSections === 'object') {
      return paperDraft.extraSections as Record<string, string>;
    }
    return {};
  }, [session?.annexureDrafts]);

  const requiredSectionKeys = useMemo(() => {
    const requiredSections = session?.paperType?.requiredSections;
    if (Array.isArray(requiredSections)) {
      return requiredSections.map((section: any) => String(section)).filter(Boolean);
    }
    if (typeof requiredSections === 'string') {
      try {
        const parsed = JSON.parse(requiredSections);
        if (Array.isArray(parsed)) {
          return parsed.map((section: any) => String(section)).filter(Boolean);
        }
      } catch {
        return [];
      }
    }
    return [];
  }, [session?.paperType?.requiredSections]);

  const hasRequiredSections = useMemo(() => {
    if (requiredSectionKeys.length === 0) return false;
    return requiredSectionKeys.every(sectionKey => {
      const content = paperSections[sectionKey] || '';
      const words = String(content).replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
      return words >= 20;
    });
  }, [paperSections, requiredSectionKeys]);
  const hasDraftContent = useMemo(
    () => Object.values(paperSections).some((value) => {
      const words = String(value || '').replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
      return words > 0;
    }),
    [paperSections]
  );
  const hasDraft = Array.isArray(session?.annexureDrafts)
    ? session.annexureDrafts.some((draft: any) => (draft.jurisdiction || '').toUpperCase() === 'PAPER')
    : false;
  const latestReview = useMemo(() => getLatestPaperReview(session), [session]);
  const hasReviewReport = !!latestReview;

  const getStageLockReason = useCallback((stageKey: StageKey) => {
    switch (stageKey) {
      case 'OUTLINE_PLANNING':
        return null; // Always accessible - this is the first stage
      case 'TOPIC_ENTRY':
        return hasPaperType ? null : 'Select a paper type first to define your research topic.';
      case 'LITERATURE_SEARCH':
        return hasTopic ? null : 'Define your research topic to begin literature search.';
      case 'FULL_TEXT_EVIDENCE_EXTRACTION':
        if (!hasTopic) return 'Define your research topic before extracting full-text evidence.';
        if (!hasFrozenBlueprint) return 'Freeze the blueprint before running full-text evidence extraction.';
        if (citationsCount === 0) {
          return 'Import at least one citation in Literature Search before deep evidence extraction.';
        }
        return deepCandidatesCount > 0
          ? null
          : 'Run Analyze & Map in Literature Search so papers are labeled for deep analysis.';
      case 'FIGURE_PLANNER':
        return hasPaperType && hasSectionConfig ? null : 'Complete paper foundation and research topic first.';
      case 'SECTION_DRAFTING':
        return hasPaperType && hasSectionConfig ? null : 'Complete paper foundation setup before drafting sections.';
      case 'MANUSCRIPT_REVIEW':
        if (!(hasPaperType && hasSectionConfig)) {
          return 'Complete paper foundation setup before reviewing the manuscript.';
        }
        return hasDraftContent ? null : 'Draft at least one section before running manuscript review.';
      case 'MANUSCRIPT_IMPROVE':
        if (!(hasPaperType && hasSectionConfig)) {
          return 'Complete paper foundation setup before applying review recommendations.';
        }
        return hasReviewReport ? null : 'Run the Review stage first to generate a persisted review report.';
      case 'HUMANIZATION':
        if (!(hasPaperType && hasSectionConfig)) {
          return 'Complete paper foundation setup before humanizing sections.';
        }
        return hasDraftContent ? null : 'Draft at least one section before starting humanization.';
      case 'REVIEW_EXPORT':
        if (!hasPaperType) {
          return 'Complete paper foundation first.';
        }
        if (requiredSectionKeys.length === 0) {
          return hasDraftContent ? null : 'Generate at least one section before export.';
        }
        if (!hasRequiredSections) {
          return 'Complete all required sections before export.'
        }
        return null;
      default:
        return null;
    }
  }, [
    citationsCount,
    deepCandidatesCount,
    hasDraft,
    hasDraftContent,
    hasFrozenBlueprint,
    hasPaperType,
    hasRequiredSections,
    hasReviewReport,
    hasSectionConfig,
    hasTopic,
    requiredSectionKeys.length,
  ]);

  const isStageEnabled = (stageKey: StageKey) => {
    switch (stageKey) {
      case 'OUTLINE_PLANNING':
        return true; // Always enabled - first stage
      case 'TOPIC_ENTRY':
        return hasPaperType;
      case 'LITERATURE_SEARCH':
        return hasTopic;
      case 'FULL_TEXT_EVIDENCE_EXTRACTION':
        return hasTopic && hasFrozenBlueprint && citationsCount > 0 && deepCandidatesCount > 0;
      case 'FIGURE_PLANNER':
        return hasPaperType && hasSectionConfig;
      case 'SECTION_DRAFTING':
        return hasPaperType && hasSectionConfig;
      case 'MANUSCRIPT_REVIEW':
        return hasPaperType && hasSectionConfig && hasDraftContent;
      case 'MANUSCRIPT_IMPROVE':
        return hasPaperType && hasSectionConfig && hasReviewReport;
      case 'HUMANIZATION':
        return hasPaperType && hasSectionConfig && hasDraftContent;
      case 'REVIEW_EXPORT':
        if (!hasPaperType) return false;
        if (requiredSectionKeys.length === 0) {
          return hasDraftContent;
        }
        return hasRequiredSections;
      default:
        return true;
    }
  };

  const handleStageChange = useCallback((stageKey: StageKey) => {
    if (stageKey === currentStage) return;
    if (HIDDEN_STAGE_KEYS.has(stageKey)) return;
    const lockReason = getStageLockReason(stageKey);
    if (lockReason) {
      setPendingStage(stageKey);
      setStageWarning(lockReason);
      return;
    }
    setPendingStage(null);
    setStageWarning(null);
    setCurrentStage(stageKey);
    if (paperId) {
      localStorage.setItem(`paper_stage_${paperId}`, stageKey);
    }
  }, [currentStage, getStageLockReason, paperId]);

  const handleForceProceed = () => {
    if (!pendingStage) return;
    setCurrentStage(pendingStage);
    if (paperId) {
      localStorage.setItem(`paper_stage_${paperId}`, pendingStage);
    }
    setPendingStage(null);
    setStageWarning(null);
  };

  const handleCancelProceed = () => {
    setPendingStage(null);
    setStageWarning(null);
  };

  // Get adjacent stages for navigation
  const currentIndex = STAGE_ORDER.indexOf(resolvedCurrentStage);
  const prevStage = currentIndex > 0 ? STAGE_ORDER[currentIndex - 1] : null;
  const nextStage = currentIndex < STAGE_ORDER.length - 1 ? STAGE_ORDER[currentIndex + 1] : null;

  // Async navigation handler for the paper stage navigation
  const handleNavigateToStage = useCallback(async (stageKey: string) => {
    handleStageChange(stageKey as StageKey);
  }, [handleStageChange]);

  return (
    <div className="min-h-screen bg-[#F5F6F7]">
      {/* Vertical Stage Navigation Sidebar */}
      {session && (
        <PaperVerticalStageNav
          session={session}
          currentStage={resolvedCurrentStage}
          paperId={paperId}
          onNavigateToStage={handleNavigateToStage}
        />
      )}

      {/* Main Content Area - Shifted right for sidebar */}
      <div className={`${session ? 'pl-72' : ''} transition-all duration-300`}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-6">
            <div className="text-sm text-slate-500">Paper Session</div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {session?.researchTopic?.title || 'Untitled Paper'}
            </h1>
          </div>

          {/* Content Area */}
          <div className="space-y-4">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                  <span className="text-sm text-slate-500">Loading session...</span>
                </div>
              </div>
            )}
            
            {error && (
              <Card className="p-6 border-red-200 bg-red-50">
                <div className="text-sm font-semibold text-red-900">Error loading session</div>
                <div className="text-sm text-red-700 mt-1">{error}</div>
              </Card>
            )}
            
            {!loading && !error && pendingStage && stageWarning && (
              <Card className="p-4 border-amber-200 bg-amber-50">
                <div className="text-sm font-semibold text-amber-900">Stage locked</div>
                <div className="text-sm text-amber-700 mt-1">{stageWarning}</div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button variant="secondary" onClick={handleCancelProceed}>
                    Stay here
                  </Button>
                  <Button onClick={handleForceProceed}>
                    Proceed anyway
                  </Button>
                </div>
              </Card>
            )}
            
            {!loading && !error && StageComponent && (
              <StageComponent
                sessionId={paperId}
                authToken={authToken}
                onSessionUpdated={handleSessionUpdated}
                onTopicSaved={handleTopicSaved}
                onNavigateToStage={(stage: string) => handleStageChange(stage as StageKey)}
              />
            )}
          </div>

          {/* Bottom Navigation */}
          {session && (
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
              <div>
                {prevStage && (
                  <Button
                    variant="outline"
                    onClick={() => handleStageChange(prevStage as StageKey)}
                    className="gap-2"
                  >
                    <span>{'<-'}</span>
                    <span>{VISIBLE_STAGES.find(s => s.key === prevStage)?.label || 'Previous'}</span>
                  </Button>
                )}
              </div>
              <div>
                {nextStage && (
                  <Button
                    onClick={() => handleStageChange(nextStage as StageKey)}
                    className="gap-2"
                  >
                    <span>{VISIBLE_STAGES.find(s => s.key === nextStage)?.label || 'Next'}</span>
                    <span>{'->'}</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
