'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CitationManager from '@/components/paper/CitationManager';
import { useToast } from '@/components/ui/toast';
import { DocumentUploadDialog } from '@/components/library/DocumentUploadDialog';

interface LiteratureSearchStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  stageMode?: 'literature_search' | 'full_text_evidence_extraction';
}

type SearchQueryCategory =
  | 'CORE_CONCEPTS'
  | 'DOMAIN_APPLICATION'
  | 'METHODOLOGY'
  | 'THEORETICAL_FOUNDATION'
  | 'SURVEYS_REVIEWS'
  | 'COMPETING_APPROACHES'
  | 'RECENT_ADVANCES'
  | 'GAP_IDENTIFICATION'
  | 'CUSTOM';

interface SearchStrategyQuery {
  id: string;
  queryText: string;
  category: SearchQueryCategory;
  description: string;
  priority: number;
  suggestedSources: string[];
  suggestedYearFrom: number | null;
  suggestedYearTo: number | null;
  status: 'PENDING' | 'SEARCHING' | 'SEARCHED' | 'COMPLETED' | 'SKIPPED';
  importedCount: number | null;
  resultsCount: number | null;
}

interface SearchStrategyData {
  id: string;
  status: 'DRAFT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED';
  summary: string | null;
  estimatedPapers: number | null;
  progress: number;
  completedQueries: number;
  totalQueries: number;
  queries: SearchStrategyQuery[];
}

interface SearchStrategyEditorState {
  queryText: string;
  description: string;
  category: SearchQueryCategory;
  suggestedSources: string[];
  suggestedYearFrom: string;
  suggestedYearTo: string;
}

type MappingConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
type EvidenceKind = 'DIRECT_QUOTE' | 'PARAPHRASE' | 'INFERRED';
type EvidenceSpecificity = 'HIGH' | 'MEDIUM' | 'LOW';

interface CoverageEvidenceRow {
  id: string;
  paperId: string;
  paperTitle: string;
  sectionKey: string;
  dimension: string;
  dimensionKey: string;
  remark: string;
  confidence: MappingConfidence;
  evidenceKind: EvidenceKind;
  hasLocation: boolean;
  locationLabel: string;
  specificity: EvidenceSpecificity;
  rubricScore: number;
  rubricBand: 'high' | 'medium' | 'low';
  authors: string[];
  year: number | null;
  venue: string;
  publisher: string;
  pages: string;
  doi: string;
  url: string;
  affiliationText: string;
}

interface CoverageRowFeedback {
  inclusionStatus: 'INCLUDED' | 'EXCLUDED';
  reviewComment: string;
}

interface MappingReviewRecord {
  id: string;
  citationId: string;
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: MappingConfidence;
  mappingSource: string;
  inclusionStatus: 'INCLUDED' | 'EXCLUDED';
  reviewComment: string;
}

interface CoverageSectionOption {
  sectionKey: string;
  sectionTitle: string;
  dimensions: string[];
}

const normalizeCoverageToken = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const buildDimensionKey = (sectionKey: string, dimension: string): string =>
  `${normalizeCoverageToken(sectionKey)}::${normalizeCoverageToken(dimension)}`;

const deriveEvidenceKind = (remark: string): EvidenceKind => {
  const text = remark.trim();
  if (!text) return 'INFERRED';
  if (text.includes('"') || text.includes("'")) return 'DIRECT_QUOTE';
  if (/\b(abstract|reports?|shows?|states?|finds?|demonstrates?)\b/i.test(text)) {
    return 'PARAPHRASE';
  }
  return 'INFERRED';
};

const hasLocationSignal = (remark: string, paper: any): boolean => {
  if (paper?.pages) return true;
  return /\b(p\.?|pp\.?|page|section|sec\.|chapter|table|figure)\s*[A-Za-z0-9-]*/i.test(remark);
};

const extractLocationLabel = (remark: string, paper: any): string => {
  if (typeof paper?.pages === 'string' && paper.pages.trim()) {
    return `Pages ${paper.pages.trim()}`;
  }
  const locationMatch = remark.match(/\b(p\.?|pp\.?|page|section|sec\.|chapter|table|figure)\s*([A-Za-z0-9.\-]+)/i);
  if (!locationMatch) return 'Location not provided';
  const locationType = locationMatch[1].replace(/\.$/, '');
  const locationValue = locationMatch[2];
  return `${locationType} ${locationValue}`;
};

const deriveSpecificity = (remark: string): EvidenceSpecificity => {
  const text = remark.trim();
  if (!text) return 'LOW';

  const hasNumericDetail = /\d/.test(text);
  const hasComparator = /\b(compared|versus|outperforms|improves|reduces|increases|benchmark)\b/i.test(text);
  const hasLength = text.length >= 120;

  if ((hasNumericDetail && hasComparator) || (hasNumericDetail && hasLength)) {
    return 'HIGH';
  }
  if (hasNumericDetail || hasComparator || text.length >= 70) {
    return 'MEDIUM';
  }
  return 'LOW';
};

const computeRubricScore = (
  confidence: MappingConfidence,
  evidenceKind: EvidenceKind,
  hasLocation: boolean,
  specificity: EvidenceSpecificity
): number => {
  const confidenceScore = confidence === 'HIGH' ? 58 : confidence === 'MEDIUM' ? 42 : 28;
  const kindScore = evidenceKind === 'DIRECT_QUOTE' ? 20 : evidenceKind === 'PARAPHRASE' ? 12 : 6;
  const locationScore = hasLocation ? 12 : 0;
  const specificityScore = specificity === 'HIGH' ? 10 : specificity === 'MEDIUM' ? 6 : 2;

  return Math.min(100, confidenceScore + kindScore + locationScore + specificityScore);
};

const rubricBandFromScore = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

const SOURCE_OPTIONS = [
  { value: 'google_scholar', label: 'Google Scholar', description: 'Broad academic search' },
  { value: 'semantic_scholar', label: 'Semantic Scholar', description: 'Rich abstracts & citations' },
  { value: 'crossref', label: 'CrossRef', description: 'Authoritative DOI data' },
  { value: 'openalex', label: 'OpenAlex', description: 'Open academic graph' },
  { value: 'pubmed', label: 'PubMed', description: 'Biomedical literature (NCBI)' },
  { value: 'arxiv', label: 'arXiv', description: 'Preprints & open access' },
  { value: 'core', label: 'CORE', description: 'Open access aggregator' }
];

const SOURCE_ABSTRACT_SUPPORT: Record<string, boolean> = {
  google_scholar: false, // Only snippets
  semantic_scholar: true, // Full abstracts
  crossref: true, // Sometimes has abstracts
  pubmed: true, // Full abstracts
  arxiv: true, // Full abstracts
  core: true, // Full abstracts
  openalex: true, // Full abstracts (reconstructed)
};

// Publication type options for filtering
const PUBLICATION_TYPE_OPTIONS = [
  { value: 'journal-article', label: 'Journal Article', icon: '📄' },
  { value: 'conference-paper', label: 'Conference Paper', icon: '🎤' },
  { value: 'preprint', label: 'Preprint', icon: '📝' },
  { value: 'book-chapter', label: 'Book Chapter', icon: '📖' },
  { value: 'book', label: 'Book', icon: '📚' },
  { value: 'review', label: 'Review', icon: '🔍' },
  { value: 'thesis', label: 'Thesis/Dissertation', icon: '🎓' },
];

// Field of study options
const FIELD_OF_STUDY_OPTIONS = [
  { value: 'computer-science', label: 'Computer Science' },
  { value: 'medicine', label: 'Medicine' },
  { value: 'biology', label: 'Biology' },
  { value: 'physics', label: 'Physics' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'economics', label: 'Economics' },
  { value: 'psychology', label: 'Psychology' },
  { value: 'environmental-science', label: 'Environmental Science' },
];

// Provider filter support mapping - which filters each source supports
const PROVIDER_FILTER_SUPPORT: Record<string, {
  publicationTypes: boolean;
  openAccessOnly: boolean;
  minCitations: boolean;
  fieldsOfStudy: boolean;
}> = {
  google_scholar: { publicationTypes: false, openAccessOnly: false, minCitations: false, fieldsOfStudy: false },
  semantic_scholar: { publicationTypes: true, openAccessOnly: true, minCitations: true, fieldsOfStudy: true },
  crossref: { publicationTypes: true, openAccessOnly: false, minCitations: false, fieldsOfStudy: false },
  openalex: { publicationTypes: true, openAccessOnly: true, minCitations: true, fieldsOfStudy: true },
  pubmed: { publicationTypes: true, openAccessOnly: true, minCitations: false, fieldsOfStudy: true },
  arxiv: { publicationTypes: false, openAccessOnly: false, minCitations: false, fieldsOfStudy: true },
  core: { publicationTypes: true, openAccessOnly: false, minCitations: false, fieldsOfStudy: true },
};

// Intelligent loading messages that rotate while searching
const SEARCH_LOADING_MESSAGES = [
  { text: 'Querying academic databases...', icon: '🔍' },
  { text: 'Searching Semantic Scholar for relevant papers...', icon: '📚' },
  { text: 'Cross-referencing citations in CrossRef...', icon: '🔗' },
  { text: 'Analyzing OpenAlex knowledge graph...', icon: '🧠' },
  { text: 'Matching keywords to research topics...', icon: '🎯' },
  { text: 'Filtering by publication year and venue...', icon: '📅' },
  { text: 'Ranking results by citation impact...', icon: '📊' },
  { text: 'Extracting abstracts and metadata...', icon: '📝' },
  { text: 'Deduplicating across sources...', icon: '🔄' },
  { text: 'Preparing your personalized results...', icon: '✨' },
];

const SEARCH_QUERY_CATEGORIES: Array<{ value: SearchQueryCategory; label: string }> = [
  { value: 'CORE_CONCEPTS', label: 'Core concepts' },
  { value: 'DOMAIN_APPLICATION', label: 'Domain application' },
  { value: 'METHODOLOGY', label: 'Methodology' },
  { value: 'THEORETICAL_FOUNDATION', label: 'Theoretical foundation' },
  { value: 'SURVEYS_REVIEWS', label: 'Surveys and reviews' },
  { value: 'COMPETING_APPROACHES', label: 'Competing approaches' },
  { value: 'RECENT_ADVANCES', label: 'Recent advances' },
  { value: 'GAP_IDENTIFICATION', label: 'Gap identification' },
  { value: 'CUSTOM', label: 'Custom' }
];

type PdfStatusValue = 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';
type DeepAnalysisRecommendation = 'DEEP_ANCHOR' | 'DEEP_SUPPORT' | 'DEEP_STRESS_TEST' | 'LIT_ONLY';
type DeepAnalysisFilterValue = 'ALL' | DeepAnalysisRecommendation;
type ImportDecisionFilterValue = 'ALL' | 'IMPORT' | 'MAYBE' | 'SKIP';
type PasteTextFormat = 'plain' | 'html';

interface PdfActionModalPaper {
  id: string;
  title: string;
  referenceId: string;
}

interface PaperPdfActionResult {
  success: boolean;
  errorCode?: string;
  docId?: string;
}

const normalizePdfStatusValue = (value: unknown): PdfStatusValue => {
  if (value === 'UPLOADED' || value === 'PARSING' || value === 'READY' || value === 'FAILED') {
    return value;
  }
  return 'NONE';
};

const PDF_STATUS_PRIORITY: Record<PdfStatusValue, number> = {
  NONE: 0,
  FAILED: 1,
  UPLOADED: 2,
  PARSING: 3,
  READY: 4,
};

const preferredPdfStatus = (current: unknown, incoming: unknown): PdfStatusValue => {
  const currentNormalized = normalizePdfStatusValue(current);
  const incomingNormalized = normalizePdfStatusValue(incoming);
  return PDF_STATUS_PRIORITY[incomingNormalized] > PDF_STATUS_PRIORITY[currentNormalized]
    ? incomingNormalized
    : currentNormalized;
};

export default function LiteratureSearchStage({
  sessionId,
  authToken,
  onSessionUpdated,
  stageMode = 'literature_search'
}: LiteratureSearchStageProps) {
  const { showToast } = useToast();
  const isFullTextEvidenceMode = stageMode === 'full_text_evidence_extraction';
  const [query, setQuery] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [sources, setSources] = useState<string[]>(['semantic_scholar', 'crossref', 'openalex']);
  const [results, setResults] = useState<any[]>([]);
  const [deletedResultIds, setDeletedResultIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [citations, setCitations] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [bibtexInput, setBibtexInput] = useState('');
  const [doiInput, setDoiInput] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);
  
  // Enhanced filter state
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [publicationTypes, setPublicationTypes] = useState<string[]>([]);
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [minCitations, setMinCitations] = useState('');
  const [fieldsOfStudy, setFieldsOfStudy] = useState<string[]>([]);
  
  // Expandable abstracts
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());
  
  // AbortController for cancelling in-flight search requests
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  
  // Add Citations mode: 'search' | 'library' | 'import'
  const [addMode, setAddMode] = useState<'search' | 'library' | 'import'>('search');
  
  // Manual entry modal
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  
  // Gap Analysis modal
  const [gapModalOpen, setGapModalOpen] = useState(false);
  
  // Citations panel - search and selection
  const [citationSearch, setCitationSearch] = useState('');
  const [selectedCitations, setSelectedCitations] = useState<Set<string>>(new Set());
  const [exportingBibtex, setExportingBibtex] = useState(false);
  
  // Libraries for "Save to Library" feature
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [saveToLibraryResult, setSaveToLibraryResult] = useState<{ resultId: string; success: boolean; libraryName: string } | null>(null);

  // Track all search run IDs for accumulated results
  const [searchRunIds, setSearchRunIds] = useState<string[]>([]);
  
  // AI Relevance Suggestion feature with enhanced citation metadata
  const [searchRunId, setSearchRunId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, { 
    isRelevant: boolean; 
    score: number; 
    reasoning: string;
    recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
    deepAnalysisRecommendation?: DeepAnalysisRecommendation;
    deepAnalysisRationale?: string;
    citationMeta?: {
      keyContribution: string;
      keyFindings: string;
      methodologicalApproach: string | null;
      relevanceToResearch: string;
      limitationsOrGaps: string | null;
      usage: {
        introduction: boolean;
        literatureReview: boolean;
        methodology: boolean;
        comparison: boolean;
      };
    };
  }>>(new Map());
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiReviewStatus, setAiReviewStatus] = useState<{
    total: number;
    reviewed: number;
    inProcess: number;
    retry: number;
  } | null>(null);
  const [bulkAddingSuggested, setBulkAddingSuggested] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pdfRetrievalRunning, setPdfRetrievalRunning] = useState(false);
  const [pdfRetrievalByPaper, setPdfRetrievalByPaper] = useState<Set<string>>(new Set());
  const [pdfRetrievalSummary, setPdfRetrievalSummary] = useState<string | null>(null);
  const [pdfLinkModalPaper, setPdfLinkModalPaper] = useState<PdfActionModalPaper | null>(null);
  const [pasteTextModalPaper, setPasteTextModalPaper] = useState<PdfActionModalPaper | null>(null);
  const [pdfUploadModalPaper, setPdfUploadModalPaper] = useState<PdfActionModalPaper | null>(null);
  const [fullTextModalPaper, setFullTextModalPaper] = useState<PdfActionModalPaper | null>(null);
  const [fullTextModalContent, setFullTextModalContent] = useState<string>('');
  const [loadingFullTextPaper, setLoadingFullTextPaper] = useState<string | null>(null);
  const [pdfLinkUrl, setPdfLinkUrl] = useState('');
  const [pasteTextContent, setPasteTextContent] = useState('');
  const [pasteTextFormat, setPasteTextFormat] = useState<PasteTextFormat>('plain');
  const [submittingPdfLink, setSubmittingPdfLink] = useState<Set<string>>(new Set());
  const [submittingPasteText, setSubmittingPasteText] = useState<Set<string>>(new Set());
  const [paperPdfActionResults, setPaperPdfActionResults] = useState<Map<string, PaperPdfActionResult>>(new Map());
  
  // Hide non-relevant papers feature
  const [hideNonRelevant, setHideNonRelevant] = useState(false);
  
  // Multi-select and filter for search results
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [removedResults, setRemovedResults] = useState<Set<string>>(new Set());
  const [resultFilters, setResultFilters] = useState<{
    hasAbstract: boolean | null;
    source: string | null;
    yearFrom: string;
    yearTo: string;
    aiRelevantOnly: boolean;
    importDecision: ImportDecisionFilterValue;
    deepAnalysisRecommendation: DeepAnalysisFilterValue;
    publicationType: string | null;  // For Review filter
    minCitations: string;            // Citation count filter
    openAccessOnly: boolean;         // Open Access filter
  }>({
    hasAbstract: null,
    source: null,
    yearFrom: '',
    yearTo: '',
    aiRelevantOnly: false,
    importDecision: 'ALL',
    deepAnalysisRecommendation: 'ALL',
    publicationType: null,
    minCitations: '',
    openAccessOnly: false
  });
  const [showResultFilters, setShowResultFilters] = useState(false);
  
  // Pagination for search results
  const [resultsCurrentPage, setResultsCurrentPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(50);
  const RESULTS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

  const importedKeys = useMemo(() => new Set(citations.map(c => c.doi || c.title)), [citations]);
  const aiImportSuggestionIds = useMemo(() => {
    const ids = new Set<string>();
    aiSuggestions.forEach((suggestion, paperId) => {
      if (suggestion.recommendation === 'IMPORT') {
        ids.add(paperId);
      }
    });
    return ids;
  }, [aiSuggestions]);
  const aiImportSuggestionCount = aiImportSuggestionIds.size;
  const deepRelevantCount = useMemo(() => {
    let count = 0;
    aiSuggestions.forEach(suggestion => {
      if (
        suggestion.isRelevant &&
        (
          suggestion.deepAnalysisRecommendation === 'DEEP_ANCHOR' ||
          suggestion.deepAnalysisRecommendation === 'DEEP_SUPPORT' ||
          suggestion.deepAnalysisRecommendation === 'DEEP_STRESS_TEST'
        )
      ) {
        count += 1;
      }
    });
    return count;
  }, [aiSuggestions]);
  const relevantCount = useMemo(() => {
    let count = 0;
    aiSuggestions.forEach(suggestion => {
      if (suggestion.isRelevant) {
        count += 1;
      }
    });
    return count;
  }, [aiSuggestions]);
  const importDecisionCounts = useMemo(() => {
    const counts: Record<'IMPORT' | 'MAYBE' | 'SKIP', number> = {
      IMPORT: 0,
      MAYBE: 0,
      SKIP: 0
    };
    aiSuggestions.forEach(suggestion => {
      if (suggestion.recommendation === 'IMPORT' || suggestion.recommendation === 'MAYBE' || suggestion.recommendation === 'SKIP') {
        counts[suggestion.recommendation] += 1;
      }
    });
    return counts;
  }, [aiSuggestions]);
  const deepRecommendationCounts = useMemo(() => {
    const counts: Record<DeepAnalysisRecommendation, number> = {
      DEEP_ANCHOR: 0,
      DEEP_SUPPORT: 0,
      DEEP_STRESS_TEST: 0,
      LIT_ONLY: 0
    };
    aiSuggestions.forEach(suggestion => {
      const label = suggestion.deepAnalysisRecommendation;
      if (label === 'DEEP_ANCHOR' || label === 'DEEP_SUPPORT' || label === 'DEEP_STRESS_TEST' || label === 'LIT_ONLY') {
        counts[label] += 1;
      }
    });
    return counts;
  }, [aiSuggestions]);
  
  // Filtered results (applying all filters)
  const filteredResults = useMemo(() => {
    return results.filter(r => {
      // Skip removed results
      if (removedResults.has(r.id)) return false;
      
      // Hide non-import recommendations if toggle is on
      if (hideNonRelevant && aiImportSuggestionCount > 0 && !aiImportSuggestionIds.has(r.id)) return false;
      
      // AI relevant only filter
      if (resultFilters.aiRelevantOnly && !aiSuggestions.has(r.id)) return false;
      if (resultFilters.importDecision !== 'ALL') {
        const importDecision = aiSuggestions.get(r.id)?.recommendation;
        if (importDecision !== resultFilters.importDecision) return false;
      }
      if (resultFilters.deepAnalysisRecommendation !== 'ALL') {
        const deepLabel = aiSuggestions.get(r.id)?.deepAnalysisRecommendation;
        if (deepLabel !== resultFilters.deepAnalysisRecommendation) return false;
      }
      
      // Has abstract filter
      if (resultFilters.hasAbstract === true && !r.abstract) return false;
      if (resultFilters.hasAbstract === false && r.abstract) return false;
      
      // Source filter
      if (resultFilters.source && r.source !== resultFilters.source) return false;
      
      // Year filter
      if (resultFilters.yearFrom && r.year && r.year < parseInt(resultFilters.yearFrom)) return false;
      if (resultFilters.yearTo && r.year && r.year > parseInt(resultFilters.yearTo)) return false;
      
      // Publication Type filter (for Review papers)
      if (resultFilters.publicationType && r.publicationType !== resultFilters.publicationType) return false;
      
      // Minimum Citation Count filter
      if (resultFilters.minCitations) {
        const minCitations = parseInt(resultFilters.minCitations);
        if (!isNaN(minCitations) && (r.citationCount === undefined || r.citationCount < minCitations)) return false;
      }
      
      // Open Access Only filter
      if (resultFilters.openAccessOnly && !r.isOpenAccess) return false;
      
      return true;
    });
  }, [results, removedResults, hideNonRelevant, aiImportSuggestionCount, aiImportSuggestionIds, aiSuggestions, resultFilters]);
  
  // Paginated results
  const totalResultPages = Math.ceil(filteredResults.length / resultsPerPage);
  const paginatedResults = useMemo(() => {
    const startIndex = (resultsCurrentPage - 1) * resultsPerPage;
    return filteredResults.slice(startIndex, startIndex + resultsPerPage);
  }, [filteredResults, resultsCurrentPage, resultsPerPage]);
  
  // Reset to page 1 when filters or page size change
  useEffect(() => {
    setResultsCurrentPage(1);
  }, [resultFilters, results.length, resultsPerPage]);
  
  // Get unique sources from results for filter dropdown
  const availableSources = useMemo(() => {
    const sources = new Set(results.map(r => r.source));
    return Array.from(sources);
  }, [results]);
  
  // Selection handlers
  const toggleResultSelection = (id: string) => {
    setSelectedResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };
  
  const selectAllVisible = () => {
    // Select all on current page
    const visibleIds = paginatedResults.map(r => r.id);
    setSelectedResults(new Set(visibleIds));
  };
  
  const selectAllFiltered = () => {
    // Select all filtered results across all pages
    const allFilteredIds = filteredResults.map(r => r.id);
    setSelectedResults(new Set(allFilteredIds));
  };
  
  const clearSelection = () => {
    setSelectedResults(new Set());
  };
  
  // Show confirmation dialog before permanently deleting
  const removeSelected = () => {
    if (selectedResults.size === 0) return;
    setPendingDeleteIds(new Set(selectedResults));
    setDeleteConfirmOpen(true);
  };
  
  // Confirm and permanently delete selected results
  const confirmDeleteSelected = async () => {
    const deletedIds = Array.from(pendingDeleteIds);
    const resultsById = new Map(results.map(r => [r.id, r]));
    const removedByRun = new Map<string, string[]>();

    for (const id of deletedIds) {
      const runId = resultsById.get(id)?._searchRunId || searchRunId;
      if (!runId) continue;
      if (!removedByRun.has(runId)) removedByRun.set(runId, []);
      removedByRun.get(runId)!.push(id);
    }

    // Permanently remove from results array
    setResults(prev => prev.filter(r => !pendingDeleteIds.has(r.id)));
    // Also clean up from removedResults set if they were there
    setRemovedResults(prev => {
      const newSet = new Set(prev);
      pendingDeleteIds.forEach(id => newSet.delete(id));
      return newSet;
    });
    // Clear AI suggestions for deleted items
    setAiSuggestions(prev => {
      const newMap = new Map(prev);
      pendingDeleteIds.forEach(id => newMap.delete(id));
      return newMap;
    });
    // Track deleted results to avoid re-adding on new searches
    setDeletedResultIds(prev => {
      const next = new Set(prev);
      deletedIds.forEach(id => next.add(id));
      return next;
    });
    // Clear selection and close dialog
    setSelectedResults(new Set());
    setPendingDeleteIds(new Set());
    setDeleteConfirmOpen(false);

    if (authToken && removedByRun.size > 0) {
      const updatePromises = Array.from(removedByRun.entries()).map(async ([runId, ids]) => {
        const res = await fetch(`/api/papers/${sessionId}/literature/select-relevant`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            searchRunId: runId,
            removedResultIds: ids
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to persist deletions');
        }
      });

      const results = await Promise.allSettled(updatePromises);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[LiteratureSearch] Failed to persist ${failed} deletion batch(es)`);
        showToast({
          type: 'warning',
          title: 'Deletion Not Fully Saved',
          message: 'Some deletions may return after refresh. Please try again.',
          duration: 4000
        });
      }
    }
    
    showToast({
      title: 'Results deleted',
      description: `${pendingDeleteIds.size} result(s) permanently removed.`,
      variant: 'default'
    });
  };
  
  // Cancel delete operation
  const cancelDeleteSelected = () => {
    setPendingDeleteIds(new Set());
    setDeleteConfirmOpen(false);
  };
  
  const restoreAllRemoved = () => {
    setRemovedResults(new Set());
  };
  
  // Clear UI selection state when new search is performed, but PRESERVE AI analysis data
  // (relevance scores, dimension mappings, recommendations, blueprint coverage, summary)
  // because results accumulate across searches and existing AI analysis remains valid.
  const handleSearchWithReset = async () => {
    setRemovedResults(new Set());
    setSelectedResults(new Set());
    // Switch back to results view so new papers are visible
    setSearchViewMode('results');
    await handleSearch();
  };
  
  // Load libraries for "Save to Library" feature
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const params = new URLSearchParams({ paperId: sessionId });
      const response = await fetch(`/api/library/collections?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken, sessionId]);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  // Rotate loading messages while searching
  useEffect(() => {
    if (!loading) {
      setLoadingMessageIndex(0);
      return;
    }
    
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => (prev + 1) % SEARCH_LOADING_MESSAGES.length);
    }, 2000); // Change message every 2 seconds
    
    return () => clearInterval(interval);
  }, [loading]);

  // Save search result to library
  const handleSaveToLibrary = async (result: any, libraryId: string) => {
    if (!authToken) return;
    
    const library = libraries.find(l => l.id === libraryId);
    const libraryName = library?.name || 'Library';
    
    try {
      // First, add to personal library
      const createResponse = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          title: result.title,
          authors: result.authors || [],
          year: result.year,
          venue: result.venue,
          doi: result.doi,
          url: result.url,
          abstract: result.abstract,
          sourceType: 'JOURNAL_ARTICLE'
        })
      });
      
      if (!createResponse.ok) {
        const data = await createResponse.json();
        throw new Error(data.error || 'Failed to save');
      }
      
      const { reference } = await createResponse.json();
      
      // Then add to specific library/collection
      await fetch(`/api/library/collections/${libraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'addReferences',
          referenceIds: [reference.id]
        })
      });
      
      // Show success toast
      showToast({
        type: 'success',
        title: 'Saved to Library',
        message: `"${result.title.slice(0, 50)}${result.title.length > 50 ? '...' : ''}" added to ${libraryName}`,
        duration: 4000
      });
      
      setSaveToLibraryResult({ resultId: result.id, success: true, libraryName });
      loadLibraries();
      
      // Clear state after 3 seconds
      setTimeout(() => setSaveToLibraryResult(null), 3000);
    } catch (err) {
      console.error('Failed to save to library:', err);
      
      // Show error toast
      showToast({
        type: 'error',
        title: 'Failed to Save',
        message: err instanceof Error ? err.message : 'Could not save citation to library',
        duration: 5000
      });
      
      setSaveToLibraryResult({ resultId: result.id, success: false, libraryName: '' });
      setTimeout(() => setSaveToLibraryResult(null), 3000);
    }
  };
  
  const toggleAbstract = useCallback((id: string) => {
    setExpandedAbstracts(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const refreshSession = async () => {
    if (!authToken) return;
    const sessionRes = await fetch(`/api/papers/${sessionId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (sessionRes.ok) {
      const sessionData = await sessionRes.json();
      setSession(sessionData.session);
      onSessionUpdated?.(sessionData.session);
    }
  };

  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}/literature/suggestions`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    };

    const loadCitations = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}/citations`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setCitations(data.citations || []);
      } catch {
        setCitations([]);
      }
    };

    if (sessionId && authToken) {
      loadSuggestions();
      loadCitations();
    }
  }, [sessionId, authToken]);

  const normalizePaperKey = useCallback((value?: string) => value?.toLowerCase().trim(), []);
  // Normalize DOI to handle different formats (with/without URL prefix)
  const normalizeDoiKey = useCallback((doi?: string) => {
    if (!doi) return undefined;
    let normalized = doi.toLowerCase().trim();
    // Remove common DOI URL prefixes
    normalized = normalized
      .replace(/^https?:\/\/doi\.org\//i, '')
      .replace(/^https?:\/\/dx\.doi\.org\//i, '')
      .replace(/^doi:/i, '');
    return normalized || undefined;
  }, []);
  const titleKey = useCallback((title?: string) => normalizePaperKey(title)?.substring(0, 100), [normalizePaperKey]);

  const buildResultLookup = useCallback((list: any[]) => {
    const byId = new Set<string>();
    const byDoi = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const result of list) {
      if (result?.id) byId.add(result.id);
      const doiKey = normalizeDoiKey(result?.doi);
      if (doiKey && !byDoi.has(doiKey)) byDoi.set(doiKey, result.id);
      const tKey = titleKey(result?.title);
      if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, result.id);
    }
    return { byId, byDoi, byTitle };
  }, [normalizeDoiKey, titleKey]);

  const resolveSuggestionResultId = useCallback((
    suggestion: any,
    lookup: ReturnType<typeof buildResultLookup>
  ) => {
    if (suggestion?.paperId && lookup.byId.has(suggestion.paperId)) {
      return suggestion.paperId as string;
    }
    const doiKey = normalizeDoiKey(suggestion?.paperDoi);
    if (doiKey && lookup.byDoi.has(doiKey)) {
      return lookup.byDoi.get(doiKey) as string;
    }
    const tKey = titleKey(suggestion?.paperTitle);
    if (tKey && lookup.byTitle.has(tKey)) {
      return lookup.byTitle.get(tKey) as string;
    }
    return null;
  }, [normalizeDoiKey, titleKey]);

  // Load ALL search runs and merge their results on mount (persist across refresh)
  useEffect(() => {
    const loadExistingSearchRuns = async () => {
      if (!sessionId || !authToken) return;
      
      try {
        const response = await fetch(`/api/papers/${sessionId}/literature/select-relevant`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const searchRuns = data.searchRuns || [];
        
        if (searchRuns.length === 0) return;
        
        // Fetch ALL search runs and merge their results
        const allRunIds: string[] = [];
        const allResults: any[] = [];
        const removedIds = new Set<string>();
        const allAiSuggestions = new Map<string, {
          isRelevant: boolean;
          score: number;
          reasoning: string;
          recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
          deepAnalysisRecommendation?: DeepAnalysisRecommendation;
          deepAnalysisRationale?: string;
          citationMeta?: any;
        }>();
        const allDimensionMappings = new Map<string, Array<{
          sectionKey: string;
          dimension: string;
          remark: string;
          confidence: 'HIGH' | 'MEDIUM' | 'LOW';
        }>>();
        const allRecommendations = new Map<string, 'IMPORT' | 'MAYBE' | 'SKIP'>();
        const rawSuggestions: Array<{
          paperId: string;
          paperTitle?: string;
          paperDoi?: string;
          isRelevant: boolean;
          relevanceScore: number;
          reasoning: string;
          citationMeta?: any;
          dimensionMappings?: Array<{
            sectionKey: string;
            dimension: string;
            remark: string;
            confidence: 'HIGH' | 'MEDIUM' | 'LOW';
          }>;
          recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
          deepAnalysisRecommendation?: DeepAnalysisRecommendation;
          deepAnalysisRationale?: string;
        }> = [];
        let latestAiSummary: string | null = null;
        let latestBlueprintCoverage: any = null;
        let latestQuery = '';
        let mostRecentRunId: string | null = null;
        
        // Load all search runs in parallel for efficiency
        const detailPromises = searchRuns.map((run: any) => 
          fetch(
            `/api/papers/${sessionId}/literature/select-relevant?searchRunId=${run.id}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
          ).then(res => res.ok ? res.json() : null)
        );
        
        const detailResponses = await Promise.all(detailPromises);
        
        // Process each search run - from oldest to newest to maintain order
        for (let i = detailResponses.length - 1; i >= 0; i--) {
          const detailData = detailResponses[i];
          if (!detailData?.searchRun) continue;
          
            const searchRun = detailData.searchRun;
          allRunIds.push(searchRun.id);
          
          const runRemoved = new Set<string>(
            Array.isArray((searchRun.aiAnalysis as any)?.removedResultIds)
              ? (searchRun.aiAnalysis as any).removedResultIds
              : []
          );
          runRemoved.forEach(id => removedIds.add(id));

          // Add results from this run (will be deduplicated)
          const runResults = searchRun.results || [];
          const runResultsById = new Map<string, any>(runResults.map((r: any) => [r.id, r]));
          for (const result of runResults) {
            if (removedIds.has(result.id)) continue;
            // Check for duplicate by DOI or title
            const key = result.doi?.toLowerCase() || result.title?.toLowerCase()?.substring(0, 100);
            const duplicateIndex = allResults.findIndex(r => {
              const existingKey = r.doi?.toLowerCase() || r.title?.toLowerCase()?.substring(0, 100);
              return existingKey && existingKey === key;
            });

            if (duplicateIndex === -1) {
              allResults.push({
                ...result,
                _sourceQuery: searchRun.query,
                _searchRunId: searchRun.id
              });
            } else {
              const existing = allResults[duplicateIndex];
              allResults[duplicateIndex] = {
                ...existing,
                abstract: existing.abstract || result.abstract,
                isOpenAccess: existing.isOpenAccess ?? result.isOpenAccess,
                pdfStatus: preferredPdfStatus(existing.pdfStatus, result.pdfStatus),
                libraryReferenceId: existing.libraryReferenceId || result.libraryReferenceId,
                libraryDocumentId: existing.libraryDocumentId || result.libraryDocumentId,
                documentSourceType: existing.documentSourceType || result.documentSourceType,
              };
            }
          }
          
          // Merge AI analysis if available
              if (searchRun.aiAnalysis) {
            const analysis = searchRun.aiAnalysis as { 
              suggestions?: Array<{ 
                paperId: string; 
                paperTitle?: string;
                paperDoi?: string;
                isRelevant: boolean; 
                relevanceScore: number; 
                reasoning: string;
                citationMeta?: any;
                dimensionMappings?: Array<{
                  sectionKey: string;
                  dimension: string;
                  remark: string;
                  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
                }>;
                recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
                deepAnalysisRecommendation?: DeepAnalysisRecommendation;
                deepAnalysisRationale?: string;
              }>; 
              summary?: string;
              blueprintCoverage?: {
                totalDimensions: number;
                coveredDimensions: number;
                gaps: Array<{ sectionKey: string; sectionTitle: string; dimension: string }>;
                sectionCoverage: Record<string, { total: number; covered: number; dimensions: Array<{ dimension: string; covered: boolean; papers: any[] }> }>;
              };
            };
                
            for (const suggestion of (analysis.suggestions || [])) {
              const paper = runResultsById.get(suggestion.paperId);
              rawSuggestions.push({
                ...suggestion,
                paperTitle: suggestion.paperTitle ?? paper?.title,
                paperDoi: suggestion.paperDoi ?? paper?.doi
              });
            }
            
            // Keep most recent summary
            if (analysis.summary) {
              latestAiSummary = analysis.summary;
            }
            
            // Keep most recent blueprint coverage
            if (analysis.blueprintCoverage) {
              latestBlueprintCoverage = analysis.blueprintCoverage;
            }
          }
          
          // Update query from most recent run (first in original array)
          if (i === 0) {
            latestQuery = searchRun.query || '';
            mostRecentRunId = searchRun.id;
          }
        }
        
        if (rawSuggestions.length > 0 && allResults.length > 0) {
          const lookup = buildResultLookup(allResults);
          
          // Build a search-run-ID → accumulated-result-ID map for papers that were
          // deduplicated (run result ID differs from the ID kept in allResults).
          // This mirrors the searchRunIdMap approach in handleAiRelevanceAnalysis.
          const searchRunIdToAccumulated = new Map<string, string>();
          for (const detailData of detailResponses) {
            if (!detailData?.searchRun?.results) continue;
            for (const runResult of detailData.searchRun.results) {
              if (!runResult?.id) continue;
              // If this ID is already in accumulated results, map to itself
              if (lookup.byId.has(runResult.id)) {
                searchRunIdToAccumulated.set(runResult.id, runResult.id);
                continue;
              }
              // Otherwise try DOI/title match against accumulated results
              const doiKey = normalizeDoiKey(runResult.doi);
              const tKey = titleKey(runResult.title);
              const matchedId = (doiKey && lookup.byDoi.get(doiKey)) || (tKey && lookup.byTitle.get(tKey));
              if (matchedId) {
                searchRunIdToAccumulated.set(runResult.id, matchedId);
              }
            }
          }
          
          for (const suggestion of rawSuggestions) {
            // Prefer direct ID map (handles deduplicated results), then fall back to DOI/title
            const resolvedId = searchRunIdToAccumulated.get(suggestion.paperId) 
              || resolveSuggestionResultId(suggestion, lookup);
            if (!resolvedId) continue;
            allAiSuggestions.set(resolvedId, {
              isRelevant: suggestion.isRelevant,
              score: suggestion.relevanceScore,
              reasoning: suggestion.reasoning,
              recommendation: suggestion.recommendation,
              deepAnalysisRecommendation: suggestion.deepAnalysisRecommendation,
              deepAnalysisRationale: suggestion.deepAnalysisRationale,
              citationMeta: suggestion.citationMeta
            });
            
            // Extract dimension mappings if available
            if (suggestion.dimensionMappings && suggestion.dimensionMappings.length > 0) {
              allDimensionMappings.set(resolvedId, suggestion.dimensionMappings);
            }
            
            // Extract recommendation if available
            if (suggestion.recommendation) {
              allRecommendations.set(resolvedId, suggestion.recommendation);
            }
          }
          
          const unresolvedCount = rawSuggestions.length - allAiSuggestions.size;
          if (unresolvedCount > 0) {
            console.warn(`[LiteratureSearch] ${unresolvedCount}/${rawSuggestions.length} AI suggestions could not be matched to accumulated results`);
          }
        }

        // Set all accumulated state
        setDeletedResultIds(removedIds);

        if (allResults.length > 0) {
          setResults(allResults);
          setExpandedAbstracts(new Set(allResults.filter(result => !!result.abstract).map(result => result.id)));
          setSearchRunIds(allRunIds);
          setSearchRunId(mostRecentRunId);
          setQuery(latestQuery);
          
          if (allAiSuggestions.size > 0) {
            setAiSuggestions(allAiSuggestions);
          }
          if (latestAiSummary) {
            setAiSummary(latestAiSummary);
          }
          
          // Restore dimension mappings, recommendations, and blueprint coverage
          if (allDimensionMappings.size > 0) {
            setPaperDimensionMappings(allDimensionMappings);
          }
          if (allRecommendations.size > 0) {
            setPaperRecommendations(allRecommendations);
          }
          if (latestBlueprintCoverage) {
            setBlueprintCoverage(latestBlueprintCoverage);
          }
          
          console.log(`[LiteratureSearch] Restored ${allResults.length} results from ${allRunIds.length} search run(s), ${allDimensionMappings.size} dimension mappings, ${allRecommendations.size} recommendations, blueprintCoverage: ${latestBlueprintCoverage ? 'yes' : 'no'}`);
          
          // Show toast notification about restored results
          if (allRunIds.length > 1) {
            showToast({
              title: 'Search Results Restored',
              description: `Loaded ${allResults.length} papers from ${allRunIds.length} previous searches.`,
              variant: 'default'
            });
          }
        }
      } catch (err) {
        console.error('Failed to load existing search runs:', err);
      }
    };
    
    loadExistingSearchRuns();
  }, [sessionId, authToken, buildResultLookup, resolveSuggestionResultId, showToast, titleKey, normalizeDoiKey]);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setSession(data.session);
      } catch {
        setSession(null);
      }
    };

    if (sessionId && authToken) {
      loadSession();
    }
  }, [sessionId, authToken]);

  const toggleSource = (value: string) => {
    setSources(prev => prev.includes(value)
      ? prev.filter(item => item !== value)
      : [...prev, value]
    );
  };

  const citationTargets = useMemo(() => {
    const type = session?.paperType || {};
    const min = type.minCitations || type.minimumCitations;
    const recommended = type.recommendedCitations || type.citationRange;
    if (Array.isArray(recommended) && recommended.length === 2) {
      return { min, recommended: `${recommended[0]}-${recommended[1]}` };
    }
    if (typeof recommended === 'string') {
      return { min, recommended };
    }
    return { min, recommended: null };
  }, [session?.paperType]);

  const handleBibtexFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setBibtexInput(text);
    };
    reader.readAsText(file);
  };

  // Deduplicate results by DOI or title (case-insensitive)
  const deduplicateResults = (
    existingResults: any[],
    newResults: any[],
    sourceQuery: string,
    searchRunId: string | null,
    deletedIds: Set<string>
  ): any[] => {
    const seen = new Map<string, any>();
    
    // Add existing results first (they take priority)
    for (const result of existingResults) {
      const key = result.doi?.toLowerCase() || result.title?.toLowerCase()?.substring(0, 100);
      if (key && !seen.has(key)) {
        seen.set(key, result);
      }
    }
    
    // Add new results, tagging with source query
    let addedCount = 0;
    for (const result of newResults) {
      if (deletedIds.has(result.id)) continue;
      const key = result.doi?.toLowerCase() || result.title?.toLowerCase()?.substring(0, 100);
      if (!key) continue;

      if (!seen.has(key)) {
        seen.set(key, {
          ...result,
          _sourceQuery: sourceQuery,
          _addedAt: Date.now(),
          _searchRunId: searchRunId || undefined
        });
        addedCount += 1;
        continue;
      }

      const existing = seen.get(key);
      seen.set(key, {
        ...existing,
        abstract: existing?.abstract || result.abstract,
        isOpenAccess: existing?.isOpenAccess ?? result.isOpenAccess,
        pdfStatus: preferredPdfStatus(existing?.pdfStatus, result.pdfStatus),
        libraryReferenceId: existing?.libraryReferenceId || result.libraryReferenceId,
        libraryDocumentId: existing?.libraryDocumentId || result.libraryDocumentId,
        documentSourceType: existing?.documentSourceType || result.documentSourceType
      });
    }
    
    console.log(`[Search] Added ${addedCount} new unique results from query: "${sourceQuery.substring(0, 50)}..."`);
    return Array.from(seen.values());
  };

  // Clear all accumulated results AND all associated AI analysis data
  const clearAllResults = () => {
    setResults([]);
    setExpandedAbstracts(new Set());
    setSearchRunIds([]);
    setSearchRunId(null);
    setAiSuggestions(new Map());
    setPaperDimensionMappings(new Map());
    setPaperRecommendations(new Map());
    setBlueprintCoverage(null);
    setAiSummary(null);
    setAiError(null);
    setAiReviewStatus(null);
    setSelectedResults(new Set());
    setRemovedResults(new Set());
    setSearchViewMode('results');
    showToast({
      type: 'info',
      title: 'Results Cleared',
      message: 'All accumulated search results and AI analysis have been cleared',
      duration: 3000
    });
  };

  // Cancel any in-flight search request
  const handleCancelSearch = useCallback(() => {
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
      searchAbortControllerRef.current = null;
    }
    setLoading(false);
    showToast({
      type: 'info',
      title: 'Search Cancelled',
      message: 'The search request has been stopped',
      duration: 3000
    });
  }, [showToast]);

  const handleSearch = async (overrides?: {
    query?: string;
    sources?: string[];
    yearFrom?: string;
    yearTo?: string;
    strategyQueryId?: string | null;
  }) => {
    // Abort any previous in-flight search
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    
    // Create a new AbortController for this search
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;
    
    try {
      setLoading(true);
      setError(null);
      const searchQuery = overrides?.query ?? query;
      const searchSources = overrides?.sources ?? sources;
      const searchYearFrom = overrides?.yearFrom ?? yearFrom;
      const searchYearTo = overrides?.yearTo ?? yearTo;
      const strategyId = overrides?.strategyQueryId ?? currentStrategyQueryId;
      
      // Validate year values before sending — ensure they are valid integers
      const parsedYearFrom = searchYearFrom ? parseInt(searchYearFrom, 10) : undefined;
      const parsedYearTo = searchYearTo ? parseInt(searchYearTo, 10) : undefined;
      
      const response = await fetch(`/api/papers/${sessionId}/literature/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          query: searchQuery,
          sources: searchSources,
          yearFrom: parsedYearFrom && Number.isFinite(parsedYearFrom) ? parsedYearFrom : undefined,
          yearTo: parsedYearTo && Number.isFinite(parsedYearTo) ? parsedYearTo : undefined,
          // Enhanced filters
          publicationTypes: publicationTypes.length > 0 ? publicationTypes : undefined,
          openAccessOnly: openAccessOnly || undefined,
          minCitations: minCitations ? parseInt(minCitations, 10) : undefined,
          fieldsOfStudy: fieldsOfStudy.length > 0 ? fieldsOfStudy : undefined
        }),
        signal: abortController.signal
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      const newResults = data.results || [];
      const previousCount = results.length;
      
      // ACCUMULATE results instead of replacing
      const accumulatedResults = deduplicateResults(
        results,
        newResults,
        searchQuery,
        data.searchRunId || null,
        deletedResultIds
      );
      setResults(accumulatedResults);
      const existingResultIds = new Set(results.map(result => result.id));
      setExpandedAbstracts(prev => {
        const next = new Set(prev);
        for (const result of accumulatedResults) {
          if (result.abstract && !existingResultIds.has(result.id)) {
            next.add(result.id);
          }
        }
        return next;
      });
      
      // Track search run ID for this batch
      if (data.searchRunId) {
        setSearchRunId(data.searchRunId);
        setSearchRunIds(prev => (prev.includes(data.searchRunId) ? prev : [...prev, data.searchRunId]));
      }
      
      // Show feedback about accumulation
      const addedCount = accumulatedResults.length - previousCount;
      if (previousCount > 0) {
        showToast({
          type: 'success',
          title: 'Results Accumulated',
          message: `Added ${addedCount} new papers (${newResults.length - addedCount} duplicates skipped). Total: ${accumulatedResults.length}`,
          duration: 4000
        });
      }
      
      // Update strategy query status if this search was from a strategy query
      if (strategyId) {
        await updateQueryStatus(strategyId, 'SEARCHED', newResults.length, addedCount);
        setCurrentStrategyQueryId(null);
      }
    } catch (err) {
      // Don't treat abort as an error
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Search was cancelled by user, silently exit
      }
      setError(err instanceof Error ? err.message : 'Search failed');
      // Reset strategy query tracking on error
      const strategyId = overrides?.strategyQueryId ?? currentStrategyQueryId;
      if (strategyId) {
        await updateQueryStatus(strategyId, 'PENDING');
        setCurrentStrategyQueryId(null);
      }
    } finally {
      // Only clear loading if this controller is still the current one
      // (prevents a cancelled search from clearing the loading state of a new search)
      if (searchAbortControllerRef.current === abortController) {
        setLoading(false);
        searchAbortControllerRef.current = null;
      }
    }
  };

  // Helper to check if a filter is supported by any selected source
  const isFilterSupported = (filterName: keyof typeof PROVIDER_FILTER_SUPPORT['semantic_scholar']) => {
    return sources.some(source => PROVIDER_FILTER_SUPPORT[source]?.[filterName]);
  };

  // Get sources that support a specific filter
  const getSourcesSupportingFilter = (filterName: keyof typeof PROVIDER_FILTER_SUPPORT['semantic_scholar']) => {
    return sources.filter(source => PROVIDER_FILTER_SUPPORT[source]?.[filterName]);
  };

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (yearFrom || yearTo) count++;
    if (publicationTypes.length > 0) count++;
    if (openAccessOnly) count++;
    if (minCitations) count++;
    if (fieldsOfStudy.length > 0) count++;
    return count;
  }, [yearFrom, yearTo, publicationTypes, openAccessOnly, minCitations, fieldsOfStudy]);

  // AI Relevance Analysis - batch all papers in single LLM call with blueprint mapping
  const handleAiRelevanceAnalysis = async () => {
    if (!searchRunId || !authToken || results.length === 0) return;
    
    try {
      setAiAnalyzing(true);
      setAiError(null);

      const resultsWithAbstracts = results.filter(r => r.abstract);
      const totalTarget = resultsWithAbstracts.length >= 5 ? resultsWithAbstracts.length : results.length;
      setAiReviewStatus({
        total: totalTarget,
        reviewed: 0,
        inProcess: totalTarget,
        retry: 0
      });
      let stopProgressPolling = false;
      let progressPollingInFlight = false;
      let progressPollingTimer: ReturnType<typeof setInterval> | null = null;

      const pollAiProgress = async () => {
        if (stopProgressPolling || progressPollingInFlight) return;
        progressPollingInFlight = true;
        try {
          const progressResponse = await fetch(
            `/api/papers/${sessionId}/literature/select-relevant?searchRunId=${searchRunId}&progressOnly=true`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
              cache: 'no-store'
            }
          );
          if (!progressResponse.ok) return;
          const progressData = await progressResponse.json();
          const meta = progressData.searchRun?.aiAnalysis?.analysisMeta;
          if (!meta || typeof meta !== 'object') return;

          const skippedCount = typeof meta.skippedNoAbstractCount === 'number'
            ? Math.max(0, meta.skippedNoAbstractCount)
            : 0;
          const totalFromMeta = typeof meta.totalPapers === 'number'
            ? Math.max(0, meta.totalPapers) + skippedCount
            : totalTarget;
          const reviewedFromMeta = typeof meta.reviewedPapers === 'number'
            ? Math.max(0, meta.reviewedPapers)
            : 0;
          const failedFromMeta = typeof meta.failedPapers === 'number'
            ? Math.max(0, meta.failedPapers)
            : 0;

          setAiReviewStatus(prev => {
            const total = prev ? Math.max(prev.total, totalFromMeta) : totalFromMeta;
            const reviewed = prev ? Math.max(prev.reviewed, reviewedFromMeta) : reviewedFromMeta;
            const retry = prev ? Math.max(prev.retry, failedFromMeta) : failedFromMeta;
            return {
              total,
              reviewed,
              retry,
              inProcess: Math.max(0, total - reviewed - retry)
            };
          });
        } catch {
          // Ignore transient polling failures; final POST response remains source of truth.
        } finally {
          progressPollingInFlight = false;
        }
      };

      await pollAiProgress();
      progressPollingTimer = setInterval(() => {
        void pollAiProgress();
      }, 1200);

      let data: any;
      try {
        const response = await fetch(`/api/papers/${sessionId}/literature/select-relevant`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            searchRunId,
            maxSuggestions: 15, // Increased to capture more papers for blueprint coverage
            includeBlueprint: true // Include blueprint dimension mapping
          })
        });

        data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'AI analysis failed');
        }
      } finally {
        stopProgressPolling = true;
        if (progressPollingTimer) {
          clearInterval(progressPollingTimer);
        }
      }

      // Fetch the search run's results to ensure we have the correct papers for matching
      // This handles the case where accumulated results have different IDs due to deduplication
      let searchRunResults: any[] = [];
      try {
        const searchRunResponse = await fetch(
          `/api/papers/${sessionId}/literature/select-relevant?searchRunId=${searchRunId}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (searchRunResponse.ok) {
          const searchRunData = await searchRunResponse.json();
          searchRunResults = searchRunData.searchRun?.results || [];
          console.log('[AI Analysis] Fetched search run results:', searchRunResults.length);
        }
      } catch (err) {
        console.warn('[AI Analysis] Could not fetch search run results:', err);
      }

      // Build suggestions map from response with enhanced citation metadata
      const suggestionsMap = new Map<string, { 
        isRelevant: boolean; 
        score: number; 
        reasoning: string;
        recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
        deepAnalysisRecommendation?: DeepAnalysisRecommendation;
        deepAnalysisRationale?: string;
        citationMeta?: {
          keyContribution: string;
          keyFindings: string;
          methodologicalApproach: string | null;
          relevanceToResearch: string;
          limitationsOrGaps: string | null;
          usage: {
            introduction: boolean;
            literatureReview: boolean;
            methodology: boolean;
            comparison: boolean;
          };
        };
      }>();
      
      // Build dimension mappings and recommendations maps
      const dimensionMappingsMap = new Map<string, Array<{
        sectionKey: string;
        dimension: string;
        remark: string;
        confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      }>>();
      const recommendationsMap = new Map<string, 'IMPORT' | 'MAYBE' | 'SKIP'>();
      
      // Build lookup from accumulated results only (these are the IDs rendered in UI)
      // We map search-run IDs -> accumulated IDs separately to avoid storing suggestions under hidden IDs.
      const lookup = buildResultLookup(results);
      
      // Build a direct map from the search run's result IDs to accumulated result IDs (via DOI/title)
      const searchRunIdMap = new Map<string, string>();
      for (const srResult of searchRunResults) {
        const doiKey = normalizeDoiKey(srResult.doi);
        const title = titleKey(srResult.title);
        const byDoi = doiKey ? lookup.byDoi.get(doiKey) : undefined;
        const byTitle = title ? lookup.byTitle.get(title) : undefined;
        const mappedId = byDoi || byTitle;
        if (mappedId) {
          searchRunIdMap.set(srResult.id, mappedId);
        }
      }
      console.log('[AI Analysis] Search run ID mappings created:', searchRunIdMap.size);
      
      // Debug: log matching info with actual values
      const sampleResults = results.slice(0, 5).map(r => ({ 
        id: r.id, 
        doi: r.doi,
        normalizedDoi: normalizeDoiKey(r.doi),
        title: r.title?.substring(0, 40) 
      }));
      const sampleSuggestions = data.analysis?.suggestions?.slice(0, 3).map((s: any) => ({ 
        paperId: s.paperId, 
        paperDoi: s.paperDoi,
        normalizedDoi: normalizeDoiKey(s.paperDoi),
        paperTitle: s.paperTitle?.substring(0, 40)
      })) || [];
      
      console.log('[AI Analysis] Results count:', results.length);
      console.log('[AI Analysis] Suggestions count:', data.analysis?.suggestions?.length || 0);
      console.log('[AI Analysis] Lookup sizes - byId:', lookup.byId.size, 'byDoi:', lookup.byDoi.size, 'byTitle:', lookup.byTitle.size);
      console.log('[AI Analysis] Sample results (stringified):', JSON.stringify(sampleResults, null, 2));
      console.log('[AI Analysis] Sample suggestions (stringified):', JSON.stringify(sampleSuggestions, null, 2));
      console.log('[AI Analysis] Lookup DOIs (first 5):', JSON.stringify(Array.from(lookup.byDoi.keys()).slice(0, 5)));
      
      // Check if any suggestion DOI exists in lookup
      for (const s of sampleSuggestions) {
        const doiKey = normalizeDoiKey(s.paperDoi);
        console.log(`[AI Analysis] DOI check: "${doiKey}" found in lookup:`, doiKey ? lookup.byDoi.has(doiKey) : 'N/A');
      }
      
      for (const suggestion of data.analysis?.suggestions || []) {
        let resolvedId: string | null = null;

        // Prefer mapping search-run IDs to accumulated IDs (when dedup kept older results)
        if (suggestion.paperId && searchRunIdMap.has(suggestion.paperId)) {
          resolvedId = searchRunIdMap.get(suggestion.paperId) || null;
          if (resolvedId) {
            console.log('[AI Analysis] Resolved via ID map:', suggestion.paperId, '->', resolvedId);
          }
        }

        // Fall back to matching against accumulated results (ID, DOI, title)
        if (!resolvedId) {
          resolvedId = resolveSuggestionResultId(suggestion, lookup);
        }
        
        if (!resolvedId) {
          // Debug: check WHY matching failed
          const normalizedSuggestionDoi = normalizeDoiKey(suggestion.paperDoi);
          const normalizedSuggestionTitle = titleKey(suggestion.paperTitle);
          const doiMatch = normalizedSuggestionDoi ? lookup.byDoi.get(normalizedSuggestionDoi) : undefined;
          const titleMatch = normalizedSuggestionTitle ? lookup.byTitle.get(normalizedSuggestionTitle) : undefined;
          
          console.warn('[AI Analysis] Failed to resolve suggestion:', {
            paperId: suggestion.paperId,
            paperTitle: suggestion.paperTitle?.substring(0, 50),
            paperDoi: suggestion.paperDoi,
            normalizedDoi: normalizedSuggestionDoi,
            normalizedTitle: normalizedSuggestionTitle,
            doiFoundInLookup: !!doiMatch,
            titleFoundInLookup: !!titleMatch,
            lookupDoiSample: Array.from(lookup.byDoi.keys()).slice(0, 3),
            lookupTitleSample: Array.from(lookup.byTitle.keys()).slice(0, 2)
          });
          continue;
        }
        suggestionsMap.set(resolvedId, {
          isRelevant: suggestion.isRelevant,
          score: suggestion.relevanceScore,
          reasoning: suggestion.reasoning,
          recommendation: suggestion.recommendation,
          deepAnalysisRecommendation: suggestion.deepAnalysisRecommendation,
          deepAnalysisRationale: suggestion.deepAnalysisRationale,
          citationMeta: suggestion.citationMeta
        });
        
        // Store dimension mappings if available
        if (suggestion.dimensionMappings && suggestion.dimensionMappings.length > 0) {
          dimensionMappingsMap.set(resolvedId, suggestion.dimensionMappings);
        }
        
        // Store recommendation if available
        if (suggestion.recommendation) {
          recommendationsMap.set(resolvedId, suggestion.recommendation);
        }
      }
      
      console.log('[AI Analysis] Resolved suggestions count:', suggestionsMap.size);
      console.log('[AI Analysis] Resolved dimension mappings count:', dimensionMappingsMap.size);
      
      // MERGE new AI data with existing data so that previous analysis is preserved
      // when the user runs AI analysis again after searching for more papers.
      setAiSuggestions(prev => {
        const merged = new Map(prev);
        for (const [key, value] of suggestionsMap) {
          merged.set(key, value); // New analysis overwrites old for same paper
        }
        return merged;
      });
      setPaperDimensionMappings(prev => {
        const merged = new Map(prev);
        for (const [key, value] of dimensionMappingsMap) {
          merged.set(key, value);
        }
        return merged;
      });
      setPaperRecommendations(prev => {
        const merged = new Map(prev);
        for (const [key, value] of recommendationsMap) {
          merged.set(key, value);
        }
        return merged;
      });
      // Append new summary to existing (if any) so context from prior analyses is kept
      setAiSummary(prev => {
        const newSummary = data.analysis?.summary;
        if (!newSummary) return prev;
        if (!prev) return newSummary;
        return `${prev}\n\n---\n\n${newSummary}`;
      });
      
      // Store blueprint coverage if available
      if (data.analysis?.blueprintCoverage) {
        setBlueprintCoverage(data.analysis.blueprintCoverage);
      }

      const meta = data.analysis?.analysisMeta;
      const skippedCount = meta?.skippedNoAbstractCount || 0;
      if (meta && typeof meta.totalPapers === 'number') {
        setAiReviewStatus({
          total: meta.totalPapers + skippedCount, // include skipped in total so user sees the full picture
          reviewed: meta.reviewedPapers ?? Math.max(0, meta.totalPapers - (meta.failedPapers || 0)),
          inProcess: 0,
          retry: meta.failedPapers || 0
        });
      } else {
        setAiReviewStatus(prev => prev ? { ...prev, reviewed: suggestionsMap.size, inProcess: 0 } : null);
      }
      
      // Show appropriate toast based on whether blueprint was included
      const hasBlueprintData = data.analysis?.blueprintIncluded && data.analysis?.blueprintCoverage;
      const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} skipped — no abstract)` : '';
      showToast({
        type: 'success',
        title: hasBlueprintData ? 'Blueprint Analysis Complete' : 'AI Analysis Complete',
        message: hasBlueprintData 
          ? `Analyzed ${suggestionsMap.size} papers against ${data.analysis?.blueprintCoverage?.totalDimensions || 0} blueprint dimensions${skippedSuffix}`
          : `Found ${suggestionsMap.size} relevant papers${!data.analysis?.blueprintIncluded ? ' (no blueprint found - generate one first for dimension mapping)' : ''}${skippedSuffix}`,
        duration: hasBlueprintData ? 4000 : 5000
      });
    } catch (err) {
      console.error('AI analysis failed:', err);
      setAiError(err instanceof Error ? err.message : 'AI analysis failed');
      setAiReviewStatus(prev => prev ? { ...prev, inProcess: 0 } : null);
      showToast({
        type: 'error',
        title: 'Analysis Failed',
        message: err instanceof Error ? err.message : 'Could not analyze papers',
        duration: 5000
      });
    } finally {
      setAiAnalyzing(false);
    }
  };

  // Add all AI-suggested papers at once
  const handleAddAllSuggested = async () => {
    const suggestedPapers = results.filter(
      r => aiImportSuggestionIds.has(r.id) && !importedKeys.has(r.doi || r.title)
    );
    
    if (suggestedPapers.length === 0) {
      showToast({
        type: 'info',
        title: 'No Papers to Add',
        message: 'No AI import-recommended papers are pending citation import',
        duration: 3000
      });
      return;
    }

    try {
      setBulkAddingSuggested(true);

      const response = await fetch(`/api/papers/${sessionId}/citations/bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          citations: suggestedPapers.map(paper => {
            const suggestion = aiSuggestions.get(paper.id);
            const suggestionMeta = suggestion?.citationMeta;
            return {
              searchResult: paper,
              citationMeta: suggestionMeta ? {
                keyContribution: suggestionMeta.keyContribution,
                keyFindings: suggestionMeta.keyFindings,
                methodologicalApproach: suggestionMeta.methodologicalApproach,
                relevanceToResearch: suggestionMeta.relevanceToResearch,
                limitationsOrGaps: suggestionMeta.limitationsOrGaps,
                usage: suggestionMeta.usage,
                relevanceScore: suggestion?.score
              } : null,
              relevanceScore: suggestion?.score,
              recommendation: paperRecommendations.get(paper.id),
              dimensionMappings: paperDimensionMappings.get(paper.id) || []
            };
          })
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Bulk import failed');
      }

      const importedBatch = Array.isArray(data.citations) ? data.citations : [];
      const importedCount = typeof data.importedCount === 'number'
        ? data.importedCount
        : importedBatch.length;
      const skippedCount = typeof data.skippedCount === 'number'
        ? data.skippedCount
        : Math.max(0, suggestedPapers.length - importedCount);

      if (importedBatch.length > 0) {
        setCitations(prev => {
          const next = [...prev];
          const seen = new Set(next.map(c => c.id));
          for (const citation of importedBatch) {
            if (citation?.id && !seen.has(citation.id)) {
              seen.add(citation.id);
              next.push(citation);
            }
          }
          return next;
        });
      }

      await refreshSession();

      showToast({
        type: importedCount > 0 ? 'success' : 'info',
        title: importedCount > 0 ? 'Papers Added' : 'No New Papers Added',
        message: skippedCount > 0
          ? `Added ${importedCount} AI import-recommended papers (${skippedCount} skipped as duplicates)`
          : `Added ${importedCount} AI import-recommended papers to citations`,
        duration: 4000
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Import Failed',
        message: err instanceof Error ? err.message : 'Could not import suggested papers',
        duration: 5000
      });
    } finally {
      setBulkAddingSuggested(false);
    }
  };

  const applyPdfRetrievalResults = useCallback((items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return;

    const byPaperId = new Map<string, any>();
    for (const item of items) {
      if (typeof item?.paperId === 'string' && item.paperId.trim()) {
        byPaperId.set(item.paperId, item);
      }
    }
    if (byPaperId.size === 0) return;

    setResults(prev => prev.map(result => {
      const matched = byPaperId.get(result.id);
      if (!matched) return result;

      const nextStatus = matched.success
        ? (() => {
            const normalized = normalizePdfStatusValue(matched.pdfStatus);
            return normalized === 'NONE' ? 'UPLOADED' : normalized;
          })()
        : 'FAILED';

      return {
        ...result,
        pdfStatus: nextStatus,
        libraryReferenceId: matched.referenceId || result.libraryReferenceId,
        libraryDocumentId: matched.documentId || result.libraryDocumentId,
        documentSourceType: matched.documentSourceType || result.documentSourceType,
      };
    }));
  }, []);

  const setPaperActionResult = useCallback((paperId: string, payload: PaperPdfActionResult) => {
    setPaperPdfActionResults(prev => {
      const next = new Map(prev);
      next.set(paperId, payload);
      return next;
    });
  }, []);

  const updateSingleResultPdfState = useCallback((paperId: string, patch: Record<string, any>) => {
    setResults(prev => prev.map(result => {
      if (result.id !== paperId) return result;
      return {
        ...result,
        ...patch,
      };
    }));
  }, []);

  const ensureReferenceForPaper = useCallback(async (paper: any): Promise<string | null> => {
    const existingRef = typeof paper?.libraryReferenceId === 'string'
      ? paper.libraryReferenceId.trim()
      : (typeof paper?.referenceId === 'string' ? paper.referenceId.trim() : '');
    if (existingRef) return existingRef;
    if (!authToken) return null;

    const manualRunId = paper?._searchRunId || searchRunId || '';
    if (!manualRunId) {
      showToast({
        type: 'error',
        title: 'Missing Search Context',
        message: 'Could not resolve this paper to a search run. Re-run search and try again.',
        duration: 4500,
      });
      return null;
    }

    try {
      setPdfRetrievalByPaper(prev => new Set(prev).add(paper.id));

      const response = await fetch(`/api/papers/${sessionId}/literature/retrieve-pdfs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          mode: 'manual',
          searchRunIds: [manualRunId],
          paperIds: [paper.id],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Could not initialize paper reference');
      }

      applyPdfRetrievalResults(data.results || []);
      const matched = Array.isArray(data.results)
        ? data.results.find((item: any) => item?.paperId === paper.id)
        : null;
      const referenceId = typeof matched?.referenceId === 'string' ? matched.referenceId : '';
      if (referenceId) {
        return referenceId;
      }

      const latestResult = results.find(r => r.id === paper.id);
      const fallbackRef = typeof latestResult?.libraryReferenceId === 'string' ? latestResult.libraryReferenceId : '';
      if (fallbackRef) {
        return fallbackRef;
      }

      showToast({
        type: 'error',
        title: 'Reference Not Ready',
        message: 'Could not prepare a library reference for this paper yet.',
        duration: 4500,
      });
      return null;
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Reference Setup Failed',
        message: err instanceof Error ? err.message : 'Could not prepare paper reference',
        duration: 5000,
      });
      return null;
    } finally {
      setPdfRetrievalByPaper(prev => {
        const next = new Set(prev);
        next.delete(paper.id);
        return next;
      });
    }
  }, [authToken, searchRunId, sessionId, showToast, applyPdfRetrievalResults, results]);

  const runPdfRetrieval = useCallback(async (
    mode: 'deep' | 'relevant' | 'manual',
    options?: { manualPaperId?: string; manualSearchRunId?: string }
  ) => {
    if (!authToken) return;

    const runIds = (() => {
      if (mode === 'manual') {
        const manualRunId = options?.manualSearchRunId || searchRunId || '';
        return manualRunId ? [manualRunId] : [];
      }
      return searchRunIds.length > 0
        ? searchRunIds
        : (searchRunId ? [searchRunId] : []);
    })();

    if (runIds.length === 0) {
      showToast({
        type: 'error',
        title: 'No Search Run Selected',
        message: 'Run literature search and AI relevance review first.',
        duration: 4000
      });
      return;
    }

    const paperIds = mode === 'manual' && options?.manualPaperId
      ? [options.manualPaperId]
      : undefined;

    try {
      if (mode === 'manual' && options?.manualPaperId) {
        setPdfRetrievalByPaper(prev => new Set(prev).add(options.manualPaperId as string));
      } else {
        setPdfRetrievalRunning(true);
      }

      const response = await fetch(`/api/papers/${sessionId}/literature/retrieve-pdfs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          mode,
          searchRunIds: runIds,
          paperIds,
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'PDF retrieval failed');
      }

      applyPdfRetrievalResults(data.results || []);

      const summary = `Retrieved ${data.succeeded || 0}/${data.attempted || 0} PDFs (${data.reused || 0} reused by DOI, ${data.downloaded || 0} downloaded)`;
      setPdfRetrievalSummary(summary);
      showToast({
        type: data.failed > 0 ? 'info' : 'success',
        title: data.failed > 0 ? 'PDF Retrieval Finished with Skips' : 'PDF Retrieval Complete',
        message: summary,
        duration: 4500
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'PDF Retrieval Failed',
        message: err instanceof Error ? err.message : 'Could not retrieve PDFs',
        duration: 5000
      });
    } finally {
      if (mode === 'manual' && options?.manualPaperId) {
        setPdfRetrievalByPaper(prev => {
          const next = new Set(prev);
          next.delete(options.manualPaperId as string);
          return next;
        });
      } else {
        setPdfRetrievalRunning(false);
      }
    }
  }, [authToken, searchRunId, searchRunIds, sessionId, showToast, applyPdfRetrievalResults]);

  const openProvideLinkModal = useCallback(async (paper: any) => {
    const referenceId = await ensureReferenceForPaper(paper);
    if (!referenceId) return;
    setPdfLinkUrl('');
    setPdfLinkModalPaper({
      id: paper.id,
      title: paper.title || 'Untitled paper',
      referenceId,
    });
  }, [ensureReferenceForPaper]);

  const openPasteTextModal = useCallback(async (paper: any, presetText = '') => {
    const referenceId = await ensureReferenceForPaper(paper);
    if (!referenceId) return;
    setPasteTextContent(presetText);
    setPasteTextFormat('plain');
    setPasteTextModalPaper({
      id: paper.id,
      title: paper.title || 'Untitled paper',
      referenceId,
    });
  }, [ensureReferenceForPaper]);

  const openUploadPdfModal = useCallback(async (paper: any) => {
    const referenceId = await ensureReferenceForPaper(paper);
    if (!referenceId) return;
    setPdfUploadModalPaper({
      id: paper.id,
      title: paper.title || 'Untitled paper',
      referenceId,
    });
  }, [ensureReferenceForPaper]);

  const handleSubmitPdfLink = useCallback(async () => {
    if (!authToken || !pdfLinkModalPaper) return;

    const url = pdfLinkUrl.trim();
    if (!url) {
      showToast({
        type: 'error',
        title: 'URL Required',
        message: 'Enter a PDF URL first.',
        duration: 3500,
      });
      return;
    }

    const paperId = pdfLinkModalPaper.id;
    setSubmittingPdfLink(prev => new Set(prev).add(paperId));
    try {
      const response = await fetch(`/api/references/${pdfLinkModalPaper.referenceId}/acquire-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        const errorCode = data?.errorCode || 'DOWNLOAD_FAILED';
        setPaperActionResult(paperId, {
          success: false,
          errorCode,
        });

        if (errorCode === 'NOT_PDF') {
          setPdfLinkModalPaper(null);
          setPdfLinkUrl('');
          showToast({
            type: 'info',
            title: 'Web Page Detected',
            message: 'That URL is not a direct PDF. Paste full text instead.',
            duration: 4500,
          });
          await openPasteTextModal({ ...pdfLinkModalPaper, id: paperId, title: pdfLinkModalPaper.title }, '');
          return;
        }

        throw new Error(data?.error || 'Failed to import PDF from URL');
      }

      setPaperActionResult(paperId, {
        success: true,
        docId: data.documentId,
      });
      updateSingleResultPdfState(paperId, {
        pdfStatus: normalizePdfStatusValue(data.pdfStatus),
        libraryReferenceId: pdfLinkModalPaper.referenceId,
        libraryDocumentId: data.documentId || null,
        documentSourceType: data.sourceType || 'URL_IMPORT',
      });
      setPdfLinkModalPaper(null);
      setPdfLinkUrl('');
      showToast({
        type: 'success',
        title: 'PDF Linked',
        message: 'PDF retrieval started for this paper.',
        duration: 3500,
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Provide Link Failed',
        message: err instanceof Error ? err.message : 'Could not retrieve PDF from URL',
        duration: 5000,
      });
    } finally {
      setSubmittingPdfLink(prev => {
        const next = new Set(prev);
        next.delete(paperId);
        return next;
      });
    }
  }, [authToken, pdfLinkModalPaper, pdfLinkUrl, showToast, setPaperActionResult, updateSingleResultPdfState, openPasteTextModal]);

  const handleSubmitPasteText = useCallback(async () => {
    if (!authToken || !pasteTextModalPaper) return;
    const text = pasteTextContent.trim();
    if (!text) {
      showToast({
        type: 'error',
        title: 'Text Required',
        message: 'Paste full text content before submitting.',
        duration: 3500,
      });
      return;
    }

    const paperId = pasteTextModalPaper.id;
    setSubmittingPasteText(prev => new Set(prev).add(paperId));
    try {
      const response = await fetch(`/api/references/${pasteTextModalPaper.referenceId}/paste-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          text,
          format: pasteTextFormat,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setPaperActionResult(paperId, {
          success: false,
          errorCode: data?.errorCode || 'INTERNAL_ERROR',
        });
        throw new Error(data?.error || 'Failed to store pasted full text');
      }

      setPaperActionResult(paperId, {
        success: true,
        docId: data.documentId,
      });
      updateSingleResultPdfState(paperId, {
        pdfStatus: 'READY',
        libraryReferenceId: pasteTextModalPaper.referenceId,
        libraryDocumentId: data.documentId || null,
        documentSourceType: data.sourceType || 'TEXT_PASTE',
      });
      setPasteTextModalPaper(null);
      setPasteTextContent('');
      setPasteTextFormat('plain');
      showToast({
        type: 'success',
        title: 'Full Text Saved',
        message: `Stored ${data.characterCount || text.length} characters for deep analysis.`,
        duration: 4000,
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Paste Text Failed',
        message: err instanceof Error ? err.message : 'Could not store pasted text',
        duration: 5000,
      });
    } finally {
      setSubmittingPasteText(prev => {
        const next = new Set(prev);
        next.delete(paperId);
        return next;
      });
    }
  }, [authToken, pasteTextModalPaper, pasteTextContent, pasteTextFormat, showToast, setPaperActionResult, updateSingleResultPdfState]);

  const handleViewPdf = useCallback(async (paper: any) => {
    if (!authToken) return;
    const referenceId = await ensureReferenceForPaper(paper);
    if (!referenceId) return;

    try {
      const response = await fetch(`/api/library/${referenceId}/document/serve`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Could not open PDF');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err) {
      showToast({
        type: 'error',
        title: 'View PDF Failed',
        message: err instanceof Error ? err.message : 'Could not open PDF',
        duration: 4500,
      });
    }
  }, [authToken, ensureReferenceForPaper, showToast]);

  const handleViewFullText = useCallback(async (paper: any) => {
    if (!authToken) return;
    const referenceId = await ensureReferenceForPaper(paper);
    if (!referenceId) return;

    setLoadingFullTextPaper(paper.id);
    try {
      const response = await fetch(`/api/references/${referenceId}/full-text`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'Full text is not ready yet');
      }

      if (!data.text || !String(data.text).trim()) {
        throw new Error('Full text is not available yet. Try again shortly.');
      }

      setFullTextModalPaper({
        id: paper.id,
        title: paper.title || 'Untitled paper',
        referenceId,
      });
      setFullTextModalContent(String(data.text));
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Full Text Unavailable',
        message: err instanceof Error ? err.message : 'Could not load full text',
        duration: 4500,
      });
    } finally {
      setLoadingFullTextPaper(null);
    }
  }, [authToken, ensureReferenceForPaper, showToast]);

  // Analyze unanalyzed citations against blueprint dimensions
  const handleAnalyzeUnanalyzedCitations = async () => {
    if (!authToken || citations.length === 0) return;
    
    // Filter to citations without blueprint analysis AND under the retry limit.
    // Papers that exceeded MAX_ANALYSIS_ATTEMPTS are excluded to prevent infinite token spend.
    const unanalyzedCitations = citations.filter(c =>
      !analyzedCitationIds.has(c.id) &&
      (citationFailureCounts.get(c.id) || 0) < MAX_ANALYSIS_ATTEMPTS
    );
    const exhaustedCitations = citations.filter(c =>
      !analyzedCitationIds.has(c.id) &&
      (citationFailureCounts.get(c.id) || 0) >= MAX_ANALYSIS_ATTEMPTS
    );
    
    if (unanalyzedCitations.length === 0) {
      showToast({
        type: exhaustedCitations.length > 0 ? 'warning' : 'info',
        title: exhaustedCitations.length > 0 ? 'Retry Limit Reached' : 'All Citations Analyzed',
        message: exhaustedCitations.length > 0
          ? `${exhaustedCitations.length} citation${exhaustedCitations.length > 1 ? 's' : ''} failed after ${MAX_ANALYSIS_ATTEMPTS} attempts. Try adding abstracts or editing titles for better results.`
          : 'All imported citations have already been analyzed against the blueprint.',
        duration: 4000
      });
      return;
    }
    
    // Separate citations with and without abstracts.
    // Papers without abstracts are NOT sent to the LLM — they produce low-quality
    // results and waste tokens. Instead they are flagged in the UI with a "No Abstract" tag.
    const withAbstracts = unanalyzedCitations.filter((c: any) => c.abstract);
    const withoutAbstracts = unanalyzedCitations.filter((c: any) => !c.abstract);
    
    // Track skipped-no-abstract IDs so the UI can show the tag
    if (withoutAbstracts.length > 0) {
      setCitationSkippedNoAbstract(prev => {
        const next = new Set(prev);
        withoutAbstracts.forEach(c => next.add(c.id));
        return next;
      });
    }
    
    if (withAbstracts.length === 0) {
      showToast({
        type: 'warning',
        title: 'No Abstracts Available',
        message: `All ${withoutAbstracts.length} citation${withoutAbstracts.length > 1 ? 's' : ''} lack abstracts and were skipped. Add abstracts to enable AI analysis.`,
        duration: 4000
      });
      return;
    } else if (withoutAbstracts.length > 0) {
      showToast({
        type: 'info',
        title: 'Some Citations Skipped',
        message: `${withoutAbstracts.length} citation${withoutAbstracts.length > 1 ? 's' : ''} without abstracts will be skipped. Analyzing ${withAbstracts.length} citation${withAbstracts.length > 1 ? 's' : ''} with abstracts.`,
        duration: 3000
      });
    }
    
    try {
      setCitationAnalyzing(true);
      
      // Only send citations WITH abstracts to the mapping API
      const citationsAsResults = withAbstracts.map((c: any) => ({
        id: c.id,
        title: c.title,
        abstract: c.abstract || null,
        authors: c.authors || [],
        year: c.year || null,
        doi: c.doi || null
      }));
      
      const totalToAnalyze = citationsAsResults.length;
      setCitationReviewStatus({
        total: totalToAnalyze,
        reviewed: 0,
        inProcess: totalToAnalyze,
        retry: 0
      });
      
      // Chunk citations into groups of 100 (API limit) and process in parallel.
      // Up to PARALLEL_API_CHUNKS are fired concurrently; results merge after each group.
      const API_CHUNK_SIZE = 100;
      const PARALLEL_API_CHUNKS = 2;
      const chunks: typeof citationsAsResults[] = [];
      for (let i = 0; i < citationsAsResults.length; i += API_CHUNK_SIZE) {
        chunks.push(citationsAsResults.slice(i, i + API_CHUNK_SIZE));
      }
      
      let allSuggestions: any[] = [];
      let latestCoverage: any = null;
      let cumulativeReviewed = 0;
      let cumulativeFailed = 0;
      
      // Process a single chunk — returns structured result (never throws)
      const processOneChunk = async (chunk: typeof citationsAsResults, chunkIdx: number) => {
        try {
          const response = await fetch(`/api/papers/${sessionId}/literature/mapping`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({
              citations: chunk,
              includeBlueprint: true
            })
          });

          const data = await response.json();
          if (!response.ok) {
            console.error(`[CitationMapping] Chunk ${chunkIdx + 1}/${chunks.length} failed:`, data.error);
            return { suggestions: [] as any[], coverage: null, reviewed: 0, failed: chunk.length };
          }

          const chunkSuggestions: any[] = Array.isArray(data.analysis?.suggestions) ? data.analysis.suggestions : [];
          const meta = data.analysis?.analysisMeta;
          return {
            suggestions: chunkSuggestions,
            coverage: data.analysis?.blueprintCoverage ?? null,
            reviewed: meta?.reviewedPapers ?? chunkSuggestions.length,
            failed: meta?.failedPapers ?? 0
          };
        } catch (chunkErr) {
          console.error(`[CitationMapping] Chunk ${chunkIdx + 1}/${chunks.length} threw:`, chunkErr);
          return { suggestions: [] as any[], coverage: null, reviewed: 0, failed: chunk.length };
        }
      };
      
      // Fire chunks in parallel groups of PARALLEL_API_CHUNKS
      for (let g = 0; g < chunks.length; g += PARALLEL_API_CHUNKS) {
        const group = chunks.slice(g, g + PARALLEL_API_CHUNKS);
        const groupResults = await Promise.all(
          group.map((chunk, idx) => processOneChunk(chunk, g + idx))
        );
        
        // Merge results from this parallel group
        for (const result of groupResults) {
          allSuggestions = [...allSuggestions, ...result.suggestions];
          if (result.coverage) latestCoverage = result.coverage;
          cumulativeReviewed += result.reviewed;
          cumulativeFailed += result.failed;
        }
        
        // Live progress update after each parallel group completes
        setCitationReviewStatus({
          total: totalToAnalyze,
          reviewed: cumulativeReviewed,
          inProcess: Math.max(0, totalToAnalyze - cumulativeReviewed - cumulativeFailed),
          retry: cumulativeFailed
        });
      }

      // Process accumulated results from all chunks
      const actuallyAnalyzedIds = allSuggestions.map((s: any) => s.paperId).filter(Boolean);
      const analyzedSet = new Set(actuallyAnalyzedIds);
      const newAnalyzedIds = new Set(analyzedCitationIds);
      actuallyAnalyzedIds.forEach((id: string) => newAnalyzedIds.add(id));
      setAnalyzedCitationIds(newAnalyzedIds);
      
      // Track per-paper failure counts: increment for papers that were sent but NOT analyzed.
      // This prevents persistently failing papers from consuming tokens indefinitely.
      const newFailureCounts = new Map(citationFailureCounts);
      for (const c of citationsAsResults) {
        if (!analyzedSet.has(c.id)) {
          newFailureCounts.set(c.id, (newFailureCounts.get(c.id) || 0) + 1);
        }
      }
      setCitationFailureCounts(newFailureCounts);
      
      // Update dimension mappings AND per-paper AI analysis
      if (allSuggestions.length > 0) {
        const newMappings = new Map(citationDimensionMappings);
        const newAnalysis = new Map(citationAiAnalysis);
        for (const suggestion of allSuggestions) {
          if (!suggestion.paperId) continue;
          // Store dimension mappings
          if (suggestion.dimensionMappings && suggestion.dimensionMappings.length > 0) {
            newMappings.set(suggestion.paperId, suggestion.dimensionMappings);
          }
          // Store full per-paper AI analysis (relevance, reasoning, recommendation)
          newAnalysis.set(suggestion.paperId, {
            isRelevant: suggestion.isRelevant ?? true,
            relevanceScore: typeof suggestion.relevanceScore === 'number' ? suggestion.relevanceScore : 50,
            reasoning: suggestion.reasoning || '',
            recommendation: suggestion.recommendation
          });
        }
        setCitationDimensionMappings(newMappings);
        setCitationAiAnalysis(newAnalysis);
      }
      
      // Update coverage from last successful response
      if (latestCoverage) {
        setCitationBlueprintCoverage(latestCoverage);
      }
      if (allSuggestions.length > 0) {
        setSession((prev: any) => prev ? { ...prev, archetypeEvidenceStale: false } : prev);
      }

      // Final review status
      setCitationReviewStatus({
        total: totalToAnalyze,
        reviewed: cumulativeReviewed,
        inProcess: 0,
        retry: cumulativeFailed
      });
      
      const analyzedCount = actuallyAnalyzedIds.length;
      const remainingCount = Math.max(0, withAbstracts.length - analyzedCount);
      const skippedSuffix = withoutAbstracts.length > 0 ? ` (${withoutAbstracts.length} skipped — no abstract)` : '';
      showToast({
        type: 'success',
        title: 'Citation Analysis Complete',
        message: remainingCount > 0
          ? `Analyzed ${analyzedCount} citation${analyzedCount !== 1 ? 's' : ''}. ${remainingCount} remaining — run again to continue.${skippedSuffix}`
          : `Analyzed ${analyzedCount} citation${analyzedCount !== 1 ? 's' : ''} against blueprint dimensions${skippedSuffix}`,
        duration: 4500
      });
    } catch (err) {
      console.error('Citation analysis failed:', err);
      setCitationReviewStatus(prev => prev ? { ...prev, inProcess: 0 } : null);
      showToast({
        type: 'error',
        title: 'Analysis Failed',
        message: err instanceof Error ? err.message : 'Could not analyze citations',
        duration: 5000
      });
    } finally {
      setCitationAnalyzing(false);
    }
  };

  const handleImport = async (result: any) => {
    try {
      setImportMessage(null);
      
      // Auto-fetch abstract if missing
      let resultWithAbstract = result;
      if (!result.abstract && result.doi) {
        try {
          setFetchingAbstract(result.id);
          const abstractResponse = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${result.doi}?fields=abstract`);
          if (abstractResponse.ok) {
            const abstractData = await abstractResponse.json();
            if (abstractData.abstract) {
              resultWithAbstract = { ...result, abstract: abstractData.abstract };
              // Update the results array with the fetched abstract
              setResults(prev => prev.map(r => 
                r.id === result.id ? { ...r, abstract: abstractData.abstract } : r
              ));
            } else {
              // Auto-fetch failed - mark it
              setFetchAbstractFailed(prev => new Set(prev).add(result.id));
              showToast({
                title: 'Abstract not found',
                description: 'Auto-fetch failed. You can add the abstract manually.',
                variant: 'default'
              });
            }
          } else {
            // API call failed - mark as failed
            setFetchAbstractFailed(prev => new Set(prev).add(result.id));
            showToast({
              title: 'Abstract auto-fetch failed',
              description: 'Could not fetch abstract automatically. You can add it manually.',
              variant: 'default'
            });
          }
        } catch (abstractErr) {
          console.error('Failed to auto-fetch abstract:', abstractErr);
          setFetchAbstractFailed(prev => new Set(prev).add(result.id));
        } finally {
          setFetchingAbstract(null);
        }
      }
      
      // Include AI citation metadata if available
      const aiSuggestion = aiSuggestions.get(result.id);
      const citationMeta = aiSuggestion?.citationMeta || null;
      
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ 
          searchResult: resultWithAbstract,
          // Include AI-generated citation metadata for section generation
          citationMeta: citationMeta ? {
            keyContribution: citationMeta.keyContribution,
            keyFindings: citationMeta.keyFindings,
            methodologicalApproach: citationMeta.methodologicalApproach,
            relevanceToResearch: citationMeta.relevanceToResearch,
            limitationsOrGaps: citationMeta.limitationsOrGaps,
            usage: citationMeta.usage,
            relevanceScore: aiSuggestion?.score
          } : null
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setCitations(prev => [...prev, data.citation]);
      setImportMessage('Citation imported.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleDoiImport = async () => {
    if (!doiInput.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/citations/import-doi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ doi: doiInput.trim() })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'DOI import failed');
      }

      setCitations(prev => [...prev, data.citation]);
      setDoiInput('');
      setImportMessage('DOI imported.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'DOI import failed');
    }
  };

  const handleBibtexImport = async () => {
    if (!bibtexInput.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/citations/import-bibtex`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ bibtex: bibtexInput })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'BibTeX import failed');
      }

      setCitations(prev => [...prev, ...(data.citations || [])]);
      setBibtexInput('');
      setImportMessage('BibTeX import complete.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'BibTeX import failed');
    }
  };

  const handleExportBibtex = async () => {
    if (!authToken || citations.length === 0 || exportingBibtex) return;

    try {
      setExportingBibtex(true);
      const idsQuery = selectedCitations.size > 0
        ? `?ids=${encodeURIComponent(Array.from(selectedCitations).join(','))}`
        : '';

      const response = await fetch(`/api/papers/${sessionId}/citations/export${idsQuery}`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'BibTeX export failed');
      }

      const bibtex = typeof data.bibtex === 'string' ? data.bibtex : '';
      const blob = new Blob([bibtex], { type: 'application/x-bibtex;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = selectedCitations.size > 0
        ? `citations_selected_${sessionId}.bib`
        : `citations_${sessionId}.bib`;
      link.click();
      window.URL.revokeObjectURL(url);

      const exportedCount = typeof data.count === 'number' ? data.count : 0;
      showToast({
        type: 'success',
        title: 'BibTeX Export Ready',
        message: `Downloaded ${exportedCount} citation${exportedCount === 1 ? '' : 's'} as BibTeX.`,
        duration: 3500
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: err instanceof Error ? err.message : 'Could not export BibTeX.',
        duration: 5000
      });
    } finally {
      setExportingBibtex(false);
    }
  };

  const runGapAnalysis = async () => {
    if (!authToken) return;
    try {
      setGapLoading(true);
      setGapError(null);
      const response = await fetch(`/api/papers/${sessionId}/literature/gap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({})
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Gap analysis failed');
      }

      setGapAnalysis(data.analysis || null);
    } catch (err) {
      setGapError(err instanceof Error ? err.message : 'Gap analysis failed');
    } finally {
      setGapLoading(false);
    }
  };

  // Filter citations for display
  const filteredCitations = useMemo(() => {
    if (!citationSearch.trim()) return citations;
    const search = citationSearch.toLowerCase();
    return citations.filter(c => 
      c.title?.toLowerCase().includes(search) ||
      c.authors?.some((a: string) => a.toLowerCase().includes(search)) ||
      c.citationKey?.toLowerCase().includes(search)
    );
  }, [citations, citationSearch]);

  // Handle removing selected citations (bulk delete)
  const handleRemoveSelected = async () => {
    if (selectedCitations.size === 0) return;
    if (!confirm(`Remove ${selectedCitations.size} citation(s) from this paper?`)) return;
    
    const idsToDelete = Array.from(selectedCitations);
    
    // Optimistic update
    setCitations(prev => prev.filter(c => !selectedCitations.has(c.id)));
    setSelectedCitations(new Set());
    
    try {
      const response = await fetch(`/api/papers/${sessionId}/citations/bulk-delete`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}` 
        },
        body: JSON.stringify({ citationIds: idsToDelete })
      });
      
      if (!response.ok) {
        throw new Error('Bulk delete failed');
      }
      
      await refreshSession();
    } catch (err) {
      console.error('Failed to delete citations:', err);
      // Refresh to get actual state on error
      try {
        const response = await fetch(`/api/papers/${sessionId}/citations`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          setCitations(data.citations || []);
        }
      } catch {}
    }
  };

  // Main tab state
  const [mainTab, setMainTab] = useState<'find' | 'citations'>('find');
  
  // Search Strategy state
  const [searchStrategy, setSearchStrategy] = useState<SearchStrategyData | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyExpanded, setStrategyExpanded] = useState(true);
  const [generatingStrategy, setGeneratingStrategy] = useState(false);
  const [selectedStrategyQueryId, setSelectedStrategyQueryId] = useState<string | null>(null);
  const [strategyDetailsOpen, setStrategyDetailsOpen] = useState(false);
  const [strategyEditor, setStrategyEditor] = useState<SearchStrategyEditorState | null>(null);
  const [strategyEditorQueryId, setStrategyEditorQueryId] = useState<string | null>(null);
  const [savingStrategyQuery, setSavingStrategyQuery] = useState(false);

  const toStrategyEditorState = useCallback((strategyQuery: SearchStrategyQuery): SearchStrategyEditorState => ({
    queryText: strategyQuery.queryText || '',
    description: strategyQuery.description || '',
    category: strategyQuery.category,
    suggestedSources: Array.isArray(strategyQuery.suggestedSources) ? strategyQuery.suggestedSources : [],
    suggestedYearFrom: strategyQuery.suggestedYearFrom ? String(strategyQuery.suggestedYearFrom) : '',
    suggestedYearTo: strategyQuery.suggestedYearTo ? String(strategyQuery.suggestedYearTo) : ''
  }), []);

  const selectedStrategyQuery = useMemo(() => {
    if (!searchStrategy || !selectedStrategyQueryId) return null;
    return searchStrategy.queries.find(q => q.id === selectedStrategyQueryId) || null;
  }, [searchStrategy, selectedStrategyQueryId]);

  const strategyEditorDirty = useMemo(() => {
    if (!selectedStrategyQuery || !strategyEditor) return false;
    const normalize = (value: string) => value.trim();
    const normalizeSources = (values: string[]) => [...values].sort().join('|');
    const selectedYearFrom = selectedStrategyQuery.suggestedYearFrom ? String(selectedStrategyQuery.suggestedYearFrom) : '';
    const selectedYearTo = selectedStrategyQuery.suggestedYearTo ? String(selectedStrategyQuery.suggestedYearTo) : '';

    return (
      normalize(strategyEditor.queryText) !== normalize(selectedStrategyQuery.queryText) ||
      normalize(strategyEditor.description) !== normalize(selectedStrategyQuery.description) ||
      strategyEditor.category !== selectedStrategyQuery.category ||
      normalizeSources(strategyEditor.suggestedSources) !== normalizeSources(selectedStrategyQuery.suggestedSources || []) ||
      normalize(strategyEditor.suggestedYearFrom) !== selectedYearFrom ||
      normalize(strategyEditor.suggestedYearTo) !== selectedYearTo
    );
  }, [selectedStrategyQuery, strategyEditor]);
  
  // Fetch search strategy
  const fetchSearchStrategy = useCallback(async () => {
    if (!authToken) return;
    try {
      setStrategyLoading(true);
      const response = await fetch(`/api/papers/${sessionId}/search-strategy`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        const strategyData = (data.strategy || null) as SearchStrategyData | null;
        setSearchStrategy(strategyData);
        if (!strategyData || strategyData.queries.length === 0) {
          setStrategyDetailsOpen(false);
        }
        setSelectedStrategyQueryId(prev => {
          if (!strategyData || strategyData.queries.length === 0) return null;
          if (prev && strategyData.queries.some(q => q.id === prev)) return prev;
          return strategyData.queries[0].id;
        });
      }
    } catch (err) {
      console.error('Failed to fetch search strategy:', err);
    } finally {
      setStrategyLoading(false);
    }
  }, [sessionId, authToken]);
  
  // Generate search strategy
  const generateSearchStrategy = async (regenerate = false) => {
    if (!authToken) return;
    try {
      setGeneratingStrategy(true);
      const response = await fetch(`/api/papers/${sessionId}/search-strategy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ regenerate })
      });
      
      const data = await response.json();
      if (response.ok) {
        const strategyData = data.strategy as SearchStrategyData;
        setSearchStrategy(strategyData);
        setSelectedStrategyQueryId(strategyData.queries?.[0]?.id || null);
        setStrategyDetailsOpen(false);
        showToast({
          type: 'success',
          title: 'Search Strategy Generated',
          message: `Created ${strategyData.queries.length} systematic search queries`,
          duration: 4000
        });
      } else {
        // Handle Pro plan requirement
        if (data.code === 'PRO_REQUIRED') {
          showToast({
            type: 'info',
            title: '✨ Pro Feature',
            message: 'AI Search Strategy is a Pro feature. Upgrade your plan to access systematic search query generation.',
            duration: 6000
          });
        } else {
          showToast({
            type: 'error',
            title: 'Generation Failed',
            message: data.error || 'Could not generate search strategy',
            duration: 5000
          });
        }
      }
    } catch (err) {
      console.error('Failed to generate search strategy:', err);
    } finally {
      setGeneratingStrategy(false);
    }
  };
  
  // Update query status
  const updateQueryStatus = async (
    queryId: string,
    status: SearchStrategyQuery['status'],
    resultsCount?: number,
    importedCount?: number
  ) => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/search-strategy`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ queryId, status, resultsCount, importedCount })
      });
      
      if (response.ok) {
        const data = await response.json();
        // Refresh strategy to get updated progress
        await fetchSearchStrategy();
      }
    } catch (err) {
      console.error('Failed to update query status:', err);
    }
  };
  
  // Track current strategy query being executed
  const [currentStrategyQueryId, setCurrentStrategyQueryId] = useState<string | null>(null);

  const loadStrategyQueryIntoSearchForm = useCallback((strategyQuery: SearchStrategyQuery) => {
    setQuery(strategyQuery.queryText);
    if (strategyQuery.suggestedSources && strategyQuery.suggestedSources.length > 0) {
      setSources(strategyQuery.suggestedSources);
    }
    setYearFrom(strategyQuery.suggestedYearFrom ? strategyQuery.suggestedYearFrom.toString() : '');
    setYearTo(strategyQuery.suggestedYearTo ? strategyQuery.suggestedYearTo.toString() : '');
    setAddMode('search');
  }, []);

  const toggleStrategySource = useCallback((sourceValue: string, checked: boolean) => {
    setStrategyEditor(prev => {
      if (!prev) return prev;
      if (checked) {
        if (prev.suggestedSources.includes(sourceValue)) return prev;
        return { ...prev, suggestedSources: [...prev.suggestedSources, sourceValue] };
      }
      return { ...prev, suggestedSources: prev.suggestedSources.filter(source => source !== sourceValue) };
    });
  }, []);

  const saveStrategyQueryEdits = useCallback(async () => {
    if (!authToken || !selectedStrategyQuery || !strategyEditor) return;

    const queryText = strategyEditor.queryText.trim();
    if (queryText.length < 2) {
      showToast({
        type: 'error',
        title: 'Query text required',
        message: 'Query text must be at least 2 characters long.',
        duration: 4000
      });
      return;
    }

    const parseYear = (value: string): number | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
        throw new Error('Years must be integers between 1900 and 2100.');
      }
      return parsed;
    };

    let suggestedYearFrom: number | null;
    let suggestedYearTo: number | null;
    try {
      suggestedYearFrom = parseYear(strategyEditor.suggestedYearFrom);
      suggestedYearTo = parseYear(strategyEditor.suggestedYearTo);
      if (suggestedYearFrom !== null && suggestedYearTo !== null && suggestedYearFrom > suggestedYearTo) {
        throw new Error('Start year must be less than or equal to end year.');
      }
    } catch (validationError) {
      showToast({
        type: 'error',
        title: 'Invalid year range',
        message: validationError instanceof Error ? validationError.message : 'Please check year values.',
        duration: 4500
      });
      return;
    }

    try {
      setSavingStrategyQuery(true);
      const response = await fetch(`/api/papers/${sessionId}/search-strategy`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          queryId: selectedStrategyQuery.id,
          queryText,
          description: strategyEditor.description.trim(),
          category: strategyEditor.category,
          suggestedSources: strategyEditor.suggestedSources,
          suggestedYearFrom,
          suggestedYearTo
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save strategy query');
      }

      showToast({
        type: 'success',
        title: 'Search strategy updated',
        message: 'Your query edits have been saved.',
        duration: 3000
      });

      await fetchSearchStrategy();
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Could not update this strategy query.',
        duration: 4500
      });
    } finally {
      setSavingStrategyQuery(false);
    }
  }, [authToken, selectedStrategyQuery, strategyEditor, showToast, sessionId, fetchSearchStrategy]);

  const resetStrategyEditor = useCallback(() => {
    if (!selectedStrategyQuery) return;
    setStrategyEditor(toStrategyEditorState(selectedStrategyQuery));
    setStrategyEditorQueryId(selectedStrategyQuery.id);
  }, [selectedStrategyQuery, toStrategyEditorState]);

  const showStrategyQueryDetails = useCallback((strategyQuery: SearchStrategyQuery) => {
    setSelectedStrategyQueryId(strategyQuery.id);
    setStrategyEditor(toStrategyEditorState(strategyQuery));
    setStrategyEditorQueryId(strategyQuery.id);
    setStrategyDetailsOpen(true);
  }, [toStrategyEditorState]);
  
  // Execute a strategy query - fills search box and triggers search
  const executeStrategyQuery = async (strategyQuery: SearchStrategyQuery) => {
    // Track which strategy query we're executing
    setCurrentStrategyQueryId(strategyQuery.id);
    loadStrategyQueryIntoSearchForm(strategyQuery);
    setSelectedStrategyQueryId(strategyQuery.id);
    setStrategyEditor(toStrategyEditorState(strategyQuery));
    setStrategyEditorQueryId(strategyQuery.id);

    const selectedSources = strategyQuery.suggestedSources && strategyQuery.suggestedSources.length > 0
      ? strategyQuery.suggestedSources
      : sources;
    const selectedYearFrom = strategyQuery.suggestedYearFrom ? strategyQuery.suggestedYearFrom.toString() : yearFrom;
    const selectedYearTo = strategyQuery.suggestedYearTo ? strategyQuery.suggestedYearTo.toString() : yearTo;
    
    // Update query status to searching
    await updateQueryStatus(strategyQuery.id, 'SEARCHING');

    // Trigger the actual search immediately (no second click)
    await handleSearch({
      query: strategyQuery.queryText,
      sources: selectedSources,
      yearFrom: selectedYearFrom,
      yearTo: selectedYearTo,
      strategyQueryId: strategyQuery.id
    });
  };
  
  // Keep an editor loaded for the currently selected strategy query
  useEffect(() => {
    if (!selectedStrategyQuery) {
      setStrategyEditor(null);
      setStrategyEditorQueryId(null);
      setStrategyDetailsOpen(false);
      return;
    }

    if (strategyEditorQueryId !== selectedStrategyQuery.id) {
      setStrategyEditor(toStrategyEditorState(selectedStrategyQuery));
      setStrategyEditorQueryId(selectedStrategyQuery.id);
    }
  }, [selectedStrategyQuery, strategyEditorQueryId, toStrategyEditorState]);

  // Load search strategy on mount
  useEffect(() => {
    fetchSearchStrategy();
  }, [fetchSearchStrategy]);
  
  // Fetch abstract for a search result
  const [fetchingAbstract, setFetchingAbstract] = useState<string | null>(null);
  const [fetchAbstractFailed, setFetchAbstractFailed] = useState<Set<string>>(new Set());
  
  // Manual abstract entry modal
  const [manualAbstractModalOpen, setManualAbstractModalOpen] = useState(false);
  const [manualAbstractResultId, setManualAbstractResultId] = useState<string | null>(null);
  const [manualAbstractText, setManualAbstractText] = useState('');
  const [manualAbstractResultTitle, setManualAbstractResultTitle] = useState('');
  
  // Delete confirmation modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  
  // Toggle view: 'results' | 'coverage' for blueprint dimension coverage view
  const [searchViewMode, setSearchViewMode] = useState<'results' | 'coverage'>(
    isFullTextEvidenceMode ? 'coverage' : 'results'
  );

  useEffect(() => {
    if (!isFullTextEvidenceMode) return;
    setMainTab('find');
    setSearchViewMode('coverage');
  }, [isFullTextEvidenceMode]);
  
  // Blueprint coverage data from AI analysis
  const [blueprintCoverage, setBlueprintCoverage] = useState<{
    totalDimensions: number;
    coveredDimensions: number;
    gaps: Array<{
      sectionKey: string;
      sectionTitle: string;
      dimension: string;
    }>;
    sectionCoverage: Record<string, {
      total: number;
      covered: number;
      dimensions: Array<{
        dimension: string;
        paperCount: number;
        papers: string[];
      }>;
    }>;
  } | null>(null);
  
  // Dimension mappings for papers (from AI analysis)
  const [paperDimensionMappings, setPaperDimensionMappings] = useState<Map<string, Array<{
    sectionKey: string;
    dimension: string;
    remark: string;
    confidence: MappingConfidence;
  }>>>(new Map());
  
  // Import recommendation from AI
  const [paperRecommendations, setPaperRecommendations] = useState<Map<string, 'IMPORT' | 'MAYBE' | 'SKIP'>>(new Map());

  // Coverage UX: default evidence-first table + bipartite matrix alternate
  const [coverageSubView, setCoverageSubView] = useState<'evidence_table' | 'matrix'>('evidence_table');
  const [coverageDimensionFamilyFilter, setCoverageDimensionFamilyFilter] = useState<string>('all');
  const [coverageYearFilter, setCoverageYearFilter] = useState<string>('all');
  const [coverageVenueFilter, setCoverageVenueFilter] = useState('');
  const [coverageAffiliationFilter, setCoverageAffiliationFilter] = useState('');
  const [coverageStrengthFilter, setCoverageStrengthFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [coverageShowGapsMode, setCoverageShowGapsMode] = useState(false);
  const [coverageFeedback, setCoverageFeedback] = useState<Map<string, CoverageRowFeedback>>(new Map());
  const [coverageSectionOptionsFromServer, setCoverageSectionOptionsFromServer] = useState<CoverageSectionOption[]>([]);
  const [coverageSavingRows, setCoverageSavingRows] = useState<Set<string>>(new Set());
  const [coverageRemapRow, setCoverageRemapRow] = useState<CoverageEvidenceRow | null>(null);
  const [coverageRemapSectionKey, setCoverageRemapSectionKey] = useState('');
  const [coverageRemapDimension, setCoverageRemapDimension] = useState('');
  const [coverageRemapRemark, setCoverageRemapRemark] = useState('');
  const [coverageRemapSubmitting, setCoverageRemapSubmitting] = useState(false);
  const [activeCoverageEvidence, setActiveCoverageEvidence] = useState<CoverageEvidenceRow | null>(null);
  
  // Citation analysis state (for analyzing imported citations against blueprint)
  const [citationAnalyzing, setCitationAnalyzing] = useState(false);
  const [citationReviewStatus, setCitationReviewStatus] = useState<{
    total: number;
    reviewed: number;
    inProcess: number;
    retry: number;
  } | null>(null);
  const [analyzedCitationIds, setAnalyzedCitationIds] = useState<Set<string>>(new Set());
  const [citationDimensionMappings, setCitationDimensionMappings] = useState<Map<string, Array<{
    sectionKey: string;
    dimension: string;
    remark: string;
    confidence: MappingConfidence;
  }>>>(new Map());
  const [citationAiAnalysis, setCitationAiAnalysis] = useState<Map<string, {
    isRelevant: boolean;
    relevanceScore: number;
    reasoning: string;
    recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
  }>>(new Map());
  // Per-paper failure count: prevents infinite token consumption from persistently failing papers.
  // Papers that exceed MAX_ANALYSIS_ATTEMPTS are excluded from future analysis runs.
  const MAX_ANALYSIS_ATTEMPTS = 2;
  const [citationFailureCounts, setCitationFailureCounts] = useState<Map<string, number>>(new Map());
  // Papers skipped from analysis because they lack an abstract (no useful data for LLM)
  const [citationSkippedNoAbstract, setCitationSkippedNoAbstract] = useState<Set<string>>(new Set());
  const [citationBlueprintCoverage, setCitationBlueprintCoverage] = useState<{
    totalDimensions: number;
    coveredDimensions: number;
    gaps: Array<{
      sectionKey: string;
      sectionTitle: string;
      dimension: string;
    }>;
    sectionCoverage: Record<string, {
      total: number;
      covered: number;
      dimensions: Array<{
        dimension: string;
        paperCount: number;
        papers: string[];
      }>;
    }>;
  } | null>(null);

  const coverageEvidenceRows = useMemo<CoverageEvidenceRow[]>(() => {
    if (!blueprintCoverage) return [];

    const resultById = new Map<string, any>(results.map(result => [String(result.id), result]));
    const rows: CoverageEvidenceRow[] = [];
    const seen = new Set<string>();

    for (const [paperId, mappings] of paperDimensionMappings.entries()) {
      const paper = resultById.get(String(paperId)) || {};
      for (const mapping of mappings || []) {
        const sectionKey = String(mapping.sectionKey || '').trim();
        const dimension = String(mapping.dimension || '').trim();
        if (!sectionKey || !dimension) continue;

        const dimensionKey = buildDimensionKey(sectionKey, dimension);
        const rowId = `${paperId}::${dimensionKey}`;
        if (seen.has(rowId)) continue;

        const remark = String(mapping.remark || '').trim();
        const evidenceKind = deriveEvidenceKind(remark);
        const hasLocation = hasLocationSignal(remark, paper);
        const specificity = deriveSpecificity(remark);
        const rubricScore = computeRubricScore(mapping.confidence, evidenceKind, hasLocation, specificity);
        const affiliationParts: string[] = [];
        if (typeof paper?.publisher === 'string') affiliationParts.push(paper.publisher);
        if (typeof paper?.venue === 'string') affiliationParts.push(paper.venue);
        if (typeof paper?.rawData?.institution === 'string') affiliationParts.push(paper.rawData.institution);
        if (Array.isArray(paper?.rawData?.affiliations)) affiliationParts.push(paper.rawData.affiliations.join(' '));
        if (typeof paper?.rawData?.host_venue?.publisher === 'string') affiliationParts.push(paper.rawData.host_venue.publisher);

        rows.push({
          id: rowId,
          paperId: String(paperId),
          paperTitle: typeof paper?.title === 'string' && paper.title.trim() ? paper.title : 'Untitled paper',
          sectionKey,
          dimension,
          dimensionKey,
          remark,
          confidence: mapping.confidence,
          evidenceKind,
          hasLocation,
          locationLabel: extractLocationLabel(remark, paper),
          specificity,
          rubricScore,
          rubricBand: rubricBandFromScore(rubricScore),
          authors: Array.isArray(paper?.authors) ? paper.authors.filter((author: any) => typeof author === 'string' && author.trim()) : [],
          year: typeof paper?.year === 'number' ? paper.year : null,
          venue: typeof paper?.venue === 'string' ? paper.venue : '',
          publisher: typeof paper?.publisher === 'string' ? paper.publisher : '',
          pages: typeof paper?.pages === 'string' ? paper.pages : '',
          doi: typeof paper?.doi === 'string' ? paper.doi : '',
          url: typeof paper?.url === 'string' ? paper.url : '',
          affiliationText: affiliationParts.join(' ')
        });
        seen.add(rowId);
      }
    }

    for (const [sectionKey, section] of Object.entries(blueprintCoverage.sectionCoverage || {})) {
      for (const dimensionNode of section.dimensions || []) {
        const dimension = String(dimensionNode.dimension || '').trim();
        const dimensionKey = buildDimensionKey(sectionKey, dimension);
        for (const paperId of dimensionNode.papers || []) {
          const rowId = `${paperId}::${dimensionKey}`;
          if (seen.has(rowId)) continue;
          const paper = resultById.get(String(paperId)) || {};
          rows.push({
            id: rowId,
            paperId: String(paperId),
            paperTitle: typeof paper?.title === 'string' && paper.title.trim() ? paper.title : 'Untitled paper',
            sectionKey,
            dimension,
            dimensionKey,
            remark: '',
            confidence: 'LOW',
            evidenceKind: 'INFERRED',
            hasLocation: false,
            locationLabel: 'Location not provided',
            specificity: 'LOW',
            rubricScore: computeRubricScore('LOW', 'INFERRED', false, 'LOW'),
            rubricBand: 'low',
            authors: Array.isArray(paper?.authors) ? paper.authors.filter((author: any) => typeof author === 'string' && author.trim()) : [],
            year: typeof paper?.year === 'number' ? paper.year : null,
            venue: typeof paper?.venue === 'string' ? paper.venue : '',
            publisher: typeof paper?.publisher === 'string' ? paper.publisher : '',
            pages: typeof paper?.pages === 'string' ? paper.pages : '',
            doi: typeof paper?.doi === 'string' ? paper.doi : '',
            url: typeof paper?.url === 'string' ? paper.url : '',
            affiliationText: typeof paper?.publisher === 'string' ? paper.publisher : ''
          });
          seen.add(rowId);
        }
      }
    }

    return rows.sort((a, b) => {
      if (a.sectionKey !== b.sectionKey) return a.sectionKey.localeCompare(b.sectionKey);
      if (a.dimension !== b.dimension) return a.dimension.localeCompare(b.dimension);
      return a.paperTitle.localeCompare(b.paperTitle);
    });
  }, [blueprintCoverage, paperDimensionMappings, results]);

  const coverageDimensionFamilies = useMemo(() => {
    const families = new Set<string>();
    for (const row of coverageEvidenceRows) {
      families.add(row.sectionKey);
    }
    return Array.from(families).sort((a, b) => a.localeCompare(b));
  }, [coverageEvidenceRows]);

  const coverageYears = useMemo(() => {
    const years = new Set<number>();
    for (const row of coverageEvidenceRows) {
      if (typeof row.year === 'number') years.add(row.year);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [coverageEvidenceRows]);

  const filteredCoverageRows = useMemo(() => {
    const venueFilter = normalizeCoverageToken(coverageVenueFilter);
    const affiliationFilter = normalizeCoverageToken(coverageAffiliationFilter);

    return coverageEvidenceRows.filter(row => {
      if (coverageDimensionFamilyFilter !== 'all' && row.sectionKey !== coverageDimensionFamilyFilter) return false;
      if (coverageYearFilter !== 'all' && String(row.year ?? '') !== coverageYearFilter) return false;
      if (coverageStrengthFilter !== 'all' && row.rubricBand !== coverageStrengthFilter) return false;
      if (venueFilter && !normalizeCoverageToken(`${row.venue} ${row.paperTitle}`).includes(venueFilter)) return false;
      if (affiliationFilter && !normalizeCoverageToken(row.affiliationText).includes(affiliationFilter)) return false;
      return true;
    });
  }, [
    coverageEvidenceRows,
    coverageDimensionFamilyFilter,
    coverageYearFilter,
    coverageVenueFilter,
    coverageAffiliationFilter,
    coverageStrengthFilter
  ]);

  const coverageGapKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const gap of blueprintCoverage?.gaps || []) {
      keys.add(buildDimensionKey(gap.sectionKey, gap.dimension));
    }
    return keys;
  }, [blueprintCoverage]);

  const coverageMatrixDimensions = useMemo(() => {
    if (!blueprintCoverage?.sectionCoverage) return [] as Array<{
      key: string;
      sectionKey: string;
      dimension: string;
      isGap: boolean;
    }>;

    const dimensions: Array<{ key: string; sectionKey: string; dimension: string; isGap: boolean }> = [];

    for (const [sectionKey, section] of Object.entries(blueprintCoverage.sectionCoverage)) {
      if (coverageDimensionFamilyFilter !== 'all' && sectionKey !== coverageDimensionFamilyFilter) continue;

      for (const dim of section.dimensions || []) {
        const dimension = String(dim.dimension || '').trim();
        const key = buildDimensionKey(sectionKey, dimension);
        dimensions.push({
          key,
          sectionKey,
          dimension,
          isGap: coverageGapKeys.has(key)
        });
      }
    }

    return dimensions.sort((a, b) => {
      if (a.sectionKey !== b.sectionKey) return a.sectionKey.localeCompare(b.sectionKey);
      return a.dimension.localeCompare(b.dimension);
    });
  }, [blueprintCoverage, coverageDimensionFamilyFilter, coverageGapKeys]);

  const coverageMatrixDimensionDisplay = useMemo(() => {
    const sectionCounters = new Map<string, number>();
    return coverageMatrixDimensions.map(dimension => {
      const sectionTokens = String(dimension.sectionKey || '')
        .trim()
        .toUpperCase()
        .split(/[\s_\-]+/)
        .filter(Boolean);
      const sectionCode = sectionTokens.length > 1
        ? sectionTokens.map(token => token[0]).join('').slice(0, 3)
        : (sectionTokens[0] || 'DIM').slice(0, 3);
      const count = (sectionCounters.get(sectionCode) || 0) + 1;
      sectionCounters.set(sectionCode, count);
      return {
        ...dimension,
        identifier: `${sectionCode}-${count}`
      };
    });
  }, [coverageMatrixDimensions]);

  const coverageRowsByCell = useMemo(() => {
    const lookup = new Map<string, CoverageEvidenceRow[]>();
    for (const row of filteredCoverageRows) {
      const key = `${row.paperId}::${row.dimensionKey}`;
      if (!lookup.has(key)) lookup.set(key, []);
      lookup.get(key)!.push(row);
    }
    return lookup;
  }, [filteredCoverageRows]);

  const coverageMatrixPapers = useMemo(() => {
    const papers = new Map<string, { id: string; title: string; year: number | null; venue: string }>();
    for (const row of filteredCoverageRows) {
      if (!papers.has(row.paperId)) {
        papers.set(row.paperId, {
          id: row.paperId,
          title: row.paperTitle,
          year: row.year,
          venue: row.venue
        });
      }
    }
    return Array.from(papers.values()).sort((a, b) => {
      if ((a.year || 0) !== (b.year || 0)) return (b.year || 0) - (a.year || 0);
      return a.title.localeCompare(b.title);
    });
  }, [filteredCoverageRows]);

  const coverageSectionOptions = useMemo<CoverageSectionOption[]>(() => {
    const fromBlueprint = Array.isArray((session as any)?.paperBlueprint?.sectionPlan)
      ? (session as any).paperBlueprint.sectionPlan
          .map((section: any) => ({
            sectionKey: String(section?.sectionKey || '').trim(),
            sectionTitle: String(section?.purpose || section?.sectionKey || '').trim(),
            dimensions: Array.isArray(section?.mustCover)
              ? section.mustCover.map((dim: any) => String(dim || '').trim()).filter(Boolean)
              : []
          }))
          .filter((section: CoverageSectionOption) => section.sectionKey && section.dimensions.length > 0)
      : [];
    if (fromBlueprint.length > 0) {
      return fromBlueprint;
    }
    if (coverageSectionOptionsFromServer.length > 0) {
      return coverageSectionOptionsFromServer;
    }

    return Object.entries(blueprintCoverage?.sectionCoverage || {}).map(([sectionKey, section]) => ({
      sectionKey,
      sectionTitle: sectionKey,
      dimensions: (section.dimensions || [])
        .map(dim => String(dim.dimension || '').trim())
        .filter(Boolean)
    })).filter(section => section.dimensions.length > 0);
  }, [session, coverageSectionOptionsFromServer, blueprintCoverage]);

  const coverageSectionOptionMap = useMemo(() => {
    return new Map(coverageSectionOptions.map(option => [option.sectionKey, option]));
  }, [coverageSectionOptions]);

  const coverageRemapDimensionOptions = useMemo(() => {
    const dimensions = coverageSectionOptionMap.get(coverageRemapSectionKey)?.dimensions || [];
    if (dimensions.length > 0) {
      return dimensions;
    }
    return coverageRemapRow?.dimension ? [coverageRemapRow.dimension] : [];
  }, [coverageSectionOptionMap, coverageRemapSectionKey, coverageRemapRow]);

  const citationLookup = useMemo(() => {
    const byId = new Set<string>();
    const byDoi = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const citation of citations) {
      const citationId = String(citation?.id || '');
      if (!citationId) continue;
      byId.add(citationId);
      const doiKey = normalizeDoiKey(citation?.doi);
      if (doiKey && !byDoi.has(doiKey)) byDoi.set(doiKey, citationId);
      const tKey = titleKey(citation?.title);
      if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, citationId);
    }
    return { byId, byDoi, byTitle };
  }, [citations, normalizeDoiKey, titleKey]);

  const resultsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const result of results) {
      if (result?.id) {
        map.set(String(result.id), result);
      }
    }
    return map;
  }, [results]);

  const resolveCoverageRowCitationId = useCallback((row: CoverageEvidenceRow): string | null => {
    if (citationLookup.byId.has(row.paperId)) {
      return row.paperId;
    }
    const backingResult = resultsById.get(row.paperId);
    const doiKey = normalizeDoiKey(row.doi || backingResult?.doi);
    if (doiKey && citationLookup.byDoi.has(doiKey)) {
      return citationLookup.byDoi.get(doiKey) || null;
    }
    const tKey = titleKey(row.paperTitle || backingResult?.title);
    if (tKey && citationLookup.byTitle.has(tKey)) {
      return citationLookup.byTitle.get(tKey) || null;
    }
    return null;
  }, [citationLookup, resultsById, normalizeDoiKey, titleKey]);

  const updateCoverageFeedbackState = useCallback((
    rowId: string,
    inclusionStatus: 'INCLUDED' | 'EXCLUDED',
    reviewComment = ''
  ) => {
    setCoverageFeedback(prev => {
      const next = new Map(prev);
      next.set(rowId, { inclusionStatus, reviewComment });
      return next;
    });
  }, []);

  const setCoverageRowSaving = useCallback((rowId: string, saving: boolean) => {
    setCoverageSavingRows(prev => {
      const next = new Set(prev);
      if (saving) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  const updateCoverageInclusion = useCallback(async (
    row: CoverageEvidenceRow,
    inclusionStatus: 'INCLUDED' | 'EXCLUDED'
  ) => {
    if (!authToken) return;
    const citationId = resolveCoverageRowCitationId(row);
    if (!citationId) {
      showToast({
        type: 'info',
        title: 'Import required',
        message: 'This paper must be added to citations before inclusion state can be persisted.',
        duration: 3500
      });
      updateCoverageFeedbackState(row.id, inclusionStatus);
      return;
    }

    setCoverageRowSaving(row.id, true);
    try {
      const response = await fetch(`/api/papers/${sessionId}/literature/mapping-review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          citationId,
          sectionKey: row.sectionKey,
          dimension: row.dimension,
          action: inclusionStatus === 'INCLUDED' ? 'CONFIRM' : 'REMOVE'
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update mapping status');
      }

      updateCoverageFeedbackState(row.id, inclusionStatus, String(payload?.mapping?.reviewComment || ''));
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : 'Could not update mapping state',
        duration: 4500
      });
    } finally {
      setCoverageRowSaving(row.id, false);
    }
  }, [resolveCoverageRowCitationId, showToast, updateCoverageFeedbackState, setCoverageRowSaving, sessionId, authToken]);

  const openCoverageRemapDialog = useCallback((row: CoverageEvidenceRow) => {
    const matchedSection = coverageSectionOptions.find(section =>
      normalizeCoverageToken(section.sectionKey) === normalizeCoverageToken(row.sectionKey)
    ) || coverageSectionOptions[0];
    const nextSectionKey = matchedSection?.sectionKey || row.sectionKey;
    const nextDimension = matchedSection?.dimensions.find(dim =>
      normalizeCoverageToken(dim) === normalizeCoverageToken(row.dimension)
    ) || matchedSection?.dimensions[0] || row.dimension;

    setCoverageRemapRow(row);
    setCoverageRemapSectionKey(nextSectionKey);
    setCoverageRemapDimension(nextDimension);
    setCoverageRemapRemark(row.remark || '');
  }, [coverageSectionOptions]);

  const submitCoverageRemap = useCallback(async () => {
    if (!coverageRemapRow) return;
    if (!authToken) return;

    const citationId = resolveCoverageRowCitationId(coverageRemapRow);
    if (!citationId) {
      showToast({
        type: 'info',
        title: 'Import required',
        message: 'This paper must be added to citations before mapping changes can be persisted.',
        duration: 3500
      });
      return;
    }

    setCoverageRemapSubmitting(true);
    try {
      const response = await fetch(`/api/papers/${sessionId}/literature/mapping-review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          citationId,
          sectionKey: coverageRemapRow.sectionKey,
          dimension: coverageRemapRow.dimension,
          action: 'CHANGE_MAPPING',
          newSectionKey: coverageRemapSectionKey,
          newDimension: coverageRemapDimension,
          newRemark: coverageRemapRemark
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update mapping');
      }

      setPaperDimensionMappings(prev => {
        const next = new Map(prev);
        const existing = next.get(coverageRemapRow.paperId) || [];
        const filtered = existing.filter(mapping =>
          normalizeCoverageToken(mapping.sectionKey) !== normalizeCoverageToken(coverageRemapRow.sectionKey)
          || normalizeCoverageToken(mapping.dimension) !== normalizeCoverageToken(coverageRemapRow.dimension)
        );
        next.set(coverageRemapRow.paperId, [
          ...filtered,
          {
            sectionKey: payload?.mapping?.sectionKey || coverageRemapSectionKey,
            dimension: payload?.mapping?.dimension || coverageRemapDimension,
            remark: payload?.mapping?.remark || coverageRemapRemark.trim(),
            confidence: (payload?.mapping?.confidence || coverageRemapRow.confidence) as MappingConfidence
          }
        ]);
        return next;
      });

      updateCoverageFeedbackState(
        `${coverageRemapRow.paperId}::${buildDimensionKey(payload?.mapping?.sectionKey || coverageRemapSectionKey, payload?.mapping?.dimension || coverageRemapDimension)}`,
        'INCLUDED',
        String(payload?.mapping?.reviewComment || '')
      );
      setCoverageFeedback(prev => {
        const next = new Map(prev);
        next.delete(coverageRemapRow.id);
        return next;
      });

      setCoverageRemapRow(null);
      setCoverageRemapSectionKey('');
      setCoverageRemapDimension('');
      setCoverageRemapRemark('');
      showToast({
        type: 'success',
        title: 'Mapping updated',
        message: 'Paper mapping was updated and marked as included for drafting.',
        duration: 3500
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Remap failed',
        message: err instanceof Error ? err.message : 'Could not update mapping',
        duration: 4500
      });
    } finally {
      setCoverageRemapSubmitting(false);
    }
  }, [
    coverageRemapRow,
    resolveCoverageRowCitationId,
    showToast,
    sessionId,
    authToken,
    coverageRemapSectionKey,
    coverageRemapDimension,
    coverageRemapRemark,
    updateCoverageFeedbackState
  ]);

  const loadPersistedCoverageReview = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/literature/mapping-review`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const reviewMappings: MappingReviewRecord[] = Array.isArray(payload?.mappings) ? payload.mappings : [];
      const sectionOptions: CoverageSectionOption[] = Array.isArray(payload?.sectionOptions) ? payload.sectionOptions : [];
      if (sectionOptions.length > 0) {
        setCoverageSectionOptionsFromServer(
          sectionOptions.map(option => ({
            sectionKey: String(option.sectionKey || '').trim(),
            sectionTitle: String(option.sectionTitle || option.sectionKey || '').trim(),
            dimensions: Array.isArray(option.dimensions)
              ? option.dimensions.map(dim => String(dim || '').trim()).filter(Boolean)
              : []
          })).filter(option => option.sectionKey && option.dimensions.length > 0)
        );
      }
      if (reviewMappings.length === 0) {
        return;
      }

      const resultLookup = buildResultLookup(results);
      const citationToResultIds = new Map<string, Set<string>>();
      for (const citation of citations) {
        const citationId = String(citation?.id || '');
        if (!citationId) continue;
        const resultIds = new Set<string>();
        if (resultLookup.byId.has(citationId)) {
          resultIds.add(citationId);
        }
        const doiMatch = normalizeDoiKey(citation?.doi);
        if (doiMatch && resultLookup.byDoi.has(doiMatch)) {
          resultIds.add(String(resultLookup.byDoi.get(doiMatch)));
        }
        const titleMatch = titleKey(citation?.title);
        if (titleMatch && resultLookup.byTitle.has(titleMatch)) {
          resultIds.add(String(resultLookup.byTitle.get(titleMatch)));
        }
        if (resultIds.size > 0) {
          citationToResultIds.set(citationId, resultIds);
        }
      }

      const mappingsByCitation = new Map<string, Array<{
        sectionKey: string;
        dimension: string;
        remark: string;
        confidence: MappingConfidence;
      }>>();

      for (const mapping of reviewMappings) {
        if (!mapping?.citationId || !mapping?.sectionKey || !mapping?.dimension) continue;
        const group = mappingsByCitation.get(mapping.citationId) || [];
        group.push({
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          remark: mapping.remark || '',
          confidence: mapping.confidence || 'MEDIUM'
        });
        mappingsByCitation.set(mapping.citationId, group);
      }

      setPaperDimensionMappings(prev => {
        const next = new Map(prev);
        for (const [citationId, mappedDims] of mappingsByCitation.entries()) {
          const resultIds = citationToResultIds.get(citationId);
          if (!resultIds || resultIds.size === 0) continue;
          for (const resultId of resultIds) {
            next.set(resultId, mappedDims);
          }
        }
        return next;
      });

      const hydratedFeedback = new Map<string, CoverageRowFeedback>();
      for (const mapping of reviewMappings) {
        const resultIds = citationToResultIds.get(mapping.citationId);
        if (!resultIds || resultIds.size === 0) continue;
        for (const resultId of resultIds) {
          const rowId = `${resultId}::${buildDimensionKey(mapping.sectionKey, mapping.dimension)}`;
          hydratedFeedback.set(rowId, {
            inclusionStatus: mapping.inclusionStatus === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED',
            reviewComment: mapping.reviewComment || ''
          });
        }
      }
      setCoverageFeedback(hydratedFeedback);
    } catch (err) {
      console.warn('[LiteratureSearch] Failed to load persisted mapping review state:', err);
    }
  }, [authToken, sessionId, results, citations, buildResultLookup, normalizeDoiKey, titleKey]);

  useEffect(() => {
    if (!authToken || results.length === 0 || citations.length === 0) return;
    loadPersistedCoverageReview();
  }, [authToken, results.length, citations.length, loadPersistedCoverageReview]);

  const renderCoverageEvidenceCard = useCallback((row: CoverageEvidenceRow) => {
    const scoreClass =
      row.rubricBand === 'high'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : row.rubricBand === 'medium'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-amber-50 text-amber-700 border-amber-200';

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-2">
        <p className="text-xs text-gray-800 leading-relaxed">
          {row.remark || 'No explicit grounding snippet returned. This mapping should be reviewed before relying on it.'}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-[10px] bg-white text-gray-700 border-gray-300">
            {row.evidenceKind === 'DIRECT_QUOTE'
              ? 'Direct quote'
              : row.evidenceKind === 'PARAPHRASE'
                ? 'Paraphrase'
                : 'Inferred'}
          </Badge>
          <Badge variant="outline" className="text-[10px] bg-white text-gray-700 border-gray-300">
            Location: {row.hasLocation ? 'Yes' : 'No'}
          </Badge>
          <Badge variant="outline" className="text-[10px] bg-white text-gray-700 border-gray-300">
            Specificity: {row.specificity}
          </Badge>
          <Badge className={`text-[10px] border-0 ${scoreClass}`}>
            Strength: {row.rubricScore}
          </Badge>
          <Badge variant="outline" className="text-[10px] bg-white text-gray-700 border-gray-300">
            Confidence: {row.confidence}
          </Badge>
        </div>
        <p className="text-[11px] text-gray-500">
          <span className="font-medium text-gray-600">Location:</span> {row.locationLabel}
        </p>
      </div>
    );
  }, []);
  
  const handleFetchAbstract = async (resultId: string, doi?: string) => {
    if (!doi) return;
    setFetchingAbstract(resultId);
    // Clear any previous failure for this result
    setFetchAbstractFailed(prev => {
      const next = new Set(prev);
      next.delete(resultId);
      return next;
    });
    try {
      // Try to fetch abstract from Semantic Scholar or CrossRef
      const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=abstract`);
      if (response.ok) {
        const data = await response.json();
        if (data.abstract) {
          setResults(prev => prev.map(r => 
            r.id === resultId ? { ...r, abstract: data.abstract } : r
          ));
          return; // Success, no need to mark as failed
        }
      }
      // If we get here, fetch didn't return an abstract - mark as failed
      setFetchAbstractFailed(prev => new Set(prev).add(resultId));
      showToast({
        title: 'Abstract not found',
        description: 'Auto-fetch failed. You can add the abstract manually.',
        variant: 'default'
      });
    } catch (err) {
      console.error('Failed to fetch abstract:', err);
      setFetchAbstractFailed(prev => new Set(prev).add(resultId));
      showToast({
        title: 'Fetch failed',
        description: 'Could not fetch abstract. You can add it manually.',
        variant: 'destructive'
      });
    } finally {
      setFetchingAbstract(null);
    }
  };
  
  // Open manual abstract entry modal
  const openManualAbstractModal = (resultId: string, title: string) => {
    setManualAbstractResultId(resultId);
    setManualAbstractResultTitle(title);
    setManualAbstractText('');
    setManualAbstractModalOpen(true);
  };
  
  // Save manually entered abstract
  const saveManualAbstract = () => {
    if (!manualAbstractResultId || !manualAbstractText.trim()) return;
    
    setResults(prev => prev.map(r => 
      r.id === manualAbstractResultId ? { ...r, abstract: manualAbstractText.trim() } : r
    ));
    
    // Clear the failed state for this result
    setFetchAbstractFailed(prev => {
      const next = new Set(prev);
      next.delete(manualAbstractResultId);
      return next;
    });
    
    showToast({
      title: 'Abstract saved',
      description: 'The abstract has been added to this paper.',
      variant: 'default'
    });
    
    // Close modal and reset
    setManualAbstractModalOpen(false);
    setManualAbstractResultId(null);
    setManualAbstractText('');
    setManualAbstractResultTitle('');
  };

  return (
    <div className="space-y-4">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {isFullTextEvidenceMode ? 'Full-Text Evidence Extraction' : 'Literature Search'}
          </h2>
          <p className="text-sm text-gray-500">
            {isFullTextEvidenceMode
              ? 'Retrieve full text, validate mappings, and review grounded evidence coverage.'
              : 'Find papers, analyze relevance, check coverage, and manage citations'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold text-indigo-600">{citations.length}</div>
            <div className="text-xs text-gray-500">
              {citationTargets.recommended ? `of ${citationTargets.recommended} recommended` : 'citations'}
            </div>
          </div>
          {citationTargets.min && citations.length < citationTargets.min && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              Min: {citationTargets.min}
            </Badge>
          )}
          {citations.length >= (citationTargets.min || 0) && (
            <Badge className="bg-emerald-100 text-emerald-700">
              ✓ Met minimum
            </Badge>
          )}
        </div>
      </div>

      {isFullTextEvidenceMode && (
        <div className="flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-indigo-50 to-sky-50 rounded-lg border border-indigo-200 text-xs text-indigo-900">
          <svg className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m2 9H7a2 2 0 01-2-2V5a2 2 0 012-2h5l5 5v11a2 2 0 01-2 2zm-3-10v6m3-3H9" />
          </svg>
          <div>
            <p className="font-medium mb-0.5">Focus</p>
            <p className="text-indigo-800/90 leading-relaxed">
              Use this stage to run Analyze &amp; Map, retrieve and attach full text, and review the Evidence Table / Coverage Matrix before drafting.
            </p>
          </div>
        </div>
      )}

      {/* Workflow Guide - subtle hint for new users */}
      {!isFullTextEvidenceMode && citations.length === 0 && !searchStrategy && (
        <div className="flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 text-xs text-blue-800">
          <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-medium mb-0.5">Getting Started</p>
            <p className="text-blue-700/80 leading-relaxed">
              <span className="font-semibold">1.</span> Generate a Search Strategy to get AI-suggested queries {' '}
              <span className="font-semibold">2.</span> Search &amp; import relevant papers {' '}
              <span className="font-semibold">3.</span> Run Analyze &amp; Map to check blueprint coverage {' '}
              <span className="font-semibold">4.</span> Review your citations in the Paper Citations tab
            </p>
          </div>
        </div>
      )}

      {session?.archetypeEvidenceStale && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="text-sm text-amber-800">
            Evidence packs may be outdated after archetype changes. Refresh mappings before drafting.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAnalyzeUnanalyzedCitations}
            className="border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            Refresh evidence mappings
          </Button>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'find' | 'citations')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="find" className="flex items-center gap-2" title="Search online databases, browse your library, or import references to find papers for your research.">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Find & Add
          </TabsTrigger>
          <TabsTrigger value="citations" className="flex items-center gap-2" title="View and manage all citations you've added to this paper. Analyze coverage and export references.">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Paper Citations ({citations.length})
          </TabsTrigger>
        </TabsList>

        {/* FIND & ADD TAB */}
        <TabsContent value="find" className="space-y-4">
          
          {/* Search Strategy Panel */}
          <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/50 to-violet-50/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStrategyExpanded(!strategyExpanded)}
                    className="flex items-center gap-2 hover:text-indigo-700 transition-colors"
                  >
                    <svg 
                      className={`w-4 h-4 text-indigo-600 transition-transform ${strategyExpanded ? 'rotate-90' : ''}`} 
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <CardTitle className="text-base text-indigo-900">📋 Search Strategy</CardTitle>
                  </button>
                  {searchStrategy && (
                    <Badge 
                      className={`text-xs ${
                        searchStrategy.status === 'COMPLETED' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : searchStrategy.status === 'IN_PROGRESS'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {searchStrategy.progress}% complete
                    </Badge>
                  )}
                </div>
                {!searchStrategy ? (
                  <Button
                    size="sm"
                    onClick={() => generateSearchStrategy(false)}
                    disabled={generatingStrategy}
                    className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white shadow-sm"
                    title="Generate Strategy: Use this first to create an AI search plan before running searches. It prepares query groups for concepts, methods, and comparison literature."
                  >
                    {generatingStrategy ? (
                      <>
                        <svg className="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="mr-1">Generate Strategy</span>
                        <Badge className="bg-amber-400/90 text-amber-900 text-[9px] px-1 py-0">PRO</Badge>
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateSearchStrategy(true)}
                    disabled={generatingStrategy}
                    className="text-violet-700 border-violet-300 hover:bg-violet-50"
                    title="Regenerate Strategy: Rebuild the search plan after changing your topic, scope, or blueprint dimensions."
                  >
                    {generatingStrategy ? 'Regenerating...' : 'Regenerate'}
                  </Button>
                )}
              </div>
              {!searchStrategy && (
                <CardDescription className="text-xs text-indigo-700/70">
                  Generate AI-powered search queries for systematic literature coverage
                </CardDescription>
              )}
            </CardHeader>
            
            <AnimatePresence>
              {strategyExpanded && searchStrategy && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <CardContent className="pt-0 pb-3">
                    {/* Strategy Summary */}
                    {searchStrategy.summary && (
                      <p className="text-xs text-indigo-800 mb-3 p-2 bg-white/50 rounded border border-indigo-100">
                        💡 {searchStrategy.summary}
                      </p>
                    )}
                    
                    {/* Progress Bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-indigo-700 mb-1">
                        <span>{searchStrategy.completedQueries} of {searchStrategy.totalQueries} queries completed</span>
                        <span>~{searchStrategy.estimatedPapers} papers estimated</span>
                      </div>
                      <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                          style={{ width: `${searchStrategy.progress}%` }}
                        />
                      </div>
                    </div>
                    
                    {/* Query List */}
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {searchStrategy.queries.map((strategyQuery: SearchStrategyQuery) => {
                        const categoryIcons: Record<string, string> = {
                          CORE_CONCEPTS: '🎯',
                          DOMAIN_APPLICATION: '🏭',
                          METHODOLOGY: '⚙️',
                          THEORETICAL_FOUNDATION: '📚',
                          SURVEYS_REVIEWS: '📊',
                          COMPETING_APPROACHES: '⚔️',
                          RECENT_ADVANCES: '🚀',
                          GAP_IDENTIFICATION: '🔍',
                          CUSTOM: '✏️'
                        };

                        const statusColors: Record<string, string> = {
                          PENDING: 'bg-gray-100 text-gray-600 border-gray-200',
                          SEARCHING: 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse',
                          SEARCHED: 'bg-blue-100 text-blue-700 border-blue-200',
                          COMPLETED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                          SKIPPED: 'bg-gray-100 text-gray-400 border-gray-200 line-through'
                        };
                        const isSelected = strategyDetailsOpen && selectedStrategyQueryId === strategyQuery.id;

                        return (
                          <div
                            key={strategyQuery.id}
                            className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                              isSelected
                                ? 'bg-indigo-50 border-indigo-300 shadow-sm'
                                : strategyQuery.status === 'COMPLETED' || strategyQuery.status === 'SKIPPED'
                                  ? 'bg-gray-50/50 border-gray-200'
                                  : 'bg-white hover:shadow-sm'
                            }`}
                          >
                            <span className="text-sm shrink-0">{categoryIcons[strategyQuery.category] || '📄'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${
                                  strategyQuery.status === 'SKIPPED' ? 'text-gray-400 line-through' : 'text-gray-900'
                                }`}>
                                  {strategyQuery.queryText}
                                </span>
                                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${statusColors[strategyQuery.status]}`}>
                                  {strategyQuery.status === 'COMPLETED' && strategyQuery.importedCount !== null
                                    ? `✓ ${strategyQuery.importedCount} imported`
                                    : strategyQuery.status.toLowerCase().replace('_', ' ')
                                  }
                                </Badge>
                              </div>
                              <p className="text-[10px] text-gray-500 truncate">{strategyQuery.description}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  showStrategyQueryDetails(strategyQuery);
                                }}
                                className="h-6 text-[10px] px-2 border-indigo-200 text-indigo-700"
                              >
                                {isSelected && strategyDetailsOpen ? 'Shown' : 'Show'}
                              </Button>
                              {strategyQuery.status === 'PENDING' && (
                                <Button
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    executeStrategyQuery(strategyQuery);
                                  }}
                                  className="h-6 text-[10px] px-2 bg-indigo-600 hover:bg-indigo-700"
                                >
                                  Search {'→'}
                                </Button>
                              )}
                              {strategyQuery.status === 'SEARCHING' && (
                                <span className="text-[10px] text-amber-600 animate-pulse">Searching...</span>
                              )}
                              {strategyQuery.status === 'SEARCHED' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      updateQueryStatus(strategyQuery.id, 'COMPLETED', strategyQuery.resultsCount || undefined, citations.length);
                                    }}
                                    className="h-6 text-[10px] px-2 text-emerald-600 border-emerald-300"
                                  >
                                    ✓ Done
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      updateQueryStatus(strategyQuery.id, 'SKIPPED');
                                    }}
                                    className="h-6 text-[10px] px-1 text-gray-400"
                                  >
                                    Skip
                                  </Button>
                                </>
                              )}
                              {(strategyQuery.status === 'COMPLETED' || strategyQuery.status === 'SKIPPED') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    executeStrategyQuery(strategyQuery);
                                  }}
                                  className="h-6 text-[10px] px-1 text-gray-400"
                                  title="Search again"
                                >
                                  🔄
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {strategyDetailsOpen && selectedStrategyQuery && strategyEditor && (
                      <div className="mt-3 rounded-lg border border-indigo-200 bg-white/80 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold text-indigo-900">Selected strategy query</p>
                            <p className="text-[10px] text-indigo-700/80">Edit details, then save. Changes affect future runs.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] border-indigo-200 text-indigo-700">
                              {selectedStrategyQuery.status.toLowerCase().replace('_', ' ')}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setStrategyDetailsOpen(false)}
                              className="h-6 text-[10px] px-2 text-gray-500"
                            >
                              Hide
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-[11px] font-medium text-gray-700">Query text</label>
                          <Input
                            value={strategyEditor.queryText}
                            onChange={(event) => setStrategyEditor(prev => prev ? { ...prev, queryText: event.target.value } : prev)}
                            placeholder="Search query keywords"
                            className="h-8 text-xs"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-gray-700">Category</label>
                            <select
                              value={strategyEditor.category}
                              onChange={(event) => setStrategyEditor(prev => prev ? { ...prev, category: event.target.value as SearchQueryCategory } : prev)}
                              className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
                            >
                              {SEARCH_QUERY_CATEGORIES.map(categoryOption => (
                                <option key={categoryOption.value} value={categoryOption.value}>
                                  {categoryOption.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="block text-[11px] font-medium text-gray-700">Year from</label>
                              <Input
                                value={strategyEditor.suggestedYearFrom}
                                onChange={(event) => setStrategyEditor(prev => prev ? { ...prev, suggestedYearFrom: event.target.value } : prev)}
                                placeholder="e.g. 2020"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-[11px] font-medium text-gray-700">Year to</label>
                              <Input
                                value={strategyEditor.suggestedYearTo}
                                onChange={(event) => setStrategyEditor(prev => prev ? { ...prev, suggestedYearTo: event.target.value } : prev)}
                                placeholder="e.g. 2026"
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-[11px] font-medium text-gray-700">Description</label>
                          <Textarea
                            value={strategyEditor.description}
                            onChange={(event) => setStrategyEditor(prev => prev ? { ...prev, description: event.target.value } : prev)}
                            placeholder="What this query is intended to cover"
                            className="min-h-[64px] text-xs"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-[11px] font-medium text-gray-700">Suggested sources</label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                            {SOURCE_OPTIONS.map(sourceOption => (
                              <label key={sourceOption.value} className="flex items-center gap-1.5 text-[10px] text-gray-700 bg-white rounded border border-gray-200 px-2 py-1">
                                <Checkbox
                                  checked={strategyEditor.suggestedSources.includes(sourceOption.value)}
                                  onCheckedChange={(checked) => toggleStrategySource(sourceOption.value, checked === true)}
                                />
                                <span>{sourceOption.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadStrategyQueryIntoSearchForm(selectedStrategyQuery)}
                            className="h-7 text-[11px]"
                            title="Copy this strategy query into the search bar with its suggested filters. You can then run the search or tweak the query before searching."
                          >
                            Load into search form
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={resetStrategyEditor}
                            disabled={!strategyEditorDirty || savingStrategyQuery}
                            className="h-7 text-[11px] text-gray-600"
                          >
                            Reset
                          </Button>
                          <Button
                            size="sm"
                            onClick={saveStrategyQueryEdits}
                            disabled={!strategyEditorDirty || savingStrategyQuery || !strategyEditor.queryText.trim()}
                            className="h-7 text-[11px] bg-indigo-600 hover:bg-indigo-700"
                          >
                            {savingStrategyQuery ? 'Saving...' : 'Save changes'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
          
          <Card className="overflow-hidden">
            {/* Sub-tabs for different add methods */}
            <div className="border-b bg-gray-50/50">
              <div className="flex">
                <button
                  onClick={() => setAddMode('search')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'search'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Search academic databases (Semantic Scholar, CrossRef, etc.) for papers related to your topic."
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search Online
                </button>
                <button
                  onClick={() => setAddMode('library')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'library'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Browse and add papers from your personal reference library. Papers saved from previous sessions appear here."
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                  </svg>
                  My Library
                </button>
                <button
                  onClick={() => setAddMode('import')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'import'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Import citations from BibTeX files, DOI lists, or other reference formats directly into your paper."
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import
                </button>
              </div>
            </div>

            <CardContent className="p-0">
              {/* SEARCH MODE */}
              {addMode === 'search' && (
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()}
                        placeholder="Search papers, topics, or keywords..."
                        className={loading ? "pr-32" : "pr-20"}
                      />
                      <div className="absolute right-1 top-1 flex items-center gap-1">
                        {loading && (
                          <Button 
                            size="sm" 
                            variant="destructive"
                            onClick={handleCancelSearch}
                            className="h-7 px-2 text-xs"
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Stop
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          onClick={handleSearchWithReset} 
                          disabled={loading || !query.trim()}
                          className="h-7"
                        >
                          {loading ? (
                            <span className="flex items-center gap-1">
                              <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            </span>
                          ) : 'Search'}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Research question suggestions removed - use Search Strategy for systematic queries */}
                  </div>

                  {/* Compact inline filter bar */}
                  <div className="flex items-center gap-3 text-xs bg-slate-50/80 rounded-lg px-3 py-2 border border-slate-200">
                    {/* Year Range - Compact */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500 font-medium">Year</span>
                      <div className="flex items-center bg-white rounded border border-slate-200">
                        <Input
                          type="number"
                          value={yearFrom}
                          onChange={e => setYearFrom(e.target.value)}
                          placeholder="From"
                          className="w-16 h-6 text-xs border-0 bg-transparent focus-visible:ring-0 text-center"
                        />
                        <span className="text-slate-300 px-1">–</span>
                        <Input
                          type="number"
                          value={yearTo}
                          onChange={e => setYearTo(e.target.value)}
                          placeholder="To"
                          className="w-16 h-6 text-xs border-0 bg-transparent focus-visible:ring-0 text-center"
                        />
                      </div>
                    </div>
                    
                    {/* Divider */}
                    <div className="h-4 w-px bg-slate-300" />
                    
                    {/* Sources - Compact badges */}
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-slate-500 font-medium">Sources</span>
                      <div className="flex flex-wrap gap-1">
                        {SOURCE_OPTIONS.map(source => {
                          const isSelected = sources.includes(source.value);
                          const shortLabel = source.label.split(' ')[0];
                          return (
                            <button
                              key={source.value}
                              type="button"
                              onClick={() => toggleSource(source.value)}
                              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                              }`}
                            >
                              {shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Divider */}
                    <div className="h-4 w-px bg-slate-300" />
                    
                    {/* Advanced Filters Toggle */}
                    <button
                      type="button"
                      onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        showAdvancedFilters || activeFilterCount > 0
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                      </svg>
                      More{activeFilterCount > 0 && <Badge className="ml-1 bg-indigo-600 text-white text-[9px] px-1 py-0 h-4">{activeFilterCount}</Badge>}
                    </button>
                  </div>

                  {/* Advanced Filters Panel */}
                  <AnimatePresence>
                    {showAdvancedFilters && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                          {/* Publication Type Filter */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-gray-700">Publication Type</span>
                              {!isFilterSupported('publicationTypes') && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                  Not supported by selected sources
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {PUBLICATION_TYPE_OPTIONS.map(type => (
                                <label
                                  key={type.value}
                                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                                    publicationTypes.includes(type.value)
                                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                  } ${!isFilterSupported('publicationTypes') ? 'opacity-50' : ''}`}
                                >
                                  <Checkbox
                                    checked={publicationTypes.includes(type.value)}
                                    onCheckedChange={() => {
                                      setPublicationTypes(prev =>
                                        prev.includes(type.value)
                                          ? prev.filter(t => t !== type.value)
                                          : [...prev, type.value]
                                      );
                                    }}
                                    disabled={!isFilterSupported('publicationTypes')}
                                    className="w-3 h-3"
                                  />
                                  <span>{type.icon}</span>
                                  <span>{type.label}</span>
                                </label>
                              ))}
                            </div>
                            {isFilterSupported('publicationTypes') && publicationTypes.length > 0 && (
                              <p className="text-[10px] text-gray-500 mt-1">
                                Supported by: {getSourcesSupportingFilter('publicationTypes').map(s => 
                                  SOURCE_OPTIONS.find(o => o.value === s)?.label.split(' ')[0]
                                ).join(', ')}
                              </p>
                            )}
                          </div>

                          {/* Field of Study Filter */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-gray-700">Field of Study</span>
                              {!isFilterSupported('fieldsOfStudy') && (
                                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                  Not supported by selected sources
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {FIELD_OF_STUDY_OPTIONS.map(field => (
                                <label
                                  key={field.value}
                                  className={`px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                    fieldsOfStudy.includes(field.value)
                                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                  } ${!isFilterSupported('fieldsOfStudy') ? 'opacity-50' : ''}`}
                                >
                                  <Checkbox
                                    checked={fieldsOfStudy.includes(field.value)}
                                    onCheckedChange={() => {
                                      setFieldsOfStudy(prev =>
                                        prev.includes(field.value)
                                          ? prev.filter(f => f !== field.value)
                                          : [...prev, field.value]
                                      );
                                    }}
                                    disabled={!isFilterSupported('fieldsOfStudy')}
                                    className="hidden"
                                  />
                                  {field.label}
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Additional Filters Row */}
                          <div className="flex flex-wrap items-center gap-4">
                            {/* Open Access Filter */}
                            <label className={`flex items-center gap-2 text-xs cursor-pointer ${
                              !isFilterSupported('openAccessOnly') ? 'opacity-50' : ''
                            }`}>
                              <Checkbox
                                checked={openAccessOnly}
                                onCheckedChange={(checked) => setOpenAccessOnly(!!checked)}
                                disabled={!isFilterSupported('openAccessOnly')}
                                className="w-4 h-4"
                              />
                              <span className="text-gray-700">🔓 Open Access Only</span>
                              {!isFilterSupported('openAccessOnly') && (
                                <span className="text-[10px] text-amber-600">(not supported)</span>
                              )}
                            </label>

                            {/* Minimum Citations Filter */}
                            <div className={`flex items-center gap-2 ${
                              !isFilterSupported('minCitations') ? 'opacity-50' : ''
                            }`}>
                              <span className="text-xs text-gray-700">📊 Min Citations:</span>
                              <Input
                                type="number"
                                value={minCitations}
                                onChange={e => setMinCitations(e.target.value)}
                                placeholder="0"
                                min="0"
                                disabled={!isFilterSupported('minCitations')}
                                className="w-20 h-7 text-xs"
                              />
                              {!isFilterSupported('minCitations') && (
                                <span className="text-[10px] text-amber-600">(not supported)</span>
                              )}
                            </div>

                            {/* Clear Filters */}
                            {activeFilterCount > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPublicationTypes([]);
                                  setOpenAccessOnly(false);
                                  setMinCitations('');
                                  setFieldsOfStudy([]);
                                }}
                                className="text-xs text-red-600 hover:text-red-700 hover:underline"
                              >
                                Clear all filters
                              </button>
                            )}
                          </div>

                          {/* Filter Support Info */}
                          <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-200">
                            💡 Some filters only work with specific sources. Unsupported filters are dimmed.
                            Sources with most filter support: Semantic Scholar, OpenAlex
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
                </div>
              )}

              {/* LIBRARY MODE */}
              {addMode === 'library' && (
                <InlineLibraryImport
                  authToken={authToken}
                  sessionId={sessionId}
                  onImported={async (payload) => {
                    if (payload?.results?.length) {
                      setResults(prev => deduplicateResults(
                        prev,
                        payload.results,
                        'My Library import',
                        payload.searchRunId || null,
                        deletedResultIds
                      ));
                    }

                    if (payload?.searchRunId) {
                      setSearchRunId(payload.searchRunId);
                      setSearchRunIds(prev => (prev.includes(payload.searchRunId as string)
                        ? prev
                        : [...prev, payload.searchRunId as string]));
                    }
                  }}
                />
              )}

              {/* IMPORT MODE */}
              {addMode === 'import' && (
                <div className="p-4 space-y-4">
                  {/* DOI Import */}
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1.5">Import by DOI</label>
                    <div className="flex gap-2">
                      <Input
                        value={doiInput}
                        onChange={e => setDoiInput(e.target.value)}
                        placeholder="10.1000/xyz123 or https://doi.org/..."
                        className="text-sm"
                      />
                      <Button size="sm" onClick={handleDoiImport} disabled={!doiInput.trim()}>
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* BibTeX Import */}
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1.5">Import BibTeX / RIS</label>
                    <Textarea
                      value={bibtexInput}
                      onChange={e => setBibtexInput(e.target.value)}
                      placeholder="Paste BibTeX or RIS entries..."
                      rows={4}
                      className="text-sm font-mono"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <Button size="sm" variant="secondary" onClick={handleBibtexImport} disabled={!bibtexInput.trim()}>
                        Import
                      </Button>
                      <label className="text-xs text-indigo-600 cursor-pointer hover:underline flex items-center gap-1">
                        <input
                          type="file"
                          accept=".bib,.bibtex,.ris,.txt"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleBibtexFile(file);
                          }}
                        />
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload file
                      </label>
                    </div>
                  </div>

                  {/* Manual Entry */}
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-sm"
                    onClick={() => setManualEntryOpen(true)}
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Add citation manually
                  </Button>

                  {importMessage && (
                    <div className={`text-xs p-2 rounded ${
                      importMessage.includes('failed') || importMessage.includes('error') 
                        ? 'bg-red-50 text-red-600' 
                        : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {importMessage}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Search Results - Only show when in search mode */}
          {addMode === 'search' && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Search Results</CardTitle>
                    {searchRunIds.length > 1 && (
                      <Badge className="bg-indigo-100 text-indigo-700 text-[10px]">
                        {searchRunIds.length} searches
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!loading && (
                      <span className="text-sm text-gray-500">
                        {filteredResults.length > resultsPerPage ? (
                          <>
                            Page {resultsCurrentPage} of {totalResultPages} • {filteredResults.length} results
                          </>
                        ) : (
                          <>
                        {filteredResults.length} of {results.length} 
                          </>
                        )}
                        {removedResults.size > 0 && ` (${removedResults.size} hidden)`}
                      </span>
                    )}
                    {results.some(r => !r.abstract) && results.length > 0 && !loading && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                        Some missing abstracts
                      </Badge>
                    )}
                    {/* Clear All Results Button */}
                    {results.length > 0 && !loading && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearAllResults}
                        className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Clear All
                      </Button>
                    )}
                    {/* Filter Toggle */}
                    {results.length > 0 && !loading && (
                      <Button
                        size="sm"
                        variant={showResultFilters ? "default" : "outline"}
                        onClick={() => setShowResultFilters(!showResultFilters)}
                        className="h-7 text-xs"
                      >
                        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        Filter
                      </Button>
                    )}
                  </div>
                </div>
                
                {/* Result Filters Panel */}
                <AnimatePresence>
                  {showResultFilters && results.length > 0 && !loading && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                        {/* First row of filters */}
                        <div className="flex flex-wrap items-center gap-3">
                          {/* Source filter */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-600">Source:</span>
                            <select
                              value={resultFilters.source || ''}
                              onChange={e => setResultFilters(prev => ({ ...prev, source: e.target.value || null }))}
                              className="h-7 text-xs border border-gray-300 rounded px-2"
                            >
                              <option value="">All</option>
                              {availableSources.map(source => (
                                <option key={source} value={source}>
                                  {SOURCE_OPTIONS.find(s => s.value === source)?.label || source}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          {/* Publication Type filter (Review, etc.) */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-600">Type:</span>
                            <select
                              value={resultFilters.publicationType || ''}
                              onChange={e => setResultFilters(prev => ({ ...prev, publicationType: e.target.value || null }))}
                              className="h-7 text-xs border border-gray-300 rounded px-2"
                            >
                              <option value="">All Types</option>
                              {PUBLICATION_TYPE_OPTIONS.map(type => (
                                <option key={type.value} value={type.value}>
                                  {type.icon} {type.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          {/* Has Abstract filter */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-600">Abstract:</span>
                            <select
                              value={resultFilters.hasAbstract === null ? '' : resultFilters.hasAbstract.toString()}
                              onChange={e => setResultFilters(prev => ({ 
                                ...prev, 
                                hasAbstract: e.target.value === '' ? null : e.target.value === 'true' 
                              }))}
                              className="h-7 text-xs border border-gray-300 rounded px-2"
                            >
                              <option value="">Any</option>
                              <option value="true">Has Abstract</option>
                              <option value="false">No Abstract</option>
                            </select>
                          </div>
                          
                          {/* Year range filter */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-600">Year:</span>
                            <Input
                              type="number"
                              value={resultFilters.yearFrom}
                              onChange={e => setResultFilters(prev => ({ ...prev, yearFrom: e.target.value }))}
                              placeholder="From"
                              className="w-16 h-7 text-xs"
                            />
                            <span className="text-gray-400">-</span>
                            <Input
                              type="number"
                              value={resultFilters.yearTo}
                              onChange={e => setResultFilters(prev => ({ ...prev, yearTo: e.target.value }))}
                              placeholder="To"
                              className="w-16 h-7 text-xs"
                            />
                          </div>
                          </div>
                        
                        {/* Second row of filters */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-200">
                          {/* Min Citations filter */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-600">Min Citations:</span>
                            <Input
                              type="number"
                              value={resultFilters.minCitations}
                              onChange={e => setResultFilters(prev => ({ ...prev, minCitations: e.target.value }))}
                              placeholder="0"
                              className="w-20 h-7 text-xs"
                              min={0}
                            />
                          </div>
                          
                          {/* Open Access Only filter */}
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox
                              checked={resultFilters.openAccessOnly}
                              onCheckedChange={(checked) => setResultFilters(prev => ({ ...prev, openAccessOnly: !!checked }))}
                              className="w-3.5 h-3.5"
                            />
                            <span className="text-emerald-700">🔓 Open Access Only</span>
                          </label>
                          
                          {/* AI Relevant Only */}
                          {aiSuggestions.size > 0 && (
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <Checkbox
                                checked={resultFilters.aiRelevantOnly}
                                onCheckedChange={(checked) => setResultFilters(prev => ({ ...prev, aiRelevantOnly: !!checked }))}
                                className="w-3.5 h-3.5"
                              />
                              <span className="text-violet-700">🤖 AI Reviewed Only</span>
                            </label>
                          )}
                          {aiSuggestions.size > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-600">AI Decision:</span>
                              <select
                                value={resultFilters.importDecision}
                                onChange={e => setResultFilters(prev => ({
                                  ...prev,
                                  importDecision: e.target.value as ImportDecisionFilterValue
                                }))}
                                className="h-7 text-xs border border-gray-300 rounded px-2"
                              >
                                <option value="ALL">All ({aiSuggestions.size})</option>
                                <option value="IMPORT">Import ({importDecisionCounts.IMPORT})</option>
                                <option value="MAYBE">Maybe ({importDecisionCounts.MAYBE})</option>
                                <option value="SKIP">Skip ({importDecisionCounts.SKIP})</option>
                              </select>
                            </div>
                          )}
                          {aiSuggestions.size > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-600">Deep:</span>
                              <select
                                value={resultFilters.deepAnalysisRecommendation}
                                onChange={e => setResultFilters(prev => ({
                                  ...prev,
                                  deepAnalysisRecommendation: e.target.value as DeepAnalysisFilterValue
                                }))}
                                className="h-7 text-xs border border-gray-300 rounded px-2"
                              >
                                <option value="ALL">All ({aiSuggestions.size})</option>
                                <option value="DEEP_ANCHOR">Anchor ({deepRecommendationCounts.DEEP_ANCHOR})</option>
                                <option value="DEEP_SUPPORT">Support ({deepRecommendationCounts.DEEP_SUPPORT})</option>
                                <option value="DEEP_STRESS_TEST">Stress Test ({deepRecommendationCounts.DEEP_STRESS_TEST})</option>
                                <option value="LIT_ONLY">Lit Only ({deepRecommendationCounts.LIT_ONLY})</option>
                              </select>
                            </div>
                          )}
                          
                          {/* Clear Filters */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResultFilters({ 
                              hasAbstract: null, 
                              source: null, 
                              yearFrom: '', 
                              yearTo: '', 
                              aiRelevantOnly: false,
                              importDecision: 'ALL',
                              deepAnalysisRecommendation: 'ALL',
                              publicationType: null,
                              minCitations: '',
                              openAccessOnly: false
                            })}
                            className="h-7 text-xs text-gray-500 hover:text-gray-700"
                          >
                            Clear All
                          </Button>
                          
                          {/* Restore Removed */}
                          {removedResults.size > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={restoreAllRemoved}
                              className="h-7 text-xs text-amber-600 border-amber-300 hover:bg-amber-50"
                            >
                              Restore {removedResults.size} hidden
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Top Pagination Bar - Quick access to navigation */}
                {!loading && filteredResults.length > 0 && (
                  <div className="flex items-center justify-between gap-2 py-2 px-3 bg-gray-50 rounded-lg border border-gray-200 mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">Show:</span>
                      <select
                        value={resultsPerPage}
                        onChange={(e) => setResultsPerPage(Number(e.target.value))}
                        className="h-7 text-xs border border-gray-300 rounded px-2 bg-white"
                      >
                        {RESULTS_PER_PAGE_OPTIONS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setResultsCurrentPage(1)} 
                        disabled={resultsCurrentPage === 1}
                        className="h-7 px-2 text-xs"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setResultsCurrentPage(p => Math.max(1, p - 1))} 
                        disabled={resultsCurrentPage === 1}
                        className="h-7 px-2 text-xs"
                      >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Prev
                      </Button>
                      
                      <span className="text-xs text-gray-600 px-2">
                        Page {resultsCurrentPage} of {totalResultPages || 1}
                      </span>
                      
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setResultsCurrentPage(p => Math.min(totalResultPages, p + 1))} 
                        disabled={resultsCurrentPage === totalResultPages || totalResultPages === 0}
                        className="h-7 px-2 text-xs"
                      >
                        Next
                        <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setResultsCurrentPage(totalResultPages)} 
                        disabled={resultsCurrentPage === totalResultPages || totalResultPages === 0}
                        className="h-7 px-2 text-xs"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </Button>
                    </div>
                    
                    <span className="text-xs text-gray-500">
                      {((resultsCurrentPage - 1) * resultsPerPage) + 1}-{Math.min(resultsCurrentPage * resultsPerPage, filteredResults.length)} of {filteredResults.length}
                    </span>
                  </div>
                )}
                
                {/* Selection Toolbar - Shows when items are selected */}
                <AnimatePresence>
                  {selectedResults.size > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 p-2 bg-indigo-50 rounded-lg border border-indigo-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-indigo-700">
                            {selectedResults.size} selected
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={clearSelection}
                            className="h-6 text-xs text-indigo-600 hover:text-indigo-700"
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={selectAllVisible}
                            className="h-6 text-xs text-indigo-600 hover:text-indigo-700"
                          >
                            Select Page ({paginatedResults.length})
                          </Button>
                          {totalResultPages > 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={selectAllFiltered}
                            className="h-6 text-xs text-indigo-600 hover:text-indigo-700"
                          >
                            Select All ({filteredResults.length})
                          </Button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Add Selected */}
                          <Button
                            size="sm"
                            onClick={async () => {
                              const toImport = filteredResults.filter(r => 
                                selectedResults.has(r.id) && !importedKeys.has(r.doi || r.title)
                              );
                              for (const result of toImport) {
                                await handleImport(result);
                              }
                              setSelectedResults(new Set());
                            }}
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                            title="Import the selected papers into your citation list for use in your paper."
                          >
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add Selected
                          </Button>
                          {/* Delete Selected */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={removeSelected}
                            className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50"
                            title="Remove selected papers from the search results list."
                          >
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete Selected
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Accumulation info when multiple searches done */}
                {searchRunIds.length > 1 && results.length > 0 && (
                  <div className="mb-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
                    <span className="font-medium">📚 Accumulated Results:</span> {results.length} unique papers from {searchRunIds.length} searches. 
                    <span className="text-indigo-500 ml-1">Duplicates are automatically removed.</span>
                  </div>
                )}
                
                <CardDescription className="text-xs">
                  💡 Tip: Add citations with abstracts for better literature analysis
                </CardDescription>
                
                {/* AI Relevance Analysis Section */}
                {results.length > 0 && !loading && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    {/* Row 1: AI Analysis action + status + view toggle */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      {/* Left: Analyze button + status */}
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-violet-700">Analysis</p>
                        <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          onClick={handleAiRelevanceAnalysis}
                          disabled={aiAnalyzing || !searchRunId}
                          size="sm"
                          className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white shadow-sm"
                          title="Use AI to score each search result for relevance and map them to your paper's blueprint sections. Run this after searching to see which papers are most useful and unlock the Coverage view."
                        >
                          {aiAnalyzing ? (
                            <>
                              <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              Analyze & Map
                            </>
                          )}
                        </Button>
                        {aiReviewStatus && (
                          <span className="text-[11px] text-gray-500">
                            {aiReviewStatus.reviewed}/{aiReviewStatus.total} reviewed
                            {aiReviewStatus.inProcess > 0 && (
                              <span className="text-sky-600 ml-1">- {aiReviewStatus.inProcess} in process</span>
                            )}
                            {aiReviewStatus.retry > 0 && (
                              <span className="text-amber-600 ml-1">· {aiReviewStatus.retry} retry</span>
                            )}
                          </span>
                        )}
                        </div>
                      </div>

                      <div className="hidden lg:block self-stretch w-px bg-gray-200" />

                      {/* Right: View toggle */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] uppercase tracking-wide font-semibold text-teal-700">Coverage</p>
                          {aiImportSuggestionCount > 0 && (
                            <Badge className="bg-violet-100 text-violet-700 border-0 text-[10px]">
                              {aiImportSuggestionCount} AI import picks
                            </Badge>
                          )}
                        </div>
                        {/* Toggle View: Results / Coverage */}
                        <div className="flex items-center border border-teal-200 bg-teal-50/70 rounded-lg p-0.5 shadow-sm">
                          <Button
                            size="sm"
                            variant={searchViewMode === 'results' ? 'default' : 'ghost'}
                            onClick={() => setSearchViewMode('results')}
                            className={`h-7 px-3 text-xs rounded-md ${
                              searchViewMode === 'results' 
                                ? 'bg-white border border-teal-200 shadow-sm text-gray-900' 
                                : 'text-gray-700 hover:text-gray-900'
                            }`}
                            title="Results: Browse and import individual papers."
                          >
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                            </svg>
                            Results
                          </Button>
                          <Button
                            size="sm"
                            variant={searchViewMode === 'coverage' ? 'default' : 'ghost'}
                            onClick={() => setSearchViewMode('coverage')}
                            disabled={!blueprintCoverage}
                            className={`h-7 px-3 text-xs rounded-md ${
                              searchViewMode === 'coverage' 
                                ? 'bg-teal-600 shadow-sm text-white border border-teal-600' 
                                : !blueprintCoverage
                                  ? 'bg-teal-100 text-teal-500 border border-teal-200 opacity-80 cursor-not-allowed'
                                  : 'text-teal-700 hover:text-teal-900 hover:bg-teal-100'
                            }`}
                            title={blueprintCoverage 
                              ? 'Coverage: Check mapped dimensions and identify evidence gaps before drafting.' 
                              : "Coverage is locked until you run 'Analyze & Map'."
                            }
                          >
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            Coverage
                            {blueprintCoverage && blueprintCoverage.gaps.length > 0 && (
                              <Badge className="ml-1 h-4 px-1 text-[10px] bg-amber-500 text-white">
                                {blueprintCoverage.gaps.length}
                              </Badge>
                            )}
                          </Button>
                        </div>
                        {!blueprintCoverage && (
                          <p className="text-[11px] text-teal-700/80">
                            Run Analyze & Map first. Coverage view unlocks after blueprint mapping.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Quick actions (only show after analysis) */}
                    {aiImportSuggestionCount > 0 && (
                      <div className="flex items-center gap-2 mt-2 pl-0.5 pt-2 border-t border-gray-100">
                        <span className="text-[10px] text-emerald-700 uppercase tracking-wider font-semibold mr-1">Add / Import:</span>
                        <Button
                          onClick={handleAddAllSuggested}
                          disabled={bulkAddingSuggested}
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          title="Add All Suggested: Import all AI papers marked with recommendation IMPORT."
                        >
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          {bulkAddingSuggested ? 'Adding...' : `Add All Suggested (${aiImportSuggestionCount})`}
                        </Button>
                        <Button
                          onClick={() => setHideNonRelevant(!hideNonRelevant)}
                          size="sm"
                          variant={hideNonRelevant ? "default" : "outline"}
                          className={`h-6 text-[11px] ${hideNonRelevant 
                            ? "bg-violet-600 hover:bg-violet-700 text-white"
                            : "text-violet-700 border-violet-300 hover:bg-violet-50"
                          }`}
                          title={hideNonRelevant 
                            ? "Show all results again, including papers not suggested by AI." 
                            : "Hide Others: Show only AI papers marked IMPORT."
                          }
                        >
                          {hideNonRelevant ? (
                            <>
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              Show All ({results.length})
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                              Hide Others ({Math.max(0, results.length - aiImportSuggestionCount)})
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {aiSuggestions.size > 0 && (
                      <div className="flex items-center gap-2 mt-2 pl-0.5 pt-2 border-t border-gray-100 flex-wrap">
                        <span className="text-[10px] text-indigo-700 uppercase tracking-wider font-semibold mr-1">Full Text:</span>
                        <Button
                          onClick={() => runPdfRetrieval('deep')}
                          disabled={pdfRetrievalRunning || deepRelevantCount === 0}
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] text-indigo-700 border-indigo-300 hover:bg-indigo-50"
                          title="Retrieve PDFs for relevant DEEP_ANCHOR / DEEP_SUPPORT / DEEP_STRESS_TEST papers."
                        >
                          {pdfRetrievalRunning ? 'Retrieving...' : `Retrieve Deep PDFs (${deepRelevantCount})`}
                        </Button>
                        <Button
                          onClick={() => runPdfRetrieval('relevant')}
                          disabled={pdfRetrievalRunning || relevantCount === 0}
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] text-sky-700 border-sky-300 hover:bg-sky-50"
                          title="Retrieve PDFs for all papers marked relevant by AI."
                        >
                          {pdfRetrievalRunning ? 'Retrieving...' : `Retrieve Relevant PDFs (${relevantCount})`}
                        </Button>
                        {pdfRetrievalSummary && (
                          <span className="text-[11px] text-gray-600">{pdfRetrievalSummary}</span>
                        )}
                      </div>
                    )}
                    
                    {/* AI Summary */}
                    {aiSummary && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-2 p-2 bg-violet-50 rounded-lg border border-violet-200"
                      >
                        <p className="text-xs text-violet-700 flex items-start gap-2">
                          <span className="shrink-0">🤖</span>
                          <span>{aiSummary}</span>
                        </p>
                      </motion.div>
                    )}
                    
                    {/* AI Error */}
                    {aiError && (
                      <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs text-red-600">{aiError}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-col">
                {/* Scrollable Results Area */}
                <div className="space-y-3 flex-1">
                  {/* Loading State with Intelligent Messages */}
                  {loading && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="py-12 px-4"
                    >
                      <div className="flex flex-col items-center">
                        {/* Animated Search Icon */}
                        <div className="relative mb-6">
                          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                            <svg className="w-8 h-8 text-indigo-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </div>
                          {/* Orbiting dots */}
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-indigo-500" />
                          </div>
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s', animationDelay: '1s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-purple-500" />
                          </div>
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s', animationDelay: '2s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-pink-500" />
                          </div>
                        </div>
                        
                        {/* Rotating Message */}
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={loadingMessageIndex}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                            className="text-center"
                          >
                            <span className="text-2xl mb-2 block">{SEARCH_LOADING_MESSAGES[loadingMessageIndex].icon}</span>
                            <p className="text-sm font-medium text-gray-700">
                              {SEARCH_LOADING_MESSAGES[loadingMessageIndex].text}
                            </p>
                          </motion.div>
                        </AnimatePresence>
                        
                        {/* Progress indicator */}
                        <div className="mt-6 flex gap-1">
                          {SEARCH_LOADING_MESSAGES.slice(0, 5).map((_, idx) => (
                            <div
                              key={idx}
                              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                idx <= loadingMessageIndex % 5 ? 'bg-indigo-500' : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                        
                        {/* Sources being searched */}
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {sources.map(source => (
                            <span
                              key={source}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 animate-pulse"
                            >
                              {SOURCE_OPTIONS.find(s => s.value === source)?.label || source}
                            </span>
                          ))}
                        </div>
                        
                        {/* Stop Search button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelSearch}
                          className="mt-5 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                        >
                          <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                          </svg>
                          Stop Search
                        </Button>
                      </div>
                    </motion.div>
                  )}
                  
                  {/* Empty State - only show when not loading */}
                  {!loading && results.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="text-sm">Search for papers above</p>
                    </div>
                  )}
                  
                  {/* Filtered Empty State - when all results are filtered out */}
                  {!loading && results.length > 0 && filteredResults.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                      <p className="text-sm mb-2">No results match your filters</p>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResultFilters({ 
                            hasAbstract: null, 
                            source: null, 
                            yearFrom: '', 
                            yearTo: '', 
                            aiRelevantOnly: false,
                            importDecision: 'ALL',
                            deepAnalysisRecommendation: 'ALL',
                            publicationType: null,
                            minCitations: '',
                            openAccessOnly: false
                          })}
                          className="text-xs"
                        >
                          Clear Filters
                        </Button>
                        {removedResults.size > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={restoreAllRemoved}
                            className="text-xs text-amber-600 border-amber-300"
                          >
                            Restore {removedResults.size} Hidden
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Coverage View - Evidence-first table + bipartite matrix */}
                  {!loading && searchViewMode === 'coverage' && blueprintCoverage && (
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-xl p-4 border border-violet-200">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                            <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            Dimension Coverage
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">
                              {blueprintCoverage.coveredDimensions} / {blueprintCoverage.totalDimensions} dimensions
                            </span>
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-500 to-green-500 rounded-full transition-all"
                                style={{ width: `${blueprintCoverage.totalDimensions > 0 ? (blueprintCoverage.coveredDimensions / blueprintCoverage.totalDimensions) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-gray-600">
                          Review each mapping with grounded evidence. Use the matrix for fast global coverage checks.
                        </p>
                        {blueprintCoverage.gaps.length > 0 && (
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            {blueprintCoverage.gaps.length} uncovered dimension{blueprintCoverage.gaps.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {(!blueprintCoverage.sectionCoverage || Object.keys(blueprintCoverage.sectionCoverage).length === 0) && (
                        <div className="text-center py-8 text-gray-400">
                          <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                          </svg>
                          <p className="text-sm">No blueprint sections found</p>
                          <p className="text-xs mt-1">Generate a blueprint first in the Blueprint stage</p>
                        </div>
                      )}

                      {blueprintCoverage.sectionCoverage && Object.keys(blueprintCoverage.sectionCoverage).length > 0 && (
                        <>
                          <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
                                <Button
                                  size="sm"
                                  variant={coverageSubView === 'evidence_table' ? 'default' : 'ghost'}
                                  onClick={() => setCoverageSubView('evidence_table')}
                                  className={`h-7 px-3 text-xs ${coverageSubView === 'evidence_table' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}
                                >
                                  Evidence Table
                                </Button>
                                <Button
                                  size="sm"
                                  variant={coverageSubView === 'matrix' ? 'default' : 'ghost'}
                                  onClick={() => setCoverageSubView('matrix')}
                                  className={`h-7 px-3 text-xs ${coverageSubView === 'matrix' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}
                                >
                                  Coverage Matrix
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                variant={coverageShowGapsMode ? 'default' : 'outline'}
                                onClick={() => setCoverageShowGapsMode(prev => !prev)}
                                className={`h-7 text-xs ${coverageShowGapsMode ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'text-amber-700 border-amber-300 hover:bg-amber-50'}`}
                              >
                                {coverageShowGapsMode ? 'Hide Gaps Mode' : 'Show Gaps Mode'}
                              </Button>
                            </div>

                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              <div>
                                <label className="text-[11px] font-medium text-gray-600">Dimension family</label>
                                <select
                                  value={coverageDimensionFamilyFilter}
                                  onChange={e => setCoverageDimensionFamilyFilter(e.target.value)}
                                  className="mt-1 w-full h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                >
                                  <option value="all">All families</option>
                                  {coverageDimensionFamilies.map(family => (
                                    <option key={family} value={family}>{family}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[11px] font-medium text-gray-600">Year</label>
                                <select
                                  value={coverageYearFilter}
                                  onChange={e => setCoverageYearFilter(e.target.value)}
                                  className="mt-1 w-full h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                >
                                  <option value="all">All years</option>
                                  {coverageYears.map(year => (
                                    <option key={year} value={String(year)}>{year}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[11px] font-medium text-gray-600">Evidence strength</label>
                                <select
                                  value={coverageStrengthFilter}
                                  onChange={e => setCoverageStrengthFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
                                  className="mt-1 w-full h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
                                >
                                  <option value="all">All strengths</option>
                                  <option value="high">High</option>
                                  <option value="medium">Medium</option>
                                  <option value="low">Low</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[11px] font-medium text-gray-600">Venue</label>
                                <Input
                                  value={coverageVenueFilter}
                                  onChange={e => setCoverageVenueFilter(e.target.value)}
                                  placeholder="Filter by venue"
                                  className="mt-1 h-8 text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-medium text-gray-600">Affiliation</label>
                                <Input
                                  value={coverageAffiliationFilter}
                                  onChange={e => setCoverageAffiliationFilter(e.target.value)}
                                  placeholder="Filter by affiliation/publisher"
                                  className="mt-1 h-8 text-xs"
                                />
                              </div>
                            </div>

                            <p className="text-[11px] text-gray-500">
                              Showing {filteredCoverageRows.length} mapping row{filteredCoverageRows.length !== 1 ? 's' : ''}.
                            </p>
                          </div>

                          {filteredCoverageRows.length === 0 && (
                            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                              <p className="text-sm text-gray-600">No mappings match the current filters.</p>
                              <p className="text-xs text-gray-500 mt-1">Clear filters or run analysis again to populate evidence rows.</p>
                            </div>
                          )}

                          {filteredCoverageRows.length > 0 && coverageSubView === 'evidence_table' && (
                            <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
                              <table className="min-w-[1100px] w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                  <tr>
                                    <th className="text-left text-[11px] font-semibold text-gray-600 px-3 py-2 w-[20%]">Dimension</th>
                                    <th className="text-left text-[11px] font-semibold text-gray-600 px-3 py-2 w-[26%]">Paper</th>
                                    <th className="text-left text-[11px] font-semibold text-gray-600 px-3 py-2 w-[34%]">Evidence Card</th>
                                    <th className="text-left text-[11px] font-semibold text-gray-600 px-3 py-2 w-[20%]">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {filteredCoverageRows.map(row => {
                                    const feedback = coverageFeedback.get(row.id);
                                    const primaryLink = row.doi ? `https://doi.org/${row.doi}` : row.url;
                                    const inclusionStatus = feedback?.inclusionStatus || 'INCLUDED';
                                    const isSavingRow = coverageSavingRows.has(row.id);
                                    const detailText = [
                                      row.authors.slice(0, 3).join(', '),
                                      row.year ? String(row.year) : '',
                                      row.venue || row.publisher
                                    ].filter(Boolean).join(' · ');

                                    return (
                                      <tr key={row.id} className="align-top">
                                        <td className="px-3 py-3">
                                          <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">{row.sectionKey}</p>
                                          <p className="text-sm text-gray-900 mt-0.5">{row.dimension}</p>
                                        </td>
                                        <td className="px-3 py-3">
                                          <p className="text-sm font-medium text-gray-900 leading-snug">{row.paperTitle}</p>
                                          {detailText && (
                                            <p className="text-[11px] text-gray-500 mt-1">{detailText}</p>
                                          )}
                                          {primaryLink && (
                                            <a
                                              href={primaryLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center mt-1 text-[11px] text-indigo-600 hover:underline"
                                            >
                                              Open source
                                            </a>
                                          )}
                                        </td>
                                        <td className="px-3 py-3">
                                          {renderCoverageEvidenceCard(row)}
                                        </td>
                                        <td className="px-3 py-3">
                                          <div className="flex flex-wrap gap-1">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => setActiveCoverageEvidence(row)}
                                              className="h-6 px-2 text-[10px] text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                                            >
                                              Open card
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={inclusionStatus === 'INCLUDED' ? 'default' : 'outline'}
                                              onClick={() => updateCoverageInclusion(row, 'INCLUDED')}
                                              disabled={isSavingRow}
                                              className={`h-6 px-2 text-[10px] ${inclusionStatus === 'INCLUDED' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'}`}
                                            >
                                              Confirm
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant={inclusionStatus === 'EXCLUDED' ? 'default' : 'outline'}
                                              onClick={() => updateCoverageInclusion(row, 'EXCLUDED')}
                                              disabled={isSavingRow}
                                              className={`h-6 px-2 text-[10px] ${inclusionStatus === 'EXCLUDED' ? 'bg-red-600 hover:bg-red-700 text-white' : 'text-red-700 border-red-300 hover:bg-red-50'}`}
                                            >
                                              Remove
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => openCoverageRemapDialog(row)}
                                              className="h-6 px-2 text-[10px] text-gray-700 border-gray-300 hover:bg-gray-50"
                                            >
                                              Change Mapping
                                            </Button>
                                          </div>
                                          <p className={`text-[11px] mt-2 ${inclusionStatus === 'EXCLUDED' ? 'text-red-700' : 'text-emerald-700'}`}>
                                            {inclusionStatus === 'EXCLUDED' ? 'Excluded from drafting' : 'Included for drafting'}
                                          </p>
                                          {feedback?.reviewComment && (
                                            <p className="text-[11px] text-gray-600 mt-1">
                                              <span className="font-medium">Note:</span> {feedback.reviewComment}
                                            </p>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {coverageSubView === 'matrix' && (
                            <div className="space-y-2">
                              {(coverageMatrixDimensionDisplay.length === 0 || coverageMatrixPapers.length === 0) ? (
                                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                                  <p className="text-sm text-gray-600">Matrix cannot be rendered with current filters.</p>
                                  <p className="text-xs text-gray-500 mt-1">Adjust filters to include mapped papers and dimensions.</p>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-gray-200 bg-white overflow-auto max-h-[520px]">
                                  <table className="min-w-max border-collapse">
                                    <thead className="sticky top-0 z-20 bg-white">
                                      <tr>
                                        <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-[11px] font-semibold text-gray-700 min-w-[240px]">
                                          Papers
                                        </th>
                                        {coverageMatrixDimensionDisplay.map(dimension => (
                                          <th
                                            key={dimension.key}
                                            title={`${dimension.sectionKey}: ${dimension.dimension}`}
                                            className={`border-b border-r px-1 py-1 text-[10px] font-semibold text-center align-middle min-w-[54px] ${
                                              coverageShowGapsMode && dimension.isGap
                                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                                : 'bg-gray-50 border-gray-200 text-gray-700'
                                            }`}
                                          >
                                            <span className="inline-flex items-center justify-center h-6 px-1 rounded bg-white/70 border border-gray-200">
                                              {dimension.identifier}
                                            </span>
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {coverageMatrixPapers.map(paper => (
                                        <tr key={paper.id} className="hover:bg-gray-50/50">
                                          <td className="sticky left-0 z-10 bg-white border-r border-b border-gray-200 px-3 py-2 min-w-[240px]">
                                            <p className="text-xs font-medium text-gray-900 leading-tight">{paper.title}</p>
                                            <p className="text-[10px] text-gray-500 mt-1">
                                              {[paper.year ? String(paper.year) : '', paper.venue].filter(Boolean).join(' · ') || 'Metadata unavailable'}
                                            </p>
                                          </td>
                                          {coverageMatrixDimensionDisplay.map(dimension => {
                                            const cellRows = coverageRowsByCell.get(`${paper.id}::${dimension.key}`) || [];
                                            const strongestRow = cellRows
                                              .slice()
                                              .sort((a, b) => b.rubricScore - a.rubricScore)[0];
                                            const hasMapping = !!strongestRow;
                                            const score = strongestRow?.rubricScore || 0;

                                            const cellClass = hasMapping
                                              ? score >= 75
                                                ? 'bg-emerald-500 text-white border-emerald-600'
                                                : score >= 50
                                                  ? 'bg-blue-500 text-white border-blue-600'
                                                  : 'bg-amber-400 text-amber-950 border-amber-500'
                                              : (coverageShowGapsMode && dimension.isGap)
                                                ? 'bg-amber-100 text-amber-700 border-amber-300'
                                                : 'bg-gray-50 text-gray-300 border-gray-200';

                                            return (
                                              <td
                                                key={`${paper.id}-${dimension.key}`}
                                                className={`border-r border-b px-2 py-2 text-center text-[10px] transition-colors ${cellClass} ${hasMapping ? 'cursor-pointer hover:brightness-95' : ''}`}
                                                title={hasMapping ? `${strongestRow.sectionKey}: ${strongestRow.dimension} (${strongestRow.rubricScore})` : (dimension.isGap ? 'Uncovered dimension' : 'No mapped evidence')}
                                                onClick={() => {
                                                  if (strongestRow) setActiveCoverageEvidence(strongestRow);
                                                }}
                                              >
                                                {hasMapping ? strongestRow.rubricScore : (coverageShowGapsMode && dimension.isGap ? 'Gap' : '–')}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-600">
                                <Badge className="bg-emerald-500 text-white border-0">75-100</Badge>
                                <Badge className="bg-blue-500 text-white border-0">50-74</Badge>
                                <Badge className="bg-amber-400 text-amber-950 border-0">0-49</Badge>
                                <span>Header IDs are compact; hover a column header to view full section and dimension.</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {blueprintCoverage.gaps.length > 0 && (
                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                          <h4 className="font-medium text-amber-900 mb-2 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            Search Suggestions for Uncovered Dimensions
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {blueprintCoverage.gaps.slice(0, 5).map((gap, idx) => (
                              <Button
                                key={idx}
                                size="sm"
                                variant="outline"
                                className="text-xs text-amber-700 border-amber-300 hover:bg-amber-100"
                                onClick={() => {
                                  setQuery(gap.dimension.slice(0, 50));
                                  setSearchViewMode('results');
                                }}
                              >
                                Search: {gap.dimension.slice(0, 40)}...
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Results - only show when not loading and in results view */}
                  {/* Sort results: AI-suggested first, use paginatedResults with pagination applied */}
                  {!loading && searchViewMode === 'results' && (
                    <AnimatePresence mode="popLayout">
                      {[...paginatedResults]
                        .sort((a, b) => {
                          const aIsSuggested = aiImportSuggestionIds.has(a.id);
                          const bIsSuggested = aiImportSuggestionIds.has(b.id);
                          if (aIsSuggested && !bIsSuggested) return -1;
                          if (!aIsSuggested && bIsSuggested) return 1;
                          // If both suggested, sort by score
                          if (aIsSuggested && bIsSuggested) {
                            return (aiSuggestions.get(b.id)?.score || 0) - (aiSuggestions.get(a.id)?.score || 0);
                          }
                          return 0;
                        })
                        .map((result, index) => {
                        const isImported = importedKeys.has(result.doi || result.title);
                        const hasAbstract = !!result.abstract;
                        const isExpanded = expandedAbstracts.has(result.id);
                        const isSelected = selectedResults.has(result.id);
                        const isFetchingThis = fetchingAbstract === result.id;
                        const aiSuggestion = aiSuggestions.get(result.id);
                        const isAiAnalyzed = !!aiSuggestion;
                        const isAiSuggested = aiSuggestion?.recommendation === 'IMPORT';
                        const resultPdfStatus = normalizePdfStatusValue(result.pdfStatus);
                        const resultSourceType = typeof result.documentSourceType === 'string' ? result.documentSourceType : undefined;
                        const availabilityLabel = resultSourceType === 'TEXT_PASTE' ? 'Full Text' : 'PDF';

                        return (
                          <motion.div
                            key={result.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ delay: index * 0.02 }}
                            className={`border rounded-lg p-3 transition-all ${
                              isSelected
                                ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200'
                                : isImported 
                                  ? 'bg-emerald-50/50 border-emerald-200' 
                                  : isAiSuggested
                                    ? 'bg-violet-50/70 border-violet-300 ring-1 ring-violet-200 shadow-sm'
                                  : hasAbstract 
                                    ? 'bg-white hover:shadow-sm border-gray-200' 
                                    : 'bg-amber-50/30 border-amber-200 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex gap-3">
                            {/* Selection Checkbox */}
                            <div className="shrink-0 pt-0.5">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleResultSelection(result.id)}
                                className="w-4 h-4"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2">
                                <h4 
                                  className="font-medium text-sm text-gray-900 leading-tight flex-1 cursor-pointer hover:text-indigo-700"
                                  onClick={() => toggleResultSelection(result.id)}
                                >
                                  {result.title}
                                </h4>
                                {/* AI Suggested Badge */}
                                {isAiSuggested && (
                                  <Badge className="shrink-0 text-[10px] bg-gradient-to-r from-violet-500 to-indigo-500 text-white border-0 shadow-sm">
                                    🤖 AI Import Pick
                                  </Badge>
                                )}
                                {/* Usage Badges (I/L/M/C) */}
                                {isAiAnalyzed && aiSuggestion?.citationMeta?.usage && (
                                  <div className="flex gap-0.5 shrink-0">
                                    {aiSuggestion.citationMeta.usage.introduction && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-300" title="Cite in Introduction">
                                        I
                                      </Badge>
                                    )}
                                    {aiSuggestion.citationMeta.usage.literatureReview && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-300" title="Cite in Literature Review">
                                        L
                                      </Badge>
                                    )}
                                    {aiSuggestion.citationMeta.usage.methodology && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-50 text-emerald-700 border-emerald-300" title="Reference in Methodology">
                                        M
                                      </Badge>
                                    )}
                                    {aiSuggestion.citationMeta.usage.comparison && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-300" title="Use for Comparison">
                                        C
                                      </Badge>
                                    )}
                                  </div>
                                )}
                                {/* Import Recommendation Badge */}
                                {paperRecommendations.has(result.id) && (
                                  <Badge 
                                    className={`shrink-0 text-[10px] ${
                                      paperRecommendations.get(result.id) === 'IMPORT'
                                        ? 'bg-emerald-500 text-white'
                                        : paperRecommendations.get(result.id) === 'MAYBE'
                                          ? 'bg-amber-500 text-white'
                                          : 'bg-gray-400 text-white'
                                    }`}
                                    title={paperRecommendations.get(result.id) === 'IMPORT' 
                                      ? 'Strongly recommended for import - maps to multiple dimensions'
                                      : paperRecommendations.get(result.id) === 'MAYBE'
                                        ? 'Consider importing - maps to some dimensions'
                                        : 'Low blueprint coverage - might be useful for background'}
                                  >
                                    {paperRecommendations.get(result.id)}
                                  </Badge>
                                )}
                                {aiSuggestion?.deepAnalysisRecommendation && (
                                  <Badge
                                    className={`shrink-0 text-[10px] ${
                                      aiSuggestion.deepAnalysisRecommendation === 'DEEP_ANCHOR'
                                        ? 'bg-indigo-600 text-white'
                                        : aiSuggestion.deepAnalysisRecommendation === 'DEEP_SUPPORT'
                                          ? 'bg-sky-600 text-white'
                                          : aiSuggestion.deepAnalysisRecommendation === 'DEEP_STRESS_TEST'
                                            ? 'bg-rose-600 text-white'
                                            : 'bg-gray-500 text-white'
                                    }`}
                                    title={aiSuggestion.deepAnalysisRationale || 'Deep analysis recommendation'}
                                  >
                                    {aiSuggestion.deepAnalysisRecommendation}
                                  </Badge>
                                )}
                                {hasAbstract ? (
                                  <Badge variant="secondary" className="shrink-0 text-[10px] bg-blue-50 text-blue-600">
                                    📄 Abstract
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={`shrink-0 text-[10px] ${
                                    aiSuggestions.size > 0
                                      ? 'text-amber-700 border-amber-300 bg-amber-50'
                                      : 'text-amber-600 border-amber-300'
                                  }`} title={aiSuggestions.size > 0 ? 'Skipped from AI analysis — add an abstract to enable review' : 'No abstract available'}>
                                    {aiSuggestions.size > 0 ? 'No Abstract — Skipped' : 'No abstract'}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <p className="text-xs text-gray-500">
                                  {(result.authors || []).slice(0, 3).join(', ')}
                                  {result.authors?.length > 3 && ' et al.'}
                                  {result.year && ` • ${result.year}`}
                                  {result.venue && ` • ${result.venue}`}
                                </p>
                                {/* Publication Type Badge */}
                                {result.publicationType && (
                                  <Badge 
                                    variant="outline" 
                                    className={`text-[9px] px-1.5 py-0 ${
                                      result.publicationType === 'journal-article' 
                                        ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                        : result.publicationType === 'conference-paper'
                                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                                          : result.publicationType === 'preprint'
                                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                                            : result.publicationType === 'review'
                                              ? 'bg-green-50 text-green-700 border-green-200'
                                              : 'bg-gray-50 text-gray-600 border-gray-200'
                                    }`}
                                  >
                                    {PUBLICATION_TYPE_OPTIONS.find(t => t.value === result.publicationType)?.icon || '📄'}{' '}
                                    {PUBLICATION_TYPE_OPTIONS.find(t => t.value === result.publicationType)?.label || result.publicationType}
                                  </Badge>
                                )}
                                {/* Open Access Badge */}
                                {result.isOpenAccess && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200">
                                    🔓 Open Access
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 ${
                                    resultPdfStatus === 'READY'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : resultPdfStatus === 'FAILED'
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : resultPdfStatus === 'UPLOADED' || resultPdfStatus === 'PARSING'
                                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                                        : 'bg-gray-50 text-gray-600 border-gray-200'
                                  }`}
                                >
                                  {availabilityLabel} {resultPdfStatus}
                                </Badge>
                                {result.citationCount !== undefined && result.citationCount > 0 && (
                                  <span className="text-[10px] text-gray-400">
                                    📊 {result.citationCount.toLocaleString()} citations
                                  </span>
                                )}
                              </div>
                              
                              {/* Dimension Mappings - Show which blueprint dimensions this paper covers */}
                              {paperDimensionMappings.has(result.id) && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {paperDimensionMappings.get(result.id)?.map((mapping, idx) => (
                                    <div key={idx} className="group relative">
                                      <Badge 
                                        variant="outline" 
                                        className={`text-[9px] cursor-help ${
                                          mapping.confidence === 'HIGH'
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                            : mapping.confidence === 'MEDIUM'
                                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                                              : 'bg-gray-50 text-gray-600 border-gray-300'
                                        }`}
                                      >
                                        <span className="font-medium">{mapping.sectionKey}:</span>{' '}
                                        {mapping.dimension.slice(0, 30)}{mapping.dimension.length > 30 ? '...' : ''}
                                      </Badge>
                                      {/* Tooltip with full remark */}
                                      <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-50 w-72 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg">
                                        <p className="font-medium text-emerald-400 mb-1">{mapping.sectionKey}</p>
                                        <p className="text-gray-300 mb-1">{mapping.dimension}</p>
                                        <p className="text-gray-400 italic">"{mapping.remark}"</p>
                                        <p className="mt-1 text-[10px] text-gray-500">Confidence: {mapping.confidence}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {/* Abstract section */}
                              {hasAbstract ? (
                                <>
                                  <button
                                    onClick={() => toggleAbstract(result.id)}
                                    className="text-xs text-indigo-600 mt-1 hover:underline"
                                  >
                                    {isExpanded ? 'Hide abstract ▲' : 'Show abstract ▼'}
                                  </button>
                                  {isExpanded && (
                                    <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2 rounded leading-relaxed">
                                      {result.abstract}
                                    </p>
                                  )}
                                </>
                              ) : result.doi ? (
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {/* Fetch abstract button */}
                                  <button
                                    onClick={() => handleFetchAbstract(result.id, result.doi)}
                                    disabled={isFetchingThis}
                                    className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                                  >
                                    {isFetchingThis ? (
                                      <>
                                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Fetching...
                                      </>
                                    ) : fetchAbstractFailed.has(result.id) ? (
                                      <>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Retry fetch
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        Fetch abstract
                                      </>
                                    )}
                                  </button>
                                  
                                  {/* Separator */}
                                  <span className="text-gray-300">|</span>
                                  
                                  {/* Add manually button */}
                                  <button
                                    onClick={() => openManualAbstractModal(result.id, result.title)}
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Add manually
                                  </button>
                                  
                                  {/* Show fetch failed message */}
                                  {fetchAbstractFailed.has(result.id) && (
                                    <span className="text-[10px] text-red-500 italic">
                                      (auto-fetch failed)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-xs text-gray-400">No DOI available</span>
                                  <span className="text-gray-300">|</span>
                                  <button
                                    onClick={() => openManualAbstractModal(result.id, result.title)}
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Add abstract manually
                                  </button>
                                </div>
                              )}
                              
                              {result.doi && (
                                <a
                                  href={`https://doi.org/${result.doi}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-indigo-500 hover:underline mt-1 inline-block"
                                >
                                  DOI: {result.doi} ↗
                                </a>
                              )}
                              
                              {/* AI Reasoning & Citation Metadata - Show why this paper was suggested */}
                              {isAiAnalyzed && aiSuggestion && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="mt-2 p-2.5 bg-gradient-to-r from-violet-50 to-indigo-50 rounded-lg border border-violet-200"
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="text-violet-500 text-sm shrink-0">🤖</span>
                                    <div className="flex-1 min-w-0 space-y-2">
                                      {/* Score and relevance */}
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">
                                          Why it's relevant
                                        </span>
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 rounded text-[10px] text-violet-600">
                                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                          </svg>
                                          {aiSuggestion.score}% match
                                        </div>
                                      </div>
                                      <p className="text-xs text-violet-800 leading-relaxed">
                                        {aiSuggestion.reasoning}
                                      </p>
                                      {aiSuggestion.deepAnalysisRecommendation && (
                                        <p className="text-[11px] text-indigo-800">
                                          <span className="font-semibold">Deep analysis:</span>{' '}
                                          {aiSuggestion.deepAnalysisRecommendation}
                                          {aiSuggestion.deepAnalysisRationale ? ` — ${aiSuggestion.deepAnalysisRationale}` : ''}
                                        </p>
                                      )}
                                      
                                      {/* Enhanced Citation Metadata */}
                                      {aiSuggestion.citationMeta && (
                                        <div className="mt-2 pt-2 border-t border-violet-200/50 space-y-1.5">
                                          {/* Key Contribution */}
                                          <div className="flex items-start gap-1.5">
                                            <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">💡 Contribution:</span>
                                            <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.keyContribution}</span>
                                          </div>
                                          
                                          {/* Key Findings */}
                                          <div className="flex items-start gap-1.5">
                                            <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">📊 Findings:</span>
                                            <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.keyFindings}</span>
                                          </div>
                                          
                                          {/* Methodological Approach */}
                                          {aiSuggestion.citationMeta.methodologicalApproach && (
                                            <div className="flex items-start gap-1.5">
                                              <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">⚙️ Method:</span>
                                              <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.methodologicalApproach}</span>
                                            </div>
                                          )}
                                          
                                          {/* Limitations/Gaps */}
                                          {aiSuggestion.citationMeta.limitationsOrGaps && (
                                            <div className="flex items-start gap-1.5">
                                              <span className="text-[10px] font-medium text-amber-600 shrink-0 w-20">⚠️ Gap:</span>
                                              <span className="text-[11px] text-amber-900">{aiSuggestion.citationMeta.limitationsOrGaps}</span>
                                            </div>
                                          )}
                                          
                                          {/* Usage Guidance */}
                                          <div className="flex items-center gap-1.5 pt-1">
                                            <span className="text-[10px] font-medium text-violet-600">📝 Cite in:</span>
                                            <div className="flex gap-1">
                                              {aiSuggestion.citationMeta.usage.introduction && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Introduction</span>
                                              )}
                                              {aiSuggestion.citationMeta.usage.literatureReview && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">Lit Review</span>
                                              )}
                                              {aiSuggestion.citationMeta.usage.methodology && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">Methodology</span>
                                              )}
                                              {aiSuggestion.citationMeta.usage.comparison && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Comparison</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                            <div className="shrink-0 flex flex-col gap-1 min-w-[134px]">
                              {(() => {
                                const isRetrievingThisPdf = pdfRetrievalByPaper.has(result.id);
                                const isSubmittingLink = submittingPdfLink.has(result.id);
                                const isSubmittingText = submittingPasteText.has(result.id);
                                const isLoadingText = loadingFullTextPaper === result.id;
                                const sourceType = resultSourceType;
                                const isTextOnly = sourceType === 'TEXT_PASTE';
                                const isReady = resultPdfStatus === 'READY';
                                const isProcessing = isRetrievingThisPdf || isSubmittingLink || isSubmittingText || resultPdfStatus === 'UPLOADED' || resultPdfStatus === 'PARSING';
                                const actionResult = paperPdfActionResults.get(result.id);
                                const hasAttachedDocument = Boolean(result.libraryDocumentId)
                                  || resultPdfStatus === 'UPLOADED'
                                  || resultPdfStatus === 'PARSING'
                                  || resultPdfStatus === 'READY';
                                const canViewPdf = hasAttachedDocument && !isTextOnly;
                                const canViewText = hasAttachedDocument && (isTextOnly || isReady);
                                const showFallbackActions = !hasAttachedDocument && !isReady;

                                return (
                                  <>
                                    {canViewPdf && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleViewPdf(result)}
                                        className="text-xs h-7 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                                        title="Open attached PDF."
                                      >
                                        View PDF
                                      </Button>
                                    )}
                                    {canViewText && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleViewFullText(result)}
                                        disabled={isLoadingText}
                                        className="text-xs h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                        title="Open extracted full text."
                                      >
                                        {isLoadingText ? 'Loading...' : 'View Text'}
                                      </Button>
                                    )}
                                    {isProcessing && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled
                                        className="text-xs h-7 border-amber-300 text-amber-700 bg-amber-50"
                                      >
                                        Processing...
                                      </Button>
                                    )}
                                    {showFallbackActions && (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => runPdfRetrieval('manual', {
                                            manualPaperId: result.id,
                                            manualSearchRunId: result._searchRunId || searchRunId || undefined,
                                          })}
                                          disabled={isRetrievingThisPdf}
                                          className="text-xs h-7 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                                          title="Try automatic retrieval from DOI and direct PDF URL."
                                        >
                                          Retrieve PDF
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openProvideLinkModal(result)}
                                          disabled={isSubmittingLink}
                                          className="text-xs h-7 border-sky-300 text-sky-700 hover:bg-sky-50"
                                          title="Provide a direct PDF link."
                                        >
                                          Provide Link
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openUploadPdfModal(result)}
                                          className="text-xs h-7 border-violet-300 text-violet-700 hover:bg-violet-50"
                                          title="Upload a PDF file from your device."
                                        >
                                          Upload PDF
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => openPasteTextModal(result)}
                                          disabled={isSubmittingText}
                                          className="text-xs h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                          title="Paste full text when PDF is unavailable."
                                        >
                                          Paste Text
                                        </Button>
                                      </>
                                    )}
                                    {actionResult && !actionResult.success && (
                                      <span className="text-[10px] text-rose-600">
                                        {actionResult.errorCode || 'Failed'}
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              <Button
                                size="sm"
                                onClick={() => handleImport(result)}
                                disabled={isImported}
                                className={`text-xs h-7 ${isImported ? 'bg-emerald-600' : isAiSuggested ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                              >
                                {isImported ? '✓ Added' : '+ Add'}
                              </Button>
                              <div className="relative group">
                                <Button size="sm" variant="ghost" className="text-xs h-7 w-full px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50" title="Save to library">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                                  </svg>
                                </Button>
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl py-1.5 min-w-[160px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b mb-1">
                                    Save to Library
                                  </div>
                                  {libraries.length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-gray-500">No libraries created yet</div>
                                  ) : (
                                    libraries.map(lib => (
                                      <button
                                        key={lib.id}
                                        onClick={() => handleSaveToLibrary(result, lib.id)}
                                        className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-xs flex items-center gap-2 transition-colors"
                                      >
                                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lib.color || '#6366f1' }} />
                                        <span className="truncate">{lib.name}</span>
                                        <span className="text-gray-400 text-[10px] ml-auto">{lib.referenceCount}</span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </div>
                
                {/* Pagination Controls - Always visible at bottom, outside scrollable area */}
                {!loading && filteredResults.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-gray-200 bg-white sticky bottom-0">
                      {/* Page size selector */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Show:</span>
                        <select
                          value={resultsPerPage}
                          onChange={(e) => setResultsPerPage(Number(e.target.value))}
                          className="h-8 text-sm border border-gray-300 rounded px-2 bg-white"
                        >
                          {RESULTS_PER_PAGE_OPTIONS.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <span className="text-sm text-gray-600">per page</span>
                      </div>
                      
                      {/* Navigation controls */}
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setResultsCurrentPage(1)} 
                          disabled={resultsCurrentPage === 1}
                          className="h-8 px-2"
                          title="First page"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                          </svg>
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setResultsCurrentPage(p => Math.max(1, p - 1))} 
                          disabled={resultsCurrentPage === 1}
                          className="h-8 px-3"
                          title="Previous page"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                          Prev
                        </Button>
                        
                        {/* Page numbers */}
                        {totalResultPages > 1 && (
                          <div className="flex items-center gap-1 mx-1">
                            {Array.from({ length: Math.min(5, totalResultPages) }, (_, i) => {
                              let pageNum: number;
                              if (totalResultPages <= 5) {
                                pageNum = i + 1;
                              } else if (resultsCurrentPage <= 3) {
                                pageNum = i + 1;
                              } else if (resultsCurrentPage >= totalResultPages - 2) {
                                pageNum = totalResultPages - 4 + i;
                              } else {
                                pageNum = resultsCurrentPage - 2 + i;
                              }
                              
                              return (
                                <Button
                                  key={pageNum}
                                  variant={resultsCurrentPage === pageNum ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setResultsCurrentPage(pageNum)}
                                  className={`h-8 w-8 p-0 ${resultsCurrentPage === pageNum ? 'bg-indigo-600' : ''}`}
                                >
                                  {pageNum}
                                </Button>
                              );
                            })}
                          </div>
                        )}
                        
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setResultsCurrentPage(p => Math.min(totalResultPages, p + 1))} 
                          disabled={resultsCurrentPage === totalResultPages || totalResultPages === 0}
                          className="h-8 px-3"
                          title="Next page"
                        >
                          Next
                          <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setResultsCurrentPage(totalResultPages)} 
                          disabled={resultsCurrentPage === totalResultPages || totalResultPages === 0}
                          className="h-8 px-2"
                          title="Last page"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                          </svg>
                        </Button>
                      </div>
                      
                      {/* Results info */}
                      <div className="text-sm text-gray-500">
                        Showing {((resultsCurrentPage - 1) * resultsPerPage) + 1}-{Math.min(resultsCurrentPage * resultsPerPage, filteredResults.length)} of {filteredResults.length}
                      </div>
                    </div>
                  )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* PAPER CITATIONS TAB */}
        <TabsContent value="citations" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Citations in Your Paper
                </CardTitle>
                <Badge variant="secondary">{citations.length}</Badge>
              </div>
              <CardDescription>
                These citations will be used in your publication
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search and Actions */}
              <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/70 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Filter</span>
                  <Input
                    value={citationSearch}
                    onChange={e => setCitationSearch(e.target.value)}
                    placeholder="Search citations..."
                    className="h-8 text-sm bg-white"
                    title="Filter citations by title, author, or citation key."
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-700 uppercase tracking-wider font-semibold">Export</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportBibtex}
                    disabled={citations.length === 0 || exportingBibtex}
                    className="shrink-0 h-7 text-xs text-slate-700 border-slate-300 hover:bg-slate-50"
                    title={selectedCitations.size > 0
                      ? `Export BibTeX: Download only the ${selectedCitations.size} selected citation${selectedCitations.size === 1 ? '' : 's'}.`
                      : 'Export BibTeX: Download all citations as a .bib file for LaTeX/reference managers.'}
                  >
                    {exportingBibtex
                      ? 'Exporting...'
                      : selectedCitations.size > 0
                        ? `Export BibTeX (${selectedCitations.size} selected)`
                        : 'Export BibTeX'}
                  </Button>
                </div>

                <p className="text-[11px] text-gray-500">
                  Select citation rows if you want to export only a subset; otherwise export will include all citations.
                </p>
              </div>
              {citationReviewStatus && (
                <div className="text-[11px] text-gray-600">
                  Reviewed: <span className="font-medium">{citationReviewStatus.reviewed}</span> / {citationReviewStatus.total}
                  {citationReviewStatus.inProcess > 0 && (
                    <> · In Process: <span className="font-medium">{citationReviewStatus.inProcess}</span></>
                  )}
                  {citationReviewStatus.retry > 0 && (
                    <> · Needs Retry: <span className="font-medium text-amber-700">{citationReviewStatus.retry}</span></>
                  )}
                </div>
              )}
              
              {/* Citation Blueprint Coverage Summary */}
              {citationBlueprintCoverage && (
                <div className="bg-gradient-to-r from-violet-50 to-indigo-50 rounded-lg p-3 border border-violet-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                      <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                      </svg>
                      Blueprint Coverage
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">
                        {citationBlueprintCoverage.coveredDimensions}/{citationBlueprintCoverage.totalDimensions} dimensions
                      </span>
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-emerald-500 to-green-500 rounded-full"
                          style={{ width: `${citationBlueprintCoverage.totalDimensions > 0 ? (citationBlueprintCoverage.coveredDimensions / citationBlueprintCoverage.totalDimensions) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  {citationBlueprintCoverage.gaps.length > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      ⚠️ {citationBlueprintCoverage.gaps.length} uncovered dimension{citationBlueprintCoverage.gaps.length > 1 ? 's' : ''} - search for more papers
                    </p>
                  )}
                </div>
              )}

              {/* Selection actions */}
              {selectedCitations.size > 0 && (
                <div className="flex items-center justify-between bg-indigo-50 p-2 rounded text-sm">
                  <span className="text-indigo-700">{selectedCitations.size} selected</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedCitations(new Set())} className="h-6 text-xs">
                      Clear
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleRemoveSelected} className="h-6 text-xs">
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {/* Citations List */}
              <div className="space-y-2 max-h-[450px] overflow-y-auto">
                {citations.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-sm font-medium">No citations yet</p>
                    <p className="text-xs mt-1">Search or import to add citations</p>
                  </div>
                ) : filteredCitations.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">
                    No citations match your search
                  </div>
                ) : (
                  <AnimatePresence>
                    {filteredCitations.map(citation => {
                      const mappings = citationDimensionMappings.get(citation.id) || [];
                      const aiAnalysis = citationAiAnalysis.get(citation.id);
                      const failureCount = citationFailureCounts.get(citation.id) || 0;
                      const isExhausted = !analyzedCitationIds.has(citation.id) && failureCount >= MAX_ANALYSIS_ATTEMPTS;
                      const isSkippedNoAbstract = citationSkippedNoAbstract.has(citation.id) || (analyzedCitationIds.size > 0 && !citation.abstract);
                      return (
                        <motion.div
                          key={citation.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                            selectedCitations.has(citation.id)
                              ? 'bg-indigo-50 border-indigo-300'
                              : 'bg-white hover:bg-gray-50 border-gray-200'
                          }`}
                          onClick={() => {
                            setSelectedCitations(prev => {
                              const next = new Set(prev);
                              if (next.has(citation.id)) {
                                next.delete(citation.id);
                              } else {
                                next.add(citation.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={selectedCitations.has(citation.id)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight">
                                {citation.title}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {citation.authors?.slice(0, 2).join(', ')}
                                {citation.authors?.length > 2 && ' et al.'}
                                {citation.year && ` (${citation.year})`}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <code className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                  {citation.citationKey || citation.preview?.inText}
                                </code>
                                {citation.doi && (
                                  <a
                                    href={`https://doi.org/${citation.doi}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-indigo-600 hover:underline"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    DOI ↗
                                  </a>
                                )}
                              </div>
                              {/* No Abstract — skipped from AI analysis */}
                              {isSkippedNoAbstract && !aiAnalysis && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                                    No Abstract
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    Skipped — add abstract to enable AI analysis
                                  </span>
                                </div>
                              )}
                              {/* Analysis exhausted indicator */}
                              {isExhausted && !aiAnalysis && !isSkippedNoAbstract && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                                    Analysis failed ({failureCount}x)
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    Try adding/editing abstract
                                  </span>
                                </div>
                              )}
                              {/* AI Relevance Review */}
                              {aiAnalysis && (
                                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    aiAnalysis.relevanceScore >= 70
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : aiAnalysis.relevanceScore >= 40
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {aiAnalysis.relevanceScore}% relevant
                                  </span>
                                  {aiAnalysis.recommendation && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      aiAnalysis.recommendation === 'IMPORT'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : aiAnalysis.recommendation === 'MAYBE'
                                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                          : 'bg-gray-50 text-gray-500 border border-gray-200'
                                    }`}>
                                      {aiAnalysis.recommendation}
                                    </span>
                                  )}
                                  {aiAnalysis.reasoning && (
                                    <span className="text-[10px] text-gray-500 line-clamp-1" title={aiAnalysis.reasoning}>
                                      {aiAnalysis.reasoning}
                                    </span>
                                  )}
                                </div>
                              )}
                              {mappings.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {mappings.slice(0, 3).map((mapping, idx) => {
                                    const dimensionText = typeof mapping.dimension === 'string' ? mapping.dimension : '';
                                    const displayDimension = dimensionText.length > 32
                                      ? `${dimensionText.slice(0, 32)}...`
                                      : dimensionText || 'Dimension';
                                    return (
                                      <div
                                        key={`${citation.id}-map-${idx}`}
                                        className="group relative"
                                      >
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                            mapping.confidence === 'HIGH'
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                              : mapping.confidence === 'MEDIUM'
                                                ? 'bg-blue-50 text-blue-700 border-blue-300'
                                                : 'bg-gray-50 text-gray-700 border-gray-300'
                                          }`}
                                        >
                                          {mapping.sectionKey}: {displayDimension}
                                        </span>
                                        {mapping.remark && (
                                          <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-50 w-64 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg">
                                            <p className="font-medium mb-1">{mapping.sectionKey}</p>
                                            <p className="text-gray-300">{mapping.remark}</p>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {mappings.length > 3 && (
                                    <span className="text-[10px] text-gray-500">
                                      +{mappings.length - 3} more
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
              </div>

              {/* Select all / Export */}
              {citations.length > 0 && (
                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedCitations.size === citations.length) {
                          setSelectedCitations(new Set());
                        } else {
                          setSelectedCitations(new Set(citations.map(c => c.id)));
                        }
                      }}
                      className="text-xs text-indigo-600 hover:underline"
                      title="Select or deselect all citations for bulk actions like removal."
                    >
                      {selectedCitations.size === citations.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-500">
                    Use the toolbar above to export all citations or only the selected ones.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!activeCoverageEvidence}
        onOpenChange={(open) => {
          if (!open) setActiveCoverageEvidence(null);
        }}
      >
        <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Mapping Evidence Card</DialogTitle>
            <DialogDescription>
              Review the same grounded evidence card used in the evidence-first table.
            </DialogDescription>
          </DialogHeader>
          {activeCoverageEvidence && (() => {
            const aiSuggestion = aiSuggestions.get(activeCoverageEvidence.paperId);
            const recommendation = paperRecommendations.get(activeCoverageEvidence.paperId);
            const mappings = paperDimensionMappings.get(activeCoverageEvidence.paperId) || [];

            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                  <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">
                    {activeCoverageEvidence.sectionKey}
                  </p>
                  <p className="text-sm text-gray-900 mt-0.5">{activeCoverageEvidence.dimension}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium text-gray-900">{activeCoverageEvidence.paperTitle}</p>
                    {recommendation === 'IMPORT' && (
                      <Badge className="text-[10px] bg-gradient-to-r from-violet-500 to-indigo-500 text-white border-0 shadow-sm">
                        AI Import Pick
                      </Badge>
                    )}
                    {recommendation && (
                      <Badge className={`text-[10px] ${
                        recommendation === 'IMPORT'
                          ? 'bg-emerald-500 text-white'
                          : recommendation === 'MAYBE'
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-400 text-white'
                      }`}>
                        {recommendation}
                      </Badge>
                    )}
                    {aiSuggestion?.deepAnalysisRecommendation && (
                      <Badge className={`text-[10px] ${
                        aiSuggestion.deepAnalysisRecommendation === 'DEEP_ANCHOR'
                          ? 'bg-indigo-600 text-white'
                          : aiSuggestion.deepAnalysisRecommendation === 'DEEP_SUPPORT'
                            ? 'bg-sky-600 text-white'
                            : aiSuggestion.deepAnalysisRecommendation === 'DEEP_STRESS_TEST'
                              ? 'bg-rose-600 text-white'
                              : 'bg-gray-500 text-white'
                      }`}>
                        {aiSuggestion.deepAnalysisRecommendation}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {[
                      activeCoverageEvidence.authors.slice(0, 3).join(', '),
                      activeCoverageEvidence.year ? String(activeCoverageEvidence.year) : '',
                      activeCoverageEvidence.venue || activeCoverageEvidence.publisher
                    ].filter(Boolean).join(' � ') || 'Metadata unavailable'}
                  </p>
                </div>

                {mappings.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {mappings.slice(0, 6).map((mapping, idx) => (
                      <Badge
                        key={`${mapping.sectionKey}-${mapping.dimension}-${idx}`}
                        variant="outline"
                        className={`text-[9px] ${
                          mapping.confidence === 'HIGH'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : mapping.confidence === 'MEDIUM'
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-gray-50 text-gray-600 border-gray-300'
                        }`}
                      >
                        {mapping.sectionKey}: {mapping.dimension.length > 36 ? `${mapping.dimension.slice(0, 36)}...` : mapping.dimension}
                      </Badge>
                    ))}
                  </div>
                )}

                {aiSuggestion ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-2.5 bg-gradient-to-r from-violet-50 to-indigo-50 rounded-lg border border-violet-200"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-violet-500 text-sm shrink-0">AI</span>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">
                            Why it&apos;s relevant
                          </span>
                          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 rounded text-[10px] text-violet-600">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            {aiSuggestion.score}% match
                          </div>
                        </div>
                        <p className="text-xs text-violet-800 leading-relaxed">
                          {aiSuggestion.reasoning}
                        </p>

                        {aiSuggestion.citationMeta && (
                          <div className="pt-2 border-t border-violet-200/50 space-y-1.5">
                            {aiSuggestion.citationMeta.keyContribution && (
                              <div className="flex items-start gap-1.5">
                                <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">Contribution:</span>
                                <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.keyContribution}</span>
                              </div>
                            )}
                            {aiSuggestion.citationMeta.keyFindings && (
                              <div className="flex items-start gap-1.5">
                                <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">Findings:</span>
                                <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.keyFindings}</span>
                              </div>
                            )}
                            {aiSuggestion.citationMeta.methodologicalApproach && (
                              <div className="flex items-start gap-1.5">
                                <span className="text-[10px] font-medium text-violet-600 shrink-0 w-20">Method:</span>
                                <span className="text-[11px] text-violet-900">{aiSuggestion.citationMeta.methodologicalApproach}</span>
                              </div>
                            )}
                            {aiSuggestion.citationMeta.limitationsOrGaps && (
                              <div className="flex items-start gap-1.5">
                                <span className="text-[10px] font-medium text-amber-600 shrink-0 w-20">Gap:</span>
                                <span className="text-[11px] text-amber-900">{aiSuggestion.citationMeta.limitationsOrGaps}</span>
                              </div>
                            )}
                            {aiSuggestion.citationMeta.usage && (
                              <div className="flex items-center gap-1.5 pt-1">
                                <span className="text-[10px] font-medium text-violet-600">Cite in:</span>
                                <div className="flex gap-1 flex-wrap">
                                  {aiSuggestion.citationMeta.usage.introduction && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Introduction</span>
                                  )}
                                  {aiSuggestion.citationMeta.usage.literatureReview && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">Lit Review</span>
                                  )}
                                  {aiSuggestion.citationMeta.usage.methodology && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">Methodology</span>
                                  )}
                                  {aiSuggestion.citationMeta.usage.comparison && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Comparison</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                    <p className="text-xs text-gray-600">
                      AI relevance review is not available for this paper yet. Run AI relevance analysis in Citation Search to see the full review tile.
                    </p>
                  </div>
                )}

                {renderCoverageEvidenceCard(activeCoverageEvidence)}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateCoverageInclusion(activeCoverageEvidence, 'INCLUDED')}
                    className="text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateCoverageInclusion(activeCoverageEvidence, 'EXCLUDED')}
                    className="text-xs text-red-700 border-red-300 hover:bg-red-50"
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      openCoverageRemapDialog(activeCoverageEvidence);
                      setActiveCoverageEvidence(null);
                    }}
                    className="text-xs text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Change Mapping
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!coverageRemapRow}
        onOpenChange={(open) => {
          if (!open) {
            setCoverageRemapRow(null);
            setCoverageRemapSectionKey('');
            setCoverageRemapDimension('');
            setCoverageRemapRemark('');
          }
        }}
      >
        <DialogContent className="max-w-xl bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Change Mapping</DialogTitle>
            <DialogDescription>
              Move this paper to a different blueprint dimension and update the relevance remark.
            </DialogDescription>
          </DialogHeader>
          {coverageRemapRow && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-900">{coverageRemapRow.paperTitle}</p>
                <p className="text-[11px] text-gray-600 mt-1">
                  Current: {coverageRemapRow.sectionKey} / {coverageRemapRow.dimension}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Section</label>
                <select
                  value={coverageRemapSectionKey}
                  onChange={(event) => {
                    const nextSectionKey = event.target.value;
                    const nextDims = coverageSectionOptionMap.get(nextSectionKey)?.dimensions || [];
                    setCoverageRemapSectionKey(nextSectionKey);
                    setCoverageRemapDimension(nextDims[0] || '');
                  }}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {coverageSectionOptions.map(section => (
                    <option key={section.sectionKey} value={section.sectionKey}>
                      {section.sectionKey} - {section.sectionTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Dimension</label>
                <select
                  value={coverageRemapDimension}
                  onChange={(event) => setCoverageRemapDimension(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {coverageRemapDimensionOptions.map(dimension => (
                    <option key={dimension} value={dimension}>
                      {dimension}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Relevance Remark</label>
                <Textarea
                  value={coverageRemapRemark}
                  onChange={(event) => setCoverageRemapRemark(event.target.value)}
                  placeholder="Explain briefly how this paper supports the selected dimension."
                  className="min-h-[96px] text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCoverageRemapRow(null);
                    setCoverageRemapSectionKey('');
                    setCoverageRemapDimension('');
                    setCoverageRemapRemark('');
                  }}
                  disabled={coverageRemapSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitCoverageRemap}
                  disabled={coverageRemapSubmitting || !coverageRemapSectionKey || !coverageRemapDimension}
                >
                  {coverageRemapSubmitting ? 'Saving...' : 'Save mapping'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Gap Analysis Modal */}
      <Dialog open={gapModalOpen} onOpenChange={setGapModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Literature Gap Analysis</DialogTitle>
            <DialogDescription>
              Analyze your {citations.length} citations for themes, gaps, and positioning opportunities
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Button
              onClick={runGapAnalysis}
              disabled={gapLoading || citations.length === 0}
              className="w-full"
            >
              {gapLoading ? 'Analyzing...' : 'Run Analysis'}
            </Button>

            {gapError && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{gapError}</div>
            )}

            {gapAnalysis && (
              <div className="space-y-4">
                {Array.isArray(gapAnalysis.themes) && gapAnalysis.themes.length > 0 && (
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-2">📚 Key Themes</h4>
                    <ul className="space-y-1 text-sm text-blue-800">
                      {gapAnalysis.themes.map((theme: string, i: number) => (
                        <li key={i}>• {theme}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(gapAnalysis.gaps) && gapAnalysis.gaps.length > 0 && (
                  <div className="bg-amber-50 p-4 rounded-lg">
                    <h4 className="font-medium text-amber-900 mb-2">🔍 Research Gaps</h4>
                    <ul className="space-y-1 text-sm text-amber-800">
                      {gapAnalysis.gaps.map((gap: string, i: number) => (
                        <li key={i}>• {gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(gapAnalysis.positioning) && gapAnalysis.positioning.length > 0 && (
                  <div className="bg-emerald-50 p-4 rounded-lg">
                    <h4 className="font-medium text-emerald-900 mb-2">🎯 Positioning Suggestions</h4>
                    <ul className="space-y-1 text-sm text-emerald-800">
                      {gapAnalysis.positioning.map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Abstract Entry Modal */}
      <Dialog open={manualAbstractModalOpen} onOpenChange={(open) => {
        if (!open) {
          setManualAbstractModalOpen(false);
          setManualAbstractResultId(null);
          setManualAbstractText('');
          setManualAbstractResultTitle('');
        }
      }}>
        <DialogContent className="max-w-xl bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Add Abstract Manually
            </DialogTitle>
            <DialogDescription>
              Paste the abstract content for this paper
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Paper title for context */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Paper:</p>
              <p className="text-sm font-medium text-gray-900 line-clamp-2">{manualAbstractResultTitle}</p>
            </div>
            
            {/* Abstract textarea */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Abstract Content
              </label>
              <Textarea
                value={manualAbstractText}
                onChange={(e) => setManualAbstractText(e.target.value)}
                placeholder="Paste the paper's abstract here..."
                className="min-h-[200px] resize-y text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                💡 Tip: You can copy the abstract from the paper's PDF or the publisher's website
              </p>
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setManualAbstractModalOpen(false);
                  setManualAbstractResultId(null);
                  setManualAbstractText('');
                  setManualAbstractResultTitle('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={saveManualAbstract}
                disabled={!manualAbstractText.trim()}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Abstract
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => {
        if (!open) {
          cancelDeleteSelected();
        }
      }}>
        <DialogContent className="max-w-md bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Permanently Delete Results
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Are you sure you want to permanently delete {pendingDeleteIds.size} selected search result(s)? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">
              <strong>Warning:</strong> These results will be permanently removed from your search results. 
              You will need to perform a new search to find them again.
            </p>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={cancelDeleteSelected}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteSelected}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Provide PDF Link Modal */}
      <Dialog
        open={Boolean(pdfLinkModalPaper)}
        onOpenChange={(open) => {
          if (!open) {
            setPdfLinkModalPaper(null);
            setPdfLinkUrl('');
          }
        }}
      >
        <DialogContent className="max-w-lg bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Provide PDF Link</DialogTitle>
            <DialogDescription>
              Paste a direct PDF URL for: {pdfLinkModalPaper?.title || 'paper'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={pdfLinkUrl}
              onChange={(event) => setPdfLinkUrl(event.target.value)}
              placeholder="https://.../paper.pdf"
            />
            <p className="text-xs text-gray-500">
              If this URL is a web page (not a PDF), you can paste full text in the next step.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setPdfLinkModalPaper(null);
                setPdfLinkUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitPdfLink}
              disabled={!pdfLinkUrl.trim() || !pdfLinkModalPaper || submittingPdfLink.has(pdfLinkModalPaper.id)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {pdfLinkModalPaper && submittingPdfLink.has(pdfLinkModalPaper.id) ? 'Submitting...' : 'Submit Link'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paste Full Text Modal */}
      <Dialog
        open={Boolean(pasteTextModalPaper)}
        onOpenChange={(open) => {
          if (!open) {
            setPasteTextModalPaper(null);
            setPasteTextContent('');
            setPasteTextFormat('plain');
          }
        }}
      >
        <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Paste Full Text</DialogTitle>
            <DialogDescription>
              Paste text for: {pasteTextModalPaper?.title || 'paper'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Format:</span>
              <Button
                size="sm"
                variant={pasteTextFormat === 'plain' ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setPasteTextFormat('plain')}
              >
                Plain
              </Button>
              <Button
                size="sm"
                variant={pasteTextFormat === 'html' ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setPasteTextFormat('html')}
              >
                HTML
              </Button>
            </div>

            <Textarea
              value={pasteTextContent}
              onChange={(event) => setPasteTextContent(event.target.value)}
              placeholder="Paste full paper text here..."
              className="min-h-[260px] text-sm"
            />
            <div className="text-xs text-gray-500">
              Characters: {pasteTextContent.trim().length.toLocaleString()}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setPasteTextModalPaper(null);
                setPasteTextContent('');
                setPasteTextFormat('plain');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitPasteText}
              disabled={!pasteTextModalPaper || !pasteTextContent.trim() || submittingPasteText.has(pasteTextModalPaper.id)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {pasteTextModalPaper && submittingPasteText.has(pasteTextModalPaper.id) ? 'Saving...' : 'Save Full Text'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full Text Viewer Modal */}
      <Dialog
        open={Boolean(fullTextModalPaper)}
        onOpenChange={(open) => {
          if (!open) {
            setFullTextModalPaper(null);
            setFullTextModalContent('');
          }
        }}
      >
        <DialogContent className="max-w-4xl bg-white border-gray-200 shadow-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Full Text</DialogTitle>
            <DialogDescription>{fullTextModalPaper?.title || ''}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto border rounded-md p-3 bg-gray-50 max-h-[62vh]">
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800 font-sans">
              {fullTextModalContent}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload PDF Modal */}
      {pdfUploadModalPaper && (
        <DocumentUploadDialog
          open={Boolean(pdfUploadModalPaper)}
          onClose={() => setPdfUploadModalPaper(null)}
          referenceId={pdfUploadModalPaper.referenceId}
          referenceTitle={pdfUploadModalPaper.title}
          authToken={authToken}
          onSuccess={async () => {
            if (!pdfUploadModalPaper) return;
            updateSingleResultPdfState(pdfUploadModalPaper.id, {
              pdfStatus: 'UPLOADED',
              libraryReferenceId: pdfUploadModalPaper.referenceId,
              documentSourceType: 'UPLOAD',
            });
            showToast({
              type: 'success',
              title: 'PDF Uploaded',
              message: 'Uploaded file is queued for text extraction.',
              duration: 3500,
            });
            setPdfUploadModalPaper(null);
          }}
          mode="attach"
        />
      )}

      {/* Manual Entry Modal */}
      <ManualCitationModal
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        authToken={authToken}
        sessionId={sessionId}
        onSaved={async (citation) => {
          setCitations(prev => [...prev, citation]);
          await refreshSession();
        }}
      />
    </div>
  );
}

// Inline Library Import Component (for tab view)
const LIBRARY_PAGE_SIZE = 15;

type LibraryWorkspaceImportPayload = {
  searchRunId: string | null;
  results: any[];
  workspaceAdded: number;
  workspaceSkipped: number;
};

function InlineLibraryImport({
  authToken,
  sessionId,
  onImported
}: {
  authToken: string | null;
  sessionId: string;
  onImported: (payload: LibraryWorkspaceImportPayload) => void | Promise<void>;
}) {
  const [references, setReferences] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [totalRefs, setTotalRefs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    workspaceAdded: number;
    workspaceSkipped: number;
  } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / LIBRARY_PAGE_SIZE);
  
  // Year filter
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Load libraries
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const params = new URLSearchParams({ paperId: sessionId });
      const response = await fetch(`/api/library/collections?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
        setTotalRefs(data.totalReferences || 0);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken, sessionId]);

  const loadReferences = useCallback(async (page = 1) => {
    if (!authToken) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedLibrary) params.set('collectionId', selectedLibrary);
      if (search) params.set('search', search);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      // API uses offset, not page - convert page to offset
      const offset = (page - 1) * LIBRARY_PAGE_SIZE;
      params.set('offset', offset.toString());
      params.set('limit', LIBRARY_PAGE_SIZE.toString());
      
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferences(data.references || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken, search, selectedLibrary, yearFrom, yearTo]);

  // Initial load
  useEffect(() => {
    if (authToken) {
      loadLibraries();
      loadReferences(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]); // Only depend on authToken for initial load

  // When library or filters change, reload from page 1
  useEffect(() => {
    if (authToken) {
      loadReferences(1);
      setSelected(new Set());
      setCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibrary, yearFrom, yearTo, authToken]);
  
  // When page changes
  useEffect(() => {
    if (authToken && currentPage > 1) {
      loadReferences(currentPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, authToken]);
  
  const handleSelectAll = () => {
    if (references.every(r => selected.has(r.id))) {
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.add(r.id));
        return next;
      });
    }
  };
  
  const allOnPageSelected = references.length > 0 && references.every(r => selected.has(r.id));

  const handleImport = async () => {
    if (!authToken || selected.size === 0) return;
    try {
      setImporting(true);
      const selectedIds = Array.from(selected);

      const workspaceResponse = await fetch(`/api/papers/${sessionId}/literature/library-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ referenceIds: selectedIds })
      });

      if (!workspaceResponse.ok) {
        const workspaceErr = await workspaceResponse.json().catch(() => null);
        throw new Error(workspaceErr?.error || 'Failed to add library papers to AI analysis workspace');
      }

      const workspaceData = await workspaceResponse.json();

      const payload: LibraryWorkspaceImportPayload = {
        searchRunId: workspaceData.searchRunId ?? null,
        results: Array.isArray(workspaceData.results) ? workspaceData.results : [],
        workspaceAdded: Number(workspaceData.importedFromLibrary || 0),
        workspaceSkipped: Number(workspaceData.skipped || 0)
      };

      setImportResult({
        workspaceAdded: payload.workspaceAdded,
        workspaceSkipped: payload.workspaceSkipped
      });
      setSelected(new Set());
      await onImported(payload);
    } catch (err) {
      console.error('Failed to import:', err);
    } finally {
      setImporting(false);
    }
  };

  // Success message
  if (importResult) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-6 text-center"
      >
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Added to AI Analysis Workspace
        </h3>
        
        <p className="text-gray-600 mb-4">
          <span className="font-medium text-emerald-600">{importResult.workspaceAdded} paper{importResult.workspaceAdded !== 1 ? 's' : ''}</span> added for AI relevance and dimension mapping
          {importResult.workspaceSkipped > 0 && (
            <span className="text-amber-600"> ({importResult.workspaceSkipped} skipped as duplicates)</span>
          )}
          <span className="block mt-1 text-indigo-600">
            Papers are available in AI workspace only until you choose to add citations.
          </span>
        </p>

        <Button onClick={() => setImportResult(null)} variant="outline">
          Import More
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 h-[400px]">
        {/* Library Sidebar */}
        <div className="w-48 shrink-0 flex flex-col">
          <p className="text-xs font-medium text-gray-600 mb-2">Your Libraries</p>
          <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
            <button
              onClick={() => setSelectedLibrary(null)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b ${
                selectedLibrary === null 
                  ? 'bg-indigo-100 text-indigo-700' 
                  : 'hover:bg-white text-gray-700'
              }`}
            >
              <span className="font-medium">All References</span>
              <Badge variant="secondary" className="text-[10px]">{totalRefs}</Badge>
            </button>
            
            {libraries.map(lib => (
              <button
                key={lib.id}
                onClick={() => setSelectedLibrary(lib.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b last:border-b-0 ${
                  selectedLibrary === lib.id 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'hover:bg-white text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div 
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: lib.color || '#6366f1' }}
                  />
                  <span className="truncate">{lib.name}</span>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">{lib.referenceCount}</Badge>
              </button>
            ))}
            
            {libraries.length === 0 && (
              <div className="p-3 text-xs text-gray-500 text-center">
                No libraries yet.
              </div>
            )}
          </div>
        </div>

        {/* References List */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search & Filters */}
          <div className="space-y-2 mb-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search references..."
                className="flex-1 bg-white h-9"
                onKeyDown={e => e.key === 'Enter' && loadReferences(1)}
              />
              <Button size="sm" variant="secondary" onClick={() => { setCurrentPage(1); loadReferences(1); }}>
                Search
              </Button>
            </div>
            
            {/* Year Filters */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Year:</span>
              <Input
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value)}
                placeholder="From"
                className="w-20 h-7 text-xs bg-white"
                type="number"
              />
              <span className="text-gray-400">-</span>
              <Input
                value={yearTo}
                onChange={e => setYearTo(e.target.value)}
                placeholder="To"
                className="w-20 h-7 text-xs bg-white"
                type="number"
              />
              {(yearFrom || yearTo) && (
                <button 
                  onClick={() => { setYearFrom(''); setYearTo(''); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              )}
            </div>
            
            {/* Select All */}
            {references.length > 0 && (
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <Checkbox 
                    checked={allOnPageSelected}
                    onCheckedChange={handleSelectAll}
                  />
                  Select all on page ({references.length})
                </label>
                <span className="text-xs text-gray-400">
                  Page {currentPage}/{totalPages || 1} • {totalCount} total
                </span>
              </div>
            )}
          </div>

          {/* References Grid */}
          <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
            {loading ? (
              <div className="p-6 text-center">
                <svg className="w-6 h-6 mx-auto mb-2 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-500 text-sm">Loading...</p>
              </div>
            ) : references.length === 0 ? (
              <div className="p-6 text-center">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-gray-500 font-medium text-sm">
                  {selectedLibrary ? 'Library is empty' : 'No references yet'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Add references via Reference Management
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 bg-white rounded-lg">
                {references.map(ref => (
                  (() => {
                    const primaryDocument = Array.isArray(ref.documents) && ref.documents.length > 0
                      ? ref.documents[0]?.document
                      : null;
                    const pdfStatus = normalizePdfStatusValue(primaryDocument?.status);
                    return (
                      <div
                        key={ref.id}
                        className={`p-2.5 cursor-pointer transition-colors ${
                          selected.has(ref.id)
                            ? 'bg-indigo-50 border-l-4 border-l-indigo-500'
                            : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                        }`}
                        onClick={() => {
                          setSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(ref.id)) {
                              next.delete(ref.id);
                            } else {
                              next.add(ref.id);
                            }
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox checked={selected.has(ref.id)} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 line-clamp-1">{ref.title}</p>
                            <p className="text-xs text-gray-500">
                              {ref.authors?.slice(0, 2).join(', ')}
                              {ref.authors?.length > 2 && ' et al.'}
                              {ref.year && ` (${ref.year})`}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              {pdfStatus !== 'NONE' ? (
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] px-1.5 py-0 ${
                                    pdfStatus === 'READY'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : pdfStatus === 'FAILED'
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}
                                >
                                  PDF {pdfStatus}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 bg-gray-50 text-gray-600 border-gray-200"
                                >
                                  PDF NONE
                                </Badge>
                              )}
                              {primaryDocument?.sourceType === 'DOI_FETCH' && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200"
                                >
                                  OA
                                </Badge>
                              )}
                            </div>
                          </div>
                          {ref.isFavorite && (
                            <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1 || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Button>
              <span className="text-xs text-gray-600 px-2">{currentPage}/{totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
              </Button>
            </div>
          )}
        </div>
      </div>
      
      {/* Import Button */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
            {selected.size} selected
          </Badge>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">
              Clear
            </button>
          )}
        </div>
        <Button 
          onClick={handleImport} 
          disabled={selected.size === 0 || importing}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {importing ? (
            <>
              <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Adding...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add {selected.size} to AI Map
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// Library Import Modal Component (for backup/alternative use)
const LIBRARY_MODAL_PAGE_SIZE = 20;

function LibraryImportModal({
  open,
  onOpenChange,
  authToken,
  sessionId,
  onImported,
  onGoToManage
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
  sessionId: string;
  onImported: () => void;
  onGoToManage?: () => void;
}) {
  const [references, setReferences] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [totalRefs, setTotalRefs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / LIBRARY_MODAL_PAGE_SIZE);
  
  // Year filter
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Load libraries
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const params = new URLSearchParams({ paperId: sessionId });
      const response = await fetch(`/api/library/collections?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
        setTotalRefs(data.totalReferences || 0);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken, sessionId]);

  const loadReferences = useCallback(async (page = 1) => {
    if (!authToken) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedLibrary) params.set('collectionId', selectedLibrary);
      if (search) params.set('search', search);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      // API uses offset, not page - convert page to offset
      const offset = (page - 1) * LIBRARY_MODAL_PAGE_SIZE;
      params.set('offset', offset.toString());
      params.set('limit', LIBRARY_MODAL_PAGE_SIZE.toString());
      
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferences(data.references || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken, search, selectedLibrary, yearFrom, yearTo]);

  useEffect(() => {
    if (open && authToken) {
      loadLibraries();
      loadReferences(1);
      // Reset state when opening
      setImportResult(null);
      setSelected(new Set());
      setCurrentPage(1);
    }
  }, [open, authToken, loadLibraries, loadReferences]);

  useEffect(() => {
    if (open) {
      loadReferences(1);
      setSelected(new Set()); // Clear selection when changing library/filters
      setCurrentPage(1);
    }
  }, [selectedLibrary, yearFrom, yearTo, loadReferences, open]);
  
  // Load references when page changes
  useEffect(() => {
    if (open && authToken) {
      loadReferences(currentPage);
    }
  }, [currentPage, open, authToken, loadReferences]);
  
  // Select all on current page
  const handleSelectAll = () => {
    if (references.every(r => selected.has(r.id))) {
      // Deselect all on current page
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      // Select all on current page
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.add(r.id));
        return next;
      });
    }
  };
  
  const allOnPageSelected = references.length > 0 && references.every(r => selected.has(r.id));

  const handleImport = async () => {
    if (!authToken || selected.size === 0) return;
    try {
      setImporting(true);
      const response = await fetch('/api/library/copy-to-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ sessionId, referenceIds: Array.from(selected) })
      });
      if (response.ok) {
        const data = await response.json();
        setImportResult({ imported: data.imported, skipped: data.skipped || 0 });
        onImported();
      }
    } catch (err) {
      console.error('Failed to import:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setImportResult(null);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col bg-white border shadow-xl">
        {/* Success Screen */}
        {importResult ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-8 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Import Successful!
            </h3>
            
            <p className="text-gray-600 mb-6">
              <span className="font-medium text-emerald-600">{importResult.imported} citation{importResult.imported !== 1 ? 's' : ''}</span> imported successfully
              {importResult.skipped > 0 && (
                <span className="text-amber-600"> ({importResult.skipped} skipped as duplicates)</span>
              )}
            </p>

            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mx-auto max-w-md mb-6">
              <div className="flex items-start gap-3 text-left">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-indigo-900 text-sm">Where to find your citations</p>
                  <p className="text-xs text-indigo-700 mt-1">
                    Your imported references are now available in the <strong>"Manage citations"</strong> tab above. 
                    You can also see them in the <strong>"Imported Citations"</strong> panel on the right side of the Search tab.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => {
                setImportResult(null);
                setSelected(new Set());
                onGoToManage?.();
              }}>
                Go to Manage Citations
              </Button>
            </div>
          </motion.div>
        ) : (
          /* Selection Screen */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                </svg>
                Import from Personal Library
              </DialogTitle>
              <DialogDescription>
                Select a library, then choose references to add to this paper
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex gap-4 mt-4">
              {/* Library Sidebar */}
              <div className="w-48 shrink-0 flex flex-col">
                <p className="text-xs font-medium text-gray-600 mb-2">Your Libraries</p>
                <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
                  {/* All References */}
                  <button
                    onClick={() => setSelectedLibrary(null)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b ${
                      selectedLibrary === null 
                        ? 'bg-indigo-100 text-indigo-700' 
                        : 'hover:bg-white text-gray-700'
                    }`}
                  >
                    <span className="font-medium">All References</span>
                    <Badge variant="secondary" className="text-[10px]">{totalRefs}</Badge>
                  </button>
                  
                  {libraries.map(lib => (
                    <button
                      key={lib.id}
                      onClick={() => setSelectedLibrary(lib.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b last:border-b-0 ${
                        selectedLibrary === lib.id 
                          ? 'bg-indigo-100 text-indigo-700' 
                          : 'hover:bg-white text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div 
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: lib.color || '#6366f1' }}
                        />
                        <span className="truncate">{lib.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{lib.referenceCount}</Badge>
                    </button>
                  ))}
                  
                  {libraries.length === 0 && (
                    <div className="p-3 text-xs text-gray-500 text-center">
                      No libraries yet.
                      <br />
                      Create one in Reference Management.
                    </div>
                  )}
                </div>
              </div>

              {/* References List */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Search & Filters */}
                <div className="space-y-2 mb-3">
                  <div className="flex gap-2">
                    <Input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search references..."
                      className="flex-1 bg-white"
                      onKeyDown={e => e.key === 'Enter' && loadReferences(1)}
                    />
                    <Button size="sm" variant="secondary" onClick={() => { setCurrentPage(1); loadReferences(1); }}>
                      Search
                    </Button>
                  </div>
                  
                  {/* Year Filters */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Year:</span>
                    <Input
                      value={yearFrom}
                      onChange={e => setYearFrom(e.target.value)}
                      placeholder="From"
                      className="w-20 h-7 text-xs bg-white"
                      type="number"
                    />
                    <span className="text-gray-400">-</span>
                    <Input
                      value={yearTo}
                      onChange={e => setYearTo(e.target.value)}
                      placeholder="To"
                      className="w-20 h-7 text-xs bg-white"
                      type="number"
                    />
                    {(yearFrom || yearTo) && (
                      <button 
                        onClick={() => { setYearFrom(''); setYearTo(''); }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  
                  {/* Select All for current page */}
                  {references.length > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <Checkbox 
                          checked={allOnPageSelected}
                          onCheckedChange={handleSelectAll}
                        />
                        Select all on this page ({references.length})
                      </label>
                      <span className="text-xs text-gray-400">
                        Page {currentPage} of {totalPages || 1} ({totalCount} total)
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
                  {loading ? (
                    <div className="p-8 text-center">
                      <svg className="w-8 h-8 mx-auto mb-3 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-gray-500">Loading references...</p>
                    </div>
                  ) : references.length === 0 ? (
                    <div className="p-8 text-center">
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <p className="text-gray-500 font-medium">
                        {selectedLibrary ? 'This library is empty' : 'No references yet'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {selectedLibrary 
                          ? 'Add references to this library from Reference Management'
                          : 'Add references to your library first'
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200 bg-white rounded-lg">
                      {references.map(ref => (
                        <div 
                          key={ref.id} 
                          className={`p-3 cursor-pointer transition-colors ${
                            selected.has(ref.id) 
                              ? 'bg-indigo-50 border-l-4 border-l-indigo-500' 
                              : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                          }`}
                          onClick={() => {
                            setSelected(prev => {
                              const next = new Set(prev);
                              if (next.has(ref.id)) {
                                next.delete(ref.id);
                              } else {
                                next.add(ref.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox 
                              checked={selected.has(ref.id)} 
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-gray-900">{ref.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {ref.authors?.slice(0, 2).join(', ')}
                                {ref.authors?.length > 2 && ' et al.'}
                                {ref.year && ` (${ref.year})`}
                              </p>
                              {ref.abstract && (
                                <p className="text-xs text-gray-400 mt-1 line-clamp-1">{ref.abstract}</p>
                              )}
                            </div>
                            {ref.isFavorite && (
                              <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2 mt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1 || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </Button>
                    <span className="text-xs text-gray-600 px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t bg-white">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                  {selected.size} selected
                </Badge>
                {selected.size > 0 && (
                  <button 
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleImport} 
                  disabled={selected.size === 0 || importing}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {importing ? (
                    <>
                      <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Importing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Import {selected.size} reference{selected.size !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Manual Citation Entry Modal
function ManualCitationModal({
  open,
  onOpenChange,
  authToken,
  sessionId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
  sessionId: string;
  onSaved: (citation: any) => void;
}) {
  const [form, setForm] = useState({
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    url: '',
    abstract: '',
    sourceType: 'JOURNAL_ARTICLE'
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!authToken || !form.title.trim()) return;
    try {
      setSaving(true);
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          searchResult: {
            title: form.title,
            authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
            year: form.year ? parseInt(form.year, 10) : undefined,
            venue: form.venue,
            doi: form.doi,
            url: form.url,
            abstract: form.abstract,
            source: 'manual'
          }
        })
      });
      if (response.ok) {
        const data = await response.json();
        onSaved(data.citation);
        onOpenChange(false);
        setForm({
          title: '',
          authors: '',
          year: '',
          venue: '',
          doi: '',
          url: '',
          abstract: '',
          sourceType: 'JOURNAL_ARTICLE'
        });
      }
    } catch (err) {
      console.error('Failed to save citation:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl">
        <DialogHeader>
          <DialogTitle>Add Citation Manually</DialogTitle>
          <DialogDescription>Enter the bibliographic details</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 mt-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Title *</label>
            <Input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Paper title"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Authors (comma-separated)</label>
              <Input
                value={form.authors}
                onChange={e => setForm(p => ({ ...p, authors: e.target.value }))}
                placeholder="John Smith, Jane Doe"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Year</label>
              <Input
                type="number"
                value={form.year}
                onChange={e => setForm(p => ({ ...p, year: e.target.value }))}
                placeholder="2024"
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Journal / Conference</label>
              <Input
                value={form.venue}
                onChange={e => setForm(p => ({ ...p, venue: e.target.value }))}
                placeholder="Nature, ICML 2024, etc."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">DOI</label>
              <Input
                value={form.doi}
                onChange={e => setForm(p => ({ ...p, doi: e.target.value }))}
                placeholder="10.1000/xyz123"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Abstract</label>
            <Textarea
              value={form.abstract}
              onChange={e => setForm(p => ({ ...p, abstract: e.target.value }))}
              placeholder="Paper abstract (optional)"
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving...' : 'Add Citation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

