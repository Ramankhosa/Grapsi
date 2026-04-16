'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';

interface FullTextEvidenceExtractionStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
}

interface CandidateRow {
  citationId: string;
  citationKey: string;
  title: string;
  depthLabel: string;
  referenceArchetype: string;
  deepAnalysisStatus: string | null;
  evidenceCardCount: number;
  ready: boolean;
  readinessReason: string | null;
  documentId: string | null;
  referenceId: string | null;
  parserCandidate: 'PDFJS' | 'GROBID' | 'REGEX_FALLBACK' | null;
}

interface CandidatePayload {
  ready: CandidateRow[];
  notReady: CandidateRow[];
  totalEligible: number;
}

interface DeepAnalysisStatusPayload {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL';
  totalJobs: number;
  completed: number;
  failed: number;
  inProgress: number;
  totalCardsExtracted: number;
  totalMappingsCreated: number;
  estimatedSecondsRemaining: number | null;
  jobs: Array<{
    jobId: string;
    citationId: string;
    citationKey: string;
    status: string;
    cardsExtracted: number | null;
    error: string | null;
  }>;
}

interface CoveragePayload {
  overallCoverage: number;
  gaps: string[];
  totalCards: number;
  matrix: Array<{
    citationKey: string;
    sections: Record<string, number>;
  }>;
  dimensionCoverage: Array<{
    sectionKey: string;
    dimension: string;
    cardCount: number;
    paperCount: number;
    minConfidence: string;
  }>;
}

interface EvidenceCardRow {
  id: string;
  citationKey: string;
  citationId: string;
  claim: string;
  claimType: string;
  quantitativeDetail: string | null;
  conditions: string | null;
  doesNotSupport: string | null;
  studyDesign: string | null;
  sourceFragment: string;
  pageHint: string | null;
  confidence: string;
  sourceSection: string | null;
  quoteVerified: boolean;
  mappings: Array<{
    sectionKey: string;
    dimension: string;
    useAs: string;
    mappingConfidence: string;
  }>;
}

interface CardsPayload {
  totalCards: number;
  page: number;
  limit: number;
  cards: EvidenceCardRow[];
}

type ActionState = 'starting' | 'stopping' | 'retrying' | 'remapping' | 'extracting' | 'preparing' | null;

interface TextExtractionStatus {
  total: number;
  structuredReady: number;
  grobidReady: number;
  basicTextOnly: number;
  noPdf: number;
  pending: number;
  queueDepth?: number;
  inFlight?: number;
  papers: Array<{
    citationId: string;
    citationKey: string;
    depthLabel: string;
    textStatus: 'structured_ready' | 'grobid_ready' | 'basic_text' | 'no_pdf' | 'parsing' | 'pending';
  }>;
}

const DEEP_ANALYSIS_CONCURRENCY = 50;

export default function FullTextEvidenceExtractionStage({
  sessionId,
  authToken,
  onSessionUpdated
}: FullTextEvidenceExtractionStageProps) {
  const [readyCandidates, setReadyCandidates] = useState<CandidateRow[]>([]);
  const [notReadyCandidates, setNotReadyCandidates] = useState<CandidateRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [statusPayload, setStatusPayload] = useState<DeepAnalysisStatusPayload | null>(null);
  const [coveragePayload, setCoveragePayload] = useState<CoveragePayload | null>(null);
  const [cardsPayload, setCardsPayload] = useState<CardsPayload | null>(null);
  const [textExtractionStatus, setTextExtractionStatus] = useState<TextExtractionStatus | null>(null);

  const [claimTypeFilter, setClaimTypeFilter] = useState<string>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('ALL');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'true' | 'false'>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(new Set());
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  const [lastEstimatedSeconds, setLastEstimatedSeconds] = useState<number | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isExtractingText, setIsExtractingText] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [cardsLoading, setCardsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Background section preparation state (two-pass pipeline)
  const [bgGenStatus, setBgGenStatus] = useState<string | null>(null);
  const [bgGenProgress, setBgGenProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    sections?: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
  } | null>(null);
  const bgGenTriggeredRef = useRef(false);
  const [fullTextModalCandidate, setFullTextModalCandidate] = useState<CandidateRow | null>(null);
  const [fullTextModalContent, setFullTextModalContent] = useState<string>('');
  const [fullTextModalError, setFullTextModalError] = useState<string | null>(null);
  const [loadingFullTextCitationId, setLoadingFullTextCitationId] = useState<string | null>(null);
  const hasInitializedSelectionRef = useRef(false);
  const cardsRequestIdRef = useRef(0);
  const refreshRequestIdRef = useRef(0);
  const onSessionUpdatedRef = useRef(onSessionUpdated);

  const authHeaders = useMemo<Record<string, string>>(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : ({} as Record<string, string>)),
    [authToken]
  );

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  // ── Data loaders ──

  const loadSession = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}`, { headers: authHeaders });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Failed to load session');
    onSessionUpdatedRef.current?.(payload.session);
  }, [authHeaders, authToken, sessionId]);

  const loadCandidates = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/candidates`, {
      headers: authHeaders,
      cache: 'no-store'
    });
    const payload: CandidatePayload = await response.json();
    if (!response.ok) throw new Error((payload as any)?.error || 'Failed to load candidates');
    setReadyCandidates(Array.isArray(payload.ready) ? payload.ready : []);
    setNotReadyCandidates(Array.isArray(payload.notReady) ? payload.notReady : []);
  }, [authHeaders, authToken, sessionId]);

  const loadStatus = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/status`, {
      headers: authHeaders,
      cache: 'no-store'
    });
    const payload: DeepAnalysisStatusPayload = await response.json();
    if (!response.ok) throw new Error((payload as any)?.error || 'Failed to load status');
    setStatusPayload(payload);
    if ((payload as any).backgroundGenerationTriggered && !bgGenTriggeredRef.current) {
      bgGenTriggeredRef.current = true;
      setBgGenStatus('RUNNING');
    }
  }, [authHeaders, authToken, sessionId]);

  const loadBgGenStatus = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/sections/prepare`, { headers: authHeaders });
      const payload = await response.json();
      if (response.ok) {
        setBgGenStatus(payload.status || null);
        if (payload.progress) setBgGenProgress(payload.progress);
      }
    } catch { /* non-critical */ }
  }, [authHeaders, authToken, sessionId]);

  const loadCoverage = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/coverage`, { headers: authHeaders });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Failed to load coverage');
    setCoveragePayload({
      overallCoverage: Number(payload?.overallCoverage || 0),
      gaps: Array.isArray(payload?.gaps) ? payload.gaps : [],
      totalCards: Number(payload?.totalCards || 0),
      matrix: Array.isArray(payload?.matrix) ? payload.matrix : [],
      dimensionCoverage: Array.isArray(payload?.dimensionCoverage) ? payload.dimensionCoverage : [],
    });
  }, [authHeaders, authToken, sessionId]);

  const loadCards = useCallback(async () => {
    if (!authToken) return;
    const requestId = ++cardsRequestIdRef.current;
    setCardsLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('view', 'paper');
      query.set('limit', '200');
      if (claimTypeFilter !== 'ALL') query.set('claimType', claimTypeFilter);
      if (confidenceFilter !== 'ALL') query.set('confidence', confidenceFilter);
      if (verifiedFilter !== 'all') query.set('verified', verifiedFilter);
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/cards?${query.toString()}`, { headers: authHeaders });
      const payload: CardsPayload = await response.json();
      if (!response.ok) throw new Error((payload as any)?.error || 'Failed to load evidence cards');
      if (requestId !== cardsRequestIdRef.current) return;
      setCardsPayload(payload);
    } finally {
      if (requestId === cardsRequestIdRef.current) setCardsLoading(false);
    }
  }, [authHeaders, authToken, claimTypeFilter, confidenceFilter, sessionId, verifiedFilter]);

  const loadTextExtractionStatus = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/extract-text`, { headers: authHeaders });
      if (!response.ok) return;
      const payload: TextExtractionStatus = await response.json();
      setTextExtractionStatus(payload);
    } catch { /* non-critical */ }
  }, [authHeaders, authToken, sessionId]);

  const refreshAll = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setIsRefreshing(true);
    setError(null);
    try {
      await Promise.all([loadSession(), loadCandidates(), loadStatus(), loadCoverage(), loadCards(), loadTextExtractionStatus()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      if (requestId === refreshRequestIdRef.current) setIsRefreshing(false);
    }
  }, [loadCandidates, loadCards, loadCoverage, loadSession, loadStatus, loadTextExtractionStatus]);

  const refreshAllRef = useRef(refreshAll);
  useEffect(() => { refreshAllRef.current = refreshAll; }, [refreshAll]);
  useEffect(() => { if (!authToken) return; void refreshAllRef.current(); }, [authToken, sessionId]);

  // Auto-select all ready candidates on initial load
  useEffect(() => {
    setSelectedIds(prev => {
      const readySet = new Set(readyCandidates.map(c => c.citationId));
      if (readySet.size === 0) { hasInitializedSelectionRef.current = false; return new Set(); }
      if (!hasInitializedSelectionRef.current) { hasInitializedSelectionRef.current = true; return readySet; }
      return new Set(Array.from(prev).filter(id => readySet.has(id)));
    });
  }, [readyCandidates]);

  // Poll while running — status every 5s, cards/coverage every 15s
  const pollTickRef = useRef(0);
  useEffect(() => {
    if (statusPayload?.status !== 'RUNNING') {
      pollTickRef.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      const tick = ++pollTickRef.current;
      if (tick % 5 === 0) {
        void Promise.all([loadStatus(), loadCoverage(), loadCards()]).catch(() => undefined);
      } else {
        void loadStatus().catch(() => undefined);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [loadCards, loadCoverage, loadStatus, statusPayload?.status]);

  useEffect(() => {
    if (statusPayload?.status === 'IDLE') setLastEstimatedSeconds(null);
  }, [statusPayload?.status]);

  // Poll background generation progress while RUNNING
  useEffect(() => {
    if (bgGenStatus !== 'RUNNING') return;
    void loadBgGenStatus();
    const timer = window.setInterval(() => {
      void loadBgGenStatus().catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [bgGenStatus, loadBgGenStatus]);

  // Load bg gen status on mount to catch already-running background generation
  useEffect(() => {
    if (authToken && (statusPayload?.status === 'COMPLETED' || statusPayload?.status === 'PARTIAL')) {
      void loadBgGenStatus().catch(() => undefined);
    }
  }, [authToken, statusPayload?.status, loadBgGenStatus]);

  const textExtractionPending = (textExtractionStatus?.pending ?? 0) + (textExtractionStatus?.basicTextOnly ?? 0);
  const textExtractionProcessing = isExtractingText || (textExtractionStatus?.queueDepth ?? 0) > 0 || (textExtractionStatus?.inFlight ?? 0) > 0;

  // Auto-clear isExtractingText when the queue drains
  useEffect(() => {
    if (!isExtractingText) return;
    const qd = textExtractionStatus?.queueDepth ?? 0;
    const ifl = textExtractionStatus?.inFlight ?? 0;
    const pend = textExtractionStatus?.pending ?? 0;
    const basic = textExtractionStatus?.basicTextOnly ?? 0;
    if (qd === 0 && ifl === 0 && pend === 0 && basic === 0) {
      setIsExtractingText(false);
    }
  }, [isExtractingText, textExtractionStatus]);

  // Poll while text extraction was actively triggered by the user
  useEffect(() => {
    if (!isExtractingText) return;
    const timer = window.setInterval(() => {
      void loadTextExtractionStatus().then(() => {
        void loadCandidates().catch(() => undefined);
      }).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [isExtractingText, loadCandidates, loadTextExtractionStatus]);

  useEffect(() => { void loadCards().catch(() => undefined); }, [loadCards]);

  // ── Actions ──

  const handleStart = useCallback(async () => {
    if (!authToken || selectedIds.size === 0) return;
    setActionState('starting');
    setError(null);
    setLastEstimatedSeconds(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          citationIds: Array.from(selectedIds),
          concurrency: DEEP_ANALYSIS_CONCURRENCY
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to start deep analysis');
      setLastEstimatedSeconds(Number(payload?.estimatedSeconds || 0) || null);
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start deep analysis');
    } finally { setActionState(null); }
  }, [authToken, loadCandidates, loadCards, loadSession, loadStatus, selectedIds, sessionId]);

  const handleStop = useCallback(async () => {
    if (!authToken) return;
    setActionState('stopping');
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/stop`, { method: 'POST', headers: authHeaders });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to stop');
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    } finally { setActionState(null); }
  }, [authHeaders, authToken, loadCandidates, loadCards, loadSession, loadStatus, sessionId]);

  const handleRetryFailed = useCallback(async (options?: { allowTextFallback?: boolean }) => {
    if (!authToken || !statusPayload) return;
    const failed = statusPayload.jobs.filter(j => String(j.status || '').toUpperCase() === 'FAILED');
    if (failed.length === 0) return;
    const allowTextFallback = options?.allowTextFallback === true;
    setActionState('retrying');
    setError(null);
    setLastEstimatedSeconds(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          jobIds: failed.map(j => j.jobId),
          concurrency: DEEP_ANALYSIS_CONCURRENCY,
          allowTextFallback,
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to retry');
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    } finally { setActionState(null); }
  }, [authToken, loadCandidates, loadCards, loadSession, loadStatus, sessionId, statusPayload]);

  const handleRemap = useCallback(async () => {
    if (!authToken) return;
    setActionState('remapping');
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/remap`, { method: 'POST', headers: authHeaders });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to remap');
      await Promise.all([loadStatus(), loadCoverage(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remap');
    } finally { setActionState(null); }
  }, [authHeaders, authToken, loadCards, loadCoverage, loadStatus, sessionId]);

  const handleExtractText = useCallback(async () => {
    if (!authToken) return;
    setActionState('extracting');
    setIsExtractingText(true);
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/extract-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to trigger text extraction');
      setTextExtractionStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract text');
      setIsExtractingText(false);
    } finally { setActionState(null); }
  }, [authHeaders, authToken, sessionId]);

  const handlePrepareSections = useCallback(async (options?: { force?: boolean; retryFailedOnly?: boolean }) => {
    if (!authToken) return;
    const force = options?.force === true;
    const retryFailedOnly = options?.retryFailedOnly === true;
    setActionState('preparing');
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/sections/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          ...(force ? { force: true } : {}),
          ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Failed to start section preparation');
      setBgGenStatus(payload?.status || 'RUNNING');
      if (payload?.progress) setBgGenProgress(payload.progress);
      await Promise.all([loadBgGenStatus(), loadSession()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start section preparation');
    } finally {
      setActionState(null);
    }
  }, [authHeaders, authToken, loadBgGenStatus, loadSession, sessionId]);

  const handleViewExtractedText = useCallback(async (candidate: CandidateRow) => {
    if (!authToken) return;
    setFullTextModalCandidate(candidate);
    setFullTextModalContent('');
    setFullTextModalError(null);
    if (!candidate.referenceId) { setFullTextModalError('Not linked to a library reference yet.'); return; }
    setLoadingFullTextCitationId(candidate.citationId);
    try {
      const response = await fetch(`/api/references/${candidate.referenceId}/full-text`, { headers: authHeaders });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load text');
      const text = String(payload?.text || '').trim();
      if (!text) throw new Error('Extracted text not available yet.');
      setFullTextModalContent(text);
    } catch (err) {
      setFullTextModalError(err instanceof Error ? err.message : 'Failed to load text');
    } finally { setLoadingFullTextCitationId(null); }
  }, [authHeaders, authToken]);

  // ── Derived state ──

  const allCandidates = useMemo(() =>
    [...readyCandidates, ...notReadyCandidates].sort((a, b) => {
      const labelOrder: Record<string, number> = { DEEP_ANCHOR: 0, DEEP_SUPPORT: 1, DEEP_STRESS_TEST: 2 };
      const la = labelOrder[a.depthLabel] ?? 3;
      const lb = labelOrder[b.depthLabel] ?? 3;
      if (la !== lb) return la - lb;
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return 0;
    }),
    [readyCandidates, notReadyCandidates]
  );

  const selectedReadyCount = useMemo(() =>
    readyCandidates.filter(c => selectedIds.has(c.citationId)).length,
    [readyCandidates, selectedIds]
  );

  const failedJobCount = statusPayload?.jobs?.filter(j => String(j.status || '').toUpperCase() === 'FAILED').length || 0;
  const parsedTextReadyCount = (textExtractionStatus?.structuredReady ?? 0) + (textExtractionStatus?.basicTextOnly ?? 0);
  const canRetryWithTextFallback = failedJobCount > 0 && parsedTextReadyCount > 0;
  const deepAnalysisDone = statusPayload?.status === 'COMPLETED' || statusPayload?.status === 'PARTIAL';
  const canManuallyPrepareSections =
    !!statusPayload &&
    statusPayload.totalJobs > 0 &&
    deepAnalysisDone &&
    bgGenStatus !== 'RUNNING';
  const bgGenLiveCounts = useMemo(() => {
    if (!bgGenProgress) return null;
    const sectionStates = bgGenProgress.sections ? Object.values(bgGenProgress.sections) : [];
    if (sectionStates.length === 0) {
      const running = bgGenStatus === 'RUNNING'
        ? Math.max(0, bgGenProgress.total - bgGenProgress.completed - bgGenProgress.failed)
        : 0;
      return {
        waiting: 0,
        running,
        done: bgGenProgress.completed,
        failed: bgGenProgress.failed,
      };
    }
    return {
      waiting: sectionStates.filter(state => state === 'pending').length,
      running: sectionStates.filter(state => state === 'running').length,
      done: sectionStates.filter(state => state === 'done').length,
      failed: sectionStates.filter(state => state === 'failed').length,
    };
  }, [bgGenProgress, bgGenStatus]);

  const progressPercent = useMemo(() => {
    if (!statusPayload || statusPayload.totalJobs === 0) return 0;
    return Math.round(((statusPayload.completed + statusPayload.failed) / statusPayload.totalJobs) * 100);
  }, [statusPayload]);

  const filteredCards = useMemo(() => {
    const cards = Array.isArray(cardsPayload?.cards) ? cardsPayload.cards : [];
    const query = searchFilter.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter(card =>
      [card.citationKey, card.claim, card.quantitativeDetail || '', card.conditions || '', card.doesNotSupport || '', card.sourceFragment || '']
        .join(' ').toLowerCase().includes(query)
    );
  }, [cardsPayload?.cards, searchFilter]);

  const paperGroups = useMemo(() => {
    const groups = new Map<string, { citationKey: string; citationId: string; cards: EvidenceCardRow[] }>();
    for (const card of filteredCards) {
      const key = card.citationId;
      if (!groups.has(key)) groups.set(key, { citationKey: card.citationKey, citationId: card.citationId, cards: [] });
      groups.get(key)!.cards.push(card);
    }
    return Array.from(groups.values()).sort((a, b) => b.cards.length - a.cards.length || a.citationKey.localeCompare(b.citationKey));
  }, [filteredCards]);

  const selectedPaperCards = useMemo(() => {
    if (!selectedPaperId) return [];
    return filteredCards.filter(c => c.citationId === selectedPaperId);
  }, [filteredCards, selectedPaperId]);

  const selectedPaperCandidate = useMemo(() =>
    selectedPaperId ? allCandidates.find(c => c.citationId === selectedPaperId) : null,
    [allCandidates, selectedPaperId]
  );

  const coverageSections = useMemo(() => {
    if (!coveragePayload?.dimensionCoverage?.length) return [];
    const bySection = new Map<string, { sectionKey: string; dimensions: Array<{ dimension: string; cardCount: number; paperCount: number; minConfidence: string }> }>();
    for (const dim of coveragePayload.dimensionCoverage) {
      if (!bySection.has(dim.sectionKey)) bySection.set(dim.sectionKey, { sectionKey: dim.sectionKey, dimensions: [] });
      bySection.get(dim.sectionKey)!.dimensions.push({ dimension: dim.dimension, cardCount: dim.cardCount, paperCount: dim.paperCount, minConfidence: dim.minConfidence });
    }
    return Array.from(bySection.values());
  }, [coveragePayload]);

  const running = statusPayload?.status === 'RUNNING';
  const isMutating = actionState !== null;

  const togglePaperExpanded = (citationId: string) => {
    setExpandedPaperIds(prev => {
      const next = new Set(prev);
      if (next.has(citationId)) next.delete(citationId);
      else next.add(citationId);
      return next;
    });
  };

  const getStatusBadge = (status: string | null) => {
    const s = String(status || '').toUpperCase();
    if (s === 'COMPLETED') return <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-200 text-[10px]">Completed</Badge>;
    if (s === 'FAILED') return <Badge className="bg-red-500/10 text-red-700 border-red-200 text-[10px]">Failed</Badge>;
    if (s === 'PREPARING') return <Badge className="bg-indigo-500/10 text-indigo-700 border-indigo-200 text-[10px] animate-pulse">Preparing</Badge>;
    if (s === 'EXTRACTING') return <Badge className="bg-blue-500/10 text-blue-700 border-blue-200 text-[10px] animate-pulse">Extracting</Badge>;
    if (s === 'MAPPING') return <Badge className="bg-cyan-500/10 text-cyan-700 border-cyan-200 text-[10px] animate-pulse">Mapping</Badge>;
    if (s === 'PENDING') return <Badge className="bg-slate-500/10 text-slate-600 border-slate-200 text-[10px]">Queued</Badge>;
    return null;
  };

  const getDepthBadge = (label: string) => {
    if (label === 'DEEP_ANCHOR') return <Badge className="bg-amber-500/10 text-amber-800 border-amber-300 text-[10px] font-semibold">Anchor</Badge>;
    if (label === 'DEEP_STRESS_TEST') return <Badge className="bg-rose-500/10 text-rose-700 border-rose-300 text-[10px] font-semibold">Stress Test</Badge>;
    return <Badge className="bg-slate-500/10 text-slate-600 border-slate-200 text-[10px] font-semibold">Support</Badge>;
  };

  const claimBadgeClass = (type: string) => {
    const t = String(type || '').toUpperCase();
    if (t === 'FINDING') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (t === 'LIMITATION') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (t === 'GAP') return 'bg-rose-50 text-rose-800 border-rose-200';
    if (t === 'METHOD') return 'bg-sky-50 text-sky-800 border-sky-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  const confidenceDot = (c: string) => {
    if (c === 'HIGH') return 'bg-emerald-500';
    if (c === 'MEDIUM') return 'bg-amber-500';
    return 'bg-slate-400';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Error Banner ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">&times;</button>
        </div>
      )}

      {/* ── Text Extraction Progress Banner ── */}
      {textExtractionProcessing && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
          <div className="flex-1">
            <p className="text-sm font-medium text-teal-800">PDF Text Extraction in Progress</p>
            <p className="text-xs text-teal-600 mt-0.5">
              {textExtractionStatus?.structuredReady ?? textExtractionStatus?.grobidReady ?? 0} of {textExtractionStatus?.total || 0} papers parsed
              {(textExtractionStatus?.inFlight ?? 0) > 0 && ` \u00b7 ${textExtractionStatus!.inFlight} active`}
              {(textExtractionStatus?.queueDepth ?? 0) > 0 && ` \u00b7 ${textExtractionStatus!.queueDepth} queued`}
              {(textExtractionStatus?.noPdf ?? 0) > 0 && ` \u00b7 ${textExtractionStatus!.noPdf} awaiting PDF`}
            </p>
          </div>
        </div>
      )}

      {/* ── Header Stats Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Papers', value: allCandidates.length, accent: 'border-l-blue-500' },
          { label: 'Text Ready', value: textExtractionStatus ? `${textExtractionStatus.structuredReady ?? textExtractionStatus.grobidReady}/${textExtractionStatus.total}` : `${readyCandidates.length}`, accent: textExtractionPending > 0 ? 'border-l-amber-500' : 'border-l-emerald-500', sub: textExtractionPending > 0 ? `${textExtractionPending} pending` : textExtractionProcessing ? 'Processing...' : undefined },
          { label: 'Ready for Analysis', value: readyCandidates.length, accent: 'border-l-emerald-500' },
          { label: 'Evidence Cards', value: statusPayload?.totalCardsExtracted || 0, accent: 'border-l-amber-500' },
          { label: 'Mapped', value: statusPayload?.totalMappingsCreated || 0, accent: 'border-l-indigo-500' },
          { label: 'Coverage', value: coveragePayload ? `${Math.round(coveragePayload.overallCoverage)}%` : '--', accent: 'border-l-teal-500' },
        ].map((stat, i) => (
          <div key={i} className={`bg-white rounded-lg border border-slate-200 border-l-4 ${stat.accent} px-4 py-3`}>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{stat.label}</div>
            <div className="text-xl font-bold text-slate-800 mt-0.5">{stat.value}</div>
            {'sub' in stat && stat.sub && (
              <div className="text-[10px] text-amber-600 mt-0.5">{stat.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Background Section Preparation Banner ── */}
      {(bgGenStatus === 'RUNNING' || bgGenStatus === 'COMPLETED' || bgGenStatus === 'PARTIAL' || bgGenStatus === 'FAILED') && (
        <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${
          bgGenStatus === 'RUNNING'
            ? 'bg-indigo-50 border-indigo-200'
            : bgGenStatus === 'COMPLETED'
              ? 'bg-emerald-50 border-emerald-200'
              : bgGenStatus === 'PARTIAL'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-red-50 border-red-200'
        }`}>
          {bgGenStatus === 'RUNNING' && (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500" />
            </span>
          )}
          {bgGenStatus === 'COMPLETED' && (
            <span className="inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          )}
          {bgGenStatus === 'PARTIAL' && (
            <span className="inline-flex h-3 w-3 rounded-full bg-amber-500" />
          )}
          {bgGenStatus === 'FAILED' && (
            <span className="inline-flex h-3 w-3 rounded-full bg-red-500" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-medium ${
              bgGenStatus === 'RUNNING'
                ? 'text-indigo-800'
                : bgGenStatus === 'COMPLETED'
                  ? 'text-emerald-800'
                  : bgGenStatus === 'PARTIAL'
                    ? 'text-amber-800'
                    : 'text-red-800'
            }`}>
              {bgGenStatus === 'RUNNING'
                ? 'Generating Pass 1 reference drafts...'
                : bgGenStatus === 'COMPLETED'
                  ? 'Pass 1 reference draft generation completed'
                  : bgGenStatus === 'PARTIAL'
                    ? `Pass 1 completed with failures - ${bgGenProgress?.failed || 0} section(s) could not be prepared`
                    : 'Pass 1 generation failed - retry before moving to drafting'}
            </p>
            {bgGenStatus === 'RUNNING' && bgGenProgress && bgGenProgress.total > 0 && bgGenLiveCounts && (
              <p className="text-xs text-indigo-600 mt-0.5">
                {bgGenLiveCounts.done}/{bgGenProgress.total} generated • {bgGenLiveCounts.waiting} waiting • {bgGenLiveCounts.running} in progress
                {bgGenLiveCounts.failed > 0 && ` • ${bgGenLiveCounts.failed} failed`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Control Bar ── */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800 text-sm">Evidence Extraction</h3>
              {running && <Badge className="bg-blue-100 text-blue-700 text-[10px] animate-pulse">Running</Badge>}
              {statusPayload?.status === 'COMPLETED' && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Complete</Badge>}
              {statusPayload?.status === 'PARTIAL' && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Partial</Badge>}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedReadyCount} of {readyCandidates.length} papers selected
              {statusPayload && statusPayload.totalJobs > 0 && ` \u00b7 ${statusPayload.completed}/${statusPayload.totalJobs} jobs done`}
              {lastEstimatedSeconds && running && ` \u00b7 ~${Math.ceil(lastEstimatedSeconds / 60)}m remaining`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(textExtractionPending > 0 || textExtractionProcessing) && (
              <Button
                onClick={handleExtractText}
                disabled={isMutating || textExtractionProcessing}
                variant="outline"
                size="sm"
                className={`h-8 text-xs ${textExtractionProcessing ? 'border-teal-400 bg-teal-50 text-teal-800' : 'text-teal-700 border-teal-300 hover:bg-teal-50'}`}
              >
                {textExtractionProcessing ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse" />
                    Extracting{(textExtractionStatus?.inFlight ?? 0) > 0 ? ` (${textExtractionStatus!.inFlight} active)` : '...'}
                  </span>
                ) : (
                  `Extract Text (${textExtractionPending})`
                )}
              </Button>
            )}
            <Button
              onClick={handleStart}
              disabled={isMutating || running || selectedReadyCount === 0}
              size="sm"
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8"
            >
              {actionState === 'starting' ? 'Starting...' : `Analyze (${selectedReadyCount})`}
            </Button>
            {running && (
              <Button variant="outline" size="sm" onClick={handleStop} disabled={isMutating} className="text-red-600 border-red-200 hover:bg-red-50 h-8 text-xs">
                Stop
              </Button>
            )}
            {failedJobCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => handleRetryFailed()} disabled={isMutating} className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8 text-xs">
                Retry ({failedJobCount})
              </Button>
            )}
            {canRetryWithTextFallback && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRetryFailed({ allowTextFallback: true })}
                disabled={isMutating}
                className="text-teal-700 border-teal-300 hover:bg-teal-50 h-8 text-xs"
              >
                Retry + Text Fallback
              </Button>
            )}
            {canManuallyPrepareSections && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrepareSections({ force: bgGenStatus === 'COMPLETED' })}
                disabled={isMutating}
                className={`h-8 text-xs ${
                  bgGenStatus === 'FAILED' || bgGenStatus === 'PARTIAL'
                    ? 'text-amber-700 border-amber-300 hover:bg-amber-50'
                    : bgGenStatus === 'COMPLETED'
                      ? 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                    : 'text-indigo-700 border-indigo-300 hover:bg-indigo-50'
                }`}
              >
                {actionState === 'preparing'
                  ? 'Preparing...'
                  : bgGenStatus === 'FAILED' || bgGenStatus === 'PARTIAL'
                    ? 'Retry Section Prep'
                    : bgGenStatus === 'COMPLETED'
                      ? 'Rerun Section Prep'
                    : 'Prepare Sections'}
              </Button>
            )}
            {(bgGenStatus === 'PARTIAL' || bgGenStatus === 'FAILED') && (bgGenLiveCounts?.failed || 0) > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrepareSections({ retryFailedOnly: true })}
                disabled={isMutating}
                className="h-8 text-xs text-amber-800 border-amber-400 bg-amber-100 hover:bg-amber-200"
              >
                {actionState === 'preparing' ? 'Retrying...' : 'Retry Failed Only'}
              </Button>
            )}
            {(statusPayload?.totalCardsExtracted ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={handleRemap} disabled={isMutating} className="h-8 text-xs">
                {actionState === 'remapping' ? 'Remapping...' : 'Remap'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={refreshAll} disabled={isRefreshing} className="h-8 text-xs text-slate-500">
              {isRefreshing ? 'Syncing...' : 'Refresh'}
            </Button>
          </div>
        </div>
        {running && <Progress value={progressPercent} className="h-1 rounded-none" />}
      </div>

      {/* ── Main Layout: Paper List + Detail Panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" style={{ minHeight: '520px' }}>

        {/* ── Left: Paper Sidebar ── */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-2">
          <div className="flex items-center justify-between px-1 mb-1">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Papers</h4>
            <span className="text-[10px] text-slate-400">{allCandidates.length} total</span>
          </div>
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {allCandidates.map(candidate => {
              const isSelected = selectedIds.has(candidate.citationId);
              const isActive = selectedPaperId === candidate.citationId;
              const isAnchor = candidate.depthLabel === 'DEEP_ANCHOR';
              const isStress = candidate.depthLabel === 'DEEP_STRESS_TEST';
              const jobStatus = statusPayload?.jobs?.find(j => j.citationId === candidate.citationId);
              const paperGroup = paperGroups.find(g => g.citationId === candidate.citationId);
              const cardCount = paperGroup?.cards.length ?? candidate.evidenceCardCount;

              return (
                <div
                  key={candidate.citationId}
                  onClick={() => setSelectedPaperId(candidate.citationId)}
                  className={`
                    group relative rounded-lg border p-3 cursor-pointer transition-all duration-150
                    ${isActive
                      ? 'border-slate-800 bg-slate-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    }
                    ${!candidate.ready ? 'opacity-55' : ''}
                  `}
                >
                  {/* Left accent bar */}
                  <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full transition-colors ${
                    isAnchor ? 'bg-amber-400' : isStress ? 'bg-rose-400' : 'bg-slate-300'
                  }`} />

                  <div className="pl-2.5">
                    {/* Top row: checkbox + badges */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {candidate.ready && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(candidate.citationId)) next.delete(candidate.citationId);
                              else next.add(candidate.citationId);
                              return next;
                            });
                          }}
                          onClick={e => e.stopPropagation()}
                          className="h-3.5 w-3.5"
                        />
                      )}
                      {getDepthBadge(candidate.depthLabel)}
                      {getStatusBadge(jobStatus?.status || candidate.deepAnalysisStatus)}
                      {(candidate.parserCandidate === 'PDFJS' || candidate.parserCandidate === 'GROBID') && (
                        <Badge variant="outline" className="text-[9px] border-teal-200 text-teal-700 px-1 py-0">PDF.js</Badge>
                      )}
                    </div>

                    {/* Title */}
                    <h5 className="text-xs font-medium text-slate-800 leading-snug line-clamp-2 mb-1" title={candidate.title}>
                      {candidate.title}
                    </h5>

                    {/* Bottom row: key + count */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono truncate max-w-[60%]">{candidate.citationKey}</span>
                      <div className="flex items-center gap-2">
                        {cardCount > 0 && (
                          <span className="text-[10px] font-semibold text-slate-500">{cardCount} cards</span>
                        )}
                        {candidate.ready && (
                          <button
                            onClick={e => { e.stopPropagation(); void handleViewExtractedText(candidate); }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 underline underline-offset-2"
                          >
                            Source
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Text extraction / readiness status */}
                    {!candidate.ready && (() => {
                      const paperTex = textExtractionStatus?.papers.find(p => p.citationId === candidate.citationId);
                      if (paperTex?.textStatus === 'parsing') {
                        return <p className="text-[10px] text-teal-600 mt-1 leading-tight animate-pulse">PDF text extraction in progress...</p>;
                      }
                      if (paperTex?.textStatus === 'pending' || paperTex?.textStatus === 'basic_text') {
                        return <p className="text-[10px] text-amber-600 mt-1 leading-tight">PDF available — text extraction pending</p>;
                      }
                      if (paperTex?.textStatus === 'no_pdf') {
                        return <p className="text-[10px] text-red-500 mt-1 leading-tight">No PDF attached</p>;
                      }
                      return candidate.readinessReason
                        ? <p className="text-[10px] text-red-500 mt-1 leading-tight">{candidate.readinessReason}</p>
                        : null;
                    })()}
                  </div>
                </div>
              );
            })}
            {allCandidates.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">
                No eligible papers found. Ensure papers are in Anchor/Support/Stress Test and have PDF or text attached in Literature Search.
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div className="lg:col-span-8 xl:col-span-9">
          <Tabs defaultValue="evidence" className="h-full">
            <div className="flex items-center justify-between mb-3">
              <TabsList className="bg-slate-100 h-8">
                <TabsTrigger value="evidence" className="text-xs h-7 px-3">Evidence Cards</TabsTrigger>
                <TabsTrigger value="coverage" className="text-xs h-7 px-3">Coverage Matrix</TabsTrigger>
                <TabsTrigger value="jobs" className="text-xs h-7 px-3">Job Status</TabsTrigger>
              </TabsList>

              {/* Filters */}
              <div className="flex items-center gap-1.5">
                <select className="h-7 rounded text-[11px] border-slate-200 bg-white focus:border-slate-400 focus:ring-0 px-2" value={claimTypeFilter} onChange={e => setClaimTypeFilter(e.target.value)}>
                  <option value="ALL">All Types</option>
                  <option value="FINDING">Findings</option>
                  <option value="GAP">Gaps</option>
                  <option value="METHOD">Methods</option>
                  <option value="LIMITATION">Limitations</option>
                </select>
                <select className="h-7 rounded text-[11px] border-slate-200 bg-white focus:border-slate-400 focus:ring-0 px-2" value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)}>
                  <option value="ALL">All Confidence</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                </select>
                <input
                  type="text"
                  placeholder="Search evidence..."
                  className="h-7 rounded text-[11px] border-slate-200 bg-white w-44 focus:border-slate-400 focus:ring-0 px-2"
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                />
              </div>
            </div>

            {/* ── Tab: Evidence Cards ── */}
            <TabsContent value="evidence" className="mt-0">
              {selectedPaperId && selectedPaperCards.length > 0 ? (
                <div className="space-y-3">
                  {/* Selected paper header */}
                  <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        {selectedPaperCandidate && getDepthBadge(selectedPaperCandidate.depthLabel)}
                        <span className="text-xs font-mono text-slate-500">{selectedPaperCandidate?.citationKey}</span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-800 line-clamp-1">{selectedPaperCandidate?.title}</h4>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{selectedPaperCards.length} cards</span>
                  </div>

                  {/* Cards grid */}
                  <div className="grid gap-2 max-h-[450px] overflow-y-auto pr-1">
                    {selectedPaperCards.map(card => (
                      <EvidenceCardItem key={card.id} card={card} claimBadgeClass={claimBadgeClass} confidenceDot={confidenceDot} />
                    ))}
                  </div>
                </div>
              ) : (
                /* All papers grouped view */
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {paperGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <p className="text-sm font-medium">No evidence extracted yet</p>
                      <p className="text-xs text-slate-400 mt-1">Select papers and click Analyze to begin extraction</p>
                    </div>
                  ) : (
                    paperGroups.map(group => {
                      const isExpanded = expandedPaperIds.has(group.citationId);
                      const candidate = allCandidates.find(c => c.citationId === group.citationId);
                      return (
                        <div key={group.citationId} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => togglePaperExpanded(group.citationId)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                              {candidate && getDepthBadge(candidate.depthLabel)}
                              <span className="text-xs font-mono text-slate-500 flex-shrink-0">{group.citationKey}</span>
                              <span className="text-xs text-slate-600 truncate">{candidate?.title}</span>
                            </div>
                            <Badge variant="secondary" className="text-[10px] ml-2 flex-shrink-0">{group.cards.length} cards</Badge>
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-3 pt-1 border-t border-slate-100 grid gap-2">
                              {group.cards.map(card => (
                                <EvidenceCardItem key={card.id} card={card} claimBadgeClass={claimBadgeClass} confidenceDot={confidenceDot} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Tab: Coverage Matrix ── */}
            <TabsContent value="coverage" className="mt-0">
              <div className="space-y-3">
                {/* Overview */}
                {coveragePayload && (
                  <div className="bg-white border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-slate-800">Blueprint Dimension Coverage</h4>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">{coveragePayload.totalCards} total cards</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.round(coveragePayload.overallCoverage)}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-slate-700">{Math.round(coveragePayload.overallCoverage)}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Gaps */}
                    {coveragePayload.gaps.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <h5 className="text-[11px] font-semibold text-red-600 uppercase tracking-wider mb-2">Uncovered Gaps ({coveragePayload.gaps.length})</h5>
                        <div className="flex flex-wrap gap-1.5">
                          {coveragePayload.gaps.map((gap, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 bg-red-50 text-red-700 rounded border border-red-200">{gap}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Section-by-section breakdown */}
                {coverageSections.length > 0 ? (
                  <div className="space-y-2">
                    {coverageSections.map(section => (
                      <div key={section.sectionKey} className="bg-white border border-slate-200 rounded-lg p-4">
                        <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">{section.sectionKey.replace(/_/g, ' ')}</h5>
                        <div className="grid gap-1.5">
                          {section.dimensions.map((dim, i) => (
                            <div key={i} className="flex items-center justify-between py-1 px-2 rounded bg-slate-50">
                              <span className="text-xs text-slate-600 truncate flex-1 mr-3">{dim.dimension}</span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-slate-500">{dim.paperCount} papers</span>
                                <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${dim.cardCount > 0 ? 'bg-emerald-500' : 'bg-slate-200'}`}
                                    style={{ width: `${Math.min(100, dim.cardCount * 20)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-medium text-slate-700 w-6 text-right">{dim.cardCount}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-sm text-slate-400">
                    Coverage data will appear after evidence extraction completes.
                  </div>
                )}

                {/* Paper x Section Matrix */}
                {coveragePayload && coveragePayload.matrix.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Paper-Section Heatmap</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr>
                            <th className="text-left py-1 pr-3 text-slate-500 font-medium">Paper</th>
                            {Object.keys(coveragePayload.matrix[0]?.sections || {}).map(sk => (
                              <th key={sk} className="text-center px-1.5 py-1 text-slate-500 font-medium whitespace-nowrap">{sk.replace(/_/g, ' ')}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {coveragePayload.matrix.map((row, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="py-1 pr-3 font-mono text-slate-600 whitespace-nowrap">{row.citationKey}</td>
                              {Object.entries(row.sections).map(([sk, count]) => (
                                <td key={sk} className="text-center px-1.5 py-1">
                                  {count > 0 ? (
                                    <span className={`inline-block w-5 h-5 rounded text-white text-[9px] font-bold leading-5 ${
                                      count >= 3 ? 'bg-emerald-600' : count >= 2 ? 'bg-emerald-400' : 'bg-emerald-300'
                                    }`}>{count}</span>
                                  ) : (
                                    <span className="inline-block w-5 h-5 rounded bg-slate-100 text-slate-300 text-[9px] leading-5">-</span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: Job Status ── */}
            <TabsContent value="jobs" className="mt-0">
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {statusPayload && statusPayload.jobs.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-2 font-medium text-slate-500">Citation</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500">Status</th>
                        <th className="text-center px-4 py-2 font-medium text-slate-500">Cards</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusPayload.jobs.map(job => (
                        <tr key={job.jobId} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-slate-600">{job.citationKey}</td>
                          <td className="px-4 py-2.5">{getStatusBadge(job.status)}</td>
                          <td className="px-4 py-2.5 text-center text-slate-600">{job.cardsExtracted ?? '--'}</td>
                          <td className="px-4 py-2.5 text-slate-500 truncate max-w-[200px]" title={job.error || ''}>
                            {job.error ? <span className="text-red-500">{job.error}</span> : '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-12 text-sm text-slate-400">
                    No analysis jobs yet. Select papers and click Analyze.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── Full Text Modal ── */}
      <Dialog open={!!fullTextModalCandidate} onOpenChange={open => !open && setFullTextModalCandidate(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">{fullTextModalCandidate?.citationKey} — Extracted Text</DialogTitle>
            <DialogDescription className="text-xs">Extracted source text used for evidence extraction.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-slate-50 p-4 rounded-md font-mono text-xs whitespace-pre-wrap border border-slate-200 leading-relaxed">
            {loadingFullTextCitationId ? 'Loading text...' : (fullTextModalError || fullTextModalContent)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EvidenceCardItem({
  card,
  claimBadgeClass,
  confidenceDot
}: {
  card: EvidenceCardRow;
  claimBadgeClass: (type: string) => string;
  confidenceDot: (c: string) => string;
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-lg p-3 hover:border-slate-300 transition-colors">
      {/* Header: type + confidence + section */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${claimBadgeClass(card.claimType)}`}>
          {card.claimType}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <span className={`w-1.5 h-1.5 rounded-full ${confidenceDot(card.confidence)}`} />
          {card.confidence}
        </span>
        {card.quoteVerified && (
          <span className="text-[10px] text-emerald-600 font-medium">Verified</span>
        )}
        {card.sourceSection && (
          <span className="text-[10px] text-slate-400 ml-auto truncate max-w-[120px]" title={card.sourceSection}>
            {card.sourceSection}
          </span>
        )}
      </div>

      {/* Source fragment */}
      <p className="text-xs text-slate-700 leading-relaxed mb-2 border-l-2 border-slate-200 pl-2.5 italic">
        &ldquo;{card.sourceFragment}&rdquo;
      </p>

      {/* Claim */}
      <p className="text-xs text-slate-800 leading-relaxed mb-2">{card.claim}</p>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {card.pageHint && <span>p. {card.pageHint}</span>}
        {card.quantitativeDetail && (
          <span className="text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">{card.quantitativeDetail}</span>
        )}
        {card.studyDesign && <span>{card.studyDesign}</span>}
        {card.doesNotSupport && (
          <span className="text-amber-700" title={card.doesNotSupport}>Boundary noted</span>
        )}
      </div>

      {/* Dimension mappings */}
      {card.mappings && card.mappings.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
          {card.mappings.map((m, i) => (
            <span
              key={i}
              className="text-[9px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100"
              title={`${m.sectionKey} > ${m.dimension} (${m.mappingConfidence})`}
            >
              {m.dimension.length > 40 ? `${m.dimension.slice(0, 40)}...` : m.dimension}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

