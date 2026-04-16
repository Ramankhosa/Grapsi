'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import Stage4ResultsDisplay from './Stage4ResultsDisplay';
import NoveltyStageNav from './NoveltyStageNav';
import NoveltyFloatingButtons from './NoveltyFloatingButtons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  Loader2, 
  Search, 
  FileText, 
  AlertCircle, 
  CheckCircle, 
  XCircle, 
  FolderOpen, 
  Check, 
  Eye, 
  AlertTriangle,
  Sparkles,
  Zap,
  ArrowRight,
  RefreshCw,
  ExternalLink
} from 'lucide-react';

// Local string constants for UI mapping
const NoveltySearchStatus = {
  PENDING: 'PENDING',
  STAGE_0_COMPLETED: 'STAGE_0_COMPLETED',
  STAGE_1_COMPLETED: 'STAGE_1_COMPLETED',
  STAGE_3_5_COMPLETED: 'STAGE_3_5_COMPLETED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const NoveltySearchStage = {
  STAGE_0: 'STAGE_0',
  STAGE_1: 'STAGE_1',
  STAGE_3_5: 'STAGE_3_5',
  STAGE_4: 'STAGE_4',
} as const;

// Stage constants for UI display
const STAGE_LABELS = {
  PENDING: 'Start Search',
  STAGE_0_COMPLETED: 'Query Generation',
  STAGE_1_COMPLETED: 'Patent Search',
  STAGE_3_5_COMPLETED: 'Feature Analysis',
  COMPLETED: 'Report Complete'
};

const STAGE_PROGRESS = {
  PENDING: 0,
  STAGE_0_COMPLETED: 20,
  STAGE_1_COMPLETED: 40,
  STAGE_3_5_COMPLETED: 70,
  COMPLETED: 100
};

const STAGE_ORDER = ['PENDING', 'STAGE_0_COMPLETED', 'STAGE_1_COMPLETED', 'STAGE_3_5_COMPLETED', 'COMPLETED'];

interface Project {
  id: string;
  name: string;
  createdAt: string;
  patents?: { id: string }[];
  collaborators?: { id: string }[];
}

interface NoveltySearchWorkflowProps {
  patentId?: string;
  projectId?: string;
  onComplete?: (searchId: string) => void;
  initialSearchId?: string;
  initialTitle?: string;
  initialDescription?: string;
  ideaId?: string;
}

interface SearchState {
  searchId: string | null;
  status: string | null;
  currentStage: string | null;
  results: any;
  error: string | null;
  isLoading: boolean;
}

// Stage tab types
const STAGE_TABS = ['0','1','1.5','3.5','3.5c','4','5'] as const;
type StageTab = (typeof STAGE_TABS)[number];

const STAGE_TAB_LABELS: Record<StageTab, string> = {
  '0': 'Idea Setup',
  '1': 'Patent Search',
  '1.5': 'AI Relevance',
  '3.5': 'Feature Analysis',
  '3.5c': 'Patent Remarks',
  '4': 'Final Report',
  '5': 'Download Report'
};

export default function NoveltySearchWorkflow({
  patentId,
  projectId: initialProjectId,
  onComplete,
  initialSearchId,
  initialTitle,
  initialDescription,
  ideaId
}: NoveltySearchWorkflowProps) {
  const [formData, setFormData] = useState({
    title: initialTitle || '',
    inventionDescription: initialDescription || '',
    jurisdiction: 'IN'
  });
  
  useEffect(() => {
    if (initialTitle || initialDescription) {
      setFormData(prev => ({
        ...prev,
        title: initialTitle || prev.title,
        inventionDescription: initialDescription || prev.inventionDescription
      }));
    }
  }, [initialTitle, initialDescription]);

  const [searchState, setSearchState] = useState<SearchState>({
    searchId: null,
    status: null,
    currentStage: null,
    results: null,
    error: null,
    isLoading: false
  });

  const [stageProgress, setStageProgress] = useState({
    stage0: 0,
    stage1: 0,
    stage3_5: 0,
    stage4: 0
  });

  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [selectedStageTab, setSelectedStageTab] = useState<StageTab>('0');
  const [activeExecutionStage, setActiveExecutionStage] = useState<string | null>(null);

  // Map stage tab keys to execution stage numbers
  const stageNumberByKey: Record<StageTab, string | null> = {
    '0': null,
    '1': '1',
    '1.5': '1.5',
    '3.5': '3.5',
    '3.5c': '3.5c',
    '4': '4',
    '5': null  // Stage 5 is just display, no execution needed
  };

  // Evidence panel state (Stage 3.5 matrix cell details)
  const [selectedEvidence, setSelectedEvidence] = useState<null | {
    pn: string;
    patentTitle?: string;
    feature: string;
    status: string;
    quote?: string;
    reason?: string;
    field?: string;
    confidence?: number;
    link?: string;
  }>(null);

  // Stage simulation states
  const [isStage1Simulating, setIsStage1Simulating] = useState(false);
  const [stage1Message, setStage1Message] = useState('');
  const [isStage35Simulating, setIsStage35Simulating] = useState(false);
  const [stage35Message, setStage35Message] = useState('');
  const [isStage35aSimulating, setIsStage35aSimulating] = useState(false);
  const [stage35aMessage, setStage35aMessage] = useState('');

  // Stage 0 editing state
  const [isEditingStage0, setIsEditingStage0] = useState(false);
  const [editedSearchQuery, setEditedSearchQuery] = useState('');
  const [editedFeatures, setEditedFeatures] = useState<string[]>([]);
  const [editingFeatureIndex, setEditingFeatureIndex] = useState<number | null>(null);
  const [newFeatureText, setNewFeatureText] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [stage0Approved, setStage0Approved] = useState(false);

  // Progress messages
  const stage1Messages = [
    '🔍 Scanning through 12M+ global patent database...',
    '🎯 Applying advanced semantic analysis to your invention...',
    '🧠 Using proprietary AI algorithms for relevance matching...',
    '📊 Calculating multi-dimensional similarity scores...',
    '🔬 Cross-referencing with CPC/IPC classification systems...',
    '⚡ Filtering results through novelty assessment engine...',
    '📈 Ranking patents by technical relevance and impact...',
    '📋 Preparing final results with comprehensive metadata...'
  ];

  const stage35Messages = [
    'Comparing invention claims with patent claims…',
    'Analyzing technical differences…',
    'Evaluating novelty impact…',
    'Assessing obviousness…',
    'Reviewing prior art citations…',
    'Generating assessment report…'
  ];

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  // Load existing search if provided
  useEffect(() => {
    if (!initialSearchId) return;

    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      setSearchState(prev => ({
        ...prev,
        error: 'Authentication token missing. Please log in again.'
      }));
      return;
    }

    const loadExistingSearch = async () => {
      try {
        setSearchState(prev => ({
          ...prev,
          searchId: initialSearchId,
          isLoading: true,
          error: null
        }));

        const response = await fetch(`/api/novelty-search/${initialSearchId}`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
          cache: 'no-store'
        });

        const data = await response.json();

        if (response.ok && data.search) {
          const search = data.search;
          setSearchState(prev => ({
            ...prev,
            searchId: initialSearchId,
            status: search.status,
            currentStage: search.currentStage,
            results: search.results,
            isLoading: false
          }));

          const completed: string[] = [];
          if (search.stage0CompletedAt) completed.push('stage0');
          if (search.stage1CompletedAt) completed.push('stage1');
          if (search.stage35CompletedAt) completed.push('stage3_5');
          if (search.stage4CompletedAt) completed.push('stage4');

          setCompletedStages(completed);
          setStageProgress(prev => {
            const next = { ...prev };
            completed.forEach(stage => {
              (next as any)[stage] = 100;
            });
            return next;
          });
        } else {
          setSearchState(prev => ({
            ...prev,
            error: data.error || 'Failed to load search status',
            isLoading: false
          }));
        }
      } catch (error) {
        console.error('[Init] Failed to load existing novelty search:', error);
        setSearchState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to load search status',
          isLoading: false
        }));
      }
    };

    loadExistingSearch();
  }, [initialSearchId]);

  // Helper function to get current stage display info
  const getCurrentStageInfo = useCallback(() => {
    const currentStatus = searchState.status || 'PENDING';
    return {
      label: STAGE_LABELS[currentStatus as keyof typeof STAGE_LABELS] || 'Start Search',
      progress: STAGE_PROGRESS[currentStatus as keyof typeof STAGE_PROGRESS] || 0
    };
  }, [searchState.status]);

  // Helper: has Stage 1.5 (AI Relevance) been computed
  const hasStage15 = useCallback((): boolean => {
    const r: any = searchState.results || {};
    const gate = r?.aiRelevance || r?.stage1?.aiRelevance;
    return !!(gate && (Array.isArray(gate.accepted) || Array.isArray(gate.borderline) || Array.isArray(gate.rejected)));
  }, [searchState.results]);

  const hasStage15Results = useMemo(() => hasStage15(), [hasStage15]);

  const stage0Snapshot = useMemo(() => {
    const root: any = searchState.results || {};
    const s0 = root.stage0 || root;
    const features = Array.isArray(s0?.inventionFeatures) ? s0.inventionFeatures.length : 0;
    return {
      hasQuery: !!s0?.searchQuery,
      featuresCount: features,
    };
  }, [searchState.results]);

  const stage1Results = useMemo(() => {
    const root: any = searchState.results || {};
    const results = root.pqaiResults || root.stage1?.pqaiResults;
    return Array.isArray(results) ? results : [];
  }, [searchState.results]);

  const hasStage1Results = stage1Results.length > 0;

  const hasStage35Results = useMemo(() => {
    const root: any = searchState.results || {};
    const carrier = root.stage35 || root.stage3_5 || root;
    const coverage = carrier?.per_patent_coverage || root.per_patent_coverage;
    const uniqueness = carrier?.per_feature_uniqueness || root.per_feature_uniqueness;
    const agg = carrier?.feature_coverage_summary || carrier?.stage3_5;
    return !!(carrier?.stage35 || coverage || uniqueness || agg || root.stage4);
  }, [searchState.results]);

  const hasStage35cResults = useMemo(() => {
    const root: any = searchState.results || {};
    const container = root.stage4 || root;
    const remarks = container?.per_patent_remarks;
    return Array.isArray(remarks) && remarks.length > 0;
  }, [searchState.results]);

  const hasStage4Results = useMemo(() => {
    const root: any = searchState.results || {};
    return !!root.stage4;
  }, [searchState.results]);

  // Auto-navigate to appropriate tab when status changes
  useEffect(() => {
    const s = searchState.status;
    if (!s) return;
    if (s === NoveltySearchStatus.PENDING) { setSelectedStageTab('0'); return; }
    // Don't auto-navigate to stage 1 after STAGE_0_COMPLETED - wait for user approval
    if (s === NoveltySearchStatus.STAGE_1_COMPLETED) {
      setSelectedStageTab(hasStage15() ? '1.5' : '1');
      return;
    }
    if (s === NoveltySearchStatus.STAGE_3_5_COMPLETED) {
      // Always show Feature Analysis (3.5) first to display the feature comparison matrix
      // User should see the matrix before per-patent remarks, so don't skip to 3.5c
      setSelectedStageTab('3.5');
      return;
    }
    if (s === NoveltySearchStatus.COMPLETED) { setSelectedStageTab('4'); return; }
  }, [searchState.status, hasStage15]);

  const runningStageKey = useMemo<StageTab | null>(() => {
    if (!activeExecutionStage) return null;
    if (activeExecutionStage.startsWith('3.5')) return '3.5';
    if (activeExecutionStage === '1.5') return '1.5';
    if (activeExecutionStage === '1') return '1';
    if (activeExecutionStage === '4') return '4';
    return null;
  }, [activeExecutionStage]);

  const failedStageKey = useMemo<StageTab | null>(() => {
    if (searchState.status !== NoveltySearchStatus.FAILED) return null;
    switch (searchState.currentStage) {
      case NoveltySearchStage.STAGE_0: return '0';
      case NoveltySearchStage.STAGE_1: return '1';
      case NoveltySearchStage.STAGE_3_5: return '3.5';
      case NoveltySearchStage.STAGE_4: return '4';
      default: return selectedStageTab;
    }
  }, [searchState.status, searchState.currentStage, selectedStageTab]);

  const isStageCompleted = useCallback((key: StageTab) => {
    switch (key) {
      case '0':
        return stage0Snapshot.hasQuery || stage0Snapshot.featuresCount > 0 || !!searchState.searchId;
      case '1':
        return hasStage1Results || searchState.status === NoveltySearchStatus.STAGE_1_COMPLETED;
      case '1.5':
        return hasStage15Results;
      case '3.5':
        return hasStage35Results || searchState.status === NoveltySearchStatus.STAGE_3_5_COMPLETED;
      case '3.5c':
        return hasStage35cResults;
      case '4':
        return hasStage4Results || searchState.status === NoveltySearchStatus.COMPLETED;
      case '5':
        return hasStage4Results; // Stage 5 is available once Stage 4 is complete
      default:
        return false;
    }
  }, [hasStage1Results, hasStage15Results, hasStage35Results, hasStage35cResults, hasStage4Results, searchState.searchId, searchState.status, stage0Snapshot.featuresCount, stage0Snapshot.hasQuery]);

  const getStageStatus = useCallback((key: StageTab): 'completed' | 'in_progress' | 'pending' | 'failed' | 'blocked' => {
    if (runningStageKey === key || (searchState.isLoading && selectedStageTab === key)) return 'in_progress';
    if (failedStageKey === key) return 'failed';
    if (isStageCompleted(key)) return 'completed';
    const idx = STAGE_TABS.indexOf(key);
    const prevKey = idx > 0 ? STAGE_TABS[idx - 1] : null;
    if (prevKey && !isStageCompleted(prevKey)) return 'blocked';
    return 'pending';
  }, [failedStageKey, isStageCompleted, runningStageKey, searchState.isLoading, selectedStageTab]);

  const stageGuard = useCallback((key: StageTab): string | null => {
    if (key === '0') {
      if (searchState.searchId) return 'Stage 0 already generated. Edit or proceed to the next stage.';
      if (!formData.title.trim() || !formData.inventionDescription.trim()) return 'Add title and invention description to start the search.';
      return null;
    }
    if (!searchState.searchId) return 'Start the novelty search from Idea Setup first.';
    if (key === '1') return null;
    if (key === '1.5') return hasStage1Results ? null : 'Run Patent Search before AI Relevance.';
    if (key === '3.5') return (hasStage1Results || hasStage15Results) ? null : 'Run Patent Search before feature analysis.';
    if (key === '3.5c') return hasStage35Results ? null : 'Run Feature Analysis before generating remarks.';
    if (key === '4') return hasStage35Results ? null : 'Run Feature Analysis before generating the report.';
    return null;
  }, [formData.inventionDescription, formData.title, hasStage15Results, hasStage1Results, hasStage35Results, searchState.searchId]);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });

      if (response.ok) {
        const data = await response.json();
        const userProjects = data.projects || [];
        setProjects(userProjects);

        if (!initialProjectId && userProjects.length > 0) {
          const defaultProject = userProjects.find((p: Project) => p.name === 'Default Project');
          if (defaultProject) {
            setSelectedProjectId(defaultProject.id);
          } else {
            setSelectedProjectId(userProjects[0].id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const startNoveltySearch = async () => {
    if (!formData.title.trim() || !formData.inventionDescription.trim()) {
      setSearchState(prev => ({ ...prev, error: 'Title and invention description are required' }));
      return;
    }

    const validProjectId = selectedProjectId && projects.find(p => p.id === selectedProjectId) ? selectedProjectId : null;

    setSearchState({ ...searchState, isLoading: true, error: null });

    try {
      const response = await fetch('/api/novelty-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          patentId,
          projectId: validProjectId,
          ...formData,
          config: {
            jurisdiction: formData.jurisdiction,
            stage4: {
              reportFormat: 'JSON',
              includeExecutiveSummary: true,
              includeTechnicalDetails: true,
              colorCoding: true,
              modelPreference: 'gemini-2.5-flash-lite'
            }
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start novelty search');
      }

      setSearchState(prev => ({
        ...prev,
        searchId: data.searchId,
        status: data.status,
        currentStage: data.currentStage,
        results: data.results,
        isLoading: false
      }));

      setStageProgress(prev => ({ ...prev, stage0: 100 }));

    } catch (error) {
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start search',
        isLoading: false
      }));
    }
  };

  const executeStage = async (stageNumber: string) => {
    setActiveExecutionStage(stageNumber);
    if (!searchState.searchId) {
      setActiveExecutionStage(null);
      return;
    }

    setSearchState(prev => ({ ...prev, isLoading: true, error: null }));

    if (stageNumber === '1') {
      setIsStage1Simulating(true);
      for (let i = 0; i < stage1Messages.length; i++) {
        setStage1Message(stage1Messages[i]);
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
      setStage1Message('💡 Finalizing patent analysis and generating comprehensive report...');
    } else if (stageNumber === '3.5') {
      setIsStage35Simulating(true);
      setStage35Message(stage35Messages[0]);
    } else if (stageNumber === '3.5a') {
      setIsStage35aSimulating(true);
      const stage35aMessages = [
        '📊 Selecting top patents by PQAI relevance...',
        '🎯 Applying 50% selection with max 20 and min 10...',
        '🔄 Canonicalizing patents for feature mapping...',
        '📝 Mapping invention features to patent evidence...',
        '✅ Computing coverage and extracting references...'
      ];
      setStage35aMessage(stage35aMessages[0]);
      for (let i = 1; i < stage35aMessages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        setStage35aMessage(stage35aMessages[i]);
      }
    } else if (stageNumber === '3.5b') {
      setIsStage35Simulating(true);
      setStage35Message('Aggregating coverage and computing novelty metrics...');
    } else if (stageNumber === '3.5c') {
      setIsStage35Simulating(true);
      setStage35Message('Generating patent-by-patent remarks...');
    }

    try {
      let fetchOptions: RequestInit = {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      };

      const response = await fetch(`/api/novelty-search/${searchState.searchId}/stage/${stageNumber}`, fetchOptions);

      const rawBody = await response.text();
      let data: any = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch (parseError) {
        console.warn(`[Execution] Non-JSON response for stage ${stageNumber}:`, rawBody?.slice(0, 500));
      }

      if (!response.ok || !data) {
        const timeoutHint = response.status === 504
          ? 'Stage timed out before the server could respond. Please retry in a moment.'
          : undefined;
        const baseError = data?.error || data?.message || timeoutHint || `Failed to execute stage ${stageNumber}`;
        throw new Error(`${baseError}${response.status ? ` (status ${response.status})` : ''}`);
      }

      if (stageNumber === '1') {
        const items = Array.isArray(data?.results?.pqaiResults)
          ? data.results.pqaiResults
          : (Array.isArray(data?.results?.stage1?.pqaiResults) ? data.results.stage1.pqaiResults : []);
        setStage1Message(`✨ Analysis complete! Found ${items.length} highly relevant patent${items.length !== 1 ? 's' : ''} from millions of global records.`);
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      const stageKey = (stageNumber === '3.5' || stageNumber === '3.5a' || stageNumber === '3.5b' ) ? 'stage3_5' : `stage${stageNumber}`;
      setStageProgress(prev => ({ ...prev, [stageKey]: 100 }));

      // Refresh full aggregated results
      let effectiveStatus = data.status;
      let effectiveCurrentStage = data.currentStage;
      let effectiveResults = data.results;

      try {
        const fullRes = await fetch(`/api/novelty-search/${searchState.searchId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          cache: 'no-store'
        });
        const fullRaw = await fullRes.text();
        let fullJson: any = null;
        try {
          fullJson = fullRaw ? JSON.parse(fullRaw) : null;
        } catch {
          console.warn('[Execution] Non-JSON response while refreshing:', fullRaw?.slice(0, 500));
        }
        if (fullRes.ok && fullJson?.success !== false && fullJson?.search) {
          effectiveStatus = fullJson.search.status;
          effectiveCurrentStage = fullJson.search.currentStage;
          effectiveResults = fullJson.search.results;
        }
      } catch {}

      setSearchState(prev => ({
        ...prev,
        status: effectiveStatus,
        currentStage: effectiveCurrentStage,
        results: effectiveResults,
        isLoading: false
      }));

      if (effectiveStatus === NoveltySearchStatus.COMPLETED && onComplete) {
        onComplete(data.searchId);
      }

      // Auto progression
      if (autoMode) {
        const next = getStageNumberForStatus(effectiveStatus);
        if (next) {
          await executeStage(next);
        }
      }

    } catch (error) {
      console.error(`[Execution] Error executing stage ${stageNumber}:`, error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : `Failed to execute stage ${stageNumber}`,
        isLoading: false
      }));
    } finally {
      if (stageNumber === '1') {
        setIsStage1Simulating(false);
      } else if (stageNumber === '3.5' || stageNumber === '3.5b' || stageNumber === '3.5c') {
        setIsStage35Simulating(false);
      } else if (stageNumber === '3.5a') {
        setIsStage35aSimulating(false);
      }
      setActiveExecutionStage(null);
    }
  };

  const getStageNumberForStatus = (status: string): string | null => {
    switch (status) {
      case 'PENDING':
        return '0'; // Start with stage 0 for new searches
      case NoveltySearchStatus.STAGE_0_COMPLETED:
        // Only auto-progress to stage 1 if user has approved the search terms
        return stage0Approved ? '1' : null;
      case NoveltySearchStatus.STAGE_1_COMPLETED:
        // In auto mode, always progress through all stages
        if (autoMode) {
          if (!hasStage15Results) return '1.5';
          if (!hasStage35Results) return '3.5';
          if (!hasStage35cResults) return '3.5c';
          if (!hasStage4Results) return '4';
        }
        return hasStage15Results ? '3.5' : '1.5';
      case NoveltySearchStatus.STAGE_3_5_COMPLETED:
        // In auto mode, always progress through all stages
        if (autoMode) {
          if (!hasStage35cResults) return '3.5c';
          if (!hasStage4Results) return '4';
        }
        return hasStage35cResults ? '4' : '3.5c';
      case NoveltySearchStatus.COMPLETED:
        return null;
      default:
        return null;
    }
  };
  
  // Run all remaining stages automatically (for auto mode after approval)
  const runAllRemainingStages = useCallback(async () => {
    if (!searchState.searchId) return;
    
    const stages = ['1', '1.5', '3.5', '3.5c', '4'];
    
    for (const stageNum of stages) {
      // Check if stage already completed
      if (stageNum === '1' && hasStage1Results) continue;
      if (stageNum === '1.5' && hasStage15Results) continue;
      if (stageNum === '3.5' && hasStage35Results) continue;
      if (stageNum === '3.5c' && hasStage35cResults) continue;
      if (stageNum === '4' && hasStage4Results) continue;
      
      try {
        console.log(`[Auto] Running stage ${stageNum}...`);
        await executeStage(stageNum);
        // Small delay between stages to let state update
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`[Auto] Stage ${stageNum} failed:`, err);
        break; // Stop on error
      }
    }
  }, [searchState.searchId, hasStage1Results, hasStage15Results, hasStage35Results, hasStage35cResults, hasStage4Results, executeStage]);

  const runStageForKey = useCallback(async (stageKey: StageTab, advance?: boolean) => {
    const guardMsg = stageGuard(stageKey);
    if (guardMsg) {
      setSearchState(prev => ({ ...prev, error: guardMsg }));
      setSelectedStageTab(stageKey);
      return;
    }

    if (stageKey === '0') {
      await startNoveltySearch();
      if (advance) setSelectedStageTab('1');
      return;
    }

    const stageNumber = stageNumberByKey[stageKey];
    if (!stageNumber) return;

    setSelectedStageTab(stageKey);
    setActiveExecutionStage(stageNumber);
    try {
      await executeStage(stageNumber);
      if (advance) {
        const idx = STAGE_TABS.indexOf(stageKey);
        const next = idx >= 0 && idx < STAGE_TABS.length - 1 ? STAGE_TABS[idx + 1] : null;
        if (next) setSelectedStageTab(next);
      }
    } finally {
      setActiveExecutionStage(null);
    }
  }, [stageGuard, stageNumberByKey]);

  const handlePrevNav = useCallback(() => {
    const idx = STAGE_TABS.indexOf(selectedStageTab);
    if (idx <= 0) return;
    setSelectedStageTab(STAGE_TABS[idx - 1]);
  }, [selectedStageTab]);

  const handleNextNav = useCallback(() => {
    const idx = STAGE_TABS.indexOf(selectedStageTab);
    if (idx < 0 || idx >= STAGE_TABS.length - 1) return;
    const next = STAGE_TABS[idx + 1];
    const guardMsg = stageGuard(next);
    if (guardMsg) {
      setSearchState(prev => ({ ...prev, error: guardMsg }));
      return;
    }
    setSelectedStageTab(next);
  }, [selectedStageTab, stageGuard]);

  const handleRunCurrent = useCallback(async () => {
    await runStageForKey(selectedStageTab);
  }, [runStageForKey, selectedStageTab]);

  // Stage 0 editing functions
  const startEditingStage0 = () => {
    const s0 = (searchState.results?.stage0) || (searchState.results as any) || {};
    if (s0) {
      setEditedSearchQuery(s0.searchQuery || '');
      setEditedFeatures([...(s0.inventionFeatures || [])]);
      setIsEditingStage0(true);
    }
  };

  const saveStage0Edits = async () => {
    if (!searchState.searchId) return;

    try {
      const response = await fetch(`/api/novelty-search/${searchState.searchId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          stage: 'stage0',
          searchQuery: editedSearchQuery,
          inventionFeatures: editedFeatures
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save Stage 0 edits: ${response.status} ${errorText}`);
      }

      setSearchState(prev => ({
        ...prev,
        results: {
          ...prev.results,
          stage0: {
            ...prev.results?.stage0,
            searchQuery: editedSearchQuery,
            inventionFeatures: editedFeatures
          },
          searchQuery: editedSearchQuery,
          inventionFeatures: editedFeatures
        }
      }));

      setStage0Approved(true);
      setIsEditingStage0(false);
    } catch (error) {
      console.error('Save Stage 0 edits error:', error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save edits'
      }));
    }
  };

  const cancelStage0Edits = () => {
    setIsEditingStage0(false);
    setEditingFeatureIndex(null);
    setNewFeatureText('');
  };

  const addFeature = () => {
    if (newFeatureText.trim()) {
      setEditedFeatures([...editedFeatures, newFeatureText.trim()]);
      setNewFeatureText('');
    }
  };

  const removeFeature = (index: number) => {
    setEditedFeatures(editedFeatures.filter((_, i) => i !== index));
  };

  const startEditingFeature = (index: number) => {
    setEditingFeatureIndex(index);
  };

  // Compute navigation state
  const currentStageInfo = getCurrentStageInfo();
  const idx = STAGE_TABS.indexOf(selectedStageTab);
  const prevStage = idx > 0 ? STAGE_TABS[idx - 1] : null;
  const nextStage = idx >= 0 && idx < STAGE_TABS.length - 1 ? STAGE_TABS[idx + 1] : null;
  const currentGuard = stageGuard(selectedStageTab);
  const canRunCurrent = (!currentGuard) && !searchState.isLoading && !activeExecutionStage && (selectedStageTab === '0' || !!stageNumberByKey[selectedStageTab]);
  const isFailedCurrent = failedStageKey === selectedStageTab;

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    const completedCount = STAGE_TABS.filter(key => isStageCompleted(key)).length;
    return Math.round((completedCount / STAGE_TABS.length) * 100);
  }, [isStageCompleted]);

  // ============================================================================
  // RENDER FORM (Initial State)
  // ============================================================================
  const renderForm = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <motion.div 
              className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              <Sparkles className="h-6 w-6 text-white" />
            </motion.div>
            <div>
              <CardTitle className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Start Novelty Search
              </CardTitle>
              <CardDescription className="text-slate-500">
                Enter your invention details to begin AI-powered novelty assessment
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Idea Bank Banner */}
          {ideaId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200"
            >
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-indigo-900">Loaded from Idea Bank</p>
                  <p className="text-xs text-indigo-700">The title and description have been pre-filled from your reserved idea.</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Project Display */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Project</Label>
            <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 rounded-xl">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-xl flex items-center justify-center shadow-sm">
                <FolderOpen className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-slate-900">{selectedProject?.name || 'Loading...'}</div>
                <div className="text-xs text-slate-500">
                  {selectedProject?.name === 'Default Project' ? 'Quick drafts and searches' : 'Selected project'}
                </div>
              </div>
              {selectedProject?.name === 'Default Project' && (
                <Badge variant="secondary" className="text-xs bg-indigo-100 text-indigo-700">Default</Badge>
              )}
            </div>
          </div>

          {/* Title Input */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium text-slate-700">Invention Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter a clear, concise title for your invention"
              className="h-12 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20"
            />
          </div>

          {/* Description Input */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium text-slate-700">Invention Description</Label>
            <Textarea
              id="description"
              value={formData.inventionDescription}
              onChange={(e) => setFormData(prev => ({ ...prev, inventionDescription: e.target.value }))}
              placeholder="Describe your invention in detail, including the problem it solves, how it works, and its key features..."
              rows={8}
              className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 resize-none"
            />
          </div>

          {/* Jurisdiction Select */}
          <div className="space-y-2">
            <Label htmlFor="jurisdiction" className="text-sm font-medium text-slate-700">Jurisdiction</Label>
            <select
              id="jurisdiction"
              value={formData.jurisdiction}
              onChange={(e) => setFormData(prev => ({ ...prev, jurisdiction: e.target.value }))}
              className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all"
            >
              <option value="IN">India (IN)</option>
              <option value="US">United States (US)</option>
              <option value="EP">European Patent (EP)</option>
              <option value="WO">PCT (WO)</option>
            </select>
          </div>

          {/* Error Display */}
          <AnimatePresence>
            {searchState.error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Alert variant="destructive" className="rounded-xl">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{searchState.error}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Start Button */}
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
            <Button
              onClick={startNoveltySearch}
              disabled={searchState.isLoading}
              className="w-full h-14 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold text-base shadow-lg shadow-indigo-500/30 transition-all"
            >
              {searchState.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Initializing AI Analysis...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-5 w-5" />
                  Start Novelty Search
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );

  // ============================================================================
  // RENDER PROGRESS (Active State)
  // ============================================================================
  const renderProgress = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Status Card */}
      <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                searchState.status === NoveltySearchStatus.COMPLETED 
                  ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' 
                  : searchState.status === NoveltySearchStatus.FAILED
                  ? 'bg-gradient-to-br from-rose-400 to-rose-600'
                  : 'bg-gradient-to-br from-indigo-400 to-purple-500'
              }`}>
                {searchState.status === NoveltySearchStatus.COMPLETED ? (
                  <CheckCircle className="h-5 w-5 text-white" />
                ) : searchState.status === NoveltySearchStatus.FAILED ? (
                  <XCircle className="h-5 w-5 text-white" />
                ) : searchState.isLoading ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Search className="h-5 w-5 text-white" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">{currentStageInfo.label}</div>
                <div className="text-xs text-slate-500">Search ID: {searchState.searchId?.slice(0, 12)}...</div>
              </div>
            </div>

            {/* Auto Mode Toggle */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Auto</span>
                <button
                  type="button"
                  onClick={() => setAutoMode(prev => !prev)}
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                    autoMode ? 'bg-indigo-500' : 'bg-slate-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                    autoMode ? 'translate-x-4' : 'translate-x-0.5'
                  } mt-0.5`} />
                </button>
              </div>

              <Badge 
                variant="outline" 
                className={`text-xs ${
                  searchState.status === NoveltySearchStatus.COMPLETED 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : searchState.status === NoveltySearchStatus.FAILED
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}
              >
                {currentStageInfo.progress}% Complete
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Processing Messages */}
      <AnimatePresence>
        {(isStage1Simulating || isStage35Simulating || isStage35aSimulating) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card className="border-0 shadow-lg overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <motion.div 
                      className="w-12 h-12 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-xl flex items-center justify-center shadow-lg"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    >
                      <Sparkles className="w-6 h-6 text-white" />
                    </motion.div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900 mb-1">
                      {isStage1Simulating ? 'Advanced Patent Intelligence Analysis' : 
                       isStage35aSimulating ? 'Feature Mapping' : 'Feature Analysis'}
                    </div>
                    <div className="text-sm text-slate-700">
                      {stage1Message || stage35Message || stage35aMessage}
                    </div>
                    <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 10, ease: 'linear' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Display */}
      <AnimatePresence>
        {searchState.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Alert variant="destructive" className="rounded-xl border-rose-200 bg-rose-50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{searchState.error}</AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // ============================================================================
  // RENDER STAGE CONTENT
  // ============================================================================
  const renderStageContent = () => {
    switch (selectedStageTab) {
      case '0':
        return renderStage0Content();
      case '1':
        return renderStage1Content();
      case '1.5':
        return renderStage15Content();
      case '3.5':
        return renderStage35Content();
      case '3.5c':
        return renderStage35cContent();
      case '4':
        return renderStage4Content();
      case '5':
        return renderStage5Content();
      default:
        return null;
    }
  };

  // Stage 0 Content
  const renderStage0Content = () => {
    const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
    const hasS0 = !!(s0.searchQuery || (Array.isArray(s0.inventionFeatures) && s0.inventionFeatures.length > 0));

    if (!hasS0) return null;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Idea Setup & Query Generation</CardTitle>
                  <CardDescription>
                    {isEditingStage0 ? 'Edit search query and features before proceeding' : 'Search query and feature extraction completed'}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
                  <Badge className={stage0Approved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                    {stage0Approved ? 'Approved' : 'Awaiting approval'}
                  </Badge>
                )}
                {!isEditingStage0 && searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
                  <Button onClick={startEditingStage0} variant="outline" size="sm" className="rounded-lg">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingStage0 ? (
              <div className="space-y-6">
                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2">Search Query</Label>
                  <Textarea
                    value={editedSearchQuery}
                    onChange={(e) => setEditedSearchQuery(e.target.value)}
                    placeholder="Enter search query..."
                    className="min-h-[80px] rounded-xl"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2">
                    Invention Features ({editedFeatures.length})
                  </Label>
                  <div className="space-y-2 mb-4">
                    {editedFeatures.map((feature: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border">
                        <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg">{idx + 1}</span>
                        {editingFeatureIndex === idx ? (
                          <Input
                            value={feature}
                            onChange={(e) => {
                              const updated = [...editedFeatures];
                              updated[idx] = e.target.value;
                              setEditedFeatures(updated);
                            }}
                            onBlur={() => setEditingFeatureIndex(null)}
                            className="flex-1 rounded-lg"
                            autoFocus
                          />
                        ) : (
                          <span className="text-sm text-slate-700 flex-1">{feature}</span>
                        )}
                        <div className="flex gap-1">
                          <Button onClick={() => startEditingFeature(idx)} variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button onClick={() => removeFeature(idx)} variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600">
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={newFeatureText}
                      onChange={(e) => setNewFeatureText(e.target.value)}
                      placeholder="Add new feature..."
                      onKeyPress={(e) => { if (e.key === 'Enter') addFeature(); }}
                      className="rounded-xl"
                    />
                    <Button onClick={addFeature} disabled={!newFeatureText.trim()} variant="outline" size="sm" className="rounded-xl">
                      Add
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button onClick={cancelStage0Edits} variant="outline" className="rounded-xl">Cancel</Button>
                  <Button onClick={saveStage0Edits} className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600" disabled={!editedSearchQuery.trim() || editedFeatures.length === 0}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Save & Continue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-slate-900 mb-3">Search Query</h4>
                  <div className="p-4 bg-slate-50 rounded-xl border">
                    <p className="text-sm text-slate-700">"{s0.searchQuery}"</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-slate-900 mb-3">
                    Extracted Features ({Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures.length : 0})
                  </h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {Array.isArray(s0.inventionFeatures) && s0.inventionFeatures.map((feature: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border">
                        <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-1 rounded">{idx + 1}</span>
                        <span className="text-sm text-slate-700">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!isEditingStage0 && searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
              <div className="mt-6 flex justify-end">
                <Button
                  size="sm"
                  className={`rounded-xl ${stage0Approved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-indigo-500 hover:bg-indigo-600'}`}
                  onClick={async () => {
                    setStage0Approved(true);
                    // Auto-progress through all stages if autoMode is enabled
                    if (autoMode) {
                      setSelectedStageTab('1');
                      // Run all stages automatically
                      await runAllRemainingStages();
                    } else if (selectedStageTab === '0') {
                      // Just move to next tab
                      setSelectedStageTab('1');
                    }
                  }}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {stage0Approved ? 'Approved' : 'Approve Search Terms'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 1 Content
  const renderStage1Content = () => {
    const root: any = (searchState.results as any) || {};
    const pqaiResults = root.pqaiResults || root.stage1?.pqaiResults || [];
    const hasStage1 = Array.isArray(pqaiResults) && pqaiResults.length > 0;

    if (!hasStage1) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Patent Search Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Execute the patent search to find relevant prior art from our global database of 12M+ patents.
            </p>
            {canRunCurrent && selectedStageTab === '1' && (
              <Button onClick={handleRunCurrent} className="mt-6 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600">
                <Search className="w-4 h-4 mr-2" />
                Run Patent Search
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }

    const highRelevanceCount = pqaiResults.filter((p: any) => p.relevanceScore && p.relevanceScore > 0.5).length;
    const avgRelevance = pqaiResults.length > 0 ? (pqaiResults.reduce((avg: number, p: any) => avg + (p.relevanceScore || 0), 0) / pqaiResults.length * 100) : 0;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-md">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Patent Search Results</CardTitle>
                <CardDescription>Patent database search and relevance-based selection</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
                <div className="text-3xl font-bold text-blue-600">{pqaiResults.length}</div>
                <div className="text-xs text-blue-700 font-medium">Patents Found</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-100">
                <div className="text-3xl font-bold text-emerald-600">{highRelevanceCount}</div>
                <div className="text-xs text-emerald-700 font-medium">High Relevance</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                <div className="text-3xl font-bold text-purple-600">{avgRelevance.toFixed(0)}%</div>
                <div className="text-xs text-purple-700 font-medium">Avg Relevance</div>
              </div>
            </div>

            {/* Patent List */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {pqaiResults.map((r: any, i: number) => {
                const patentNumber = r.publicationNumber || r.pn || r.patent_number || 'N/A';
                const title = r.title || r.invention_title || patentNumber;
                const abstract = r.abstract || r.snippet || '';
                const pubDate = r.year || r.publication_date || '';
                const relevanceScore = r.relevanceScore || r.score || 0;

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="p-4 border rounded-xl bg-white hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <a className="font-medium text-indigo-700 hover:underline text-sm line-clamp-1" target="_blank" href={`https://lens.org/${encodeURIComponent(patentNumber)}`}>
                            {title}
                          </a>
                          <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200 flex-shrink-0">
                            {(relevanceScore * 100).toFixed(0)}%
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {patentNumber} {pubDate && `• ${String(pubDate).slice(0, 10)}`}
                        </div>
                        {abstract && (
                          <p className="text-xs text-slate-600 mt-2 line-clamp-2">{abstract}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 1.5 Content
  const renderStage15Content = () => {
    const aiRel = (searchState.results as any)?.aiRelevance || (searchState.results as any)?.stage1?.aiRelevance;
    
    if (!aiRel) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <Zap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">AI Relevance Not Computed</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Run AI relevance filtering to categorize patents by their relevance to your invention.
            </p>
          </CardContent>
        </Card>
      );
    }

    const acc = Array.isArray(aiRel.accepted) ? aiRel.accepted.length : 0;
    const bor = Array.isArray(aiRel.borderline) ? aiRel.borderline.length : 0;
    const rej = Array.isArray(aiRel.rejected) ? aiRel.rejected.length : 0;
    const total = acc + bor + rej;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-md">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">AI Relevance Analysis</CardTitle>
                  <CardDescription>Smart filtering of patent results</CardDescription>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Thresholds: High {(aiRel.thresholds?.high ?? 0.6)}, Medium {(aiRel.thresholds?.medium ?? 0.4)}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-100">
                <div className="text-3xl font-bold text-emerald-600">{acc}</div>
                <div className="text-xs text-emerald-700 font-medium">Accepted</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl border border-amber-100">
                <div className="text-3xl font-bold text-amber-600">{bor}</div>
                <div className="text-xs text-amber-700 font-medium">Borderline</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-rose-50 to-red-50 rounded-xl border border-rose-100">
                <div className="text-3xl font-bold text-rose-600">{rej}</div>
                <div className="text-xs text-rose-700 font-medium">Rejected</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                <div className="text-3xl font-bold text-indigo-600">{total}</div>
                <div className="text-xs text-indigo-700 font-medium">Total</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  Accepted Patents
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Array.isArray(aiRel.accepted) && aiRel.accepted.slice(0, 10).map((pn: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 p-2 bg-emerald-50 rounded">{pn}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Borderline Patents
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Array.isArray(aiRel.borderline) && aiRel.borderline.slice(0, 10).map((pn: string, i: number) => (
                    <div key={i} className="text-xs text-slate-700 p-2 bg-amber-50 rounded">{pn}</div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 3.5 Content - Full Feature-Patent Matrix
  const renderStage35Content = () => {
    const stage35Any: any = (searchState.results as any)?.stage35;
    const topFeatureMap = (searchState.results as any)?.feature_map;
    const items = Array.isArray(stage35Any?.feature_map) ? stage35Any.feature_map : (Array.isArray(topFeatureMap) ? topFeatureMap : []);

    if (items.length === 0) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Feature Analysis Not Started</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Run feature analysis to map your invention features to prior art evidence.
            </p>
          </CardContent>
        </Card>
      );
    }

    const presentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.present || 0), 0);
    const partialSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.partial || 0), 0);
    const absentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.absent || 0), 0);

    // Extract features from Stage 0 or from the feature_map items
    const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
    const featuresFromS0: string[] = Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures : [];
    const featuresFromMaps: string[] = Array.from(new Set(
      items.flatMap((p: any) => Array.isArray(p?.feature_analysis) ? p.feature_analysis.map((c: any) => c.feature).filter(Boolean) : [])
    ));
    const features: string[] = (featuresFromS0 && featuresFromS0.length > 0) ? featuresFromS0 : featuresFromMaps;

    // Limit for readability
    const visiblePatents = items.slice(0, 20);
    const visibleFeatures = features.slice(0, 18);

    const getStatusClass = (status: string | undefined) => {
      switch (status) {
        case 'Present': return 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200';
        case 'Partial': return 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200';
        case 'Absent': return 'bg-rose-100 text-rose-700 border-rose-300 hover:bg-rose-200';
        default: return 'bg-slate-100 text-slate-600 border-slate-300';
      }
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Feature Analysis</CardTitle>
                <CardDescription>AI-powered feature-to-patent mapping with evidence extraction</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-100">
                <div className="text-3xl font-bold text-purple-600">{items.length}</div>
                <div className="text-xs text-purple-700 font-medium">Patents Analyzed</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-100">
                <div className="text-3xl font-bold text-emerald-600">{presentSum}</div>
                <div className="text-xs text-emerald-700 font-medium">Present Features</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl border border-amber-100">
                <div className="text-3xl font-bold text-amber-600">{partialSum}</div>
                <div className="text-xs text-amber-700 font-medium">Partial Features</div>
              </div>
              <div className="text-center p-4 bg-gradient-to-br from-rose-50 to-red-50 rounded-xl border border-rose-100">
                <div className="text-3xl font-bold text-rose-600">{absentSum}</div>
                <div className="text-xs text-rose-700 font-medium">Absent Features</div>
              </div>
            </div>

            {/* Detailed Feature-Patent Matrix */}
            <div className="mt-6">
              <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span>Feature-Patent Matrix</span>
                <span className="text-xs font-normal text-slate-500">
                  (Click any cell to view evidence)
                </span>
              </h4>

              {features.length === 0 ? (
                <p className="text-sm text-slate-500">No feature mapping data available to display.</p>
              ) : (
                <div className="overflow-auto rounded-xl border border-slate-200 shadow-sm">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gradient-to-r from-slate-50 to-slate-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-3 text-left font-semibold text-slate-700 border-b border-slate-200 w-44 bg-slate-50">
                          Patent
                        </th>
                        {visibleFeatures.map((f: string, idx: number) => (
                          <th key={idx} className="px-2 py-3 text-left font-medium text-slate-700 border-b border-slate-200 min-w-[120px] max-w-[160px]">
                            <div className="flex items-start gap-1">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex-shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-xs leading-tight break-words line-clamp-2" title={f}>{f}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {visiblePatents.map((patent: any, rowIdx: number) => {
                        const pn = patent.pn || patent.publicationNumber || patent.patent_number || patent.publication_number || 'N/A';
                        const cellsArray = Array.isArray(patent.feature_analysis)
                          ? patent.feature_analysis
                          : [
                              ...Array.isArray(patent.present) ? patent.present : [],
                              ...Array.isArray(patent.partial) ? patent.partial : [],
                              ...Array.isArray(patent.absent) ? patent.absent : []
                            ];
                        const featureToStatus = new Map<string, string>();
                        for (const c of cellsArray) {
                          if (c && typeof c.feature === 'string' && c.feature) {
                            featureToStatus.set(c.feature, c.status || 'Unknown');
                          }
                        }

                        return (
                          <tr key={rowIdx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-3 py-3 align-top border-r border-slate-100">
                              <div className="flex items-start gap-2">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold flex-shrink-0">
                                  {rowIdx + 1}
                                </span>
                                <div>
                                  <div className="font-medium text-slate-900 text-xs">{pn}</div>
                                  {patent.title && (
                                    <div className="text-[10px] text-slate-500 mt-0.5 max-w-[140px] truncate" title={patent.title}>
                                      {patent.title}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {visibleFeatures.map((f: string, colIdx: number) => {
                              const status = featureToStatus.get(f) || 'Unknown';
                              // Find full cell object for tooltip/details
                              const cellObj = (() => {
                                const byExact = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature === f);
                                if (byExact) return byExact;
                                const byLower = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature.toLowerCase() === f.toLowerCase());
                                return byLower || null;
                              })();

                              const quote = (cellObj && (cellObj.quote || cellObj.evidence)) ? String(cellObj.quote || cellObj.evidence) : '';
                              const reason = cellObj && cellObj.reason ? String(cellObj.reason) : '';
                              const field = cellObj && cellObj.field ? String(cellObj.field) : undefined;
                              const confidence = (cellObj && typeof cellObj.confidence === 'number') ? cellObj.confidence : undefined;
                              const link = (patent.link || (pn && `https://patents.google.com/patent/${pn}`)) as string | undefined;

                              const tooltip = (() => {
                                if (status === 'Present' || status === 'Partial') {
                                  const snip = quote ? (quote.length > 160 ? quote.slice(0, 157) + '…' : quote) : 'No evidence provided';
                                  const conf = (typeof confidence === 'number') ? ` • ${confidence.toFixed(2)}` : '';
                                  const fld = field ? ` (${field})` : '';
                                  return `${status}${conf}${fld}: "${snip}"`;
                                }
                                if (status === 'Absent') {
                                  const r = reason || 'No direct evidence in title/abstract';
                                  return `${status}: ${r}`;
                                }
                                return 'Unknown: No analysis available';
                              })();

                              return (
                                <td key={colIdx} className="px-2 py-2 align-middle">
                                  <button
                                    type="button"
                                    title={tooltip}
                                    onClick={() => setSelectedEvidence({
                                      pn,
                                      patentTitle: patent.title,
                                      feature: f,
                                      status,
                                      quote: quote || undefined,
                                      reason: reason || undefined,
                                      field,
                                      confidence,
                                      link
                                    })}
                                    className={`
                                      w-full text-center cursor-pointer 
                                      text-[10px] font-medium px-2 py-1.5 rounded-lg border 
                                      transition-all duration-150 
                                      ${getStatusClass(status)}
                                    `}
                                  >
                                    {status === 'Present' ? '✓ Present' : 
                                     status === 'Partial' ? '◐ Partial' : 
                                     status === 'Absent' ? '✗ Absent' : '? Unknown'}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  
                  {/* Table Footer with Legend */}
                  {(items.length > visiblePatents.length || features.length > visibleFeatures.length) && (
                    <div className="p-3 text-xs text-slate-500 border-t bg-slate-50">
                      Showing {visiblePatents.length}/{items.length} patents and {visibleFeatures.length}/{features.length} features.
                    </div>
                  )}
                  <div className="p-3 text-xs text-slate-600 flex items-center gap-4 border-t bg-white">
                    <span className="font-medium text-slate-700">Legend:</span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-emerald-500"></span>
                      Present
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-amber-500"></span>
                      Partial
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-rose-500"></span>
                      Absent
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-slate-400"></span>
                      Unknown
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Per-Patent Remarks from Stage 3.5a (if available) */}
            {Array.isArray(items) && items.some((p: any) => p.remarks) && (
              <div className="mt-6">
                <h4 className="font-semibold text-slate-900 mb-3">Per-Patent Remarks</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {items
                    .filter((p: any) => p.remarks)
                    .map((p: any, idx: number) => (
                      <div key={p.pn || idx} className="rounded-xl border bg-slate-50 p-3">
                        <div className="flex items-start gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-bold flex-shrink-0">
                            {idx + 1}
                          </span>
                          <div className="flex-1">
                            <div className="text-xs font-semibold text-slate-900">{p.pn || 'Unknown PN'}</div>
                            {p.title && (
                              <div className="text-[10px] text-slate-600 truncate" title={p.title}>{p.title}</div>
                            )}
                            <div className="mt-1.5 text-xs text-slate-700 whitespace-pre-wrap">{p.remarks}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 3.5c Content - Detailed Prior Art Analysis with Novelty Lines
  const renderStage35cContent = () => {
    const root: any = (searchState.results as any) || {};
    const container = root.stage4 || root;
    const remarks: any[] = Array.isArray(container?.per_patent_remarks) ? container.per_patent_remarks : [];

    if (remarks.length === 0) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Patent Remarks Not Generated</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Generate patent-by-patent analysis to create detailed prior art assessment for inventor review.
            </p>
          </CardContent>
        </Card>
      );
    }

    // Helper to get novelty line color and width based on threat level and relevance
    const getNoveltyLineStyle = (patent: any) => {
      const relevance = typeof patent.relevance === 'number' ? patent.relevance : 0.5;
      const threat = patent.novelty_threat || patent.decision || 'unknown';
      
      // Color based on novelty threat level
      const threatColors: Record<string, string> = {
        anticipates: 'bg-red-500',
        obvious: 'bg-orange-400',
        adjacent: 'bg-yellow-400',
        remote: 'bg-emerald-400',
        novel: 'bg-emerald-500',
        partial_novelty: 'bg-amber-400',
        unknown: 'bg-slate-300'
      };
      
      const color = threatColors[threat] || threatColors.unknown;
      const width = Math.round(relevance * 100);
      
      return { color, width, relevance };
    };

    // Helper to get threat label
    const getThreatLabel = (threat: string) => {
      const labels: Record<string, { text: string; color: string }> = {
        anticipates: { text: 'High Risk - Anticipates', color: 'text-red-600 bg-red-50 border-red-200' },
        obvious: { text: 'Moderate Risk - Obviousness', color: 'text-orange-600 bg-orange-50 border-orange-200' },
        adjacent: { text: 'Low Risk - Adjacent Art', color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
        remote: { text: 'Minimal Risk - Remote', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
        novel: { text: 'Novel', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
        partial_novelty: { text: 'Partial Novelty', color: 'text-amber-600 bg-amber-50 border-amber-200' }
      };
      return labels[threat] || { text: 'Unassessed', color: 'text-slate-500 bg-slate-50 border-slate-200' };
    };

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Detailed Prior Art Analysis</CardTitle>
                  <CardDescription>{remarks.length} patents analyzed for inventor review</CardDescription>
                </div>
              </div>
              {/* Legend */}
              <div className="hidden md:flex items-center gap-4 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-slate-500">Anticipates</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-orange-400"></div>
                  <span className="text-slate-500">Obvious</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <span className="text-slate-500">Adjacent</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                  <span className="text-slate-500">Remote/Novel</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {remarks.map((patent: any, idx: number) => {
                const lineStyle = getNoveltyLineStyle(patent);
                const threatInfo = getThreatLabel(patent.novelty_threat || patent.decision);
                const detailed = patent.detailedAnalysis || {};
                const relevantParts = Array.isArray(detailed.relevant_parts) ? detailed.relevant_parts : [];
                const irrelevantParts = Array.isArray(detailed.irrelevant_parts) ? detailed.irrelevant_parts : [];
                const noveltyComparison = detailed.novelty_comparison || '';

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="bg-white hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Novelty Line Indicator - Horizontal colored line at top */}
                    <div className="h-1.5 bg-slate-100 relative overflow-hidden">
                      <div 
                        className={`h-full ${lineStyle.color} transition-all duration-500`}
                        style={{ width: `${lineStyle.width}%` }}
                      />
                    </div>
                    
                    <div className="p-5">
                      {/* Header Row */}
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <a 
                                href={`https://patents.google.com/patent/${(patent.pn || '').replace(/\s+/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
                              >
                                {patent.pn || 'Unknown PN'}
                              </a>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${threatInfo.color}`}>
                                {threatInfo.text}
                              </span>
                            </div>
                            {patent.title && (
                              <p className="text-sm text-slate-600 mt-1 line-clamp-2">{patent.title}</p>
                            )}
                          </div>
                        </div>
                        
                        {/* Relevance Score */}
                        <div className="text-right flex-shrink-0">
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Relevance</div>
                          <div className="text-lg font-bold text-slate-900">{Math.round(lineStyle.relevance * 100)}%</div>
                        </div>
                      </div>

                      {/* Summary */}
                      {(patent.summary || patent.remarks) && (
                        <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                          <p className="text-sm text-slate-700">{patent.summary || patent.remarks}</p>
                        </div>
                      )}

                      {/* Detailed Analysis Section */}
                      {(relevantParts.length > 0 || irrelevantParts.length > 0 || noveltyComparison) && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 select-none">
                            <span>View Detailed Analysis</span>
                            <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </summary>
                          
                          <div className="mt-4 space-y-4">
                            {/* Overlapping Elements */}
                            {relevantParts.length > 0 && (
                              <div className="rounded-lg border border-red-100 bg-red-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-red-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span>Overlapping Elements (Action Required)</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {relevantParts.map((part: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                      <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>
                                      <span>{part}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Your Differentiators */}
                            {irrelevantParts.length > 0 && (
                              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                  <span>Your Differentiators (Claim Focus Points)</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {irrelevantParts.map((part: string, i: number) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                      <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                                      <span>{part}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Novelty Comparison */}
                            {noveltyComparison && (
                              <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                                <div className="flex items-center gap-2 text-xs font-medium text-blue-700 mb-2">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                                  </svg>
                                  <span>Novelty Assessment</span>
                                </div>
                                <p className="text-xs text-slate-700">{noveltyComparison}</p>
                              </div>
                            )}
                          </div>
                        </details>
                      )}

                      {/* Feature Summary Row */}
                      {(patent.overlap_features?.length > 0 || patent.missing_features?.length > 0) && (
                        <div className="mt-4 flex flex-wrap gap-3 text-[10px]">
                          {patent.overlap_features?.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">Overlapping:</span>
                              <span className="font-medium text-red-600">{patent.overlap_features.length} feature(s)</span>
                            </div>
                          )}
                          {patent.missing_features?.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">Unique to invention:</span>
                              <span className="font-medium text-emerald-600">{patent.missing_features.length} feature(s)</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Stage 4 Content
  const renderStage4Content = () => {
    const root: any = (searchState.results as any) || {};
    const r = root.stage4 || root;

    if (!r || !hasStage4Results) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Final Report Not Generated</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Generate the final novelty assessment report with comprehensive analysis and recommendations.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Stage4ResultsDisplay
        stage4Results={r}
        searchId={searchState.searchId as any}
        onRerun={async () => {
          await executeStage('4');
        }}
        hideIdeaBank={true}
      />
    );
  };

  // Stage 5 Content - Download Report
  const renderStage5Content = () => {
    if (!hasStage4Results) {
      return (
        <Card className="border-0 shadow-lg bg-slate-50/50">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Report Not Ready</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Complete the Final Report stage first to generate the downloadable report.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Professional Report</CardTitle>
              <CardDescription>Download your comprehensive novelty assessment</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Report Preview */}
          <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900">{formData.title || 'Novelty Assessment Report'}</h3>
                <p className="text-sm text-slate-500">Generated by PatentNest.ai</p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700">Ready</Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 uppercase tracking-wider">Patents Analyzed</div>
                <div className="text-xl font-bold text-slate-900">{stage1Results.length}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 uppercase tracking-wider">Search ID</div>
                <div className="text-sm font-mono text-slate-700">{searchState.searchId?.slice(0, 12)}...</div>
              </div>
            </div>

            <div className="space-y-3">
              {/* View Consolidated Report */}
              <Link
                href={`/novelty-search/${searchState.searchId}/consolidated`}
                target="_blank"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all font-medium"
              >
                <Eye className="w-4 h-4" />
                View Full Report
              </Link>
              
              {/* Download PDF Instructions */}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-amber-900 mb-1">Download as PDF</h4>
                    <p className="text-xs text-amber-700">
                      Click "View Full Report" above, then use <kbd className="px-1.5 py-0.5 bg-amber-100 rounded text-amber-800 font-mono">Ctrl+P</kbd> (or <kbd className="px-1.5 py-0.5 bg-amber-100 rounded text-amber-800 font-mono">Cmd+P</kbd> on Mac) to print/save as PDF with our PatentNest branding.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Share Options */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Share with Inventors
            </h4>
            <p className="text-sm text-slate-600 mb-3">
              Generate a public link to share this report with inventors or colleagues.
            </p>
            <Link
              href={`/novelty-search/${searchState.searchId}/consolidated`}
              target="_blank"
              className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Open Consolidated Report →
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Background Pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-30">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(148 163 184 / 0.3) 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }} />
      </div>

      <div className="relative flex">
        {/* Left Navigation Sidebar */}
        <div className="w-[280px] min-h-screen p-4 sticky top-0">
          <NoveltyStageNav
            selectedStage={selectedStageTab}
            onStageSelect={setSelectedStageTab}
            getStageStatus={getStageStatus}
            isStageCompleted={isStageCompleted}
            onRunStage={runStageForKey}
            activeExecutionStage={activeExecutionStage}
            searchId={searchState.searchId}
            overallProgress={overallProgress}
            formTitle={formData.title}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 p-6 max-w-4xl">
          {/* Compact Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div
                  className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-md"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                >
                  <Sparkles className="w-4 h-4 text-white" />
                </motion.div>
                <div>
                  <div className="text-sm font-medium text-slate-700">{STAGE_TAB_LABELS[selectedStageTab]}</div>
                  <div className="text-xs text-slate-500">Stage {idx + 1} of {STAGE_TABS.length}</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {!searchState.searchId ? (
              <motion.div key="form" exit={{ opacity: 0, x: -20 }}>
                {renderForm()}
              </motion.div>
            ) : (
              <motion.div key="workflow" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                {renderProgress()}
                {renderStageContent()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Floating Navigation Buttons */}
      {searchState.searchId && (
        <NoveltyFloatingButtons
          onPrevious={prevStage ? handlePrevNav : null}
          onNext={nextStage ? handleNextNav : null}
          onRunCurrent={canRunCurrent ? handleRunCurrent : null}
          previousLabel={prevStage ? STAGE_TAB_LABELS[prevStage] : undefined}
          nextLabel={nextStage ? STAGE_TAB_LABELS[nextStage] : undefined}
          currentStageLabel={`Run ${STAGE_TAB_LABELS[selectedStageTab]}`}
          isRunning={!!activeExecutionStage}
          isFailed={isFailedCurrent}
          disabled={searchState.isLoading}
        />
      )}

      {/* Evidence Panel Modal */}
      <AnimatePresence>
        {selectedEvidence && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedEvidence(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs text-slate-500">Evidence</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {selectedEvidence.feature}
                  </div>
                  <div className="text-sm text-slate-600 mt-1">
                    Patent: {selectedEvidence.pn}{selectedEvidence.patentTitle ? ` • ${selectedEvidence.patentTitle}` : ''}
                  </div>
                </div>
                <Badge className={`${
                  selectedEvidence.status === 'Present' ? 'bg-emerald-100 text-emerald-700' :
                  selectedEvidence.status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                  'bg-rose-100 text-rose-700'
                }`}>
                  {selectedEvidence.status}
                </Badge>
              </div>

              {(selectedEvidence.status === 'Present' || selectedEvidence.status === 'Partial') && selectedEvidence.quote && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 mb-2">Evidence Quote</div>
                  <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700 whitespace-pre-wrap">
                    "{selectedEvidence.quote}"
                  </div>
                </div>
              )}

              {selectedEvidence.status === 'Absent' && selectedEvidence.reason && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 mb-2">Reason</div>
                  <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
                    {selectedEvidence.reason}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-6">
                {selectedEvidence.link && (
                  <a
                    href={selectedEvidence.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Patent
                  </a>
                )}
                <Button variant="outline" onClick={() => setSelectedEvidence(null)} className="ml-auto rounded-lg">
                  Close
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
