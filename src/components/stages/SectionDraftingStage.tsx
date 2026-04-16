'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  AlertCircle,
  Settings2,
  RefreshCw,
  Image as ImageIcon,
  X,
  Eye,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import CitationPickerModal from '@/components/paper/CitationPickerModal';

import PaperMarkdownEditor, {
  type PaperMarkdownEditorRef,
  type PaperCitationDisplayMeta,
  type PaperFigureDisplayMeta
} from '@/components/paper/PaperMarkdownEditor';
import MarkdownRenderer from '@/components/paper/MarkdownRenderer';

// Shared drafting components used by the paper workflow
import BackendActivityPanel from '@/components/drafting/BackendActivityPanel';
import WritingSamplesModal from '@/components/drafting/WritingSamplesModal';
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager';
// Paper-specific components
import PaperInstructionsModal from './PaperInstructionsModal';
import PaperSectionInstructionPopover from './PaperSectionInstructionPopover';
import FloatingWritingPanel from '@/components/paper/FloatingWritingPanel';
import { getPaperFigureCaptionSeed } from '@/lib/figure-generation/paper-figure-record';
import { extractFigureSuggestionMeta } from '@/lib/figure-generation/suggestion-meta';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';
import InlineDimensionProposal from '@/components/paper/InlineDimensionProposal';
import DimensionPlanPills from '@/components/paper/DimensionPlanPills';
import SectionFloatingToolbar from '@/components/paper/SectionFloatingToolbar';

// ============================================================================
// Types
// ============================================================================

interface SectionDraftingStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  selectedSection?: string;
  onSectionSelect?: (sectionKey: string) => void;
  onNavigateToStage?: (stageKey: string) => void;
}

type SectionConfig = {
  keys: string[];
  label: string;
  description?: string;
  constraints?: string[];
  required?: boolean;
  wordLimit?: number;
};

interface UserInstruction {
  id?: string;
  instruction: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
  isActive?: boolean;
  isPersistent?: boolean;
  updatedAt?: string;
}

type SectionCitationValidation = {
  disallowedKeys: string[];
  unknownKeys: string[];
};

type GenerationDebugStep = {
  step: string;
  status: 'ok' | 'running' | 'queued' | 'error';
  label?: string;
};

type SectionGenerationStatusEvent = {
  sectionKey?: string;
  phase?: string;
  message?: string;
  at?: string;
};

type SectionGenerationErrorEvent = {
  message?: string;
  status?: number;
  payload?: any;
};

type SectionGenerationStreamResult = {
  ok: boolean;
  result: any | null;
  error: SectionGenerationErrorEvent | null;
};

type ReferenceDraftSectionView = {
  sectionKey: string;
  displayName: string;
  status: string;
  hasContent: boolean;
  content: string;
  wordCount: number;
  generatedAt: string | null;
  source: 'pass1_artifact' | 'base_content_internal' | 'none';
  updatedAt: string | null;
  figureGrounding: {
    enabled: boolean;
    selectedFigureIds: string[];
    effectiveFigureIds: string[];
    figureRefs: string[];
    figureSignature: string;
    newestFigureUpdatedAt: string | null;
    waitedForMetadata: boolean;
  } | null;
};

type DimensionPlanStatus = 'accepted' | 'pending' | 'todo';

interface DimensionPlanItem {
  dimensionKey: string;
  dimensionLabel: string;
  objective: string;
  mustUseCitationKeys: string[];
  avoidClaims: string[];
  bridgeHint: string;
  status: DimensionPlanStatus;
}

interface DimensionCitationValidation {
  allowedCitationKeys: string[];
  disallowedKeys: string[];
  unknownKeys: string[];
  missingRequiredKeys: string[];
}

type DimensionRole = 'introduction' | 'body' | 'conclusion' | 'intro_conclusion';

interface DimensionPass1Memory {
  keyPoints: string[];
  termsIntroduced: string[];
  mainClaims: string[];
  forwardReferences: string[];
  sectionIntent?: string;
  openingStrategy?: string;
  closingStrategy?: string;
  sectionOutline?: string[];
}

interface DimensionPass1SourceReview {
  source: 'pass1_section_draft';
  contentFingerprint: string;
  wordCount: number;
  preview: string;
  generatedAt?: string;
  reused: boolean;
  memory?: DimensionPass1Memory | null;
}

interface DimensionProposalReviewTrace {
  pass1Fingerprint: string;
  pass1WordCount: number;
  role: DimensionRole;
  bridgeHint: string;
  requiredCitationKeys: string[];
  previousDimensionLabel?: string | null;
  nextDimensionLabel?: string | null;
  acceptedBlockCount: number;
  acceptedContextHash: string;
  acceptedSummary: string;
  acceptedContextPreview: string;
  pass1DimensionSummary?: string;
  targetEvidenceSummary?: string;
}

interface DimensionProposal {
  dimensionKey: string;
  content: string;
  contextHash: string;
  citationValidation: DimensionCitationValidation;
  createdAt: string;
  reviewTrace: DimensionProposalReviewTrace | null;
}

interface DimensionProgress {
  total: number;
  accepted: number;
  remaining: number;
}

interface FigureInjectionPreference {
  enabled: boolean;
  selectedFigureIds: string[];
}

interface DimensionDraftUIState {
  initialized: boolean;
  started: boolean;
  loading: boolean;
  accepting: boolean;
  rejecting: boolean;
  error: string | null;
  stitchedContent: string;
  plan: DimensionPlanItem[];
  progress: DimensionProgress;
  completed: boolean;
  nextDimensionKey: string | null;
  nextDimensionLabel: string | null;
  activeDimensionKey: string | null;
  activeDimensionLabel: string | null;
  proposalText: string;
  proposalValidation: DimensionCitationValidation | null;
  proposalReviewTrace: DimensionProposalReviewTrace | null;
  pass1Source: DimensionPass1SourceReview | null;
  feedback: string;
  showReject: boolean;
  editMode: boolean;
  streamCursor: number;
  isStreaming: boolean;
}

const EMPTY_DIMENSION_PROGRESS: DimensionProgress = {
  total: 0,
  accepted: 0,
  remaining: 0
};

function createInitialDimensionUIState(): DimensionDraftUIState {
  return {
    initialized: false,
    started: false,
    loading: false,
    accepting: false,
    rejecting: false,
    error: null,
    stitchedContent: '',
    plan: [],
    progress: { ...EMPTY_DIMENSION_PROGRESS },
    completed: false,
    nextDimensionKey: null,
    nextDimensionLabel: null,
    activeDimensionKey: null,
    activeDimensionLabel: null,
    proposalText: '',
    proposalValidation: null,
    proposalReviewTrace: null,
    pass1Source: null,
    feedback: '',
    showReject: false,
    editMode: false,
    streamCursor: 0,
    isStreaming: false
  };
}

function createDefaultFigureInjectionPreference(): FigureInjectionPreference {
  return {
    enabled: false,
    selectedFigureIds: []
  };
}

async function readSectionGenerationStream(
  response: Response,
  handlers: {
    onStatus: (payload: SectionGenerationStatusEvent) => void;
    onError: (payload: SectionGenerationErrorEvent) => void;
    onResult: (payload: any) => void;
  }
): Promise<SectionGenerationStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, result: null, error: { message: 'No response stream available' } };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let ok = false;
  let resultPayload: any | null = null;
  let errorPayload: SectionGenerationErrorEvent | null = null;

  const parseChunk = (chunk: string) => {
    const lines = chunk.split('\n');
    let event = 'message';
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;

    const payload = JSON.parse(data.join('\n'));
    if (event === 'status') handlers.onStatus(payload);
    if (event === 'result') {
      resultPayload = payload;
      handlers.onResult(payload);
    }
    if (event === 'error') {
      errorPayload = payload;
      handlers.onError(payload);
    }
    if (event === 'done') {
      ok = payload?.ok === true;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      parseChunk(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    parseChunk(buffer);
  }

  return { ok, result: resultPayload, error: errorPayload };
}

function normalizeDimensionPlanItem(raw: any): DimensionPlanItem {
  return {
    dimensionKey: String(raw?.dimensionKey || '').trim(),
    dimensionLabel: String(raw?.dimensionLabel || raw?.dimensionKey || '').trim(),
    objective: String(raw?.objective || '').trim(),
    mustUseCitationKeys: Array.isArray(raw?.mustUseCitationKeys)
      ? raw.mustUseCitationKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    avoidClaims: Array.isArray(raw?.avoidClaims)
      ? raw.avoidClaims.map((text: unknown) => String(text || '').trim()).filter(Boolean)
      : [],
    bridgeHint: String(raw?.bridgeHint || '').trim(),
    status: raw?.status === 'accepted' || raw?.status === 'pending'
      ? raw.status
      : 'todo'
  };
}

function toDimensionValidation(raw: any): DimensionCitationValidation | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    allowedCitationKeys: Array.isArray(raw.allowedCitationKeys)
      ? raw.allowedCitationKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    disallowedKeys: Array.isArray(raw.disallowedKeys)
      ? raw.disallowedKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    unknownKeys: Array.isArray(raw.unknownKeys)
      ? raw.unknownKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    missingRequiredKeys: Array.isArray(raw.missingRequiredKeys)
      ? raw.missingRequiredKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : []
  };
}

function toDimensionPass1Memory(raw: any): DimensionPass1Memory | null {
  if (!raw || typeof raw !== 'object') return null;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const termsIntroduced = Array.isArray(raw.termsIntroduced)
    ? raw.termsIntroduced.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const mainClaims = Array.isArray(raw.mainClaims)
    ? raw.mainClaims.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const forwardReferences = Array.isArray(raw.forwardReferences)
    ? raw.forwardReferences.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const sectionIntent = String(raw.sectionIntent || '').trim() || undefined;
  const openingStrategy = String(raw.openingStrategy || '').trim() || undefined;
  const closingStrategy = String(raw.closingStrategy || '').trim() || undefined;
  const sectionOutline = Array.isArray(raw.sectionOutline)
    ? raw.sectionOutline.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];

  if (
    keyPoints.length === 0
    && termsIntroduced.length === 0
    && mainClaims.length === 0
    && forwardReferences.length === 0
    && !sectionIntent
    && !openingStrategy
    && !closingStrategy
    && sectionOutline.length === 0
  ) {
    return null;
  }

  return {
    keyPoints,
    termsIntroduced,
    mainClaims,
    forwardReferences,
    sectionIntent,
    openingStrategy,
    closingStrategy,
    sectionOutline
  };
}

function toDimensionPass1Source(raw: any): DimensionPass1SourceReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const contentFingerprint = String(raw.contentFingerprint || '').trim();
  if (!contentFingerprint) return null;
  return {
    source: 'pass1_section_draft',
    contentFingerprint,
    wordCount: Number(raw.wordCount || 0),
    preview: String(raw.preview || ''),
    generatedAt: String(raw.generatedAt || '').trim() || undefined,
    reused: Boolean(raw.reused),
    memory: toDimensionPass1Memory(raw.memory)
  };
}

function toDimensionProposalReviewTrace(raw: any): DimensionProposalReviewTrace | null {
  if (!raw || typeof raw !== 'object') return null;
  const role = String(raw.role || '').trim();
  if (!role || !String(raw.pass1Fingerprint || '').trim()) return null;
  if (role !== 'introduction' && role !== 'body' && role !== 'conclusion' && role !== 'intro_conclusion') {
    return null;
  }

  return {
    pass1Fingerprint: String(raw.pass1Fingerprint || '').trim(),
    pass1WordCount: Number(raw.pass1WordCount || 0),
    role: role as DimensionRole,
    bridgeHint: String(raw.bridgeHint || '').trim(),
    requiredCitationKeys: Array.isArray(raw.requiredCitationKeys)
      ? raw.requiredCitationKeys.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [],
    previousDimensionLabel: String(raw.previousDimensionLabel || '').trim() || null,
    nextDimensionLabel: String(raw.nextDimensionLabel || '').trim() || null,
    acceptedBlockCount: Number(raw.acceptedBlockCount || 0),
    acceptedContextHash: String(raw.acceptedContextHash || '').trim(),
    acceptedSummary: String(raw.acceptedSummary || ''),
    acceptedContextPreview: String(raw.acceptedContextPreview || ''),
    pass1DimensionSummary: String(raw.pass1DimensionSummary || '').trim() || undefined,
    targetEvidenceSummary: String(raw.targetEvidenceSummary || '').trim() || undefined
  };
}

function normalizeDimensionResponse(data: any): {
  started: boolean;
  stitchedContent: string;
  pass1Source: DimensionPass1SourceReview | null;
  completed: boolean;
  plan: DimensionPlanItem[];
  progress: DimensionProgress;
  nextDimensionKey: string | null;
  nextDimensionLabel: string | null;
  proposal: DimensionProposal | null;
} {
  const plan = Array.isArray(data?.plan)
    ? data.plan.map((item: any) => normalizeDimensionPlanItem(item)).filter((item: DimensionPlanItem) => item.dimensionKey.length > 0)
    : [];
  const progress = (data?.progress && typeof data.progress === 'object')
    ? {
        total: Number(data.progress.total || 0),
        accepted: Number(data.progress.accepted || 0),
        remaining: Number(data.progress.remaining || 0)
      }
    : {
        total: plan.length,
        accepted: plan.filter((item: DimensionPlanItem) => item.status === 'accepted').length,
        remaining: plan.filter((item: DimensionPlanItem) => item.status !== 'accepted').length
      };
  const nextDimension = data?.nextDimension && typeof data.nextDimension === 'object'
    ? data.nextDimension
    : null;
  const pass1Source = toDimensionPass1Source(data?.pass1Source || data?.flow?.pass1Source || null);
  const rawProposal = data?.proposal
    || data?.flow?.pendingProposal
    || null;
  const proposal = rawProposal && typeof rawProposal === 'object'
    ? {
        dimensionKey: String(rawProposal.dimensionKey || '').trim(),
        content: String(rawProposal.content || ''),
        contextHash: String(rawProposal.contextHash || ''),
        citationValidation: toDimensionValidation(rawProposal.citationValidation) || {
          allowedCitationKeys: [],
          disallowedKeys: [],
          unknownKeys: [],
          missingRequiredKeys: []
        },
        createdAt: String(rawProposal.createdAt || ''),
        reviewTrace: toDimensionProposalReviewTrace(rawProposal.reviewTrace)
      }
    : null;

  return {
    started: Boolean(data?.started ?? data?.flow),
    stitchedContent: String(data?.stitchedContent || ''),
    pass1Source,
    completed: Boolean(data?.completed),
    plan,
    progress,
    nextDimensionKey: nextDimension ? String(nextDimension.dimensionKey || '').trim() || null : null,
    nextDimensionLabel: nextDimension ? String(nextDimension.dimensionLabel || nextDimension.dimensionKey || '').trim() || null : null,
    proposal: proposal && proposal.dimensionKey ? proposal : null
  };
}

// ============================================================================
// Tooltip Component
// ============================================================================

function Tooltip({ content, position = 'bottom', children }: {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };
  
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-lg whitespace-nowrap ${positionClasses[position]}`}>
          {content}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function parseExtraSections(value: any): Record<string, string> {
  const normalize = (sections: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const [key, sectionValue] of Object.entries(sections)) {
      if (typeof sectionValue === 'string') {
        normalized[key] = polishDraftMarkdown(sectionValue);
      }
    }
    return normalized;
  };

  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? normalize(parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return normalize(value as Record<string, unknown>);
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeSectionKey(sectionKey: string): string {
  return sectionKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const SINGLE_PASS_SECTION_KEYS = new Set(['abstract', 'conclusion']);
const PASS1_EXCLUDED_SECTION_KEYS = new Set(['references', 'reference', 'bibliography']);

function supportsDimensionFlow(sectionKey: string): boolean {
  const normalized = normalizeSectionKey(sectionKey);
  return !SINGLE_PASS_SECTION_KEYS.has(normalized) && !PASS1_EXCLUDED_SECTION_KEYS.has(normalized);
}

function isPass1ExcludedSection(sectionKey: string): boolean {
  return PASS1_EXCLUDED_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

function supportsPass1FigureInjection(sectionKey: string): boolean {
  const normalized = normalizeSectionKey(sectionKey);
  return normalized !== 'abstract' && !isPass1ExcludedSection(normalized);
}

const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi;

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '');
  if (!raw) return '';

  const decodeHtmlEntities = (value: string): string => value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  const replaceLegacySpans = (value: string): string => value.replace(
    LEGACY_CITATION_SPAN_REGEX,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim();
      return citationKey ? `[CITE:${citationKey}]` : _full;
    }
  );

  const normalized = replaceLegacySpans(raw);
  if (!normalized.includes('data-cite-key') && !normalized.includes('&lt;span')) {
    return normalized;
  }

  return replaceLegacySpans(decodeHtmlEntities(normalized));
}

function parseCitationStyleMeta(raw: unknown): {
  styleCode: string;
  sortOrder: 'alphabetical' | 'order_of_appearance';
  isNumericStyle: boolean;
  orderedCitationKeys: string[];
  numberingByKey: Record<string, number>;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const styleCode = String(data.styleCode || '').trim().toUpperCase();
  if (!styleCode) return null;

  const sortOrder = data.sortOrder === 'order_of_appearance'
    ? 'order_of_appearance'
    : 'alphabetical';
  const isNumericStyle = Boolean(data.isNumericStyle);
  const orderedCitationKeys = Array.isArray(data.orderedCitationKeys)
    ? data.orderedCitationKeys.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const numberingByKey: Record<string, number> = {};
  if (data.numberingByKey && typeof data.numberingByKey === 'object' && !Array.isArray(data.numberingByKey)) {
    for (const [key, value] of Object.entries(data.numberingByKey as Record<string, unknown>)) {
      const parsed = Number(value);
      if (key && Number.isFinite(parsed) && parsed > 0) {
        numberingByKey[key] = Math.trunc(parsed);
      }
    }
  }

  return {
    styleCode,
    sortOrder,
    isNumericStyle,
    orderedCitationKeys,
    numberingByKey
  };
}

const displayName: Record<string, string> = {
  title: 'Title', abstract: 'Abstract', introduction: 'Introduction',
  literature_review: 'Literature Review', related_work: 'Related Work',
  methodology: 'Methodology', results: 'Results', discussion: 'Discussion',
  conclusion: 'Conclusion', acknowledgments: 'Acknowledgments', references: 'References',
  appendix: 'Appendix', future_work: 'Future Work', future_directions: 'Future Directions',
  main_content: 'Main Content', case_studies: 'Case Studies', case_description: 'Case Description',
  analysis: 'Analysis', recommendations: 'Recommendations', main_findings: 'Main Findings', publications: 'Publications'
};

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract', wordLimit: 300 },
  { keys: ['introduction'], label: 'Introduction', wordLimit: 1000 },
  { keys: ['literature_review'], label: 'Literature Review', wordLimit: 2000 },
  { keys: ['methodology'], label: 'Methodology', wordLimit: 1500 },
  { keys: ['results'], label: 'Results', wordLimit: 1200 },
  { keys: ['discussion'], label: 'Discussion', wordLimit: 1500 },
  { keys: ['conclusion'], label: 'Conclusion', wordLimit: 600 },
  { keys: ['references'], label: 'References' }
];

const DEFAULT_CITATION_ELIGIBLE_SECTIONS = new Set([
  'introduction',
  'literature_review',
  'methodology'
]);

// Auto-save debounce delay in ms - increased for stability
const AUTO_SAVE_DELAY = 3000;

// ============================================================================
// Main Component
// ============================================================================

export default function SectionDraftingStage({ 
  sessionId, authToken, onSessionUpdated, onNavigateToStage, selectedSection 
}: SectionDraftingStageProps) {
  // Session State
  const [session, setSession] = useState<any>(null);
  const [paperTypeCode, setPaperTypeCode] = useState<string>('');
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Draft Content State - Always in edit mode
  const [content, setContent] = useState<Record<string, string>>({});
  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const autoSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Generation State
  const [loading, setLoading] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null);
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({});
  const [sectionStatusMessage, setSectionStatusMessage] = useState<Record<string, string>>({});
  const [mappedEvidenceBySection, setMappedEvidenceBySection] = useState<Record<string, boolean>>({});
  const [citationEligibleBySection, setCitationEligibleBySection] = useState<Record<string, boolean>>({});

  // Auto Mode
  const [autoMode, setAutoMode] = useState(false);
  const [autoModeRunning, setAutoModeRunning] = useState(false);
  const [autoModeProgress, setAutoModeProgress] = useState<{ current: number; total: number; currentSection: string } | null>(null);
  const autoModeCancelledRef = useRef(false);

  // Persona & Style
  const [usePersonaStyle, setUsePersonaStyle] = useState(false);
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null);
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false);
  const [showPersonaManager, setShowPersonaManager] = useState(false);
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined);

  // UI State
  const [showActivity, setShowActivity] = useState(true);
  const [debugSteps, setDebugSteps] = useState<GenerationDebugStep[]>([]);
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  // User Instructions (loaded from API)
  const [userInstructions, setUserInstructions] = useState<Record<string, UserInstruction>>({});
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null);
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false);

  // Citations
  const [citations, setCitations] = useState<any[]>([]);
  const [citationStyleMeta, setCitationStyleMeta] = useState<{
    styleCode: string;
    sortOrder: 'alphabetical' | 'order_of_appearance';
    isNumericStyle: boolean;
    orderedCitationKeys: string[];
    numberingByKey: Record<string, number>;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertCitationTarget, setInsertCitationTarget] = useState<string | null>(null);
  const insertCitationTargetRef = useRef<string | null>(null);
  const editorRefs = useRef<Record<string, PaperMarkdownEditorRef | null>>({});
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const [bibliographyContent, setBibliographyContent] = useState<string>('');
  const [generatingBibliography, setGeneratingBibliography] = useState(false);
  const [bibliographyStyle, setBibliographyStyle] = useState<string>('APA7');
  const [bibliographySortOrder, setBibliographySortOrder] = useState<'alphabetical' | 'order_of_appearance'>('alphabetical');
  const [sequenceInfo, setSequenceInfo] = useState<{
    styleCode: string;
    version: number | null;
    changed: boolean;
    added: number;
    removed: number;
    renumbered: number;
    historyCount: number;
  } | null>(null);
  const isNumericOrderBibliography = useMemo(
    () => ['IEEE', 'VANCOUVER'].includes((bibliographyStyle || '').toUpperCase()),
    [bibliographyStyle]
  );

  useEffect(() => {
    const normalizedSection = normalizeSectionKey(selectedSection || '');
    if (!normalizedSection) return;

    setFocusedSection(normalizedSection);

    const frameId = window.requestAnimationFrame(() => {
      const anchor = document.querySelector<HTMLElement>(`[data-section-anchor="${normalizedSection}"]`);
      if (!anchor) return;

      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const editor = editorRefs.current[normalizedSection];
      editor?.focus?.();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedSection, sectionConfigs]);
  

  // Floating Panel State
  const [figures, setFigures] = useState<Array<{
    id: string;
    figureNo: number;
    title: string;
    caption?: string;
    description?: string;
    generationPrompt?: string;
    notes?: string;
    imagePath?: string;
    status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
    category?: string;
    figureType?: string;
    suggestionMeta?: Record<string, unknown> | null;
    inferredImageMeta?: Record<string, unknown> | null;
    updatedAt?: string | null;
  }>>([]);
  const [selectedText, setSelectedText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [previewFigure, setPreviewFigure] = useState<{
    id: string;
    figureNo: number;
    title: string;
    imagePath?: string;
    description?: string;
  } | null>(null);

  // Background generation (two-pass pipeline)
  const [bgGenStatus, setBgGenStatus] = useState<string | null>(null);
  const [bgGenProgress, setBgGenProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    sections?: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
  } | null>(null);
  const [bgGenRetrying, setBgGenRetrying] = useState(false);
  const [bgSectionSelectorOpen, setBgSectionSelectorOpen] = useState(false);
  const [bgSelectedSectionKeys, setBgSelectedSectionKeys] = useState<string[]>([]);
  const [showReferenceDraftModal, setShowReferenceDraftModal] = useState(false);
  const [referenceDraftLoading, setReferenceDraftLoading] = useState(false);
  const [referenceDraftError, setReferenceDraftError] = useState<string | null>(null);
  const [referenceDraftSections, setReferenceDraftSections] = useState<ReferenceDraftSectionView[]>([]);
  const [referenceDraftSummary, setReferenceDraftSummary] = useState<{
    totalSections: number;
    withPass1Content: number;
    withoutPass1Content: number;
  } | null>(null);
  const [referenceDraftFetchedAt, setReferenceDraftFetchedAt] = useState<string | null>(null);
  const [sectionCitationValidation, setSectionCitationValidation] = useState<Record<string, SectionCitationValidation>>({});
  const [dimensionPanelOpen, setDimensionPanelOpen] = useState<Record<string, boolean>>({});
  const [dimensionBySection, setDimensionBySection] = useState<Record<string, DimensionDraftUIState>>({});
  const [figureInjectionBySection, setFigureInjectionBySection] = useState<Record<string, FigureInjectionPreference>>({});
  const [figurePickerOpenBySection, setFigurePickerOpenBySection] = useState<Record<string, boolean>>({});
  const [bgFigurePickerOpenBySection, setBgFigurePickerOpenBySection] = useState<Record<string, boolean>>({});

  // Regeneration
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({});
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({});

  // REMOVED: View mode toggle - always in edit mode for stability
  // const [viewMode, setViewMode] = useState<Record<string, 'edit' | 'preview'>>({});

  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning'>('success');
  const mappedEvidenceStorageKey = useMemo(
    () => (sessionId ? `paper:${sessionId}:mapped-evidence` : ''),
    [sessionId]
  );
  const figureInjectionStorageKey = useMemo(
    () => (sessionId ? `paper:${sessionId}:figure-injection` : ''),
    [sessionId]
  );

  const showMsg = (msg: string, type: 'success' | 'error' | 'warning') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  };

  const getDimensionState = useCallback((sectionKey: string): DimensionDraftUIState => {
    const normalized = normalizeSectionKey(sectionKey);
    return dimensionBySection[normalized] || createInitialDimensionUIState();
  }, [dimensionBySection]);

  const setDimensionState = useCallback((
    sectionKey: string,
    updater: (prev: DimensionDraftUIState) => DimensionDraftUIState
  ) => {
    const normalized = normalizeSectionKey(sectionKey);
    setDimensionBySection(prev => {
      const current = prev[normalized] || createInitialDimensionUIState();
      return {
        ...prev,
        [normalized]: updater(current)
      };
    });
  }, []);

  const selectableFigures = useMemo(
    () => figures.filter((figure) => figure.status !== 'FAILED'),
    [figures]
  );

  const getFigureInjectionState = useCallback((sectionKey: string): FigureInjectionPreference => {
    const normalized = normalizeSectionKey(sectionKey);
    return figureInjectionBySection[normalized] || createDefaultFigureInjectionPreference();
  }, [figureInjectionBySection]);

  const isFigureRecommendedForSection = useCallback((
    figure: {
      category?: string;
      figureType?: string;
      suggestionMeta?: Record<string, unknown> | null;
    },
    sectionKey: string
  ) => {
    const normalizedSection = normalizeSectionKey(sectionKey);
    const meta = figure.suggestionMeta && typeof figure.suggestionMeta === 'object'
      ? figure.suggestionMeta
      : null;
    const relevantSection = normalizeSectionKey(String(meta?.relevantSection || ''));
    const figureRole = String(meta?.figureRole || '').trim().toUpperCase();
    const figureType = String(figure.figureType || '').trim().toLowerCase();
    const category = String(figure.category || '').trim().toUpperCase();

    if (relevantSection && relevantSection === normalizedSection) {
      return true;
    }

    if (normalizedSection === 'methodology') {
      return figureRole === 'EXPLAIN_METHOD'
        || ['flowchart', 'architecture', 'sequence', 'class', 'er', 'gantt'].includes(figureType)
        || category === 'DIAGRAM'
        || category === 'ILLUSTRATED_FIGURE';
    }

    if (normalizedSection === 'results') {
      return figureRole === 'SHOW_RESULTS'
        || category === 'DATA_CHART'
        || category === 'STATISTICAL_PLOT';
    }

    if (normalizedSection === 'discussion') {
      return figureRole === 'INTERPRET';
    }

    return false;
  }, []);

  const getRecommendedFigureIds = useCallback((sectionKey: string) => {
    return selectableFigures
      .filter((figure) => isFigureRecommendedForSection(figure, sectionKey))
      .map((figure) => figure.id);
  }, [isFigureRecommendedForSection, selectableFigures]);

  const getSortedFiguresForSection = useCallback((sectionKey: string) => {
    return [...selectableFigures].sort((left, right) => {
      const leftRecommended = isFigureRecommendedForSection(left, sectionKey);
      const rightRecommended = isFigureRecommendedForSection(right, sectionKey);
      if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1;
      return left.figureNo - right.figureNo;
    });
  }, [isFigureRecommendedForSection, selectableFigures]);

  const setFigureInjectionState = useCallback((
    sectionKey: string,
    updater: (prev: FigureInjectionPreference) => FigureInjectionPreference
  ) => {
    const normalized = normalizeSectionKey(sectionKey);
    setFigureInjectionBySection(prev => {
      const current = prev[normalized] || createDefaultFigureInjectionPreference();
      return {
        ...prev,
        [normalized]: updater(current)
      };
    });
  }, []);

  const toggleFigureInjection = useCallback((sectionKey: string) => {
    const recommendedIds = getRecommendedFigureIds(sectionKey);
    const normalized = normalizeSectionKey(sectionKey);
    setFigureInjectionBySection(prev => {
      const current = prev[normalized] || createDefaultFigureInjectionPreference();
      const nextEnabled = !current.enabled;
      return {
        ...prev,
        [normalized]: {
          enabled: nextEnabled,
          selectedFigureIds: nextEnabled && current.selectedFigureIds.length === 0
            ? recommendedIds
            : current.selectedFigureIds
        }
      };
    });
    setFigurePickerOpenBySection(prev => ({
      ...prev,
      [normalized]: false
    }));
  }, [getRecommendedFigureIds]);

  const toggleFigureSelection = useCallback((sectionKey: string, figureId: string) => {
    setFigureInjectionState(sectionKey, prev => {
      const selected = prev.selectedFigureIds.includes(figureId)
        ? prev.selectedFigureIds.filter(id => id !== figureId)
        : [...prev.selectedFigureIds, figureId];
      return {
        ...prev,
        enabled: true,
        selectedFigureIds: selected
      };
    });
  }, [setFigureInjectionState]);

  const applyRecommendedFigureSelection = useCallback((sectionKey: string) => {
    setFigureInjectionState(sectionKey, prev => ({
      ...prev,
      enabled: true,
      selectedFigureIds: getRecommendedFigureIds(sectionKey)
    }));
  }, [getRecommendedFigureIds, setFigureInjectionState]);

  const selectAllFiguresForSection = useCallback((sectionKey: string) => {
    setFigureInjectionState(sectionKey, prev => ({
      ...prev,
      enabled: true,
      selectedFigureIds: getSortedFiguresForSection(sectionKey).map(figure => figure.id)
    }));
  }, [getSortedFiguresForSection, setFigureInjectionState]);

  const clearSelectedFiguresForSection = useCallback((sectionKey: string) => {
    setFigureInjectionState(sectionKey, prev => ({
      ...prev,
      selectedFigureIds: []
    }));
  }, [setFigureInjectionState]);

  const buildFigureInjectionPayload = useCallback((sectionKey: string) => {
    if (!supportsPass1FigureInjection(sectionKey)) {
      return {
        useFigures: false,
        selectedFigureIds: []
      };
    }
    const state = getFigureInjectionState(sectionKey);
    const validIds = new Set(selectableFigures.map(figure => figure.id));
    const selectedFigureIds = state.selectedFigureIds.filter(id => validIds.has(id));
    return {
      useFigures: state.enabled && selectedFigureIds.length > 0,
      selectedFigureIds
    };
  }, [getFigureInjectionState, selectableFigures]);

  const isCitationEligibleForSection = useCallback(
    (sectionKey: string) => citationEligibleBySection[normalizeSectionKey(sectionKey)] === true,
    [citationEligibleBySection]
  );

  const isMappedEvidenceEnabled = useCallback(
    (sectionKey: string) => {
      const normalized = normalizeSectionKey(sectionKey);
      if (citationEligibleBySection[normalized] !== true) return false;
      return mappedEvidenceBySection[normalized] !== false;
    },
    [mappedEvidenceBySection, citationEligibleBySection]
  );

  const clearCitationValidationForSection = useCallback((sectionKey: string) => {
    const normalized = normalizeSectionKey(sectionKey);
    setSectionCitationValidation(prev => {
      if (!prev[normalized]) return prev;
      const next = { ...prev };
      delete next[normalized];
      return next;
    });
  }, []);

  const setCitationValidationForSection = useCallback((sectionKey: string, payload: any) => {
    const normalized = normalizeSectionKey(sectionKey);
    const disallowedKeys = Array.isArray(payload?.citationValidation?.disallowedKeys)
      ? payload.citationValidation.disallowedKeys
          .map((key: unknown) => String(key || '').trim())
          .filter(Boolean)
      : [];
    const unknownKeys = Array.isArray(payload?.citationValidation?.unknownKeys)
      ? payload.citationValidation.unknownKeys
          .map((key: unknown) => String(key || '').trim())
          .filter(Boolean)
      : [];

    if (disallowedKeys.length === 0 && unknownKeys.length === 0) {
      clearCitationValidationForSection(sectionKey);
      return { disallowedKeys, unknownKeys };
    }

    setSectionCitationValidation(prev => ({
      ...prev,
      [normalized]: { disallowedKeys, unknownKeys }
    }));
    return { disallowedKeys, unknownKeys };
  }, [clearCitationValidationForSection]);

  // Helper: Extract figure references from content
  const getReferencedFigures = useCallback((sectionContent: string) => {
    if (!sectionContent || figures.length === 0) return [];
    
    // Match patterns like [Figure 1], [Figure 2], etc.
    const figurePattern = /\[Figure\s+(\d+)\]/gi;
    const figureNos = new Set<number>();

    let match: RegExpExecArray | null = null;
    while ((match = figurePattern.exec(sectionContent)) !== null) {
      figureNos.add(parseInt(match[1], 10));
    }
    
    // Return matching figures
    return figures.filter(f => figureNos.has(f.figureNo) && f.status === 'GENERATED');
  }, [figures]);

  // ============================================================================
  // Data Loading
  // ============================================================================

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      setProfileLoading(true);
      const res = await fetch(`/api/papers/${sessionId}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) { setProfileError('Failed to load session'); return; }
      const data = await res.json();
      const sess = data.session;
      setSession(sess);
      const sessionStyleCode = typeof sess?.citationStyle?.code === 'string'
        ? sess.citationStyle.code
        : null;
      if (sessionStyleCode) {
        setBibliographyStyle(sessionStyleCode);
        if (['IEEE', 'VANCOUVER'].includes(sessionStyleCode.toUpperCase())) {
          setBibliographySortOrder('order_of_appearance');
        }
      }
      const code = sess?.paperType?.code || 'JOURNAL_ARTICLE';
      setPaperTypeCode(code);

      // Load draft content
      const drafts = Array.isArray(sess?.annexureDrafts) ? sess.annexureDrafts : [];
      const paperDraft = drafts.filter((d: any) => (d.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((a: any, b: any) => b.version - a.version)[0];
      if (paperDraft) setContent(parseExtraSections(paperDraft.extraSections));

      // Load paper type sections
      const typeRes = await fetch(`/api/paper-types/${code}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (typeRes.ok) {
        const typeData = await typeRes.json();
        const pt = typeData.paperType;
        if (pt) {
          const sectionOrder = Array.isArray(pt.sectionOrder) ? pt.sectionOrder : [];
          const requiredSections = Array.isArray(pt.requiredSections) ? pt.requiredSections : [];
          const wordLimits = pt.defaultWordLimits || {};
          const configs: SectionConfig[] = sectionOrder.map((key: string) => ({
            keys: [key], label: displayName[key] || formatSectionLabel(key),
            required: requiredSections.includes(key), wordLimit: wordLimits[key] || undefined
          }));
          setSectionConfigs(configs.length > 0 ? configs : fallbackSections);

          const policies = pt.sectionContextPolicies && typeof pt.sectionContextPolicies === 'object'
            ? pt.sectionContextPolicies as Record<string, { requiresCitations?: boolean }>
            : {};
          const eligibility: Record<string, boolean> = {};
          for (const key of sectionOrder) {
            const normalized = normalizeSectionKey(key);
            const policy = policies[key] || policies[normalized];
            eligibility[normalized] = typeof policy?.requiresCitations === 'boolean'
              ? policy.requiresCitations
              : DEFAULT_CITATION_ELIGIBLE_SECTIONS.has(normalized);
          }
          setCitationEligibleBySection(eligibility);
        } else {
          setSectionConfigs(fallbackSections);
          setCitationEligibleBySection({});
        }
      } else {
        setSectionConfigs(fallbackSections);
        setCitationEligibleBySection({});
      }

      // Check persona availability
      const personaRes = await fetch('/api/personas', { headers: { Authorization: `Bearer ${authToken}` } });
      if (personaRes.ok) {
        const pd = await personaRes.json();
        setStyleAvailable((pd.myPersonas?.length || 0) + (pd.orgPersonas?.length || 0) > 0);
      }

      // Load user instructions
      const instrRes = await fetch(`/api/papers/${sessionId}/drafting/user-instructions?sessionId=${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (instrRes.ok) {
        const instrData = await instrRes.json();
        setUserInstructions(instrData.grouped || {});
      }

      setProfileError(null);
    } catch (err) {
      console.error('Load session error:', err);
      setProfileError('Failed to load session');
    } finally {
      setProfileLoading(false);
    }
  }, [sessionId, authToken]);

  const loadCitations = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/citations`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        setCitations(data.citations || []);
        setCitationStyleMeta(parseCitationStyleMeta(data.citationStyleMeta));
      }
    } catch (err) {
      console.error('Load citations error:', err);
    }
  }, [sessionId, authToken]);

  const loadFigures = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/figures`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        const figs = (data.figures || []).map((f: any) => ({
          id: f.id,
          figureNo: f.figureNo,
          title: f.title,
          caption: f.caption || f.nodes?.caption || f.description,
          description: f.description,
          generationPrompt: f.generationPrompt || f.nodes?.generationPrompt,
          notes: f.notes || f.nodes?.notes,
          imagePath: f.imagePath || f.nodes?.imagePath,
          status: f.status || f.nodes?.status || (f.imagePath ? 'GENERATED' : 'PLANNED'),
          category: f.category || f.nodes?.category || 'CHART',
          figureType: f.figureType || f.nodes?.figureType || 'auto',
          suggestionMeta: f.suggestionMeta || f.nodes?.suggestionMeta || null,
          inferredImageMeta: f.inferredImageMeta || f.nodes?.inferredImageMeta || null,
          updatedAt: f.updatedAt || null
        }));
        setFigures(figs);
      }
    } catch (err) {
      console.error('Load figures error:', err);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    setDimensionPanelOpen({});
    setDimensionBySection({});
    setBgSectionSelectorOpen(false);
    setBgSelectedSectionKeys([]);
    setFigureInjectionBySection({});
    setFigurePickerOpenBySection({});
    setBgFigurePickerOpenBySection({});
    setShowReferenceDraftModal(false);
    setReferenceDraftLoading(false);
    setReferenceDraftError(null);
    setReferenceDraftSections([]);
    setReferenceDraftSummary(null);
    setReferenceDraftFetchedAt(null);
  }, [sessionId]);

  useEffect(() => { loadSession(); loadCitations(); loadFigures(); }, [loadSession, loadCitations, loadFigures]);

  // Load and poll background generation status (two-pass pipeline)
  const loadBgGenStatus = useCallback(async () => {
    if (!authToken || !sessionId) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/sections/prepare`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok) {
        const normalizedStatus = typeof data.status === 'string' && data.status.trim().length > 0
          ? data.status.trim().toUpperCase()
          : 'IDLE';
        setBgGenStatus(normalizedStatus);
        setBgGenProgress(data.progress || null);
      }
    } catch { /* non-critical */ }
  }, [authToken, sessionId]);

  const handleRetryBgPreparation = useCallback(async (options?: { force?: boolean; retryFailedOnly?: boolean; sectionKeys?: string[] }) => {
    if (!authToken || !sessionId || bgGenRetrying) return;
    const force = options?.force === true;
    const retryFailedOnly = options?.retryFailedOnly === true;
    const sectionKeys = Array.isArray(options?.sectionKeys)
      ? Array.from(new Set(options.sectionKeys.map((key) => normalizeSectionKey(String(key || ''))).filter(Boolean)))
      : [];
    const figureTargetKeys = sectionKeys.length > 0
      ? sectionKeys
      : bgSelectedSectionKeys.length > 0
        ? bgSelectedSectionKeys
        : (sectionConfigs || fallbackSections)
            .flatMap(section => section.keys || [])
            .map(key => normalizeSectionKey(String(key || '')))
            .filter((key, index, list) => key && !isPass1ExcludedSection(key) && list.indexOf(key) === index);
    const figureSelections = figureTargetKeys.reduce<Record<string, { useFigures: boolean; selectedFigureIds: string[] }>>((acc, key) => {
      if (!supportsPass1FigureInjection(key)) return acc;
      acc[normalizeSectionKey(key)] = buildFigureInjectionPayload(key);
      return acc;
    }, {});
    setBgGenRetrying(true);
    try {
      const res = await fetch(`/api/papers/${sessionId}/sections/prepare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          ...(force ? { force: true } : {}),
          ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
          ...(sectionKeys.length > 0 ? { sectionKeys } : {}),
          figureSelections
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to retry section preparation');
      }

      setBgGenStatus(data.status || 'RUNNING');
      if (data.progress) {
        setBgGenProgress(data.progress);
      }
      if (sectionKeys.length > 0) {
        setBgSectionSelectorOpen(false);
      }
      const totalSectionsPlanned = Number(data?.totalSectionsPlanned || 0);
      showMsg(
        sectionKeys.length > 0
          ? `Pass 1 started for ${sectionKeys.length} selected section(s) (0/${sectionKeys.length} generated)`
          : retryFailedOnly
            ? 'Retrying failed sections only'
            : force
              ? totalSectionsPlanned > 0
                ? `Pass 1 rerun started (0/${totalSectionsPlanned} generated)`
                : 'Pass 1 rerun started'
              : totalSectionsPlanned > 0
                ? `Pass 1 started (0/${totalSectionsPlanned} generated)`
                : 'Pass 1 started',
        'success'
      );
      await loadBgGenStatus();
    } catch (err) {
      showMsg(err instanceof Error ? err.message : 'Failed to retry section preparation', 'error');
    } finally {
      setBgGenRetrying(false);
    }
  }, [authToken, bgGenRetrying, bgSelectedSectionKeys, buildFigureInjectionPayload, loadBgGenStatus, sectionConfigs, sessionId, showMsg]);

  const loadReferenceDraftOutput = useCallback(async () => {
    if (!authToken || !sessionId) return;
    setReferenceDraftLoading(true);
    setReferenceDraftError(null);
    try {
      const res = await fetch(`/api/papers/${sessionId}/reference-draft`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch reference draft output');
      }

      const sections = Array.isArray(data?.sections)
        ? data.sections.map((section: any) => ({
            sectionKey: normalizeSectionKey(String(section?.sectionKey || '')),
            displayName: String(section?.displayName || section?.sectionKey || 'Untitled Section'),
            status: String(section?.status || 'NOT_STARTED'),
            hasContent: Boolean(section?.hasContent),
            content: String(section?.content || ''),
            wordCount: Number(section?.wordCount || 0),
            generatedAt: section?.generatedAt ? String(section.generatedAt) : null,
            source: section?.source === 'pass1_artifact' || section?.source === 'base_content_internal'
              ? section.source
              : 'none',
            updatedAt: section?.updatedAt ? String(section.updatedAt) : null,
            figureGrounding: section?.figureGrounding && typeof section.figureGrounding === 'object'
              ? {
                  enabled: section.figureGrounding.enabled === true,
                  selectedFigureIds: Array.isArray(section.figureGrounding.selectedFigureIds)
                    ? section.figureGrounding.selectedFigureIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
                    : [],
                  effectiveFigureIds: Array.isArray(section.figureGrounding.effectiveFigureIds)
                    ? section.figureGrounding.effectiveFigureIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
                    : [],
                  figureRefs: Array.isArray(section.figureGrounding.figureRefs)
                    ? section.figureGrounding.figureRefs.map((ref: unknown) => String(ref || '').trim()).filter(Boolean)
                    : [],
                  figureSignature: String(section.figureGrounding.figureSignature || '').trim(),
                  newestFigureUpdatedAt: section.figureGrounding.newestFigureUpdatedAt
                    ? String(section.figureGrounding.newestFigureUpdatedAt)
                    : null,
                  waitedForMetadata: section.figureGrounding.waitedForMetadata === true
                }
              : null
          } as ReferenceDraftSectionView))
          .filter((section: ReferenceDraftSectionView) => !isPass1ExcludedSection(section.sectionKey))
        : [];

      setReferenceDraftSections(sections);
      setReferenceDraftSummary({
        totalSections: sections.length,
        withPass1Content: sections.filter((section: ReferenceDraftSectionView) => section.hasContent).length,
        withoutPass1Content: sections.filter((section: ReferenceDraftSectionView) => !section.hasContent).length
      });
      setReferenceDraftFetchedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reference draft output';
      setReferenceDraftError(message);
      showMsg(message, 'error');
    } finally {
      setReferenceDraftLoading(false);
    }
  }, [authToken, sessionId, showMsg]);

  const handleOpenReferenceDraftModal = useCallback(async () => {
    setShowReferenceDraftModal(true);
    await loadReferenceDraftOutput();
  }, [loadReferenceDraftOutput]);

  useEffect(() => { loadBgGenStatus(); }, [loadBgGenStatus]);

  useEffect(() => {
    if (bgGenStatus !== 'RUNNING') return;
    const timer = window.setInterval(() => {
      void loadBgGenStatus().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [bgGenStatus, loadBgGenStatus]);

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

  const bgSelectableSections = useMemo(() => {
    const source = sectionConfigs || fallbackSections;
    const seen = new Set<string>();
    const sectionsForSelection: Array<{ key: string; label: string }> = [];
    for (const section of source) {
      for (const rawKey of section.keys || []) {
        const key = normalizeSectionKey(String(rawKey || ''));
        if (!key || seen.has(key) || isPass1ExcludedSection(key)) continue;
        seen.add(key);
        sectionsForSelection.push({
          key,
          label: displayName[key] || formatSectionLabel(key)
        });
      }
    }
    return sectionsForSelection;
  }, [sectionConfigs]);

  useEffect(() => {
    if (bgSelectableSections.length === 0) {
      setBgSelectedSectionKeys([]);
      return;
    }

    const validKeys = new Set(bgSelectableSections.map(section => section.key));
    setBgSelectedSectionKeys(prev => {
      const filtered = prev.filter(key => validKeys.has(key));
      return filtered.length > 0
        ? filtered
        : bgSelectableSections.map(section => section.key);
    });
  }, [bgSelectableSections]);

  const bgSelectedSectionSet = useMemo(() => new Set(bgSelectedSectionKeys), [bgSelectedSectionKeys]);

  const toggleBgSectionSelection = useCallback((sectionKey: string) => {
    setBgSelectedSectionKeys(prev => (
      prev.includes(sectionKey)
        ? prev.filter(key => key !== sectionKey)
        : [...prev, sectionKey]
    ));
  }, []);

  const selectAllBgSections = useCallback(() => {
    setBgSelectedSectionKeys(bgSelectableSections.map(section => section.key));
  }, [bgSelectableSections]);

  const clearBgSectionSelection = useCallback(() => {
    setBgSelectedSectionKeys([]);
  }, []);

  useEffect(() => {
    if (!isNumericOrderBibliography) return;
    if (bibliographySortOrder !== 'order_of_appearance') {
      setBibliographySortOrder('order_of_appearance');
    }
  }, [isNumericOrderBibliography, bibliographySortOrder]);

  useEffect(() => {
    if (!sequenceInfo) return;
    const currentStyle = (bibliographyStyle || '').toUpperCase();
    if ((sequenceInfo.styleCode || '').toUpperCase() !== currentStyle) {
      setSequenceInfo(null);
    }
  }, [bibliographyStyle, sequenceInfo]);

  useEffect(() => {
    if (!mappedEvidenceStorageKey) return;
    try {
      const raw = localStorage.getItem(mappedEvidenceStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const normalized: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'boolean') {
            normalized[normalizeSectionKey(key)] = value;
          }
        }
        setMappedEvidenceBySection(normalized);
      }
    } catch (err) {
      console.warn('[SectionDrafting] Failed to load mapped evidence preferences:', err);
    }
  }, [mappedEvidenceStorageKey]);

  useEffect(() => {
    const allKeys = (sectionConfigs || fallbackSections).flatMap(s => s.keys).filter(Boolean);
    if (allKeys.length === 0) return;
    setMappedEvidenceBySection(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of allKeys) {
        const normalized = normalizeSectionKey(key);
        const eligibleValue = citationEligibleBySection[normalized];
        if (eligibleValue === true) {
          if (typeof next[normalized] !== 'boolean') {
            next[normalized] = true;
            changed = true;
          }
        } else if (eligibleValue === false && next[normalized] !== false) {
          next[normalized] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sectionConfigs, citationEligibleBySection]);

  useEffect(() => {
    if (!mappedEvidenceStorageKey) return;
    try {
      localStorage.setItem(mappedEvidenceStorageKey, JSON.stringify(mappedEvidenceBySection));
    } catch (err) {
      console.warn('[SectionDrafting] Failed to persist mapped evidence preferences:', err);
    }
  }, [mappedEvidenceBySection, mappedEvidenceStorageKey]);

  useEffect(() => {
    if (!figureInjectionStorageKey) return;
    try {
      const raw = localStorage.getItem(figureInjectionStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const normalized: Record<string, FigureInjectionPreference> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        normalized[normalizeSectionKey(key)] = {
          enabled: entry.enabled === true,
          selectedFigureIds: Array.isArray(entry.selectedFigureIds)
            ? entry.selectedFigureIds.map((id) => String(id || '').trim()).filter(Boolean)
            : []
        };
      }
      setFigureInjectionBySection(normalized);
    } catch (err) {
      console.warn('[SectionDrafting] Failed to load figure injection preferences:', err);
    }
  }, [figureInjectionStorageKey]);

  useEffect(() => {
    if (!figureInjectionStorageKey) return;
    try {
      localStorage.setItem(figureInjectionStorageKey, JSON.stringify(figureInjectionBySection));
    } catch (err) {
      console.warn('[SectionDrafting] Failed to persist figure injection preferences:', err);
    }
  }, [figureInjectionBySection, figureInjectionStorageKey]);

  useEffect(() => {
    if (selectableFigures.length === 0) return;
    const validIds = new Set(selectableFigures.map((figure) => figure.id));
    setFigureInjectionBySection(prev => {
      let changed = false;
      const next: Record<string, FigureInjectionPreference> = {};
      for (const [key, value] of Object.entries(prev)) {
        const filteredIds = value.selectedFigureIds.filter((id) => validIds.has(id));
        if (filteredIds.length !== value.selectedFigureIds.length) {
          changed = true;
        }
        next[key] = {
          ...value,
          selectedFigureIds: filteredIds
        };
      }
      return changed ? next : prev;
    });
  }, [selectableFigures]);

  // REMOVED: Auto-switch to preview mode - always stay in edit mode for stability

  const refreshSession = useCallback(async () => {
    if (!onSessionUpdated) return;
    const res = await fetch(`/api/papers/${sessionId}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    onSessionUpdated(data.session);
    setSession(data.session);
  }, [sessionId, authToken, onSessionUpdated]);

  // ============================================================================
  // Auto-Save Handler
  // ============================================================================

  const saveSection = useCallback(async (sectionKey: string, sectionContent: string) => {
    setSaving(prev => ({ ...prev, [sectionKey]: true }));
    try {
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'save_section', sectionKey, content: sectionContent })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        clearCitationValidationForSection(sectionKey);
        setPendingChanges(prev => { const next = new Set(prev); next.delete(sectionKey); return next; });
      } else if (res.status === 422) {
        setCitationValidationForSection(sectionKey, data);
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(prev => ({ ...prev, [sectionKey]: false }));
    }
  }, [sessionId, authToken, clearCitationValidationForSection, setCitationValidationForSection]);

  const handleContentChange = useCallback((sectionKey: string, newContent: string) => {
    setContent(prev => ({ ...prev, [sectionKey]: newContent }));
    setPendingChanges(prev => new Set(prev).add(sectionKey));

    // Clear existing timer
    if (autoSaveTimers.current[sectionKey]) {
      clearTimeout(autoSaveTimers.current[sectionKey]);
    }

    // Set new auto-save timer
    autoSaveTimers.current[sectionKey] = setTimeout(() => {
      saveSection(sectionKey, newContent);
    }, AUTO_SAVE_DELAY);
  }, [saveSection]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(autoSaveTimers.current).forEach(clearTimeout);
    };
  }, []);

  // Save on blur (immediate)
  const handleBlur = useCallback((sectionKey: string) => {
    if (pendingChanges.has(sectionKey)) {
      if (autoSaveTimers.current[sectionKey]) {
        clearTimeout(autoSaveTimers.current[sectionKey]);
      }
      saveSection(sectionKey, content[sectionKey] || '');
    }
  }, [pendingChanges, content, saveSection]);

  // ============================================================================
  // Dimension Flow Drafting
  // ============================================================================

  const requestDraftingAction = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/papers/${sessionId}/drafting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(String(data?.error || 'Request failed'));
      (err as any).status = res.status;
      (err as any).payload = data;
      throw err;
    }
    return data;
  }, [sessionId, authToken]);

  const applyDimensionResponse = useCallback((sectionKey: string, data: any) => {
    const normalized = normalizeDimensionResponse(data);
    const normalizedKey = normalizeSectionKey(sectionKey);

    if (normalized.started && typeof normalized.stitchedContent === 'string') {
      setContent(prev => (
        prev[sectionKey] === normalized.stitchedContent
          ? prev
          : { ...prev, [sectionKey]: normalized.stitchedContent }
      ));
      setPendingChanges(prev => {
        if (!prev.has(sectionKey)) return prev;
        const next = new Set(prev);
        next.delete(sectionKey);
        return next;
      });
    }

    setDimensionBySection(prev => {
      const current = prev[normalizedKey] || createInitialDimensionUIState();
      const incomingProposal = normalized.proposal;
      const proposalChanged = Boolean(
        incomingProposal
        && (
          incomingProposal.dimensionKey !== current.activeDimensionKey
          || incomingProposal.content !== current.proposalText
        )
      );

      const next: DimensionDraftUIState = {
        ...current,
        initialized: true,
        started: normalized.started,
        error: null,
        stitchedContent: normalized.stitchedContent,
        pass1Source: normalized.pass1Source || current.pass1Source,
        plan: normalized.plan,
        progress: normalized.progress,
        completed: normalized.completed,
        nextDimensionKey: normalized.nextDimensionKey,
        nextDimensionLabel: normalized.nextDimensionLabel
      };

      if (incomingProposal) {
        next.activeDimensionKey = incomingProposal.dimensionKey;
        const planLabel = normalized.plan.find(item => item.dimensionKey === incomingProposal.dimensionKey)?.dimensionLabel || null;
        next.activeDimensionLabel = planLabel || incomingProposal.dimensionKey;
        next.proposalText = incomingProposal.content;
        next.proposalValidation = incomingProposal.citationValidation;
        next.proposalReviewTrace = incomingProposal.reviewTrace;
        next.showReject = false;
        next.feedback = '';
        next.editMode = proposalChanged ? false : current.editMode;
        next.streamCursor = proposalChanged ? 0 : Math.min(current.streamCursor, incomingProposal.content.length);
        next.isStreaming = proposalChanged && incomingProposal.content.length > 0;
      } else if (normalized.completed) {
        next.activeDimensionKey = null;
        next.activeDimensionLabel = null;
        next.proposalText = '';
        next.proposalValidation = null;
        next.proposalReviewTrace = null;
        next.feedback = '';
        next.showReject = false;
        next.editMode = false;
        next.streamCursor = 0;
        next.isStreaming = false;
      }

      return {
        ...prev,
        [normalizedKey]: next
      };
    });

    return normalized;
  }, []);

  const generateDimensionDraft = useCallback(async (
    sectionKey: string,
    options?: {
      dimensionKey?: string;
      feedback?: string;
      forceRegenerate?: boolean;
      silent?: boolean;
    }
  ) => {
    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      loading: true,
      error: null,
      rejecting: false,
      showReject: false,
      editMode: false
    }));

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const figureInjection = buildFigureInjectionPayload(sectionKey);
      const payload: Record<string, unknown> = {
        action: 'generate_dimension',
        sectionKey,
        useMappedEvidence,
        ...figureInjection
      };
      if (options?.dimensionKey) payload.dimensionKey = options.dimensionKey;
      if (options?.feedback) payload.feedback = options.feedback;
      if (options?.forceRegenerate) payload.forceRegenerate = true;

      const data = await requestDraftingAction(payload);
      const normalized = applyDimensionResponse(sectionKey, data);
      if (!options?.silent && normalized.proposal) {
        const label = normalized.plan.find(item => item.dimensionKey === normalized.proposal?.dimensionKey)?.dimensionLabel
          || normalized.proposal.dimensionKey
          || 'dimension';
        showMsg(`Drafted ${label}`, 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate dimension';
      const recoveredPayload = (error as any)?.payload;
      if (recoveredPayload?.recovered && recoveredPayload?.flow) {
        applyDimensionResponse(sectionKey, recoveredPayload);
      }
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      if (!options?.silent) showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        loading: false
      }));
    }
  }, [applyDimensionResponse, buildFigureInjectionPayload, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg]);

  const startDimensionFlow = useCallback(async (sectionKey: string) => {
    const instruction = userInstructions[sectionKey];
    const instructions = instruction?.isActive !== false ? instruction?.instruction || '' : '';
    const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
    const figureInjection = buildFigureInjectionPayload(sectionKey);

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      loading: true,
      error: null
    }));
    setDimensionPanelOpen(prev => ({ ...prev, [normalizeSectionKey(sectionKey)]: true }));

    try {
      const data = await requestDraftingAction({
        action: 'start_dimension_flow',
        sectionKey,
        instructions,
        useMappedEvidence,
        ...figureInjection
      });
      applyDimensionResponse(sectionKey, data);
      // Let the dimension-plan UI commit before kicking off the first LLM draft.
      await new Promise(resolve => setTimeout(resolve, 100));
      showMsg('Dimension plan ready. Drafting first dimension...', 'success');
      await generateDimensionDraft(sectionKey, { silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start dimension flow';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        loading: false
      }));
    }
  }, [applyDimensionResponse, buildFigureInjectionPayload, generateDimensionDraft, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg, userInstructions]);

  const acceptDimensionDraft = useCallback(async (
    sectionKey: string,
    continueToNext: boolean,
    options?: { allowCitationBypass?: boolean }
  ) => {
    const state = getDimensionState(sectionKey);
    if (!state.activeDimensionKey || !state.proposalText.trim()) {
      showMsg('Generate dimension content first', 'warning');
      return;
    }

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      accepting: true,
      error: null,
      showReject: false
    }));

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const figureInjection = buildFigureInjectionPayload(sectionKey);
      const data = await requestDraftingAction({
        action: 'accept_dimension',
        sectionKey,
        dimensionKey: state.activeDimensionKey,
        content: state.proposalText,
        prefetchNext: continueToNext,
        useMappedEvidence,
        ...figureInjection,
        allowCitationBypass: options?.allowCitationBypass === true
      });
      const normalized = applyDimensionResponse(sectionKey, data);
      clearCitationValidationForSection(sectionKey);
      await refreshSession();

      if (continueToNext && !normalized.completed) {
        await generateDimensionDraft(sectionKey, {
          dimensionKey: normalized.nextDimensionKey || undefined,
          silent: true
        });
      } else {
        if (options?.allowCitationBypass) {
          showMsg('Dimension accepted with citation warnings', 'warning');
        } else {
          showMsg('Dimension accepted', 'success');
        }
      }
    } catch (error) {
      const payload = (error as any)?.payload;
      const validation = toDimensionValidation(payload?.citationValidation);
      const message = error instanceof Error ? error.message : 'Failed to accept dimension';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message,
        proposalValidation: validation || prev.proposalValidation
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        accepting: false
      }));
    }
  }, [
    applyDimensionResponse,
    buildFigureInjectionPayload,
    clearCitationValidationForSection,
    generateDimensionDraft,
    getDimensionState,
    isMappedEvidenceEnabled,
    refreshSession,
    requestDraftingAction,
    setDimensionState,
    showMsg
  ]);

  const rejectDimensionDraft = useCallback(async (sectionKey: string, feedbackOverride?: string) => {
    const state = getDimensionState(sectionKey);
    if (!state.activeDimensionKey) {
      showMsg('No pending dimension to rewrite', 'warning');
      return;
    }

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      rejecting: true,
      error: null
    }));

    const effectiveFeedback = feedbackOverride ?? state.feedback ?? undefined;

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const figureInjection = buildFigureInjectionPayload(sectionKey);
      const data = await requestDraftingAction({
        action: 'reject_dimension',
        sectionKey,
        dimensionKey: state.activeDimensionKey,
        feedback: effectiveFeedback || undefined,
        useMappedEvidence,
        ...figureInjection
      });
      applyDimensionResponse(sectionKey, data);
      showMsg('Rewrote dimension draft', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rewrite dimension';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        rejecting: false
      }));
    }
  }, [applyDimensionResponse, buildFigureInjectionPayload, getDimensionState, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg]);

  const beginStructuredDraft = useCallback(async (sectionKey: string) => {
    if (!supportsDimensionFlow(sectionKey)) {
      showMsg('Abstract and conclusion are generated as single-pass sections', 'warning');
      return;
    }
    const normalized = normalizeSectionKey(sectionKey);
    setDimensionPanelOpen(prev => ({ ...prev, [normalized]: true }));
    const state = getDimensionState(sectionKey);
    if (state.started) {
      if (state.completed) {
        showMsg('All dimensions are already accepted for this section', 'warning');
        return;
      }
      await generateDimensionDraft(sectionKey, {
        dimensionKey: state.nextDimensionKey || undefined
      });
      return;
    }
    await startDimensionFlow(sectionKey);
  }, [generateDimensionDraft, getDimensionState, showMsg, startDimensionFlow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDimensionBySection(prev => {
        let changed = false;
        const next: Record<string, DimensionDraftUIState> = { ...prev };
        for (const [sectionKey, state] of Object.entries(prev)) {
          if (!state.isStreaming) continue;
          const total = state.proposalText.length;
          if (total === 0) {
            next[sectionKey] = { ...state, isStreaming: false, streamCursor: 0 };
            changed = true;
            continue;
          }
          if (state.streamCursor >= total) {
            next[sectionKey] = { ...state, isStreaming: false, streamCursor: total };
            changed = true;
            continue;
          }
          const step = Math.max(8, Math.ceil(total / 90));
          const streamCursor = Math.min(total, state.streamCursor + step);
          next[sectionKey] = {
            ...state,
            streamCursor,
            isStreaming: streamCursor < total
          };
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 24);

    return () => window.clearInterval(timer);
  }, []);

  // ============================================================================
  // Floating Panel Handlers
  // ============================================================================

  const handleInsertFigure = useCallback((figureId: string) => {
    const figure = figures.find(f => f.id === figureId);
    if (!figure) return;

    const figureRef = `[Figure ${figure.figureNo}]`;

    const targetSection = focusedSection || insertCitationTargetRef.current;
    if (!targetSection) {
      showMsg('Please click in a section first to insert the figure', 'warning');
      return;
    }

    const editor = editorRefs.current[targetSection];
    if (!editor) {
      showMsg('Editor is not ready for this section', 'warning');
      return;
    }

    editor.insertTextAtCursor(figureRef);
    showMsg(`Inserted Figure ${figure.figureNo}`, 'success');
  }, [figures, focusedSection]);

  const handleTextAction = useCallback(async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections',
    text: string,
    customInstructions?: string
  ): Promise<string> => {
    if (!authToken || !text.trim()) {
      throw new Error('Missing required parameters');
    }

    // CRITICAL: Save the editor selection range BEFORE the async API call.
    // By the time the response arrives, the editor may have lost focus/selection.
    const targetSection = focusedSection;
    let savedRange: { from: number; to: number } | null = null;
    if (targetSection) {
      const editor = editorRefs.current[targetSection];
      if (editor) {
        savedRange = editor.saveSelection();
      }
    }

    try {
      const response = await fetch(`/api/papers/${sessionId}/text-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action,
          selectedText: text,
          context: targetSection ? content[targetSection]?.slice(0, 500) : '',
          sectionKey: targetSection,
          customInstructions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Text action failed');
      }

      if (targetSection) {
        const editor = editorRefs.current[targetSection];
        if (editor) {
          if (savedRange && savedRange.from !== savedRange.to) {
            // Use precise range replacement to avoid issues with lost selection
            editor.replaceRange(savedRange.from, savedRange.to, data.transformedText);
          } else {
            // Fallback: try replaceSelection which checks saved selection internally
            editor.replaceSelection(data.transformedText);
          }
        }
        setSelectedText(null);
        const actionLabels: Record<typeof action, string> = {
          rewrite: 'rewritten',
          expand: 'expanded',
          condense: 'condensed',
          formal: 'formalized',
          simple: 'simplified',
          create_sections: 'organized into sections',
        };
        showMsg(`Text ${actionLabels[action]} successfully`, 'success');
      }

      return data.transformedText;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, sessionId, focusedSection, content]);

  const handleGenerateFigure = useCallback(async (description: string, meta?: Record<string, any>) => {
    if (!authToken || !description.trim()) {
      throw new Error('Missing required parameters');
    }

    try {
      // Derive category and type from suggestion meta if available
      const category = meta?.category || 'DIAGRAM';
      const figureType = meta?.suggestedType || 'auto';
      const title = meta?.title || description.slice(0, 100);

      // Build suggestionMeta for the figure plan so the generate route can use it
      const suggestionMeta = extractFigureSuggestionMeta(meta);
      const initialCaption = getPaperFigureCaptionSeed({ suggestionMeta: suggestionMeta || null });

      // First create the figure plan with full suggestion context
      const createRes = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title,
          caption: initialCaption,
          generationPrompt: description,
          category,
          figureType,
          notes: '',
          suggestionMeta
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || 'Failed to create figure');
      }

      // Then generate the figure – pass suggestion meta so the generate route
      // can enrich the LLM prompt and choose the right renderer
      const generateRes = await fetch(
        `/api/papers/${sessionId}/figures/${createData.figure.id}/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            title,
            description,
            category,
            figureType,
            useLLM: true,
            theme: 'academic',
            suggestionMeta
          })
        }
      );

      const generateData = await generateRes.json();
      if (!generateRes.ok) {
        throw new Error(generateData.error || 'Failed to generate figure');
      }

      // Refresh figures list
      await loadFigures();
      showMsg('Figure generated successfully', 'success');

      return generateData;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Figure generation failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, sessionId, loadFigures]);

  const handleGenerateExistingFigure = useCallback(async (figureId: string) => {
    if (!authToken) {
      throw new Error('Missing required parameters');
    }

    const figure = figures.find((entry) => entry.id === figureId);
    if (!figure) {
      throw new Error('Figure not found');
    }

    setFigures((prev) => prev.map((entry) => (
      entry.id === figureId ? { ...entry, status: 'GENERATING' as const } : entry
    )));

    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${figureId}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: figure.title,
          description: figure.generationPrompt || figure.notes || figure.caption || figure.description || figure.title,
          category: figure.category || 'DIAGRAM',
          figureType: figure.figureType || 'auto',
          useLLM: true,
          theme: 'academic',
          suggestionMeta: figure.suggestionMeta || undefined
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate figure');
      }

      await loadFigures();
      showMsg('Figure generated successfully', 'success');
    } catch (err) {
      setFigures((prev) => prev.map((entry) => (
        entry.id === figureId ? { ...entry, status: 'FAILED' as const } : entry
      )));
      const message = err instanceof Error ? err.message : 'Figure generation failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, figures, loadFigures, sessionId]);

  const handleOpenCitationPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  // ============================================================================
  // Generation
  // ============================================================================

  const upsertGenerationStep = useCallback((phase: string, label?: string, state: GenerationDebugStep['status'] = 'running') => {
    setDebugSteps(prev => {
      const next: GenerationDebugStep[] = prev.map(step => (
        step.step === phase
          ? { ...step, status: state, label: label || step.label }
          : (state === 'running' && step.status === 'running' ? { ...step, status: 'ok' as const } : step)
      ));
      const existingIndex = next.findIndex(step => step.step === phase);
      if (existingIndex >= 0) return next;
      return [...next, { step: phase, status: state, label }];
    });
  }, []);

  const completeGenerationSteps = useCallback(() => {
    setDebugSteps(prev => prev.map<GenerationDebugStep>(step => (
      step.status === 'running' ? { ...step, status: 'ok' } : step
    )));
  }, []);

  const failGenerationSteps = useCallback((label: string) => {
    setDebugSteps(prev => {
      const next: GenerationDebugStep[] = prev.map(step => (
        step.status === 'running' ? { ...step, status: 'error' as const } : step
      ));
      return [...next, { step: 'generation_failed', status: 'error', label }];
    });
  }, []);

  const runSectionGeneration = useCallback(async (
    action: 'generate_section' | 'regenerate_section',
    sectionKey: string,
    instructions: string
  ): Promise<{ success: boolean; content?: string; error?: string; data?: any }> => {
    const normalizedKey = normalizeSectionKey(sectionKey);
    const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
    const figureInjection = buildFigureInjectionPayload(sectionKey);
    const generationMode = isPass1ExcludedSection(sectionKey) ? 'topup_final' : 'two_pass';

    setShowActivity(true);
    setDebugSteps([]);
    setSectionStatusMessage(prev => ({ ...prev, [normalizedKey]: 'Starting generation...' }));

    try {
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action,
          sectionKey,
          instructions,
          useMappedEvidence,
          ...figureInjection,
          generationMode,
          autoCitationRepair: false,
          usePersonaStyle,
          personaSelection,
          stream: true
        })
      });

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('text/event-stream')) {
        const streamed = await readSectionGenerationStream(
          res,
          {
            onStatus: (payload) => {
              const phase = String(payload.phase || 'working').trim() || 'working';
              const message = String(payload.message || 'Working...').trim() || 'Working...';
              upsertGenerationStep(phase, message, 'running');
              setSectionStatusMessage(prev => ({ ...prev, [normalizedKey]: message }));
            },
            onError: (payload) => {
              const message = String(payload?.message || 'Generation failed').trim() || 'Generation failed';
              failGenerationSteps(message);
              setSectionStatusMessage(prev => ({ ...prev, [normalizedKey]: message }));
            },
            onResult: () => {
              completeGenerationSteps();
              setSectionStatusMessage(prev => ({ ...prev, [normalizedKey]: 'Finalizing section output...' }));
            }
          }
        );

        if (streamed.ok && streamed.result?.content) {
          clearCitationValidationForSection(sectionKey);
          return { success: true, content: streamed.result.content, data: streamed.result };
        }

        const errorData = streamed.error?.payload || streamed.error || null;
        const { disallowedKeys: disallowed, unknownKeys: unknown } = setCitationValidationForSection(sectionKey, errorData);
        const detailParts: string[] = [];
        if (disallowed.length > 0) {
          detailParts.push(`disallowed: ${disallowed.slice(0, 5).join(', ')}`);
        }
        if (unknown.length > 0) {
          detailParts.push(`unknown: ${unknown.slice(0, 5).join(', ')}`);
        }
        const details = detailParts.length ? ` (${detailParts.join(' | ')})` : '';
        const hint = typeof errorData?.hint === 'string' ? ` ${errorData.hint}` : '';
        const message = `${streamed.error?.message || errorData?.error || 'Generation failed'}${details}${hint}`;
        return { success: false, error: message, data: errorData };
      }

      const data = await res.json();
      if (!res.ok) {
        const { disallowedKeys: disallowed, unknownKeys: unknown } = setCitationValidationForSection(sectionKey, data);
        const detailParts: string[] = [];
        if (disallowed.length > 0) {
          detailParts.push(`disallowed: ${disallowed.slice(0, 5).join(', ')}`);
        }
        if (unknown.length > 0) {
          detailParts.push(`unknown: ${unknown.slice(0, 5).join(', ')}`);
        }
        const details = detailParts.length ? ` (${detailParts.join(' | ')})` : '';
        const hint = typeof data?.hint === 'string' ? ` ${data.hint}` : '';
        return { success: false, error: `${data.error || 'Generation failed'}${details}${hint}`, data };
      }

      if (data.content) {
        clearCitationValidationForSection(sectionKey);
        completeGenerationSteps();
        return { success: true, content: data.content, data };
      }

      return { success: false, error: 'No content returned', data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failGenerationSteps(message);
      return { success: false, error: message };
    } finally {
      setSectionStatusMessage(prev => {
        const next = { ...prev };
        delete next[normalizedKey];
        return next;
      });
    }
  }, [
    authToken,
    buildFigureInjectionPayload,
    clearCitationValidationForSection,
    completeGenerationSteps,
    failGenerationSteps,
    isMappedEvidenceEnabled,
    personaSelection,
    sessionId,
    setCitationValidationForSection,
    upsertGenerationStep,
    usePersonaStyle
  ]);

  const generateSingleSection = useCallback(async (sectionKey: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const instr = userInstructions[sectionKey];
      const instructions = instr?.isActive !== false ? instr?.instruction || '' : '';
      return await runSectionGeneration('generate_section', sectionKey, instructions);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [runSectionGeneration, userInstructions]);

  const handleGenerate = useCallback(async (keys: string[]) => {
    if (loading) return;
    setLoading(true);
    setShowActivity(true);
    setCurrentKeys(keys);
    try {
      const sections = keys.filter(Boolean);
      if (sections.length === 0) throw new Error('No sections to generate');
      const generatedContent: Record<string, string> = {};
      for (const sectionKey of sections) {
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
        const result = await generateSingleSection(sectionKey);
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
        if (result.success && result.content) {
          generatedContent[sectionKey] = result.content;
        } else {
          throw new Error(`Failed: ${result.error}`);
        }
      }
      setContent(prev => ({ ...prev, ...generatedContent }));
      setDimensionPanelOpen(prev => {
        const next = { ...prev };
        for (const sectionKey of sections) {
          delete next[normalizeSectionKey(sectionKey)];
        }
        return next;
      });
      setDimensionBySection(prev => {
        const next = { ...prev };
        for (const sectionKey of sections) {
          delete next[normalizeSectionKey(sectionKey)];
        }
        return next;
      });
      showMsg(`Generated ${sections.length} section(s)`, 'success');
      await refreshSession();
    } catch (error) {
      showMsg(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(false);
      setCurrentKeys(null);
    }
  }, [loading, generateSingleSection, refreshSession]);

  const handleAutoGenerateAll = useCallback(async () => {
    const emptySections = (sectionConfigs || fallbackSections).flatMap(c => c.keys).filter(key => !content[key] || computeWordCount(content[key]) === 0);
    if (emptySections.length === 0) { showMsg('All sections have content!', 'warning'); return; }
    autoModeCancelledRef.current = false;
    setAutoModeRunning(true);
    setShowActivity(true);
    let successCount = 0;
    try {
      for (let i = 0; i < emptySections.length; i++) {
        if (autoModeCancelledRef.current) break;
        const sectionKey = emptySections[i];
        setAutoModeProgress({ current: i + 1, total: emptySections.length, currentSection: displayName[sectionKey] || formatSectionLabel(sectionKey) });
        setCurrentKeys([sectionKey]);
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
        let result = await generateSingleSection(sectionKey);
        if (!result.success && !autoModeCancelledRef.current) {
          setSectionStatusMessage(prev => ({
            ...prev,
            [normalizeSectionKey(sectionKey)]: 'Retrying generation after an unsuccessful attempt...'
          }));
          await new Promise(r => setTimeout(r, 1000));
          result = await generateSingleSection(sectionKey);
        }
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
        if (result.success && result.content) {
          setContent(prev => ({ ...prev, [sectionKey]: result.content! }));
          // REMOVED: Auto-switch to preview - stay in edit mode
          successCount++;
        } else {
          showMsg(`Failed at ${displayName[sectionKey] || sectionKey}`, 'error');
          break;
        }
        if (i < emptySections.length - 1 && !autoModeCancelledRef.current) await new Promise(r => setTimeout(r, 500));
      }
      await refreshSession();
      showMsg(autoModeCancelledRef.current ? `Stopped. ${successCount} section(s) generated.` : `Complete! ${successCount} section(s) generated.`, autoModeCancelledRef.current ? 'warning' : 'success');
    } catch (error) {
      showMsg(`Auto-generation failed`, 'error');
    } finally {
      setAutoModeRunning(false);
      setAutoModeProgress(null);
      setCurrentKeys(null);
      autoModeCancelledRef.current = false;
    }
  }, [sectionConfigs, content, generateSingleSection, refreshSession]);

  const handleRegenerateSection = useCallback(async (sectionKey: string, instructionsOverride?: string) => {
    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setCurrentKeys([sectionKey]);
    setShowActivity(true);
    try {
      const remarks = instructionsOverride ?? regenRemarks[sectionKey] ?? '';
      const result = await runSectionGeneration('regenerate_section', sectionKey, remarks);
      const regeneratedContent = typeof result.content === 'string' ? result.content : '';
      if (result.success && regeneratedContent) {
        clearCitationValidationForSection(sectionKey);
        setContent(prev => ({ ...prev, [sectionKey]: regeneratedContent }));
        setDimensionPanelOpen(prev => {
          const next = { ...prev };
          delete next[normalizeSectionKey(sectionKey)];
          return next;
        });
        setDimensionBySection(prev => {
          const next = { ...prev };
          delete next[normalizeSectionKey(sectionKey)];
          return next;
        });
        // REMOVED: Auto-switch to preview - stay in edit mode
        setRegenOpen(prev => ({ ...prev, [sectionKey]: false }));
        setRegenRemarks(prev => ({ ...(prev || {}), [sectionKey]: '' }));
        showMsg('Section regenerated', 'success');
        await refreshSession();
      } else {
        showMsg(result.error || 'Regeneration failed', 'error');
      }
    } catch {
      showMsg('Regeneration failed', 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setCurrentKeys(null);
    }
  }, [clearCitationValidationForSection, regenRemarks, refreshSession, runSectionGeneration]);

  // ============================================================================
  // Citations & Bibliography
  // ============================================================================

  // Insert a single citation at cursor position (used by sidebar CitationManager)
  const handleInsertSingleCitation = useCallback((citationKey: string) => {
    // Get target section - use focused section or cursor position
    const activeSections = sectionConfigs || fallbackSections;
    const target = focusedSection || (activeSections.length > 0 ? activeSections[0].keys[0] : null);
    if (!target) return;

    const insertText = `[CITE:${citationKey}]`;
    const editor = editorRefs.current[target];
    if (editor) {
      editor.insertTextAtCursor(insertText);
      editor.focus();
    } else {
      const updated = `${content[target] || ''} ${insertText}`.trim();
      setContent(prev => ({ ...prev, [target]: updated }));
      setPendingChanges(prev => new Set(prev).add(target));
      setTimeout(() => saveSection(target, updated), 100);
    }

    showMsg(`Citation [${citationKey}] inserted`, 'success');
  }, [content, saveSection, focusedSection, sectionConfigs]);

  const handleInsertSelectedCitations = useCallback((keys: string[]) => {
    const target = insertCitationTargetRef.current;
    if (!target || keys.length === 0) return;
    
    const insertText = keys.map(k => `[CITE:${k}]`).join(' ');
    const editor = editorRefs.current[target];
    if (editor) {
      editor.insertTextAtCursor(insertText);
      editor.focus();
    } else {
      const updated = `${content[target] || ''} ${insertText}`.trim();
      setContent(prev => ({ ...prev, [target]: updated }));
      setPendingChanges(prev => new Set(prev).add(target));
      setTimeout(() => saveSection(target, updated), 100);
    }

    setPickerOpen(false);
    setInsertCitationTarget(null);
    insertCitationTargetRef.current = null;
    setFocusedSection(target);
    showMsg(`${keys.length} citation(s) inserted`, 'success');
  }, [content, saveSection]);

  // Extract citation keys from content in canonical section order (for IEEE sequence accuracy).
  const extractUsedCitationKeys = useCallback(() => {
    const normalizedContent: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(content)) {
      const sectionKey = normalizeSectionKey(rawKey);
      if (!sectionKey) continue;
      const value = String(rawValue || '');
      if (!value.trim()) continue;
      const existing = normalizedContent[sectionKey];
      normalizedContent[sectionKey] = existing ? `${existing}\n\n${value}` : value;
    }

    const canonicalLookup = new Map<string, string>();
    for (const citation of citations) {
      const key = String(citation?.citationKey || '').trim();
      if (!key) continue;
      canonicalLookup.set(key.toLowerCase(), key);
    }

    const configuredOrder = (sectionConfigs || fallbackSections)
      .flatMap(section => section.keys || [])
      .map(key => normalizeSectionKey(key));
    const orderedSections = Array.from(new Set([
      ...configuredOrder,
      ...Object.keys(normalizedContent)
    ]));

    const usedKeys: string[] = [];
    const seen = new Set<string>();
    const markerRegex = /\[CITE:([^\]]+)\]/gi;

    for (const sectionKey of orderedSections) {
      const sectionContent = normalizeCitationMarkupForExtraction(normalizedContent[sectionKey] || '');
      if (!sectionContent.trim()) continue;

      markerRegex.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = markerRegex.exec(sectionContent)) !== null) {
        const keysInMarker = String(match[1] || '')
          .split(/[;,]/)
          .map(key => key.trim())
          .filter(Boolean);

        for (const rawKey of keysInMarker) {
          const canonical = canonicalLookup.get(rawKey.toLowerCase()) || rawKey;
          const identity = canonical.toLowerCase();
          if (seen.has(identity)) continue;
          seen.add(identity);
          usedKeys.push(canonical);
        }
      }

      // Fallback: recover canonical keys from bare bracket markers like [Lee2025].
      if (canonicalLookup.size > 0) {
        const bareMarkerRegex = /\[([^\[\]]+)\]/g;
        bareMarkerRegex.lastIndex = 0;
        while ((match = bareMarkerRegex.exec(sectionContent)) !== null) {
          const token = String(match[1] || '').trim();
          if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
          const keysInMarker = token
            .split(/[;,]/)
            .map((key) => key.trim())
            .filter(Boolean);
          for (const rawKey of keysInMarker) {
            const canonical = canonicalLookup.get(rawKey.toLowerCase());
            if (!canonical) continue;
            const identity = canonical.toLowerCase();
            if (seen.has(identity)) continue;
            seen.add(identity);
            usedKeys.push(canonical);
          }
        }
      }
    }

    // ── Rendered-label reverse lookup (last-resort recovery) ───────────
    // If explicit markers were lost (e.g. content was saved before the
    // CitationNode fix), try to match rendered in-text citation labels
    // back to their citation keys.  This handles labels such as
    // "(Smith, 2024)", "(Smith & Lee, 2024)", "(1)", "[1]", etc.
    if (usedKeys.length === 0 && citations.length > 0) {
      const allSectionText = orderedSections
        .map(key => normalizedContent[key] || '')
        .join('\n\n');

      if (allSectionText.trim()) {
        for (const citation of citations) {
          const citationKey = String(citation?.citationKey || '').trim();
          if (!citationKey) continue;
          const identity = citationKey.toLowerCase();
          if (seen.has(identity)) continue;

          // Check rendered preview label from server
          const previewInText = typeof citation?.preview?.inText === 'string'
            ? citation.preview.inText.trim()
            : '';

          // Also check raw citation key appearing as plain text
          const searchTerms: string[] = [];
          if (previewInText) searchTerms.push(previewInText);
          // Match bare citation key as word boundary (e.g. "Smith2024")
          searchTerms.push(citationKey);

          const found = searchTerms.some(term => {
            if (!term) return false;
            // Escape regex special chars for literal match
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(escaped, 'i').test(allSectionText);
          });

          if (found) {
            seen.add(identity);
            usedKeys.push(citationKey);
          }
        }
      }
    }

    return usedKeys;
  }, [content, citations, sectionConfigs]);

  const citationDisplayMeta = useMemo<PaperCitationDisplayMeta>(() => {
    const styleCode = String(bibliographyStyle || citationStyleMeta?.styleCode || 'APA7').trim().toUpperCase();
    const isNumericStyle = ['IEEE', 'VANCOUVER'].includes(styleCode);
    const displayByKey: Record<string, string> = {};
    const orderByKey: Record<string, number> = {};

    for (const citation of citations) {
      const citationKey = String(citation?.citationKey || '').trim();
      if (!citationKey) continue;
      const previewInText = typeof citation?.preview?.inText === 'string'
        ? citation.preview.inText.trim()
        : '';
      displayByKey[citationKey] = previewInText || `[${citationKey}]`;
    }

    if (isNumericStyle) {
      const numbering: Record<string, number> = {};
      const serverMetaMatchesStyle = citationStyleMeta?.styleCode?.toUpperCase() === styleCode;
      if (serverMetaMatchesStyle && citationStyleMeta) {
        for (const [citationKey, numberValue] of Object.entries(citationStyleMeta.numberingByKey || {})) {
          const parsed = Number(numberValue);
          if (citationKey && Number.isFinite(parsed) && parsed > 0) {
            numbering[citationKey] = Math.trunc(parsed);
          }
        }
      }

      const orderedUsedKeys = extractUsedCitationKeys();
      for (let index = 0; index < orderedUsedKeys.length; index += 1) {
        const citationKey = orderedUsedKeys[index];
        numbering[citationKey] = index + 1;
      }

      const usedNumbers = Object.values(numbering).filter((value) => Number.isFinite(value) && value > 0);
      let nextNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
      for (const citation of citations) {
        const citationKey = String(citation?.citationKey || '').trim();
        if (!citationKey) continue;
        if (!numbering[citationKey]) {
          numbering[citationKey] = nextNumber;
          nextNumber += 1;
        }
      }

      for (const [citationKey, numberValue] of Object.entries(numbering)) {
        const parsed = Number(numberValue);
        if (!Number.isFinite(parsed) || parsed <= 0) continue;
        const order = Math.trunc(parsed);
        orderByKey[citationKey] = order;
        displayByKey[citationKey] = styleCode === 'VANCOUVER'
          ? `(${order})`
          : `[${order}]`;
      }
    }

    const signatureParts = Object.keys(displayByKey)
      .sort((left, right) => left.localeCompare(right))
      .map((citationKey) => {
        const order = orderByKey[citationKey];
        return `${citationKey}:${displayByKey[citationKey]}:${typeof order === 'number' ? order : ''}`;
      });

    return {
      styleCode,
      displayByKey,
      orderByKey: Object.keys(orderByKey).length > 0 ? orderByKey : undefined,
      signature: `${styleCode}|${signatureParts.join('|')}`
    };
  }, [bibliographyStyle, citationStyleMeta, citations, extractUsedCitationKeys]);

  const figureDisplayMeta = useMemo<PaperFigureDisplayMeta>(() => {
    const byNo: Record<number, { title?: string; imagePath?: string }> = {};

    for (const figure of figures) {
      const rawNo = Number(figure?.figureNo);
      if (!Number.isFinite(rawNo) || rawNo <= 0) continue;
      const figureNo = Math.trunc(rawNo);
      const title = typeof figure?.title === 'string' ? figure.title.trim() : '';
      const imagePath = typeof figure?.imagePath === 'string' ? figure.imagePath.trim() : '';

      byNo[figureNo] = {
        title: title || undefined,
        imagePath: imagePath || undefined,
      };
    }

    const signature = Object.keys(byNo)
      .map((key) => Number(key))
      .sort((left, right) => left - right)
      .map((figureNo) => {
        const meta = byNo[figureNo];
        return `${figureNo}:${meta?.imagePath || ''}:${meta?.title || ''}`;
      })
      .join('|');

    return { byNo, signature };
  }, [figures]);

  const handleOpenFigurePreview = useCallback((figureNo: number) => {
    const figure = figures.find((entry) => entry.figureNo === figureNo);
    if (!figure) return;

    setPreviewFigure({
      id: figure.id,
      figureNo: figure.figureNo,
      title: figure.title,
      imagePath: figure.imagePath,
      description: figure.description,
    });
  }, [figures]);

  const formatFigureLabelById = useCallback((figureId: string) => {
    const figure = figures.find((entry) => entry.id === figureId);
    if (!figure) return 'Selected figure';
    return `Figure ${figure.figureNo}`;
  }, [figures]);

  const getReferenceDraftFigureWarning = useCallback((section: ReferenceDraftSectionView) => {
    const grounding = section.figureGrounding;
    if (!grounding?.enabled) {
      return { stale: false, reasons: [] as string[] };
    }

    const storedFigureIds = grounding.effectiveFigureIds.length > 0
      ? grounding.effectiveFigureIds
      : grounding.selectedFigureIds;
    const currentPayload = supportsPass1FigureInjection(section.sectionKey)
      ? buildFigureInjectionPayload(section.sectionKey)
      : { useFigures: false, selectedFigureIds: [] as string[] };
    const currentFigureIds = currentPayload.useFigures
      ? currentPayload.selectedFigureIds
      : storedFigureIds;
    const storedSet = new Set(storedFigureIds);
    const currentSet = new Set(currentFigureIds);
    const reasons: string[] = [];

    if (currentPayload.useFigures) {
      const addedFigureLabels = currentFigureIds
        .filter((figureId) => !storedSet.has(figureId))
        .map(formatFigureLabelById);
      const removedFigureLabels = storedFigureIds
        .filter((figureId) => !currentSet.has(figureId))
        .map(formatFigureLabelById);

      if (addedFigureLabels.length > 0 || removedFigureLabels.length > 0) {
        const changes = [
          addedFigureLabels.length > 0 ? `added: ${addedFigureLabels.join(', ')}` : '',
          removedFigureLabels.length > 0 ? `removed: ${removedFigureLabels.join(', ')}` : '',
        ].filter(Boolean).join(' | ');
        reasons.push(`Figure selection changed since Pass 1 ran${changes ? ` (${changes})` : ''}.`);
      }
    }

    const generatedAtMs = Date.parse(String(section.generatedAt || ''));
    if (Number.isFinite(generatedAtMs) && generatedAtMs > 0) {
      const updatedFigureLabels = currentFigureIds
        .filter((figureId) => {
          const figure = figures.find((entry) => entry.id === figureId);
          const updatedAtMs = Date.parse(String(figure?.updatedAt || ''));
          return Number.isFinite(updatedAtMs) && updatedAtMs > generatedAtMs;
        })
        .map(formatFigureLabelById);

      if (updatedFigureLabels.length > 0) {
        reasons.push(`Grounded figure metadata changed after Pass 1 ran: ${updatedFigureLabels.join(', ')}.`);
      }
    }

    const missingFigureLabels = storedFigureIds
      .filter((figureId) => !figures.some((entry) => entry.id === figureId))
      .map(formatFigureLabelById);
    if (missingFigureLabels.length > 0) {
      reasons.push(`Grounded figures are no longer available: ${missingFigureLabels.join(', ')}.`);
    }

    return {
      stale: reasons.length > 0,
      reasons
    };
  }, [buildFigureInjectionPayload, figures, formatFigureLabelById]);

  const renderPass1FigureConfigurator = (sectionKey: string) => {
    if (!supportsPass1FigureInjection(sectionKey)) return null;

    const normalizedKey = normalizeSectionKey(sectionKey);
    const figureInjectionState = getFigureInjectionState(sectionKey);
    const sortedFigures = getSortedFiguresForSection(sectionKey);
    const selectedFigureSet = new Set(figureInjectionState.selectedFigureIds);
    const selectedFigures = sortedFigures.filter((figure) => selectedFigureSet.has(figure.id));
    const hasFigureOptions = sortedFigures.length > 0;
    const recommendedFigureIds = getRecommendedFigureIds(sectionKey);
    const recommendedFigureCount = recommendedFigureIds.length;
    const pickerOpen = bgFigurePickerOpenBySection[normalizedKey] === true;

    return (
      <div key={`pass1-figure-config-${normalizedKey}`} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {displayName[sectionKey] || formatSectionLabel(sectionKey)}
          </span>
          <label className={`inline-flex items-center gap-2 text-xs font-medium ${hasFigureOptions ? 'text-slate-700' : 'text-slate-400'}`}>
            <input
              type="checkbox"
              checked={figureInjectionState.enabled}
              onChange={() => toggleFigureInjection(sectionKey)}
              disabled={!hasFigureOptions || bgGenRetrying}
              className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-not-allowed"
            />
            <span>Inject figures into Pass 1</span>
          </label>

          {hasFigureOptions ? (
            <>
              <button
                type="button"
                onClick={() => setBgFigurePickerOpenBySection(prev => ({
                  ...prev,
                  [normalizedKey]: !prev[normalizedKey]
                }))}
                disabled={!figureInjectionState.enabled || bgGenRetrying}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedFigures.length > 0 ? `${selectedFigures.length} selected` : 'Choose'}
              </button>
              {recommendedFigureCount > 0 && (
                <button
                  type="button"
                  onClick={() => applyRecommendedFigureSelection(sectionKey)}
                  disabled={!figureInjectionState.enabled || bgGenRetrying}
                  className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Recommended
                </button>
              )}
              {selectedFigures.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearSelectedFiguresForSection(sectionKey)}
                  disabled={!figureInjectionState.enabled || bgGenRetrying}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              {pickerOpen && (
                <button
                  type="button"
                  onClick={() => setBgFigurePickerOpenBySection(prev => ({
                    ...prev,
                    [normalizedKey]: false
                  }))}
                  disabled={!figureInjectionState.enabled || bgGenRetrying}
                  className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Hide
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-slate-400">No generated figures available yet</span>
          )}
        </div>

        <p className="mt-1 text-[11px] text-slate-500">
          Pass 1 will receive only the selected figure metadata and must reference them inline as [Figure N].
        </p>

        {figureInjectionState.enabled && selectedFigures.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedFigures.map((figure) => (
              <span
                key={figure.id}
                className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700"
              >
                <span className="font-medium">Fig. {figure.figureNo}</span>
                <span className="max-w-[180px] truncate">{figure.title}</span>
              </span>
            ))}
          </div>
        )}

        {figureInjectionState.enabled && pickerOpen && hasFigureOptions && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>Select only the figures this Pass 1 draft should use.</span>
              <button
                type="button"
                onClick={() => selectAllFiguresForSection(sectionKey)}
                className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800"
              >
                All
              </button>
            </div>
            <div className="space-y-2">
              {sortedFigures.map((figure) => {
                const isSelected = selectedFigureSet.has(figure.id);
                const isRecommended = isFigureRecommendedForSection(figure, sectionKey);
                const relevantSectionLabel = typeof figure.suggestionMeta?.relevantSection === 'string'
                  ? figure.suggestionMeta.relevantSection.trim()
                  : '';
                const inferredSummary = typeof figure.inferredImageMeta?.summary === 'string'
                  ? figure.inferredImageMeta.summary.trim()
                  : '';
                const helperText = inferredSummary || figure.caption || figure.description || figure.notes || '';

                return (
                  <label
                    key={figure.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-2 transition-colors ${
                      isSelected
                        ? 'border-violet-300 bg-violet-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleFigureSelection(sectionKey, figure.id)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-700">Figure {figure.figureNo}</span>
                        <span className="text-xs text-slate-600">{figure.title}</span>
                        {isRecommended && (
                          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                            Recommended
                          </span>
                        )}
                        {relevantSectionLabel && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {relevantSectionLabel}
                          </span>
                        )}
                      </div>
                      {helperText && (
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          {helperText}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBgSectionSelector = (headingClassName: string, dividerClassName: string) => {
    const selectedFigureSections = bgSelectedSectionKeys.filter((sectionKey) => supportsPass1FigureInjection(sectionKey));

    return (
      <div className={`mt-3 ${dividerClassName} pt-3`}>
        <p className={`text-xs font-medium ${headingClassName}`}>Run Pass 1 only for selected non-reference sections</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {bgSelectableSections.map(section => (
            <label
              key={section.key}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
            >
              <input
                type="checkbox"
                checked={bgSelectedSectionSet.has(section.key)}
                onChange={() => toggleBgSectionSelection(section.key)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>{section.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAllBgSections}
            className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={clearBgSectionSelection}
            className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleRetryBgPreparation({ force: true, sectionKeys: bgSelectedSectionKeys })}
            disabled={bgGenRetrying || bgSelectedSectionKeys.length === 0}
            className="px-3 py-1 text-xs rounded-md border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bgGenRetrying ? 'Preparing...' : 'Run Pass 1 for Selected'}
          </button>
        </div>

        {selectedFigureSections.length > 0 && (
          <div className="mt-4 space-y-3">
            <div>
              <p className={`text-xs font-medium ${headingClassName}`}>Optional figure grounding for Pass 1</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Choose which selected sections should receive generated figure metadata during reference draft creation. Abstract and references are excluded.
              </p>
            </div>
            {selectedFigureSections.map((sectionKey) => renderPass1FigureConfigurator(sectionKey))}
          </div>
        )}
      </div>
    );
  };

  const generateBibliography = useCallback(async () => {
    // ── 1. Primary: extract [CITE:key] markers from in-memory content ──
    const extractedCitationKeys = extractUsedCitationKeys();

    // ── 2. Fallback: citations with tracked server-side usage ──────────
    const usageFallbackKeys = citations
      .filter((citation) => {
        const usageCount = Number(citation?.usageCount || 0);
        const hasUsages = Array.isArray(citation?.usages) && citation.usages.length > 0;
        return usageCount > 0 || hasUsages;
      })
      .map((citation) => String(citation?.citationKey || '').trim())
      .filter(Boolean);

    let usedCitationKeys = extractedCitationKeys.length > 0
      ? extractedCitationKeys
      : Array.from(new Set(usageFallbackKeys));

    // ── 3. Last-resort: let the server extract from DB draft ───────────
    // If both client-side paths returned nothing, send an empty array so
    // the server will read the authoritative draft from the database and
    // extract citation keys itself (it already has this logic).
    const clientExtractionFailed = usedCitationKeys.length === 0;
    if (clientExtractionFailed) {
      // Don't block here — let the server decide.  We still show a soft
      // warning but proceed with the request.
      console.warn('[Bibliography] Client-side citation extraction found 0 keys; delegating to server.');
    }
    
    setGeneratingBibliography(true);
    try {
      const pendingKeys = Array.from(pendingChanges);
      if (pendingKeys.length > 0) {
        await Promise.all(
          pendingKeys.map(key => saveSection(key, content[key] || ''))
        );
      }

      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ 
          action: 'generate_bibliography',
          // When client extraction failed, send empty so the server falls
          // through to its own draft-based extraction.
          citationKeys: clientExtractionFailed ? [] : usedCitationKeys,
          sortOrder: bibliographySortOrder,
          styleCode: bibliographyStyle
        })
      });
      const data = await res.json();
      if (res.ok && data.bibliography) {
        setBibliographyContent(data.bibliography);
        // Also update references section if it exists
        if (sectionConfigs?.some(s => s.keys.includes('references'))) {
          setContent(prev => ({ ...prev, references: data.bibliography }));
          await saveSection('references', data.bibliography);
        }
        const usedCount = typeof data.usedCount === 'number' ? data.usedCount : usedCitationKeys.length;
        const added = Array.isArray(data?.sequence?.changes?.added) ? data.sequence.changes.added.length : 0;
        const removed = Array.isArray(data?.sequence?.changes?.removed) ? data.sequence.changes.removed.length : 0;
        const renumbered = Array.isArray(data?.sequence?.changes?.renumbered) ? data.sequence.changes.renumbered.length : 0;
        const version = typeof data?.sequence?.version === 'number' ? data.sequence.version : null;
        const historyCount = typeof data?.sequence?.historyCount === 'number' ? data.sequence.historyCount : 0;
        const changed = Boolean(data?.sequence?.changed);

        setSequenceInfo({
          styleCode: String(data?.styleCode || bibliographyStyle),
          version,
          changed,
          added,
          removed,
          renumbered,
          historyCount
        });

        const sequenceLabel = version ? `, seq v${version}` : '';
        const deltaLabel = changed
          ? `, Δ +${added}/-${removed}, renumbered ${renumbered}`
          : '';
        const recoveryLabel = clientExtractionFailed
          ? ', recovered from server draft'
          : extractedCitationKeys.length === 0 && usageFallbackKeys.length > 0
            ? ', recovered from usage metadata'
            : '';
        showMsg(
          `Bibliography generated (${bibliographyStyle}, ${usedCount} citations${sequenceLabel}${deltaLabel}${recoveryLabel})`,
          'success'
        );
        await loadCitations();
      } else {
        const serverMsg = typeof data?.error === 'string' ? data.error : '';
        showMsg(serverMsg || 'Failed to generate bibliography', 'error');
      }
    } catch {
      showMsg('Bibliography generation failed', 'error');
    } finally {
      setGeneratingBibliography(false);
    }
  }, [
    sessionId,
    authToken,
    sectionConfigs,
    saveSection,
    bibliographyStyle,
    bibliographySortOrder,
    extractUsedCitationKeys,
    citations,
    pendingChanges,
    content,
    loadCitations
  ]);

  // ============================================================================
  // Instructions Handler
  // ============================================================================

  const handleSaveInstruction = useCallback((instr: UserInstruction) => {
    const key = instructionPopoverKey;
    if (!key) return;
    setUserInstructions(prev => ({
      ...prev,
      [key]: instr.instruction ? instr : undefined
    } as any));
  }, [instructionPopoverKey]);

  // Total word count
  const totalWordCount = useMemo(() => Object.values(content).reduce((acc, c) => acc + computeWordCount(c), 0), [content]);
  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-slate-600">Loading paper configuration...</span>
      </div>
    );
  }

  if (profileError || !paperTypeCode) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{profileError || 'Select a paper type to start drafting.'}</p>
        </div>
      </div>
    );
  }

  const sections = sectionConfigs || fallbackSections;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Toast Messages */}
      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${messageType === 'success' ? 'bg-emerald-500 text-white' : messageType === 'error' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Panel */}
      {showHelpPanel && (
        <div className="fixed top-20 right-4 z-40 w-80 bg-white rounded-xl shadow-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">📚 Drafting Guide</h3>
            <button onClick={() => setShowHelpPanel(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><h4 className="font-semibold text-gray-900 mb-1">✍️ Always-Edit Mode</h4><p className="text-gray-600 text-xs">Content is always editable. Changes auto-save after 2 seconds of inactivity or when you click away.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">💬 Instructions</h4><p className="text-gray-600 text-xs">Add custom instructions per section. Toggle ON/OFF to control when they're used. Use "Save for all papers" to reuse across drafts.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">📚 Citations</h4><p className="text-gray-600 text-xs">Click the citation button in section toolbar to insert. Generate bibliography uses your selected citation style.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">Review And Improve</h4><p className="text-gray-600 text-xs">After drafting, use the Review stage for the manuscript audit and the Improve stage to preview and apply revision diffs.</p></div>
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="max-w-[850px] mx-auto mb-6 px-8 pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Paper Draft</h2>
            <p className="text-sm text-gray-500">
              {totalWordCount} words
              {pendingChanges.size > 0 && <span className="ml-2 text-amber-500">• Saving...</span>}
            </p>
              </div>
          <Tooltip content="Help guide" position="left">
            <button onClick={() => setShowHelpPanel(!showHelpPanel)}
              className={`p-2.5 rounded-full transition-all ${showHelpPanel ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' : 'bg-white border text-gray-500 hover:bg-gray-50 shadow-sm'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </Tooltip>
            </div>

        {/* Controls */}
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Writing Style */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Enable AI to use your writing style" position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${usePersonaStyle ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <button onClick={() => setUsePersonaStyle(!usePersonaStyle)}
                    className={`relative w-9 h-5 rounded-full ${usePersonaStyle ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${usePersonaStyle ? 'left-4' : 'left-0.5'}`} />
              </button>
                  <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-gray-500'}`}>Style</span>
                </div>
              </Tooltip>
              <Tooltip content="Choose persona" position="bottom">
                <button onClick={() => setShowPersonaManager(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border ${personaSelection?.primaryPersonaName ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  👤 {personaSelection?.primaryPersonaName || 'Persona'}
              </button>
              </Tooltip>
              <Tooltip content="Writing samples" position="bottom">
                <button onClick={() => setShowWritingSamplesModal(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                  ✍️ Samples
              </button>
              </Tooltip>
            </div>

            {/* Auto Mode */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Auto-generate all sections" position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${autoModeRunning ? 'bg-amber-50' : autoMode ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <button onClick={() => setAutoMode(!autoMode)} disabled={autoModeRunning}
                    className={`relative w-9 h-5 rounded-full ${autoMode ? 'bg-emerald-500' : 'bg-gray-300'} ${autoModeRunning ? 'opacity-50' : ''}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoMode ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className={`text-xs font-medium ${autoMode ? 'text-emerald-700' : 'text-gray-500'}`}>{autoModeRunning ? '⏳ Running...' : 'Auto'}</span>
          </div>
              </Tooltip>
              {autoMode && !autoModeRunning && (
                <button onClick={handleAutoGenerateAll} disabled={loading} className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium disabled:opacity-50">Generate All</button>
              )}
              {autoModeRunning && (
                <>
                  {autoModeProgress && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-50 border border-blue-100">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-xs font-medium text-blue-700">{autoModeProgress.current}/{autoModeProgress.total}</span>
                      <span className="text-xs text-blue-600 max-w-[100px] truncate">{autoModeProgress.currentSection}</span>
        </div>
                  )}
                  <button onClick={() => { autoModeCancelledRef.current = true; }} className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium">Stop</button>
                </>
              )}
            </div>

            {/* Tools */}
              <div className="flex items-center gap-2">
              <Tooltip content="Section instructions" position="bottom">
                <button onClick={() => setShowAllInstructionsModal(true)}
                  className={`p-2 rounded-lg border relative ${Object.keys(userInstructions).length > 0 ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  <Settings2 className="w-4 h-4" />
                  {Object.values(userInstructions).filter(i => i?.isActive !== false).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-500 rounded-full text-[9px] text-white flex items-center justify-center font-medium">
                      {Object.values(userInstructions).filter(i => i?.isActive !== false).length}
                    </span>
                  )}
                </button>
              </Tooltip>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">{paperTypeCode}</span>
            </div>
              </div>
            </div>
          </div>

        {session?.archetypeEvidenceStale && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Evidence packs may be outdated after archetype changes. Refresh literature analysis and blueprint mapping before final drafting.
          </div>
        )}

        {/* Background section preparation status (two-pass pipeline) */}
        {(bgGenStatus === 'IDLE' || bgGenStatus === null) && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full shrink-0 bg-slate-400" />
              <div className="flex-1">
                <p className="text-sm text-slate-800">
                  Pass 1 reference draft is not prepared yet. Generate it for non-reference sections from base prompts to speed up section drafting.
                </p>
              </div>
              <button
                onClick={() => handleRetryBgPreparation()}
                disabled={bgGenRetrying}
                className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bgGenRetrying ? 'Preparing...' : 'Generate Reference Draft (Pass 1)'}
              </button>
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              renderBgSectionSelector('text-slate-700', 'border-t border-slate-200')
            )}
          </div>
        )}
        {bgGenStatus === 'RUNNING' && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-indigo-800">
                Generating Pass 1 reference drafts...
              </p>
              {bgGenProgress && bgGenProgress.total > 0 && bgGenLiveCounts && (
                <p className="text-xs text-indigo-600 mt-0.5">
                  {bgGenLiveCounts.done}/{bgGenProgress.total} generated • {bgGenLiveCounts.waiting} waiting • {bgGenLiveCounts.running} in progress
                  {bgGenLiveCounts.failed > 0 && ` • ${bgGenLiveCounts.failed} failed`}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                void handleOpenReferenceDraftModal();
              }}
              disabled={referenceDraftLoading}
              className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
            </button>
          </div>
        )}
        {(bgGenStatus === 'COMPLETED' || bgGenStatus === 'PARTIAL') && bgGenProgress && (
          <div className={`mt-4 max-w-[850px] mx-auto rounded-lg border px-4 py-3 ${
            bgGenStatus === 'PARTIAL'
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`inline-flex h-3 w-3 rounded-full shrink-0 ${
                bgGenStatus === 'PARTIAL' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} />
              <div className="flex-1">
                <p className={`text-sm ${bgGenStatus === 'PARTIAL' ? 'text-amber-800' : 'text-emerald-800'}`}>
                {bgGenStatus === 'PARTIAL'
                  ? `Paper structure partially ready — ${bgGenProgress.completed} of ${bgGenProgress.total} sections prepared (${bgGenProgress.failed} failed).`
                  : 'Paper structure ready — sections will generate faster with pre-built evidence drafts.'
                }
                </p>
              </div>
              {(bgGenStatus === 'PARTIAL' || bgGenStatus === 'COMPLETED') && (
                <button
                  onClick={() => handleRetryBgPreparation({ force: bgGenStatus === 'COMPLETED' })}
                  disabled={bgGenRetrying}
                  className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${
                    bgGenStatus === 'COMPLETED'
                      ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                      : 'border-amber-300 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  {bgGenRetrying
                    ? 'Preparing...'
                    : bgGenStatus === 'COMPLETED'
                      ? 'Rerun Section Prep'
                      : 'Retry Section Prep'}
                </button>
              )}
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${
                  bgGenStatus === 'PARTIAL'
                    ? 'border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              {bgGenStatus === 'PARTIAL' && (bgGenLiveCounts?.failed || 0) > 0 && (
                <button
                  onClick={() => handleRetryBgPreparation({ retryFailedOnly: true })}
                  disabled={bgGenRetrying}
                  className="px-3 py-1.5 text-xs rounded-lg border border-amber-400 text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bgGenRetrying ? 'Retrying...' : 'Retry Failed Only'}
                </button>
              )}
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className={`px-3 py-1.5 text-xs rounded-lg border ${
                  bgGenStatus === 'PARTIAL'
                    ? 'border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              renderBgSectionSelector(
                bgGenStatus === 'PARTIAL' ? 'text-amber-800' : 'text-emerald-800',
                'border-t border-white/60'
              )
            )}
          </div>
        )}
        {bgGenStatus === 'FAILED' && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full shrink-0 bg-red-500" />
              <div className="flex-1">
                <p className="text-sm text-red-800">
                  Paper structure preparation failed. Retry generation to pre-build section drafts.
                </p>
              </div>
              {(bgGenLiveCounts?.failed || 0) > 0 && (
                <button
                  onClick={() => handleRetryBgPreparation({ retryFailedOnly: true })}
                  disabled={bgGenRetrying}
                  className="px-3 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bgGenRetrying ? 'Retrying...' : 'Retry Failed Only'}
                </button>
              )}
              <button
                onClick={() => handleRetryBgPreparation()}
                disabled={bgGenRetrying}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bgGenRetrying ? 'Retrying...' : 'Retry Section Prep'}
              </button>
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100"
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              renderBgSectionSelector('text-red-800', 'border-t border-red-200')
            )}
          </div>
        )}
      {/* Paper Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_1px_12px_rgba(0,0,0,0.08)] min-h-[1100px] px-[72px] py-[72px] relative border border-gray-100/60 rounded-sm">
        {showActivity && (currentKeys || autoModeRunning) && (
          <div className="absolute top-4 right-4 z-10">
            <BackendActivityPanel isVisible={true} onClose={() => setShowActivity(false)}
              steps={(debugSteps || []).map((s) => ({ id: String(s.step || ''), state: s.status, label: s.label }))} />
        </div>
        )}

        <div>
          {sections.map((section, idx) => {
            const isGenerating = loading && currentKeys?.some(k => section.keys.includes(k));
            const isRegenerating = section.keys.some(k => sectionLoading[k]);
            const isWorking = isGenerating || isRegenerating;
            const isSavingSection = section.keys.some(k => saving[k]);
            const hasPending = section.keys.some(k => pendingChanges.has(k));
            const activeStatusKey = section.keys.find((key) => (
              sectionLoading[key] || Boolean(currentKeys?.includes(key))
            ));
            const activeStatusMessage = activeStatusKey
              ? sectionStatusMessage[normalizeSectionKey(activeStatusKey)] || ''
              : '';
            const primarySectionKey = section.keys[0] || '';
            const primaryDimensionState = primarySectionKey ? getDimensionState(primarySectionKey) : createInitialDimensionUIState();
            const primarySupportsDimensionFlow = primarySectionKey ? supportsDimensionFlow(primarySectionKey) : false;
            const sectionWordCount = section.keys.reduce((acc, key) => acc + computeWordCount(content[key] || ''), 0);

            const sectionCitationIssue = (() => {
              const disallowedSet = new Set<string>();
              const unknownSet = new Set<string>();
              for (const key of section.keys) {
                const issue = sectionCitationValidation[normalizeSectionKey(key)];
                if (!issue) continue;
                for (const disallowed of issue.disallowedKeys || []) disallowedSet.add(disallowed);
                for (const unknown of issue.unknownKeys || []) unknownSet.add(unknown);
              }
              const disallowedKeys = Array.from(disallowedSet);
              const unknownKeys = Array.from(unknownSet);
              if (disallowedKeys.length === 0 && unknownKeys.length === 0) return null;
              return { disallowedKeys, unknownKeys };
            })();

            return (
              <div key={section.keys.join('|') || idx} className="group/section-parent relative" style={{ marginTop: idx === 0 ? 0 : '1.5em' }}>
                <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3
                      className="text-slate-900"
                      style={{
                        fontFamily: '"Times New Roman", "Noto Serif", Georgia, serif',
                        fontSize: '15px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        lineHeight: '1.4'
                      }}
                    >
                      {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                    </h3>

                    {primarySupportsDimensionFlow && primaryDimensionState.started && primaryDimensionState.plan.length > 0 && (
                      <DimensionPlanPills
                        plan={primaryDimensionState.plan}
                        activeDimensionKey={primaryDimensionState.activeDimensionKey || primaryDimensionState.nextDimensionKey}
                        acceptedCount={primaryDimensionState.progress.accepted}
                        totalCount={primaryDimensionState.progress.total}
                        disabled={isWorking || autoModeRunning}
                        onSelect={(dimensionKey) => {
                          setDimensionPanelOpen(prev => ({ ...prev, [normalizeSectionKey(primarySectionKey)]: true }));
                          void generateDimensionDraft(primarySectionKey, { dimensionKey });
                        }}
                      />
                    )}

                    {isWorking && activeStatusMessage && (
                      <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] text-indigo-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{activeStatusMessage}</span>
                      </div>
                    )}

                    {sectionCitationIssue && (() => {
                      const allBadKeys = [
                        ...sectionCitationIssue.disallowedKeys,
                        ...sectionCitationIssue.unknownKeys
                      ];
                      const targetKey = section.keys[0] || '';
                      const isFixing = sectionLoading[targetKey];
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-[11px] text-rose-500">
                            Citation issue: {allBadKeys.slice(0, 4).join(', ')}{allBadKeys.length > 4 ? ` +${allBadKeys.length - 4} more` : ''}
                          </p>
                          <button
                            type="button"
                            disabled={isFixing || isWorking || autoModeRunning}
                            onClick={() => {
                              const fixInstruction = `Citation deviation detected. The following citation keys are invalid or not in the allowed evidence set: ${allBadKeys.join(', ')}. Remove these invalid keys. Where the removed citation supported a claim, replace it with a relevant allowed citation key only if one naturally fits the context — do not force citations. Do not invent new citation keys.`;
                              void handleRegenerateSection(targetKey, fixInstruction);
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-medium text-rose-600 transition-colors hover:bg-rose-100 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isFixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Fix citation deviation
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-300 opacity-0 transition-opacity duration-200 group-hover/section-parent:opacity-100">
                    {isSavingSection && <span className="animate-pulse text-amber-400">Saving</span>}
                    {hasPending && !isSavingSection && <span className="text-slate-400">Unsaved</span>}
                    {section.wordLimit && (
                      <span>{sectionWordCount} / {section.wordLimit}</span>
                    )}
                  </div>
                </div>

                <div className="text-gray-800" style={{ textAlign: 'justify', lineHeight: '1.8' }}>
                  {section.keys.map(keyName => {
                    const normalizedKey = normalizeSectionKey(keyName);
                    const sectionSupportsDimensionFlow = supportsDimensionFlow(keyName);
                    const dimensionState = getDimensionState(keyName);
                    const dimensionBusy = dimensionState.loading || dimensionState.accepting || dimensionState.rejecting;
                    const showInlineDimension = sectionSupportsDimensionFlow && Boolean(
                      dimensionPanelOpen[normalizedKey]
                      || dimensionState.started
                      || dimensionState.activeDimensionKey
                      || (dimensionState.loading && dimensionState.proposalText)
                    );
                    const hasDraftContent = Boolean(String(content[keyName] || '').trim());
                    const autoCitationAvailable = isCitationEligibleForSection(keyName);
                    const autoCitationEnabled = autoCitationAvailable ? isMappedEvidenceEnabled(keyName) : false;
                    const instruction = userInstructions[keyName];
                    const instructionActive = Boolean(instruction?.instruction) && instruction?.isActive !== false;
                    const sectionSupportsFigureGrounding = supportsPass1FigureInjection(keyName);
                    const figureInjectionState = getFigureInjectionState(keyName);
                    const sortedFigures = getSortedFiguresForSection(keyName);
                    const selectedFigureSet = new Set(figureInjectionState.selectedFigureIds);
                    const selectedFigures = sortedFigures.filter((figure) => selectedFigureSet.has(figure.id));
                    const hasFigureOptions = sortedFigures.length > 0;
                    const recommendedFigureIds = getRecommendedFigureIds(keyName);
                    const recommendedFigureCount = recommendedFigureIds.length;

                    return (
                      <div
                        key={keyName}
                        data-section-anchor={normalizedKey}
                        className="section-wrapper group/section relative"
                      >
                        {section.keys.length > 1 && (
                          <h4
                            className="text-slate-700"
                            style={{
                              fontFamily: '"Times New Roman", "Noto Serif", Georgia, serif',
                              fontSize: '13.5px',
                              fontWeight: 600,
                              fontStyle: 'italic',
                              marginTop: '0.8em',
                              marginBottom: '0.25em'
                            }}
                          >
                            {displayName[keyName] || keyName}
                          </h4>
                        )}

                        <SectionFloatingToolbar
                          onGenerate={() => {
                            if (dimensionState.started && !dimensionState.completed && sectionSupportsDimensionFlow) {
                              setDimensionPanelOpen(prev => ({ ...prev, [normalizedKey]: true }));
                              void generateDimensionDraft(keyName, {
                                dimensionKey: dimensionState.nextDimensionKey || undefined
                              });
                              return;
                            }
                            void handleGenerate([keyName]);
                          }}
                          onRegenerate={() => {
                            if (sectionLoading[keyName]) return;
                            setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }));
                          }}
                          onInstructions={() => {
                            setInstructionPopoverKey(prev => (prev === keyName ? null : keyName));
                          }}
                          onToggleAutoCitations={
                            autoCitationAvailable
                              ? () => {
                                setMappedEvidenceBySection(prev => ({
                                  ...prev,
                                  [normalizedKey]: !autoCitationEnabled
                                }));
                              }
                              : undefined
                          }
                          autoCitationsAvailable={autoCitationAvailable}
                          autoCitationsEnabled={autoCitationEnabled}
                          generating={dimensionState.loading || sectionLoading[keyName]}
                          regenerating={sectionLoading[keyName]}
                          instructionActive={instructionActive}
                          disabled={isWorking || autoModeRunning || loading}
                        />

                        {instructionPopoverKey === keyName && (
                          <div className="relative z-20 mb-2">
                            <PaperSectionInstructionPopover
                              sectionKey={keyName}
                              sectionLabel={displayName[keyName] || formatSectionLabel(keyName)}
                              sessionId={session?.id || ''}
                              paperTypeCode={paperTypeCode}
                              existingInstruction={instruction || null}
                              onSave={handleSaveInstruction}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          </div>
                        )}

                        {sectionSupportsFigureGrounding && (
                        <div className="mb-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className={`inline-flex items-center gap-2 text-xs font-medium ${hasFigureOptions ? 'text-slate-700' : 'text-slate-400'}`}>
                              <input
                                type="checkbox"
                                checked={figureInjectionState.enabled}
                                onChange={() => toggleFigureInjection(keyName)}
                                disabled={!hasFigureOptions || isWorking || autoModeRunning}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-not-allowed"
                              />
                              <span>Ground with figures</span>
                            </label>

                            {hasFigureOptions ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setFigurePickerOpenBySection(prev => ({
                                    ...prev,
                                    [normalizedKey]: !prev[normalizedKey]
                                  }))}
                                  disabled={!figureInjectionState.enabled || isWorking || autoModeRunning}
                                  className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {selectedFigures.length > 0 ? `${selectedFigures.length} selected` : 'Choose'}
                                </button>
                                {recommendedFigureCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => applyRecommendedFigureSelection(keyName)}
                                    disabled={!figureInjectionState.enabled || isWorking || autoModeRunning}
                                    className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Recommended
                                  </button>
                                )}
                                {selectedFigures.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => clearSelectedFiguresForSection(keyName)}
                                    disabled={!figureInjectionState.enabled || isWorking || autoModeRunning}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Clear
                                  </button>
                                )}
                                {figurePickerOpenBySection[normalizedKey] && (
                                  <button
                                    type="button"
                                    onClick={() => setFigurePickerOpenBySection(prev => ({
                                      ...prev,
                                      [normalizedKey]: false
                                    }))}
                                    disabled={!figureInjectionState.enabled || isWorking || autoModeRunning}
                                    className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Hide
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400">No figures available yet</span>
                            )}
                          </div>

                          {figureInjectionState.enabled && selectedFigures.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selectedFigures.map((figure) => (
                                <span
                                  key={figure.id}
                                  className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-700"
                                >
                                  <span className="font-medium">Fig. {figure.figureNo}</span>
                                  <span className="max-w-[160px] truncate">{figure.title}</span>
                                </span>
                              ))}
                            </div>
                          )}

                          {figureInjectionState.enabled && figurePickerOpenBySection[normalizedKey] && hasFigureOptions && (
                            <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
                              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                <span>Select only the figures this section should use.</span>
                                <button
                                  type="button"
                                  onClick={() => selectAllFiguresForSection(keyName)}
                                  className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800"
                                >
                                  All
                                </button>
                              </div>
                              <div className="space-y-2">
                                {sortedFigures.map((figure) => {
                                  const isSelected = selectedFigureSet.has(figure.id);
                                  const isRecommended = isFigureRecommendedForSection(figure, keyName);
                                  const relevantSectionLabel = typeof figure.suggestionMeta?.relevantSection === 'string'
                                    ? figure.suggestionMeta.relevantSection.trim()
                                    : '';
                                  const inferredSummary = typeof figure.inferredImageMeta?.summary === 'string'
                                    ? figure.inferredImageMeta.summary.trim()
                                    : '';
                                  const helperText = inferredSummary || figure.caption || figure.description || figure.notes || '';

                                  return (
                                    <label
                                      key={figure.id}
                                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-2 transition-colors ${
                                        isSelected
                                          ? 'border-violet-300 bg-violet-50/70'
                                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleFigureSelection(keyName, figure.id)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="text-xs font-semibold text-slate-700">Figure {figure.figureNo}</span>
                                          <span className="text-xs text-slate-600">{figure.title}</span>
                                          {isRecommended && (
                                            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                                              Recommended
                                            </span>
                                          )}
                                          {relevantSectionLabel && (
                                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                              {relevantSectionLabel}
                                            </span>
                                          )}
                                        </div>
                                        {helperText && (
                                          <p className="mt-1 text-[11px] leading-4 text-slate-500">
                                            {helperText}
                                          </p>
                                        )}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        )}

                        <div className="relative">
                          <PaperMarkdownEditor
                            ref={(editor) => { editorRefs.current[keyName] = editor; }}
                            value={content[keyName] || ''}
                            onChange={(markdown) => handleContentChange(keyName, markdown)}
                            onFigureClick={handleOpenFigurePreview}
                            citationDisplayMeta={citationDisplayMeta}
                            figureDisplayMeta={figureDisplayMeta}
                            onBlur={() => {
                              handleBlur(keyName);
                            }}
                            onFocus={() => setFocusedSection(keyName)}
                            onSelectionChange={(selection) => {
                              if (!selection || !selection.text) {
                                if (focusedSection === keyName) setSelectedText(null);
                                return;
                              }
                              setFocusedSection(keyName);
                              setSelectedText({
                                text: selection.text,
                                start: selection.start,
                                end: selection.end
                              });
                              const editor = editorRefs.current[keyName];
                              if (editor) {
                                editor.saveSelection();
                              }
                            }}
                            placeholder={isWorking ? 'Generating...' : 'Begin writing...'}
                            disabled={isWorking}
                            className="min-h-[60px]"
                          />
                        </div>

                        {!isWorking && !dimensionState.started && !hasDraftContent && (
                          <div className="mt-2 flex items-center gap-2 text-xs opacity-60 transition-opacity duration-200 hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => void handleGenerate([keyName])}
                              disabled={loading || autoModeRunning}
                              className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Full Section
                            </button>
                            {sectionSupportsDimensionFlow && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDimensionPanelOpen(prev => ({ ...prev, [normalizedKey]: true }));
                                  void beginStructuredDraft(keyName);
                                }}
                                disabled={loading || autoModeRunning}
                                className="inline-flex items-center gap-1 rounded border border-slate-200/60 bg-slate-50/50 px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Sparkles className="h-3 w-3" />
                                Dimension
                              </button>
                            )}
                          </div>
                        )}

                        {showInlineDimension && dimensionState.error && (
                          <div className="mt-1.5 rounded border border-rose-200/70 bg-rose-50/60 px-2.5 py-1 text-[11px] text-rose-600">
                            {dimensionState.error}
                          </div>
                        )}

                        {showInlineDimension && !dimensionState.activeDimensionKey && dimensionState.started && !dimensionState.completed && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => void generateDimensionDraft(keyName, { dimensionKey: dimensionState.nextDimensionKey || undefined })}
                              disabled={dimensionBusy || sectionLoading[keyName]}
                              className="inline-flex items-center gap-1 rounded border border-indigo-200/60 bg-indigo-50/50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {dimensionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                              Generate next dimension
                            </button>
                          </div>
                        )}

                        {showInlineDimension && dimensionState.activeDimensionKey && (
                          <InlineDimensionProposal
                            dimensionLabel={dimensionState.activeDimensionLabel || dimensionState.activeDimensionKey}
                            proposalText={dimensionState.proposalText}
                            isStreaming={dimensionState.isStreaming}
                            streamCursor={dimensionState.streamCursor}
                            isLoading={dimensionState.loading}
                            isAccepting={dimensionState.accepting}
                            isRewriting={dimensionState.rejecting}
                            isEditing={dimensionState.editMode}
                            showRewriteInput={dimensionState.showReject}
                            feedback={dimensionState.feedback}
                            validation={dimensionState.proposalValidation}
                            reviewTrace={dimensionState.proposalReviewTrace}
                            pass1Source={dimensionState.pass1Source}
                            onAccept={() => acceptDimensionDraft(keyName, true)}
                            onAcceptBypass={() => acceptDimensionDraft(keyName, true, { allowCitationBypass: true })}
                            onToggleRewrite={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                showReject: !prev.showReject
                              }));
                            }}
                            onToggleEdit={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                editMode: !prev.editMode
                              }));
                            }}
                            onProposalChange={(value) => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                proposalText: value
                              }));
                            }}
                            onFeedbackChange={(value) => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                feedback: value
                              }));
                            }}
                            onRewrite={() => rejectDimensionDraft(keyName)}
                            onFixCitations={(badKeys) => {
                              const isMissing = badKeys.every(k =>
                                dimensionState.proposalValidation?.missingRequiredKeys?.includes(k)
                              );
                              const fixFeedback = isMissing
                                ? `These citation keys were expected but are missing: ${badKeys.join(', ')}. Where the evidence from these sources is relevant to this dimension's argument, incorporate a [CITE:key] placeholder naturally. Only include a citation if it genuinely supports a claim — do not force all keys in.`
                                : `Citation deviation detected. The following citation keys are invalid or not in the allowed evidence set: ${badKeys.join(', ')}. Remove these invalid keys. Where the removed citation supported a claim, replace it with a relevant allowed citation key only if one naturally fits the context — do not force citations. Do not invent new citation keys.`;
                              void rejectDimensionDraft(keyName, fixFeedback);
                            }}
                            onSkipAnimation={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                isStreaming: false,
                                streamCursor: prev.proposalText.length
                              }));
                            }}
                          />
                        )}

                        {showInlineDimension && dimensionState.completed && (
                          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                            Structured draft complete for this section.
                          </div>
                        )}

                        {(() => {
                          const referencedFigs = getReferencedFigures(content[keyName] || '');
                          if (referencedFigs.length === 0) return null;

                          return (
                            <div className="mt-3 rounded-lg border border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-2">
                              <div className="mb-2 flex items-center gap-2">
                                <ImageIcon className="h-3.5 w-3.5 text-violet-600" />
                                <span className="text-xs font-medium text-violet-700">
                                  Referenced Figures ({referencedFigs.length})
                                </span>
                                <span className="text-[10px] text-violet-500">click to preview</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {referencedFigs.map(fig => (
                                  <button
                                    key={fig.id}
                                    onClick={() => setPreviewFigure({
                                      id: fig.id,
                                      figureNo: fig.figureNo,
                                      title: fig.title,
                                      imagePath: fig.imagePath,
                                      description: fig.description
                                    })}
                                    className="group relative flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-2 py-1.5 transition-all hover:border-violet-400 hover:shadow-md"
                                  >
                                    <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                                      {fig.imagePath ? (
                                        <img
                                          src={fig.imagePath}
                                          alt={fig.title}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <ImageIcon className="h-4 w-4 text-slate-300" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-left">
                                      <p className="text-xs font-medium text-slate-700">Figure {fig.figureNo}</p>
                                      <p className="max-w-[120px] truncate text-[10px] text-slate-500">{fig.title}</p>
                                    </div>
                                    <Eye className="h-3.5 w-3.5 text-violet-500 opacity-0 transition-opacity group-hover:opacity-100" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {regenOpen[keyName] && (
                          <div className="absolute right-0 top-0 z-30 w-[320px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                            <div className="mb-2 flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-700">Refinement</label>
                              <button
                                onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))}
                                className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-100"
                              >
                                <X className="h-3 w-3 text-slate-400" />
                              </button>
                            </div>
                            <div className="mb-2 flex flex-wrap gap-1">
                              {[
                                'More concise',
                                'Add more citations',
                                'More analytical depth',
                                'Improve flow & transitions',
                                'Simplify language',
                                'Strengthen argumentation'
                              ].map(preset => (
                                <button
                                  key={preset}
                                  onClick={() => setRegenRemarks(prev => ({ ...prev, [keyName]: (prev[keyName] ? prev[keyName] + '. ' : '') + preset }))}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                            <textarea
                              className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                              value={regenRemarks[keyName] || ''}
                              onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                              placeholder="Additional instructions..."
                              rows={2}
                            />
                            <div className="mt-2 flex justify-end">
                              <button
                                onClick={() => handleRegenerateSection(keyName)}
                                disabled={sectionLoading[keyName]}
                                className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {sectionLoading[keyName] && <Loader2 className="h-3 w-3 animate-spin" />}
                                {sectionLoading[keyName] ? 'Regenerating...' : 'Regenerate'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      <CitationPickerModal open={pickerOpen} onOpenChange={setPickerOpen} sessionId={sessionId} authToken={authToken}
        citations={citations} onInsert={handleInsertSelectedCitations} onCitationsUpdated={setCitations} />

      {showPersonaManager && (
        <PersonaManager isOpen={showPersonaManager} onClose={() => setShowPersonaManager(false)}
          onSelectPersona={setPersonaSelection} currentSelection={personaSelection} showSelector={true} />
      )}

      {showWritingSamplesModal && <WritingSamplesModal onClose={() => setShowWritingSamplesModal(false)} />}

      <PaperInstructionsModal isOpen={showAllInstructionsModal} onClose={() => setShowAllInstructionsModal(false)}
        sections={(sectionConfigs || fallbackSections).flatMap(s => s.keys.map(k => ({ key: k, label: displayName[k] || formatSectionLabel(k) })))}
        instructions={userInstructions} onSaveAll={(newInstr) => setUserInstructions(newInstr as Record<string, UserInstruction>)} />

      {/* Reference Draft (Pass 1) Preview Modal */}
      <AnimatePresence>
        {showReferenceDraftModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowReferenceDraftModal(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3 bg-slate-50">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Reference Draft Output (Pass 1)</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Review base-prompt outputs across all configured sections.
                  </p>
                  {referenceDraftSummary && (
                    <p className="text-xs text-slate-600 mt-1">
                      {referenceDraftSummary.withPass1Content} / {referenceDraftSummary.totalSections} sections have Pass 1 output
                    </p>
                  )}
                  {referenceDraftFetchedAt && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Last fetched: {formatDateTime(referenceDraftFetchedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void loadReferenceDraftOutput(); }}
                    disabled={referenceDraftLoading}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {referenceDraftLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    onClick={() => setShowReferenceDraftModal(false)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center"
                  >
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                {referenceDraftLoading && referenceDraftSections.length === 0 && (
                  <div className="flex items-center justify-center py-10 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading reference draft output...
                  </div>
                )}

                {!referenceDraftLoading && referenceDraftError && referenceDraftSections.length === 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {referenceDraftError}
                  </div>
                )}

                {!referenceDraftLoading && !referenceDraftError && referenceDraftSections.length === 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    No eligible non-reference sections found for Pass 1 preview.
                    </div>
                )}

                {referenceDraftSections.map((section) => {
                  const figureWarning = getReferenceDraftFigureWarning(section);
                  const figureRefs = section.figureGrounding?.figureRefs || [];

                  return (
                    <div key={section.sectionKey} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-800">{section.displayName}</h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            section.hasContent
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {section.hasContent ? 'Pass 1 Ready' : 'No Pass 1 Output'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">
                            {section.wordCount} words
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                            status: {section.status}
                          </span>
                          {section.figureGrounding?.enabled && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700">
                              Grounded with figures
                            </span>
                          )}
                          {figureWarning.stale && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                              Figure-aware Pass 1 is stale
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          generated: {formatDateTime(section.generatedAt)} {section.source !== 'none' ? ` • source: ${section.source}` : ''}
                        </p>
                        {section.figureGrounding?.enabled && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {figureRefs.map((figureRef) => (
                              <span
                                key={`${section.sectionKey}-${figureRef}`}
                                className="inline-flex items-center rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-medium text-violet-700"
                              >
                                {figureRef}
                              </span>
                            ))}
                            {section.figureGrounding.waitedForMetadata && (
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600">
                                waited for sketch metadata
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-white">
                        {figureWarning.stale && (
                          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                            <div className="font-medium">This Pass 1 draft may be outdated.</div>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {figureWarning.reasons.map((reason) => (
                                <li key={`${section.sectionKey}-${reason}`}>{reason}</li>
                              ))}
                            </ul>
                            <button
                              type="button"
                              onClick={() => void handleRetryBgPreparation({ force: true, sectionKeys: [section.sectionKey] })}
                              disabled={bgGenRetrying}
                              className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {bgGenRetrying ? 'Preparing...' : 'Regenerate Pass 1 for this section'}
                            </button>
                          </div>
                        )}

                        {section.content ? (
                          <MarkdownRenderer
                            content={section.content}
                            figureDisplayMeta={figureDisplayMeta}
                            onFigureClick={handleOpenFigurePreview}
                            className="!my-0"
                          />
                        ) : (
                          <p className="text-sm text-slate-500 italic">
                            Pass 1 output not generated for this section yet.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Figure Preview Modal */}
      <AnimatePresence>
        {previewFigure && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewFigure(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-violet-50 to-white">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-semibold rounded">
                      Figure {previewFigure.figureNo}
                    </span>
                  </div>
                  <h3 className="font-semibold text-slate-800 text-lg">{previewFigure.title}</h3>
                  {previewFigure.description && (
                    <p className="text-sm text-slate-500 mt-1 max-w-lg">{previewFigure.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setPreviewFigure(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              {/* Image */}
              <div className="p-6 bg-slate-50 flex items-center justify-center min-h-[300px] max-h-[60vh] overflow-auto">
                {previewFigure.imagePath ? (
                  <img
                    src={previewFigure.imagePath}
                    alt={previewFigure.title}
                    className="max-w-full h-auto rounded-lg shadow-lg"
                  />
                ) : (
                  <div className="text-center py-12">
                    <ImageIcon className="w-16 h-16 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">Image not available</p>
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white">
                <p className="text-xs text-slate-500">
                  Reference in text: <code className="px-1.5 py-0.5 bg-slate-100 rounded text-violet-600">[Figure {previewFigure.figureNo}]</code>
                </p>
                <div className="flex gap-2">
                  {previewFigure.imagePath && (
                    <a
                      href={previewFigure.imagePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open Full Size
                    </a>
                  )}
                  <button
                    onClick={() => setPreviewFigure(null)}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Writing Assistant Panel */}
      <FloatingWritingPanel
        sessionId={sessionId}
        authToken={authToken}
        currentSection={focusedSection || undefined}
        currentContent={focusedSection ? content[focusedSection] : undefined}
        figures={figures}
        citations={citations}
        onInsertFigure={handleInsertFigure}
        onInsertCitation={(citation) => {
          if (citation.citationKey) {
            handleInsertSingleCitation(citation.citationKey);
          }
        }}
        onTextAction={handleTextAction}
        onGenerateFigure={handleGenerateFigure}
        onGenerateExistingFigure={handleGenerateExistingFigure}
        selectedText={selectedText}
        onRefreshFigures={loadFigures}
        onRefreshCitations={loadCitations}
        onNavigateToStage={onNavigateToStage}
        isVisible={true}
        // Bibliography management (merged from Citations Panel)
        bibliographyStyle={bibliographyStyle}
        onBibliographyStyleChange={setBibliographyStyle}
        bibliographySortOrder={bibliographySortOrder}
        onBibliographySortOrderChange={setBibliographySortOrder}
        onGenerateBibliography={generateBibliography}
        generatingBibliography={generatingBibliography}
        usedCitationCount={extractUsedCitationKeys().length}
        isNumericStyleBibliography={isNumericOrderBibliography}
        sequenceInfo={sequenceInfo}
        onAddCitationViaPicker={() => {
          const activeSections = sectionConfigs || fallbackSections;
          const targetSection = focusedSection || (activeSections.length > 0 ? activeSections[0].keys[0] : null);
          if (targetSection) {
            insertCitationTargetRef.current = targetSection;
            setInsertCitationTarget(targetSection);
          }
          setPickerOpen(true);
        }}
        onCitationsUpdated={setCitations}
      />
    </div>
  );
}


