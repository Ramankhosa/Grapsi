'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  DEFAULT_FIGURE_SUGGESTION_PREFERENCES,
  normalizeFigurePreferences,
  resolveSketchStyleFromPreferences,
  type FigureSuggestionPreferences
} from '@/lib/figure-generation/preferences';
import {
  extractFigureSuggestionMeta,
  type FigureSuggestionStatus,
  type FigureSuggestionTransport,
  type FigureSuggestionTransportMeta
} from '@/lib/figure-generation/suggestion-meta';
import { getPaperFigureCaptionSeed } from '@/lib/figure-generation/paper-figure-record';
import { 
  BarChart3, 
  LineChart, 
  PieChart, 
  GitBranch, 
  Sparkles, 
  Plus, 
  Trash2, 
  Eye, 
  Download, 
  Loader2,
  Image as ImageIcon,
  Wand2,
  ChevronDown,
  Check,
  X,
  RefreshCw,
  Zap,
  Network,
  Clock,
  Boxes,
  Activity,
  LayoutGrid,
  ArrowRightLeft,
  MessageSquare,
  Send,
  Pencil,
  Upload,
  Paintbrush,
  FileImage,
  Lightbulb,
  Brain,
  FlaskConical,
  Workflow,
  Table2,
  Cog,
  Layers,
  Frame,
  Film,
  Microscope,
  BoxSelect,
  TrendingUp,
  ScatterChart,
  BarChart
} from 'lucide-react';

interface PaperFigurePlannerStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  session?: any;
  selectedSection?: string;
  initialSelectedSectionKey?: string | null;
}

type FigureCategory = 'DATA_CHART' | 'DIAGRAM' | 'STATISTICAL_PLOT' | 'ILLUSTRATED_FIGURE' | 'ILLUSTRATION' | 'SKETCH' | 'CUSTOM';

type DiagramSpec = {
  layout?: 'LR' | 'TD';
  nodes?: Array<{ idHint: string; label: string; group?: string }>;
  edges?: Array<{ fromHint: string; toHint: string; label?: string; type?: 'solid' | 'dashed' | 'async' }>;
  groups?: Array<{ name: string; nodeIds?: string[]; description?: string }>;
  splitSuggestion?: string;
};

type IllustrationGenre = 'METHOD_BLOCK' | 'SCENARIO_STORYBOARD' | 'CONCEPTUAL_FRAMEWORK' | 'GRAPHICAL_ABSTRACT'
  | 'NEURAL_ARCHITECTURE' | 'EXPERIMENTAL_SETUP' | 'DATA_PIPELINE' | 'COMPARISON_MATRIX'
  | 'PROCESS_MECHANISM' | 'SYSTEM_INTERACTION';

type FigureSuggestionMeta = FigureSuggestionTransportMeta;

type FigurePlan = {
  id: string;
  figureNo: number;
  title: string;
  caption: string;
  generationPrompt?: string;
  figureType: string;
  category: FigureCategory;
  notes?: string;
  imagePath?: string;
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
  generatedCode?: string;
  suggestionMeta?: FigureSuggestionMeta | null;
};

type GenerationFeedback = {
  kind: 'single' | 'sketch' | 'batch' | 'modify';
  category?: FigureCategory;
  title?: string;
  count?: number;
  startedAt: number;
};

type SuggestionStatus = FigureSuggestionStatus;

type FigureSuggestionItem = FigureSuggestionTransport & {
  id: string;
  category: FigureCategory;
  status?: SuggestionStatus;
};

type SuggestionScopeMode = 'selected_sections' | 'full_draft';

type FigureSourceSectionOption = {
  sectionKey: string;
  label: string;
  content: string;
  wordCount: number;
};

// Figure types with descriptions and visual examples
const FIGURE_OPTIONS: Array<{
  value: string; label: string; icon: any; category: string;
  desc: string; example: string; genre?: IllustrationGenre;
}> = [
  // Data Charts
  { value: 'bar', label: 'Bar Chart', icon: BarChart3, category: 'DATA_CHART', 
    desc: 'Compare values across categories', example: '📊 ▐▐▐ ▐▐ ▐▐▐▐' },
  { value: 'line', label: 'Line Chart', icon: LineChart, category: 'DATA_CHART',
    desc: 'Show trends over time', example: '📈 ╱╲╱╲╱' },
  { value: 'pie', label: 'Pie Chart', icon: PieChart, category: 'DATA_CHART',
    desc: 'Show proportions of a whole', example: '🥧 ◔◔◔' },
  { value: 'scatter', label: 'Scatter Plot', icon: Activity, category: 'DATA_CHART',
    desc: 'Show correlations between variables', example: '⚬ · ⚬ · ⚬' },
  { value: 'radar', label: 'Radar Chart', icon: Network, category: 'DATA_CHART',
    desc: 'Compare multiple variables', example: '◇ ◆ ◇' },
  // Statistical Plots (Python/matplotlib rendered)
  { value: 'boxplot', label: 'Box Plot', icon: BoxSelect, category: 'STATISTICAL_PLOT',
    desc: 'Distribution with quartiles & outliers', example: '┣━━━╋━━━┫' },
  { value: 'violin', label: 'Violin Plot', icon: Activity, category: 'STATISTICAL_PLOT',
    desc: 'Distribution shape comparison', example: ')()(  )(  )(' },
  { value: 'heatmap', label: 'Heatmap', icon: LayoutGrid, category: 'STATISTICAL_PLOT',
    desc: 'Matrix correlation or intensity map', example: '▓▒░▒▓' },
  { value: 'error_bar', label: 'Error Bar Chart', icon: BarChart, category: 'STATISTICAL_PLOT',
    desc: 'Means with confidence intervals', example: '┬ ┬ ┬ ┬' },
  { value: 'regression', label: 'Regression Plot', icon: TrendingUp, category: 'STATISTICAL_PLOT',
    desc: 'Best-fit line with confidence band', example: '⟋ ± band' },
  { value: 'confusion_matrix', label: 'Confusion Matrix', icon: Table2, category: 'STATISTICAL_PLOT',
    desc: 'Classification performance grid', example: 'TP FP / FN TN' },
  { value: 'roc_curve', label: 'ROC Curve', icon: ScatterChart, category: 'STATISTICAL_PLOT',
    desc: 'Receiver operating characteristic', example: '↗ AUC' },
  // Diagrams  
  { value: 'flowchart', label: 'Flowchart', icon: GitBranch, category: 'DIAGRAM',
    desc: 'Process flows & decision trees', example: '□ → ◇ → □' },
  { value: 'sequence', label: 'Sequence Diagram', icon: ArrowRightLeft, category: 'DIAGRAM',
    desc: 'Interactions over time', example: '│→│→│' },
  { value: 'architecture', label: 'Architecture', icon: Boxes, category: 'DIAGRAM',
    desc: 'System components & connections', example: '⬡―⬡―⬡' },
  { value: 'class', label: 'Class Diagram', icon: LayoutGrid, category: 'DIAGRAM',
    desc: 'Object-oriented structure', example: '┌─┐┌─┐' },
  { value: 'er', label: 'ER Diagram', icon: Network, category: 'DIAGRAM',
    desc: 'Entity relationships', example: '○─◇─○' },
  { value: 'gantt', label: 'Gantt Chart', icon: Clock, category: 'DIAGRAM',
    desc: 'Project timeline', example: '▬▬▬ ▬▬' },
  // Scientific Illustrations (AI-generated via Gemini)
  { value: 'sketch-method-block', label: 'Method Overview', icon: Layers, category: 'ILLUSTRATED_FIGURE',
    desc: 'Multi-step methodology pipeline diagram', example: 'In → [Step] → Out', genre: 'METHOD_BLOCK' },
  { value: 'sketch-neural-arch', label: 'Neural Architecture', icon: Brain, category: 'ILLUSTRATED_FIGURE',
    desc: 'Deep learning model architecture diagram', example: '◻ → ◻ → ◻ layers', genre: 'NEURAL_ARCHITECTURE' },
  { value: 'sketch-experiment', label: 'Experimental Setup', icon: FlaskConical, category: 'ILLUSTRATED_FIGURE',
    desc: 'Lab / experiment layout illustration', example: '🔬 → 📊', genre: 'EXPERIMENTAL_SETUP' },
  { value: 'sketch-pipeline', label: 'Data Pipeline', icon: Workflow, category: 'ILLUSTRATED_FIGURE',
    desc: 'Data flow from source to output', example: 'DB → ETL → ML', genre: 'DATA_PIPELINE' },
  { value: 'sketch-comparison', label: 'Comparison Matrix', icon: Table2, category: 'ILLUSTRATED_FIGURE',
    desc: 'Side-by-side method / result comparison', example: 'A vs B vs C', genre: 'COMPARISON_MATRIX' },
  { value: 'sketch-mechanism', label: 'Process Mechanism', icon: Cog, category: 'ILLUSTRATED_FIGURE',
    desc: 'Biological, chemical, or physical process', example: '⚙ → ⚙ → ⚙', genre: 'PROCESS_MECHANISM' },
  { value: 'sketch-system', label: 'System Interaction', icon: Boxes, category: 'ILLUSTRATED_FIGURE',
    desc: 'Component / module interaction diagram', example: '⬡ ↔ ⬡ ↔ ⬡', genre: 'SYSTEM_INTERACTION' },
  { value: 'sketch-framework', label: 'Conceptual Framework', icon: Frame, category: 'ILLUSTRATED_FIGURE',
    desc: 'Abstract theoretical framework figure', example: '⬡ -- ⬡ -- ⬡', genre: 'CONCEPTUAL_FRAMEWORK' },
  { value: 'sketch-storyboard', label: 'Scenario Storyboard', icon: Film, category: 'ILLUSTRATED_FIGURE',
    desc: 'Step-by-step scenario or use-case panels', example: '[ 1 ] [ 2 ] [ 3 ]', genre: 'SCENARIO_STORYBOARD' },
  { value: 'sketch-abstract', label: 'Graphical Abstract', icon: Microscope, category: 'ILLUSTRATED_FIGURE',
    desc: 'Journal graphical abstract / TOC image', example: 'TOC graphic', genre: 'GRAPHICAL_ABSTRACT' },
  // Free-form AI Sketches
  { value: 'sketch-auto', label: 'AI Sketch (Auto)', icon: Sparkles, category: 'SKETCH',
    desc: 'AI generates based on paper context', example: '✨ Auto' },
  { value: 'sketch-guided', label: 'AI Sketch (Guided)', icon: Paintbrush, category: 'SKETCH',
    desc: 'AI generates from your description', example: '🖌️ Guided' },
  { value: 'sketch-refine', label: 'Refine Image', icon: Upload, category: 'SKETCH',
    desc: 'AI refines your uploaded/hand-drawn sketch', example: '📤 → 🎨' },
];

const CATEGORY_COLORS: Record<FigureCategory, string> = {
  DATA_CHART: 'bg-sky-500',
  DIAGRAM: 'bg-violet-500',
  STATISTICAL_PLOT: 'bg-emerald-500',
  ILLUSTRATED_FIGURE: 'bg-orange-500',
  ILLUSTRATION: 'bg-amber-500',
  SKETCH: 'bg-rose-500',
  CUSTOM: 'bg-slate-500'
};

const CATEGORY_ACCENTS: Record<FigureCategory, string> = {
  DATA_CHART: 'border-sky-200 bg-sky-50/70',
  DIAGRAM: 'border-violet-200 bg-violet-50/70',
  STATISTICAL_PLOT: 'border-emerald-200 bg-emerald-50/70',
  ILLUSTRATED_FIGURE: 'border-orange-200 bg-orange-50/70',
  ILLUSTRATION: 'border-amber-200 bg-amber-50/70',
  SKETCH: 'border-rose-200 bg-rose-50/70',
  CUSTOM: 'border-slate-200 bg-slate-50/70'
};

const PREFERENCE_OPTIONS = {
  stylePreset: [
    { value: 'auto', label: 'Let AI decide' },
    { value: 'ieee_clean', label: 'IEEE clean' },
    { value: 'nature_minimal', label: 'Nature minimal' },
    { value: 'industrial_dashboard', label: 'Industrial dashboard' },
    { value: 'technical_blueprint', label: 'Technical blueprint' },
    { value: 'conceptual_storyboard', label: 'Concept storyboard' }
  ],
  outputMix: [
    { value: 'auto', label: 'Let AI balance' },
    { value: 'balanced', label: 'Balanced mix' },
    { value: 'charts_first', label: 'Charts first' },
    { value: 'diagrams_first', label: 'Diagrams first' },
    { value: 'include_sketches', label: 'Include sketches' }
  ],
  chartPreference: [
    { value: 'auto', label: 'Auto chart family' },
    { value: 'bar_line', label: 'Bar and line' },
    { value: 'distribution', label: 'Distribution focused' },
    { value: 'correlation', label: 'Correlation focused' },
    { value: 'comparative', label: 'Comparative metrics' }
  ],
  diagramPreference: [
    { value: 'auto', label: 'Auto diagram family' },
    { value: 'flow', label: 'Flow/process' },
    { value: 'architecture', label: 'Architecture/system' },
    { value: 'sequence', label: 'Sequence/interaction' },
    { value: 'conceptual', label: 'Conceptual map' }
  ],
  visualTone: [
    { value: 'auto', label: 'Auto tone' },
    { value: 'formal', label: 'Formal publication' },
    { value: 'minimal', label: 'Minimal clean' },
    { value: 'high_contrast', label: 'High contrast' },
    { value: 'presentation_ready', label: 'Presentation ready' }
  ],
  colorMode: [
    { value: 'auto', label: 'Auto color mode' },
    { value: 'color', label: 'Color' },
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'colorblind_safe', label: 'Colorblind safe' }
  ],
  detailLevel: [
    { value: 'auto', label: 'Auto detail' },
    { value: 'simple', label: 'Simple' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'advanced', label: 'Advanced' }
  ],
  annotationDensity: [
    { value: 'auto', label: 'Auto labels' },
    { value: 'light', label: 'Light' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'detailed', label: 'Detailed' }
  ],
  targetAudience: [
    { value: 'auto', label: 'Auto audience' },
    { value: 'academic', label: 'Academic reviewers' },
    { value: 'industry', label: 'Industry stakeholders' },
    { value: 'mixed', label: 'Mixed audience' }
  ],
  strictness: [
    { value: 'soft', label: 'Soft guidance' },
    { value: 'strict', label: 'Strict enforcement' }
  ]
} as const;

const SUGGESTION_SECTION_FILTER_ALL = '__all__';

function getGenerationHeading(feedback: GenerationFeedback): string {
  switch (feedback.kind) {
    case 'batch':
      return `Generating ${feedback.count || 0} figures`
    case 'modify':
      return feedback.title ? `Updating "${feedback.title}"` : 'Updating figure'
    case 'sketch':
      return feedback.title ? `Generating "${feedback.title}"` : 'Generating sketch'
    case 'single':
    default:
      return feedback.title ? `Generating "${feedback.title}"` : 'Generating figure'
  }
}

function getGenerationMessages(feedback: GenerationFeedback): string[] {
  const category = feedback.category || 'CUSTOM';

  const categorySpecific =
    category === 'DATA_CHART' || category === 'STATISTICAL_PLOT'
      ? [
          'Interpreting your request and shaping the right plot structure, axes, and series.',
          'Building a manuscript-ready plotting spec and passing it to the renderer.',
        ]
      : category === 'DIAGRAM'
        ? [
            'Structuring nodes, relationships, and layout so the diagram reads cleanly.',
            'Validating the diagram syntax and preparing the final render.',
          ]
        : category === 'SKETCH' || category === 'ILLUSTRATED_FIGURE' || category === 'ILLUSTRATION'
          ? [
              'Composing the illustration layout, scientific styling, and publication canvas.',
              'Rendering the image and checking the composition for journal-ready output.',
            ]
          : [
              'Preparing the figure instructions and routing them to the correct rendering service.',
              'Rendering the final output and storing it in your figure list.',
            ];

  if (feedback.kind === 'batch') {
    return [
      'Batch request received. The backend is working through the selected figures one by one.',
      'Each figure is being generated and saved as soon as it completes.',
      'Larger plots and sketches can take longer, but the request is still active.',
    ];
  }

  if (feedback.kind === 'modify') {
    return [
      'Modification request received. The backend is revising the existing figure.',
      ...categorySpecific,
      'Saving the refreshed output back into your figure list.',
    ];
  }

  return [
    'Request received. The backend is actively processing your figure.',
    ...categorySpecific,
    'Saving the result to the bottom of your figure list as soon as it is ready.',
  ];
}

function getSectionMapFromSession(session: any): Record<string, string> {
  const paperSections = Array.isArray(session?.paperSections) ? session.paperSections : [];
  if (paperSections.length > 0) {
    return paperSections.reduce((acc: Record<string, string>, section: any) => {
      if (section?.sectionKey && typeof section?.content === 'string' && section.content.trim()) {
        acc[section.sectionKey] = section.content;
      }
      return acc;
    }, {});
  }

  return session?.annexureDrafts?.[0]?.extraSections || {};
}

function formatSourceSectionLabel(sectionKey: string): string {
  return String(sectionKey || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Untitled Section';
}

function countSourceSectionWords(content: string): number {
  const text = String(content || '').replace(/<[^>]*>/g, ' ').trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function getSectionOptionsFromSession(session: any): FigureSourceSectionOption[] {
  const sections = getSectionMapFromSession(session);
  const labels: Record<string, string> = {};

  if (Array.isArray(session?.paperSections)) {
    for (const section of session.paperSections) {
      const sectionKey = String(section?.sectionKey || '').trim();
      if (!sectionKey) continue;
      const label = String(section?.displayName || section?.title || section?.label || '').trim();
      if (label) labels[sectionKey] = label;
    }
  }

  const sectionPlan = Array.isArray(session?.paperBlueprint?.sectionPlan)
    ? session.paperBlueprint.sectionPlan
    : [];
  for (const section of sectionPlan) {
    const sectionKey = String(section?.sectionKey || '').trim();
    if (!sectionKey) continue;
    const label = String(section?.displayLabel || section?.label || section?.title || section?.displayName || '').trim();
    if (label) labels[sectionKey] = label;
  }

  return Object.entries(sections)
    .map(([sectionKey, content]) => {
      const cleaned = String(content || '').trim();
      return {
        sectionKey,
        label: labels[sectionKey] || formatSourceSectionLabel(sectionKey),
        content: cleaned,
        wordCount: countSourceSectionWords(cleaned)
      };
    })
    .filter((section) => section.content.length > 0);
}

export default function PaperFigurePlannerStage({ 
  sessionId, 
  authToken, 
  onSessionUpdated,
  session,
  selectedSection,
  initialSelectedSectionKey
}: PaperFigurePlannerStageProps) {
  const { showToast } = useToast();
  const [figures, setFigures] = useState<FigurePlan[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [previewFigure, setPreviewFigure] = useState<FigurePlan | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<FigureSuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionPreferences, setSuggestionPreferences] = useState<FigureSuggestionPreferences>(DEFAULT_FIGURE_SUGGESTION_PREFERENCES);
  const [suggestionScopeMode, setSuggestionScopeMode] = useState<SuggestionScopeMode>('selected_sections');
  const [selectedSuggestionSectionKeys, setSelectedSuggestionSectionKeys] = useState<string[]>([]);
  const [showSectionScopeDropdown, setShowSectionScopeDropdown] = useState(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [isApplyingSuggestionBatch, setIsApplyingSuggestionBatch] = useState(false);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [sectionFilter, setSectionFilter] = useState<string>(SUGGESTION_SECTION_FILTER_ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(SUGGESTION_SECTION_FILTER_ALL);
  const [importanceFilter, setImportanceFilter] = useState<string>(SUGGESTION_SECTION_FILTER_ALL);
  const [suggestionsRequested, setSuggestionsRequested] = useState(false);
  
  // Modification request state
  const [modificationRequest, setModificationRequest] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [showModifyInput, setShowModifyInput] = useState(false);
  const [editingCaption, setEditingCaption] = useState('');
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  
  // Sketch-specific state
  const [sketchUploadFile, setSketchUploadFile] = useState<File | null>(null);
  const [sketchUploadPreview, setSketchUploadPreview] = useState<string | null>(null);
  const [sketchStyle, setSketchStyle] = useState<'academic' | 'scientific' | 'conceptual' | 'technical'>('academic');
  const [isGeneratingSketch, setIsGeneratingSketch] = useState(false);
  
  // Simple form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [figureType, setFigureType] = useState('bar');
  const [category, setCategory] = useState<FigureCategory>('DATA_CHART');
  const [pendingSuggestionMeta, setPendingSuggestionMeta] = useState<FigureSuggestionMeta | null>(null);
  const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
  const [activeRequest, setActiveRequest] = useState<{
    controller: AbortController;
    timeoutId: ReturnType<typeof setTimeout> | null;
    label: string;
    timedOut: boolean;
  } | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedback | null>(null);
  const [generationMessageIndex, setGenerationMessageIndex] = useState(0);
  const figureListEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setEditingCaption(previewFigure?.caption || '');
  }, [previewFigure?.id, previewFigure?.caption]);

  const startCancelableRequest = useCallback((label: string, timeoutMs: number) => {
    const controller = new AbortController();
    const requestState = {
      controller,
      timeoutId: null as ReturnType<typeof setTimeout> | null,
      label,
      timedOut: false
    };
    requestState.timeoutId = setTimeout(() => {
      requestState.timedOut = true;
      controller.abort();
    }, timeoutMs);
    setActiveRequest(requestState);
    return requestState;
  }, []);

  const finishCancelableRequest = useCallback((requestState: {
    controller: AbortController;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }) => {
    if (requestState.timeoutId !== null) {
      clearTimeout(requestState.timeoutId);
    }
    setActiveRequest((current) => (current === requestState ? null : current));
  }, []);

  const isAbortError = (error: unknown): boolean => {
    return error instanceof DOMException
      ? error.name === 'AbortError'
      : (error as any)?.name === 'AbortError';
  };

  const cancelActiveRequest = useCallback(() => {
    setActiveRequest((current) => {
      if (!current) return current;
      if (current.timeoutId !== null) {
        clearTimeout(current.timeoutId);
      }
      current.controller.abort();
      return null;
    });
    showToast({
      type: 'info',
      title: 'Request canceled',
      message: 'The active request was canceled.'
    });
  }, [showToast]);

  const getBatchFailureMessage = useCallback((results: any[]): string => {
    const failures = results.filter((entry: any) => entry?.success === false);
    if (failures.length === 0) return '';
    const titleList = failures
      .map((entry: any) => entry?.title)
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 3);
    const suffix = failures.length > titleList.length ? ` and ${failures.length - titleList.length} more` : '';
    if (titleList.length > 0) {
      return `Failed: ${titleList.join(', ')}${suffix}.`;
    }
    return `${failures.length} figure(s) failed.`;
  }, []);

  const scrollToFiguresBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        figureListEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
    });
  }, []);

  const generationMessages = useMemo(
    () => (generationFeedback ? getGenerationMessages(generationFeedback) : []),
    [generationFeedback]
  );

  const activeGenerationMessage = generationMessages.length > 0
    ? generationMessages[generationMessageIndex % generationMessages.length]
    : null;

  useEffect(() => {
    if (!generationFeedback || generationMessages.length === 0) {
      setGenerationMessageIndex(0);
      return;
    }

    setGenerationMessageIndex(0);
    const intervalId = window.setInterval(() => {
      setGenerationMessageIndex((current) => (current + 1) % generationMessages.length);
    }, 2600);

    return () => window.clearInterval(intervalId);
  }, [generationFeedback, generationMessages.length]);

  // Calculate next figure number
  const nextFigureNo = useMemo(() => {
    if (figures.length === 0) return 1;
    return Math.max(...figures.map(fig => fig.figureNo)) + 1;
  }, [figures]);

  const selectedType = FIGURE_OPTIONS.find(t => t.value === figureType);
  const normalizePrefs = useCallback(() => normalizeFigurePreferences(suggestionPreferences), [suggestionPreferences]);
  const suggestionSectionOptions = useMemo(() => getSectionOptionsFromSession(session), [session]);
  const selectedSuggestionSectionSet = useMemo(() => new Set(selectedSuggestionSectionKeys), [selectedSuggestionSectionKeys]);
  const selectedSuggestionSectionOptions = useMemo(() => {
    if (suggestionScopeMode === 'full_draft') return suggestionSectionOptions;
    return suggestionSectionOptions.filter((section) => selectedSuggestionSectionSet.has(section.sectionKey));
  }, [selectedSuggestionSectionSet, suggestionScopeMode, suggestionSectionOptions]);
  const suggestionScopeLabel = useMemo(() => {
    if (suggestionScopeMode === 'full_draft') return 'Full draft';
    if (selectedSuggestionSectionOptions.length === 0) return 'Choose sections';
    if (selectedSuggestionSectionOptions.length === 1) return selectedSuggestionSectionOptions[0].label;
    const firstTwo = selectedSuggestionSectionOptions.slice(0, 2).map((section) => section.label).join(', ');
    const extra = selectedSuggestionSectionOptions.length - 2;
    return extra > 0 ? `${firstTwo} +${extra}` : firstTwo;
  }, [selectedSuggestionSectionOptions, suggestionScopeMode]);

  useEffect(() => {
    if (suggestionScopeMode !== 'selected_sections' || suggestionSectionOptions.length === 0) return;
    setSelectedSuggestionSectionKeys((current) => {
      const validKeys = new Set(suggestionSectionOptions.map((section) => section.sectionKey));
      const stillValid = current.filter((key) => validKeys.has(key));
      if (stillValid.length > 0) return stillValid;

      const preferredKey = initialSelectedSectionKey || selectedSection;
      const preferred = preferredKey
        ? suggestionSectionOptions.find((section) => section.sectionKey === preferredKey)
        : undefined;
      return [preferred?.sectionKey || suggestionSectionOptions[0].sectionKey];
    });
  }, [initialSelectedSectionKey, selectedSection, suggestionScopeMode, suggestionSectionOptions]);

  const toggleSuggestionSectionKey = useCallback((sectionKey: string) => {
    setSelectedSuggestionSectionKeys((current) => {
      if (current.includes(sectionKey)) {
        return current.filter((key) => key !== sectionKey);
      }
      return [...current, sectionKey];
    });
  }, []);

  const suggestionSections = useMemo(() => {
    const values = new Set<string>();
    suggestions.forEach((item) => {
      if (item.relevantSection?.trim()) values.add(item.relevantSection.trim());
    });
    return Array.from(values);
  }, [suggestions]);

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((item) => {
      if (item.status === 'dismissed') return false;
      if (sectionFilter !== SUGGESTION_SECTION_FILTER_ALL && item.relevantSection !== sectionFilter) return false;
      if (categoryFilter !== SUGGESTION_SECTION_FILTER_ALL && item.category !== categoryFilter) return false;
      if (importanceFilter !== SUGGESTION_SECTION_FILTER_ALL && (item.importance || 'optional') !== importanceFilter) return false;
      return true;
    });
  }, [suggestions, sectionFilter, categoryFilter, importanceFilter]);

  const selectedSuggestions = useMemo(() => {
    const selected = new Set(selectedSuggestionIds);
    // Exclude already-used suggestions from batch operations
    return suggestions.filter((item) => selected.has(item.id) && item.status !== 'used' && item.status !== 'dismissed');
  }, [suggestions, selectedSuggestionIds]);

  const updatePreference = <K extends keyof FigureSuggestionPreferences>(
    key: K,
    value: FigureSuggestionPreferences[K]
  ) => {
    setSuggestionPreferences((prev) => normalizeFigurePreferences({
      ...prev,
      [key]: value
    }));
  };

  // ── Suggestion persistence helpers ──────────────────────────────

  /** Parse API response items into typed FigureSuggestionItem[] */
  const parseSuggestionsFromApi = useCallback((items: any[]): FigureSuggestionItem[] => {
    return items.map((item: any, index: number) => {
      const suggestionMeta = extractFigureSuggestionMeta(item);

      return {
        id: item.id || `${Date.now()}-${index}`,
        title: item.title,
        description: item.description,
        category: (item.category || 'DIAGRAM') as FigureCategory,
        importance: item.importance || 'optional',
        suggestedType: item.suggestedType || 'flowchart',
        ...suggestionMeta,
        status: (item.status as SuggestionStatus) || 'pending',
        usedByFigureId: item.usedByFigureId ?? null,
        usedAt: item.usedAt ?? null
      };
    });
  }, []);

  /** Load suggestion cache from server on mount */
  const loadCachedSuggestions = useCallback(async () => {
    if (!authToken || !sessionId) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/suggest`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.suggestions && data.suggestions.length > 0) {
        const cached = parseSuggestionsFromApi(data.suggestions).filter((s) => s.status !== 'dismissed');
        setSuggestions(cached);
        setSuggestionsRequested(true);
        // Auto-select only pending suggestions
        setSelectedSuggestionIds(cached.filter(s => s.status !== 'used' && s.status !== 'dismissed').map(s => s.id));
      }
    } catch (err) {
      console.error('Failed to load cached suggestions:', err);
    }
  }, [authToken, sessionId, parseSuggestionsFromApi]);

  /** Persist status changes for one or more suggestions to the server */
  const persistSuggestionStatuses = useCallback(async (
    updates: Array<{ id: string; status: SuggestionStatus; usedByFigureId?: string | null }>
  ) => {
    if (!authToken || !sessionId || updates.length === 0) return;
    try {
      await fetch(`/api/papers/${sessionId}/figures/suggest`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ updates })
      });
    } catch (err) {
      console.error('Failed to persist suggestion status:', err);
    }
  }, [authToken, sessionId]);

  /** Mark a suggestion as used (locally + server) and link it to a figure */
  const markSuggestionUsed = useCallback((suggestionId: string, figureId: string) => {
    setSuggestions(prev => prev.map(s =>
      s.id === suggestionId
        ? { ...s, status: 'used' as SuggestionStatus, usedByFigureId: figureId, usedAt: new Date().toISOString() }
        : s
    ));
    persistSuggestionStatuses([{ id: suggestionId, status: 'used', usedByFigureId: figureId }]);
  }, [persistSuggestionStatuses]);

  /** Discard a suggestion the user does not want to use */
  const dismissSuggestion = useCallback((suggestionId: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    setSelectedSuggestionIds(prev => prev.filter(id => id !== suggestionId));
    persistSuggestionStatuses([{ id: suggestionId, status: 'dismissed', usedByFigureId: null }]);
  }, [persistSuggestionStatuses]);

  /** Discard all currently selected pending suggestions */
  const dismissSelectedSuggestions = useCallback(() => {
    if (selectedSuggestions.length === 0) return;
    const ids = selectedSuggestions.map(s => s.id);
    setSuggestions(prev => prev.filter(s => !ids.includes(s.id)));
    setSelectedSuggestionIds(prev => prev.filter(id => !ids.includes(id)));
    persistSuggestionStatuses(ids.map((id) => ({ id, status: 'dismissed' as SuggestionStatus, usedByFigureId: null })));
  }, [persistSuggestionStatuses, selectedSuggestions]);

  /** Mark multiple suggestions as used (for batch operations) */
  const markSuggestionsUsedBatch = useCallback((entries: Array<{ suggestionTitle: string; figureId: string }>) => {
    setSuggestions(prev => {
      const titleToFigure = new Map(entries.map(e => [e.suggestionTitle.toLowerCase(), e.figureId]));
      const updates: Array<{ id: string; status: SuggestionStatus; usedByFigureId: string }> = [];
      const next = prev.map(s => {
        const figId = titleToFigure.get(s.title.toLowerCase());
        if (figId && s.status !== 'used') {
          updates.push({ id: s.id, status: 'used', usedByFigureId: figId });
          return { ...s, status: 'used' as SuggestionStatus, usedByFigureId: figId, usedAt: new Date().toISOString() };
        }
        return s;
      });
      if (updates.length > 0) {
        persistSuggestionStatuses(updates);
      }
      return next;
    });
  }, [persistSuggestionStatuses]);

  /** When a figure is deleted, revert its linked suggestion back to pending */
  const revertSuggestionOnFigureDelete = useCallback((figureId: string) => {
    setSuggestions(prev => {
      const match = prev.find(s => s.usedByFigureId === figureId);
      if (!match) return prev;
      persistSuggestionStatuses([{ id: match.id, status: 'pending', usedByFigureId: null }]);
      return prev.map(s =>
        s.usedByFigureId === figureId
          ? { ...s, status: 'pending' as SuggestionStatus, usedByFigureId: null, usedAt: null }
          : s
      );
    });
  }, [persistSuggestionStatuses]);

  // Load figures
  const loadFigures = useCallback(async () => {
    if (!authToken || !sessionId) return [];
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) return [];
      const data = await response.json();
      const nextFigures = data.figures || [];
      setFigures(nextFigures);
      return nextFigures as FigurePlan[];
    } catch (error) {
      console.error('Failed to load figures:', error);
      return [];
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    if (sessionId && authToken) {
      loadFigures();
      loadCachedSuggestions();
    }
  }, [sessionId, authToken, loadFigures, loadCachedSuggestions]);

  // ── Cross-stage context: if user navigated here from the drafting stage with
  //    selected text, auto-open the suggestion panel and trigger AI suggestions.
  useEffect(() => {
    if (!sessionId || !authToken) return;
    const storageKey = `figure_planner_context_${sessionId}`;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      sessionStorage.removeItem(storageKey);
      const ctx = JSON.parse(raw);
      // Only use context less than 5 minutes old
      if (ctx.timestamp && Date.now() - ctx.timestamp > 5 * 60 * 1000) return;
      if (ctx.sourceText) {
        const isSelection = ctx.focusMode === 'selection';
        const contextOptions = getSectionOptionsFromSession(session);
        const contextKeys = Array.isArray(ctx.selectedSectionKeys)
          ? ctx.selectedSectionKeys.filter((key: unknown): key is string => typeof key === 'string' && key.trim().length > 0)
          : (ctx.sourceSection ? [ctx.sourceSection] : []);
        const contextScopeMode: SuggestionScopeMode = ctx.sectionScope?.mode === 'full_draft'
          ? 'full_draft'
          : 'selected_sections';
        const contextSections = contextScopeMode === 'selected_sections'
          ? contextOptions.filter((section) => contextKeys.includes(section.sectionKey))
          : contextOptions;
        setSuggestionScopeMode(contextScopeMode);
        if (contextScopeMode === 'selected_sections' && contextSections.length > 0) {
          setSelectedSuggestionSectionKeys(contextSections.map((section) => section.sectionKey));
        }
        // Show a toast so the user knows why the suggestions panel opened
        showToast({
          type: 'info',
          title: isSelection ? 'Selected text received' : 'Section content received',
          message: isSelection
            ? 'Analyzing your selected text for the best figure suggestions...'
            : ctx.sourceSection
              ? `Analyzing "${ctx.sourceSection}" section for figure suggestions...`
              : 'Analyzing content for figure suggestions...'
        });
        // Auto-open suggestions panel and trigger generation
        setShowSuggestions(true);
        setSuggestionsRequested(true);
        setLoadingSuggestions(true);
        const requestSections = contextScopeMode === 'full_draft'
          ? getSectionMapFromSession(session)
          : contextSections.length > 0
            ? contextSections.reduce<Record<string, string>>((acc, section) => {
                acc[section.sectionKey] = section.content;
                return acc;
              }, {})
            : (ctx.sourceSection && ctx.sourceText
                ? { [ctx.sourceSection]: ctx.sourceText.slice(0, 4000) }
                : undefined);
        // Trigger the suggest API with focus mode so suggestions
        // are constrained to the carried-over text
        fetch(`/api/papers/${sessionId}/figures/suggest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            useLLM: true,
            sections: requestSections,
            sectionScope: contextScopeMode === 'selected_sections' && contextSections.length > 0
              ? { mode: 'selected_sections', sectionKeys: contextSections.map((section) => section.sectionKey) }
              : { mode: 'full_draft' },
            preferences: { outputMix: 'balanced', detailLevel: 'moderate' },
            focusText: ctx.sourceText.slice(0, 4000),
            focusSection: ctx.sourceSection || undefined,
            focusMode: ctx.focusMode || 'selection'
          })
        })
          .then(res => res.json())
          .then(data => {
            if (data.suggestions) {
              const nextSuggestions = parseSuggestionsFromApi(data.suggestions).filter((s) => s.status !== 'dismissed');
              setSuggestions(nextSuggestions);
              setSelectedSuggestionIds(nextSuggestions.filter(s => s.status !== 'used' && s.status !== 'dismissed').map(s => s.id));
            }
          })
          .catch(err => console.error('[FigurePlanner] Cross-stage suggest error:', err))
          .finally(() => setLoadingSuggestions(false));
      }
    } catch {
      /* ignore parse/storage errors */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, authToken]);

  // Create the plan record, then immediately start generation so the primary
  // manual action is consistent across charts, plots, and diagrams.
  const handleCreate = async () => {
    if (!authToken || !title.trim()) return;
    
    const shouldAutoGenerate = true;
    const wasFromSuggestion = !!pendingSuggestionMeta;
    const originSuggestionId = pendingSuggestionId;
    setIsCreating(true);
    try {
      const initialCaption = getPaperFigureCaptionSeed({ suggestionMeta: pendingSuggestionMeta || null });
      const response = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title,
          caption: initialCaption,
          generationPrompt: description,
          figureType,
          category,
          notes: '',
          figureNo: nextFigureNo,
          status: 'PLANNED',
          suggestionMeta: pendingSuggestionMeta || undefined
        })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      const createdFigure: FigurePlan = data.figure;
      setFigures(prev => [...prev, createdFigure]);
      scrollToFiguresBottom();
      setTitle('');
      setDescription('');
      setPendingSuggestionMeta(null);
      setPendingSuggestionId(null);

      // Mark the source suggestion as used
      if (wasFromSuggestion && originSuggestionId && createdFigure?.id) {
        markSuggestionUsed(originSuggestionId, createdFigure.id);
      }

      if (shouldAutoGenerate && createdFigure?.id) {
        // Small delay so React state settles and the figure card renders
        setTimeout(() => handleGenerate(createdFigure), 100);
      }
    } catch (err) {
      console.error('Failed to create figure:', err);
      showToast({
        type: 'error',
        title: 'Failed to create figure',
        message: err instanceof Error ? err.message : 'Unexpected error'
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Generate figure
  const handleGenerate = async (figure: FigurePlan) => {
    if (!authToken) return;
    const previousStatus = figure.status;
    
    setGenerating(figure.id);
    setGenerationFeedback({
      kind: 'single',
      category: figure.category,
      title: figure.title,
      startedAt: Date.now()
    });
    setFigures(prev => prev.map(f => 
      f.id === figure.id ? { ...f, status: 'GENERATING' as const } : f
    ));

    const requestState = startCancelableRequest(`Generating "${figure.title}"`, 120000);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${figure.id}/generate`, {
        method: 'POST',
        signal: requestState.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          figureType: figure.figureType,
          category: figure.category,
          title: figure.title,
          caption: figure.caption,
          description: figure.generationPrompt || figure.notes || figure.caption,
          theme: 'academic',
          preferences: normalizePrefs(),
          suggestionMeta: figure.suggestionMeta || undefined,
          figureGenre: figure.suggestionMeta?.figureGenre || undefined,
          useLLM: true
        })
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);

      const refreshedFigures = await loadFigures();
      const refreshedFigure = refreshedFigures.find((entry) => entry.id === figure.id);
      if (refreshedFigure) {
        setPreviewFigure((prev) => (prev?.id === figure.id ? refreshedFigure : prev));
      }

      setFigures(prev => prev.map(f => 
        f.id === figure.id 
          ? { ...f, status: 'GENERATED' as const, imagePath: data.imagePath } 
          : f
      ));
      scrollToFiguresBottom();
    } catch (err) {
      if (isAbortError(err)) {
        setFigures(prev => prev.map(f => 
          f.id === figure.id ? { ...f, status: previousStatus } : f
        ));
        setPreviewFigure((prev) => prev?.id === figure.id ? { ...prev, status: previousStatus } : prev);
        showToast({
          type: requestState.timedOut ? 'warning' : 'info',
          title: requestState.timedOut ? 'Generation timed out' : 'Generation canceled',
          message: requestState.timedOut
            ? 'The request took longer than 120 seconds and was canceled.'
            : 'The generation request was canceled.'
        });
      } else {
        setFigures(prev => prev.map(f => 
          f.id === figure.id ? { ...f, status: 'FAILED' as const } : f
        ));
        showToast({
          type: 'error',
          title: 'Generation failed',
          message: err instanceof Error ? err.message : 'Unexpected error'
        });
      }
    } finally {
      finishCancelableRequest(requestState);
      setGenerating(null);
      setGenerationFeedback(null);
    }
  };

  // Delete figure
  const handleDelete = async (figureId: string) => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${figureId}`, {
        method: 'DELETE',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete figure');
      }
      setFigures(prev => prev.filter(f => f.id !== figureId));
      // Close preview if we're deleting the previewed figure
      if (previewFigure?.id === figureId) {
        setPreviewFigure(null);
        setShowModifyInput(false);
        setModificationRequest('');
      }
      // Revert the linked suggestion back to pending so the user can re-use it
      revertSuggestionOnFigureDelete(figureId);
      // Re-sync with server to avoid stale local state.
      await loadFigures();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  // Clear generated image only (reset to PLANNED)
  const handleClearImage = async (figureId: string) => {
    if (!authToken) return;
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${figureId}?imageOnly=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (response.ok && data.figure) {
        setFigures(prev => prev.map(f => 
          f.id === figureId 
            ? { ...f, status: 'PLANNED' as const, imagePath: undefined, generatedCode: undefined }
            : f
        ));
        // Update preview if we're clearing the previewed figure
        if (previewFigure?.id === figureId) {
          setPreviewFigure(prev => prev ? { ...prev, status: 'PLANNED' as const, imagePath: undefined } : null);
        }
      }
    } catch (error) {
      console.error('Failed to clear image:', error);
    }
  };

  // Get AI suggestions - called only when user explicitly clicks "Let AI Suggest"
  const handleGetSuggestions = async () => {
    if (!authToken) return;
    setLoadingSuggestions(true);
    setSuggestionsRequested(true);
    
    const requestState = startCancelableRequest('Generating AI suggestions', 180000);
    try {
      const paperSections = getSectionMapFromSession(session);
      const selectedSections = suggestionScopeMode === 'selected_sections'
        ? selectedSuggestionSectionOptions
        : suggestionSectionOptions;
      if (suggestionScopeMode === 'selected_sections' && selectedSections.length === 0) {
        showToast({
          type: 'warning',
          title: 'Choose source sections',
          message: 'Select at least one non-empty section before asking for figure suggestions.'
        });
        return;
      }
      const scopedSections = suggestionScopeMode === 'selected_sections'
        ? selectedSections.reduce<Record<string, string>>((acc, section) => {
            acc[section.sectionKey] = section.content;
            return acc;
          }, {})
        : paperSections;
      const normalizedPrefs = normalizePrefs();
      const blueprint = session?.paperBlueprint
        ? {
            thesisStatement: session.paperBlueprint.thesisStatement || '',
            centralObjective: session.paperBlueprint.centralObjective || '',
            keyContributions: session.paperBlueprint.keyContributions || [],
            sectionPlan: session.paperBlueprint.sectionPlan || []
          }
        : undefined;

      const response = await fetch(`/api/papers/${sessionId}/figures/suggest`, {
        method: 'POST',
        signal: requestState.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          paperTitle: session?.researchTopic?.title || '',
          paperAbstract: session?.researchTopic?.abstractDraft || '',
          datasetDescription: session?.researchTopic?.datasetDescription || '',
          sections: scopedSections,
          sectionScope: suggestionScopeMode === 'selected_sections'
            ? { mode: 'selected_sections', sectionKeys: selectedSections.map((section) => section.sectionKey) }
            : { mode: 'full_draft' },
          blueprint,
          preferences: normalizedPrefs,
          useLLM: true
        })
      });
      
      const data = await response.json();
      if (response.ok) {
        const nextSuggestions: FigureSuggestionItem[] = parseSuggestionsFromApi(data.suggestions || []).filter((s) => s.status !== 'dismissed');
        setSuggestions(nextSuggestions);
        // Auto-select only pending suggestions
        setSelectedSuggestionIds(nextSuggestions.filter(s => s.status !== 'used' && s.status !== 'dismissed').map((item) => item.id));
        setSectionFilter(SUGGESTION_SECTION_FILTER_ALL);
        setCategoryFilter(SUGGESTION_SECTION_FILTER_ALL);
        setImportanceFilter(SUGGESTION_SECTION_FILTER_ALL);
      } else {
        throw new Error(data.error || 'Failed to fetch suggestions');
      }
    } catch (error) {
      if (isAbortError(error)) {
        showToast({
          type: requestState.timedOut ? 'warning' : 'info',
          title: requestState.timedOut ? 'Suggestion request timed out' : 'Suggestion request canceled',
          message: requestState.timedOut
            ? 'The request took longer than 120 seconds and was canceled.'
            : 'The suggestion request was canceled.'
        });
      } else {
        console.error('Failed to get suggestions:', error);
        showToast({
          type: 'error',
          title: 'Failed to get suggestions',
          message: error instanceof Error ? error.message : 'Unexpected error'
        });
      }
    } finally {
      finishCancelableRequest(requestState);
      setLoadingSuggestions(false);
    }
  };

  // Apply suggestion – tracks the suggestion ID so we can mark it as used after figure creation
  const applySuggestion = (suggestion: FigureSuggestionItem) => {
    setTitle(suggestion.title);
    setDescription(suggestion.description);
    setFigureType(suggestion.suggestedType || 'flowchart');
    setCategory(suggestion.category || 'DIAGRAM');
    if ((suggestion.category === 'SKETCH') || (suggestion.category === 'ILLUSTRATED_FIGURE') || suggestion.suggestedType?.startsWith('sketch')) {
      setSketchStyle(resolveSketchStyleFromPreferences(normalizePrefs()));
    }
    setPendingSuggestionId(suggestion.id);
    setPendingSuggestionMeta(extractFigureSuggestionMeta(suggestion) || null);
    setShowSuggestions(false);
  };

  // Handle modification request - regenerate with user feedback
  const handleModify = async (figure: FigurePlan) => {
    if (!authToken || !modificationRequest.trim()) return;
    const previousStatus = figure.status;
    
    setIsModifying(true);
    setGenerationFeedback({
      kind: 'modify',
      category: figure.category,
      title: figure.title,
      startedAt: Date.now()
    });
    setFigures(prev => prev.map(f => 
      f.id === figure.id ? { ...f, status: 'GENERATING' as const } : f
    ));

    const requestState = startCancelableRequest(`Applying changes to "${figure.title}"`, 120000);
    try {
      let response: Response;
      
      // Check if this is a sketch - use sketch endpoint
      const isSketch = figure.category === 'SKETCH' || figure.category === 'ILLUSTRATED_FIGURE' || figure.figureType?.startsWith('sketch-');
      
      if (isSketch) {
        // Use sketch modification endpoint
        response = await fetch(`/api/papers/${sessionId}/figures/${figure.id}/sketch`, {
          method: 'PATCH',
          signal: requestState.controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            modificationRequest: modificationRequest
          })
        });
      } else {
        // Use regular generate endpoint for charts/diagrams
        const enhancedDescription = `
Original request: ${figure.generationPrompt || figure.notes || figure.caption || figure.title}

User modification request: ${modificationRequest}

Please regenerate the figure incorporating the user's feedback and corrections.
`.trim();

        response = await fetch(`/api/papers/${sessionId}/figures/${figure.id}/generate`, {
          method: 'POST',
          signal: requestState.controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            figureType: figure.figureType,
            category: figure.category,
            title: figure.title,
            caption: figure.caption,
            description: enhancedDescription,
            modificationRequest: modificationRequest,
            theme: 'academic',
            preferences: normalizePrefs(),
            suggestionMeta: figure.suggestionMeta || undefined,
            useLLM: true
          })
        });
      }

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);

      const refreshedFigures = await loadFigures();
      const refreshedFigure = refreshedFigures.find((entry) => entry.id === figure.id);
      if (refreshedFigure) {
        setPreviewFigure((prev) => (prev?.id === figure.id ? refreshedFigure : prev));
      }

      setFigures(prev => prev.map(f => 
        f.id === figure.id 
          ? { ...f, status: 'GENERATED' as const, imagePath: data.imagePath } 
          : f
      ));
      
      // Update preview with new image
      setPreviewFigure(prev => prev?.id === figure.id 
        ? { ...prev, status: 'GENERATED' as const, imagePath: data.imagePath }
        : prev
      );
      scrollToFiguresBottom();
      
      // Clear modification input
      setModificationRequest('');
      setShowModifyInput(false);
    } catch (err) {
      if (isAbortError(err)) {
        setFigures(prev => prev.map(f => 
          f.id === figure.id ? { ...f, status: previousStatus } : f
        ));
        setPreviewFigure(prev => prev?.id === figure.id ? { ...prev, status: previousStatus } : prev);
        showToast({
          type: requestState.timedOut ? 'warning' : 'info',
          title: requestState.timedOut ? 'Modification timed out' : 'Modification canceled',
          message: requestState.timedOut
            ? 'The request took longer than 120 seconds and was canceled.'
            : 'The modification request was canceled.'
        });
      } else {
        console.error('Modification failed:', err);
        setFigures(prev => prev.map(f => 
          f.id === figure.id ? { ...f, status: 'FAILED' as const } : f
        ));
        showToast({
          type: 'error',
          title: 'Modification failed',
          message: err instanceof Error ? err.message : 'Unexpected error'
        });
      }
    } finally {
      finishCancelableRequest(requestState);
      setIsModifying(false);
      setGenerationFeedback(null);
    }
  };

  const handleSaveCaption = async () => {
    if (!authToken || !previewFigure) return;
    const nextCaption = editingCaption.trim();
    if (!nextCaption || nextCaption === previewFigure.caption) return;

    setIsSavingCaption(true);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/${previewFigure.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ caption: nextCaption })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update caption');
      }

      const updatedFigure = data.figure as FigurePlan | undefined;
      if (updatedFigure) {
        setFigures((prev) => prev.map((figure) => (
          figure.id === updatedFigure.id ? { ...figure, ...updatedFigure } : figure
        )));
        setPreviewFigure(updatedFigure);
        setEditingCaption(updatedFigure.caption || nextCaption);
      } else {
        const refreshedFigures = await loadFigures();
        const refreshedFigure = refreshedFigures.find((figure) => figure.id === previewFigure.id);
        if (refreshedFigure) {
          setPreviewFigure(refreshedFigure);
          setEditingCaption(refreshedFigure.caption || nextCaption);
        }
      }

      showToast({
        type: 'success',
        title: 'Caption updated',
        message: 'The figure caption was saved.'
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Caption update failed',
        message: error instanceof Error ? error.message : 'Unexpected error'
      });
    } finally {
      setIsSavingCaption(false);
    }
  };

  // Handle type selection
  const selectType = (option: typeof FIGURE_OPTIONS[number]) => {
    setFigureType(option.value);
    setCategory(option.category as FigureCategory);
    setShowTypeDropdown(false);

    if (option.genre) {
      setPendingSuggestionMeta({
        figureGenre: option.genre,
        sketchMode: 'GUIDED',
        sketchStyle: sketchStyle,
      });
    } else {
      setPendingSuggestionMeta(null);
    }

    if (!option.value.startsWith('sketch-')) {
      setSketchUploadFile(null);
      setSketchUploadPreview(null);
    }
  };

  // Handle sketch file upload
  const handleSketchFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSketchUploadFile(file);
      const reader = new FileReader();
      reader.onload = () => setSketchUploadPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Generate sketch using AI
  const handleGenerateSketch = async () => {
    if (!authToken || !title.trim()) return;
    
    // Resolve sketch mode: ILLUSTRATED_FIGURE genres always use GUIDED,
    // free-form sketches derive from the figureType suffix (auto/guided/refine).
    const isIllustratedFigure = category === 'ILLUSTRATED_FIGURE';
    const sketchMode = isIllustratedFigure
      ? 'GUIDED'
      : figureType.replace('sketch-', '').toUpperCase();
    
    if (sketchMode === 'GUIDED' && !isIllustratedFigure && (!description || description.length < 10)) {
      alert('Please provide at least 10 characters of instructions for guided mode');
      return;
    }
    
    if (sketchMode === 'REFINE' && !sketchUploadFile) {
      alert('Please upload an image to refine');
      return;
    }

    setIsGeneratingSketch(true);
    setGenerationFeedback({
      kind: 'sketch',
      category,
      title,
      startedAt: Date.now()
    });
    
    try {
      const selectedOption = FIGURE_OPTIONS.find(o => o.value === figureType);
      const genre = selectedOption?.genre || pendingSuggestionMeta?.figureGenre || undefined;

      const body: any = {
        mode: sketchMode,
        title,
        userPrompt: description,
        style: sketchStyle,
        ...(genre && { figureGenre: genre }),
        ...(pendingSuggestionMeta && { suggestionMeta: pendingSuggestionMeta }),
      };
      
      // Add uploaded image for REFINE mode
      if (sketchMode === 'REFINE' && sketchUploadFile && sketchUploadPreview) {
        const base64 = sketchUploadPreview.split(',')[1];
        body.uploadedImageBase64 = base64;
        body.uploadedImageMimeType = sketchUploadFile.type || 'image/png';
      }

      const response = await fetch(`/api/papers/${sessionId}/figures/new/sketch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);

      // Reload figures to get the new sketch
      await loadFigures();
      scrollToFiguresBottom();

      // Mark the source suggestion as used if applicable
      if (pendingSuggestionId && data.figureId) {
        markSuggestionUsed(pendingSuggestionId, data.figureId);
      }
      
      // Clear form
      setTitle('');
      setDescription('');
      setPendingSuggestionMeta(null);
      setPendingSuggestionId(null);
      setSketchUploadFile(null);
      setSketchUploadPreview(null);
      
    } catch (err: any) {
      console.error('Sketch generation failed:', err);
      alert(`Failed to generate sketch: ${err.message}`);
    } finally {
      setIsGeneratingSketch(false);
      setGenerationFeedback(null);
    }
  };

  const toggleSuggestionSelection = (suggestion: FigureSuggestionItem) => {
    if (suggestion.status === 'used' || suggestion.status === 'dismissed') return;
    const suggestionId = suggestion.id;
    setSelectedSuggestionIds((prev) => (
      prev.includes(suggestionId)
        ? prev.filter((id) => id !== suggestionId)
        : [...prev, suggestionId]
    ));
  };

  const toggleSelectAllFiltered = () => {
    // Exclude already-used suggestions from select-all toggle
    const selectableIds = filteredSuggestions
      .filter(s => s.status !== 'used' && s.status !== 'dismissed')
      .map((item) => item.id);
    const selected = new Set(selectedSuggestionIds);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

    if (allSelected) {
      setSelectedSuggestionIds((prev) => prev.filter((id) => !selectableIds.includes(id)));
      return;
    }

    setSelectedSuggestionIds((prev) => Array.from(new Set([...prev, ...selectableIds])));
  };

  const handleGenerateAll = async () => {
    if (!authToken || isGeneratingBatch) return;
    const pending = figures.filter((f) => f.status === 'PLANNED' || f.status === 'FAILED');
    if (pending.length === 0) return;

    setIsGeneratingBatch(true);
    setGenerationFeedback({
      kind: 'batch',
      count: pending.length,
      startedAt: Date.now()
    });
    const requestState = startCancelableRequest(`Generating ${pending.length} figures`, 180000);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/batch`, {
        method: 'POST',
        signal: requestState.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          mode: 'generateExisting',
          figureIds: pending.map((figure) => figure.id),
          preferences: normalizePrefs(),
          useLLM: true,
          continueOnError: true
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Batch generation failed');
      }

      await loadFigures();
      scrollToFiguresBottom();
      const results = Array.isArray(data.results) ? data.results : [];
      const generated = Number(data.generated || results.filter((entry: any) => entry?.success === true).length);
      const failed = Number(data.failed || results.filter((entry: any) => entry?.success === false).length);
      if (failed > 0) {
        showToast({
          type: 'warning',
          title: `Generated ${generated}/${generated + failed} figures`,
          message: getBatchFailureMessage(results)
        });
      } else {
        showToast({
          type: 'success',
          title: `Generated ${generated} figure${generated === 1 ? '' : 's'}`,
          message: 'Batch generation completed successfully.'
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        showToast({
          type: requestState.timedOut ? 'warning' : 'info',
          title: requestState.timedOut ? 'Batch generation timed out' : 'Batch generation canceled',
          message: requestState.timedOut
            ? 'The batch request took longer than 180 seconds and was canceled.'
            : 'The batch request was canceled.'
        });
      } else {
        console.error('Batch generation failed:', error);
        showToast({
          type: 'error',
          title: 'Batch generation failed',
          message: error instanceof Error ? error.message : 'Unexpected error'
        });
      }
    } finally {
      finishCancelableRequest(requestState);
      setIsGeneratingBatch(false);
      setGenerationFeedback(null);
    }
  };

  const handleCreateAndGenerateFromSuggestions = async () => {
    if (!authToken || isApplyingSuggestionBatch) return;
    if (selectedSuggestions.length === 0) return;

    setIsApplyingSuggestionBatch(true);
    setGenerationFeedback({
      kind: 'batch',
      count: selectedSuggestions.length,
      startedAt: Date.now()
    });
    const requestState = startCancelableRequest(`Creating and generating ${selectedSuggestions.length} suggestions`, 180000);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/batch`, {
        method: 'POST',
        signal: requestState.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          mode: 'createAndGenerateFromSuggestions',
          suggestions: selectedSuggestions.map((item) => ({
            title: item.title,
            description: item.description,
            category: item.category,
            suggestedType: item.suggestedType,
            ...extractFigureSuggestionMeta(item)
          })),
          preferences: normalizePrefs(),
          useLLM: true,
          continueOnError: true
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate selected suggestions');
      }

      await loadFigures();
      scrollToFiguresBottom();
      const results = Array.isArray(data.results) ? data.results : [];
      const generated = Number(data.generated || results.filter((entry: any) => entry?.success === true).length);
      const failed = Number(data.failed || results.filter((entry: any) => entry?.success === false).length);

      // Mark all batch-processed suggestions as used, linking them to created figures
      const batchUsedEntries: Array<{ suggestionTitle: string; figureId: string }> = results
        .filter((r: any) => r?.figureId && r?.title)
        .map((r: any) => ({ suggestionTitle: r.title, figureId: r.figureId }));
      if (batchUsedEntries.length > 0) {
        markSuggestionsUsedBatch(batchUsedEntries);
      }

      if (failed > 0) {
        showToast({
          type: 'warning',
          title: `Generated ${generated}/${generated + failed} figures`,
          message: getBatchFailureMessage(results)
        });
      } else {
        showToast({
          type: 'success',
          title: `Generated ${generated} figure${generated === 1 ? '' : 's'}`,
          message: 'All selected suggestions were generated.'
        });
      }
      setShowSuggestions(false);
    } catch (error) {
      if (isAbortError(error)) {
        showToast({
          type: requestState.timedOut ? 'warning' : 'info',
          title: requestState.timedOut ? 'Suggestion batch timed out' : 'Suggestion batch canceled',
          message: requestState.timedOut
            ? 'The batch request took longer than 180 seconds and was canceled.'
            : 'The batch request was canceled.'
        });
      } else {
        console.error('Suggestion batch failed:', error);
        showToast({
          type: 'error',
          title: 'Suggestion batch failed',
          message: error instanceof Error ? error.message : 'Unexpected error'
        });
      }
    } finally {
      finishCancelableRequest(requestState);
      setIsApplyingSuggestionBatch(false);
      setGenerationFeedback(null);
    }
  };

  const plannedFigures = figures.filter(f => f.status === 'PLANNED' || f.status === 'FAILED');
  const generatedFigures = figures.filter(f => f.status === 'GENERATED');

  return (
    <div className="min-h-[600px] bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Clean Header */}
      <div className="px-6 py-8 border-b border-slate-100">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                Figures
              </h1>
              <p className="text-slate-500 mt-1">
                Create beautiful charts and diagrams for your paper
              </p>
            </div>

            {/* AI Suggestions Button - opens the dialog for user to configure preferences first */}
            <Button 
              variant="outline" 
              onClick={() => setShowSuggestions(true)}
              className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300"
            >
              <Sparkles className="w-4 h-4" />
              Suggest Figures/Charts From My Data
            </Button>
          </div>
          
          {/* Stats Row */}
          <div className="flex gap-6 mt-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-sm text-slate-600">{plannedFigures.length} planned</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm text-slate-600">{generatedFigures.length} generated</span>
            </div>
          </div>
          {activeRequest && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span className="text-sm text-amber-800">{activeRequest.label}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelActiveRequest}
                className="border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Create New Figure - Clean Card */}
        <div className="relative mb-8 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-30px_rgba(15,23,42,0.38)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.12),_transparent_42%)]" />
          <div className="relative p-6 md:p-7">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-cyan-400 shadow-lg shadow-blue-500/20 ring-1 ring-white/60">
                  <Plus className="h-5 w-5 text-white" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">New Figure</h2>
                    <Badge className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700 hover:bg-blue-50">
                      LLM-guided
                    </Badge>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600">
                    Pick a visual format, describe the insight you want, and the system will generate the appropriate chart, plot, diagram, or sketch.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
                <Badge className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-white">
                  Raw data friendly
                </Badge>
                <Badge className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-white">
                  Charts to sketches
                </Badge>
                <Badge className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-white">
                  Single-step generation
                </Badge>
              </div>
            </div>

            <div className="space-y-4">
              {/* Type Selector */}
              <div className="relative">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Visual Format</p>
                    <p className="mt-1 text-xs text-slate-500">Browse charts, plots, diagrams, illustrations, and sketches in one place.</p>
                  </div>
                  <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 md:block">
                    Scroll to explore all options
                  </div>
                </div>
                <button
                  onClick={() => setShowTypeDropdown(!showTypeDropdown)}
                  className="group w-full rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-4">
                    {selectedType && (
                      <>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${CATEGORY_COLORS[category]} shadow-sm`}>
                            <selectedType.icon className="h-4 w-4 text-white" />
                          </div>
                          <div className="text-left">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-800">{selectedType.label}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-500">
                                {selectedType.example}
                              </span>
                              <span className="hidden rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:inline-flex">
                                {category.replace('_', ' ')}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">{selectedType.desc}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-slate-600 ${showTypeDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {showTypeDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl md:left-1/2 md:right-auto md:w-[min(52rem,calc(100vw-3rem))] md:-translate-x-1/2"
                    >
                      {/* Scrollable dropdown container — increased height to prevent cutoff */}
                      <div className="border-b border-slate-200/80 bg-slate-50/90 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Choose a figure style</p>
                            <p className="text-xs text-slate-500">The planner will route your request to the right renderer automatically.</p>
                          </div>
                          <Badge className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-white">
                            {FIGURE_OPTIONS.length} options
                          </Badge>
                        </div>
                      </div>
                      <div className="max-h-[32rem] overflow-y-auto overscroll-contain pr-1">
                        {/* Data Charts Section */}
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Charts</span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'DATA_CHART').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 border-b border-slate-50 px-5 py-3 hover:bg-sky-50 transition-colors ${figureType === option.value ? 'bg-sky-50' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-sky-600 shrink-0" />
                            )}
                          </button>
                        ))}

                        {/* Statistical Plots Section */}
                        <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100 sticky top-0 z-10">
                          <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Statistical Plots</span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'STATISTICAL_PLOT').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 border-b border-slate-50 px-5 py-3 hover:bg-emerald-50 transition-colors ${figureType === option.value ? 'bg-emerald-50' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                            )}
                          </button>
                        ))}

                        {/* Diagrams Section */}
                        <div className="px-3 py-2 bg-violet-50 border-b border-violet-100 sticky top-0 z-10">
                          <span className="text-xs font-semibold text-violet-600 uppercase tracking-wider">Diagrams</span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'DIAGRAM').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 border-b border-slate-50 px-5 py-3 hover:bg-violet-50 transition-colors ${figureType === option.value ? 'bg-violet-50' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-violet-600 shrink-0" />
                            )}
                          </button>
                        ))}

                        {/* Scientific Illustrations Section (AI-generated) */}
                        <div className="px-3 py-2 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 sticky top-0 z-10">
                          <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider flex items-center gap-1">
                            <Brain className="w-3 h-3" /> Scientific Illustrations
                          </span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'ILLUSTRATED_FIGURE').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 border-b border-slate-50 px-5 py-3 hover:bg-orange-50 transition-colors ${figureType === option.value ? 'bg-orange-50' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-orange-600 shrink-0" />
                            )}
                          </button>
                        ))}

                        {/* Free-form AI Sketches Section */}
                        <div className="px-3 py-2 bg-gradient-to-r from-rose-50 to-pink-50 border-b border-rose-100 sticky top-0 z-10">
                          <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Free-form AI Sketches
                          </span>
                        </div>
                        {FIGURE_OPTIONS.filter(o => o.category === 'SKETCH').map((option) => (
                          <button
                            key={option.value}
                            onClick={() => selectType(option)}
                            className={`w-full flex items-center gap-3 border-b border-slate-50 px-5 py-3 hover:bg-rose-50 transition-colors ${figureType === option.value ? 'bg-rose-50' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLORS[option.category as FigureCategory]} flex items-center justify-center shrink-0`}>
                              <option.icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-slate-800">{option.label}</span>
                                <span className="text-slate-400 text-xs font-mono">{option.example}</span>
                              </div>
                              <span className="text-xs text-slate-500">{option.desc}</span>
                            </div>
                            {figureType === option.value && (
                              <Check className="w-4 h-4 text-rose-600 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Figure Title</label>
                  <span className="text-[11px] text-slate-400">Keeps the output focused</span>
                </div>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={(figureType.startsWith('sketch-') || category === 'ILLUSTRATED_FIGURE')
                    ? "Illustration title (e.g., System Architecture Overview)" 
                    : "Figure title (e.g., Performance Comparison)"}
                  className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm focus:border-blue-400 focus:ring-blue-400"
                />
              </div>

              {/* Description */}
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Prompt / Brief</label>
                    <p className="mt-1 text-xs text-slate-500">Tell the model what insight matters, what data exists, and any visual constraints.</p>
                  </div>
                  <div className="hidden rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 md:block">
                    Intelligent routing enabled
                  </div>
                </div>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={
                    figureType === 'sketch-auto' 
                      ? "Optional: Add any specific details you want AI to focus on..."
                      : figureType === 'sketch-guided'
                      ? "Describe in detail what you want AI to illustrate (minimum 10 characters)..."
                      : figureType === 'sketch-refine'
                      ? "Describe how you want AI to refine/improve your uploaded image..."
                      : category === 'ILLUSTRATED_FIGURE'
                      ? "Describe the scientific concept, process, or architecture you want illustrated..."
                      : "Describe what you want to show... (AI will generate the figure based on this)"
                  }
                  rows={4}
                  className="resize-none rounded-2xl border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-400"
                />
              </div>
              {(category === 'DATA_CHART' || category === 'STATISTICAL_PLOT' || figureType === 'scatter') && (
                <p className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-blue-700">
                  Paste explicit CSV, TSV, or simple <code>label, value</code> / <code>x, y</code> rows here.
                  Free-form numeric prose is not used for chart rendering because it can produce incomplete or incorrect plots.
                </p>
              )}

              {/* Sketch-Specific Options (also for Scientific Illustration genres) */}
              {(figureType.startsWith('sketch-') || category === 'ILLUSTRATED_FIGURE') && (
                <div className={`space-y-4 p-4 rounded-xl border ${
                  category === 'ILLUSTRATED_FIGURE'
                    ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-100'
                    : 'bg-gradient-to-r from-rose-50 to-pink-50 border-rose-100'
                }`}>
                  <div className={`flex items-center gap-2 ${category === 'ILLUSTRATED_FIGURE' ? 'text-orange-700' : 'text-rose-700'}`}>
                    <Sparkles className="w-4 h-4" />
                    <span className="font-medium text-sm">
                      {category === 'ILLUSTRATED_FIGURE' ? 'AI Scientific Illustration Options' : 'AI Sketch Options'}
                    </span>
                  </div>
                  
                  {/* Style Selector */}
                  <div>
                    <label className="text-sm text-slate-600 mb-2 block">Illustration Style</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {(['academic', 'scientific', 'conceptual', 'technical'] as const).map(style => (
                        <button
                          key={style}
                          onClick={() => setSketchStyle(style)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                            sketchStyle === style 
                              ? 'bg-rose-600 text-white shadow-md' 
                              : 'bg-white text-slate-600 hover:bg-rose-100 border border-slate-200'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* File Upload for Refine Mode */}
                  {figureType === 'sketch-refine' && (
                    <div>
                      <label className="text-sm text-slate-600 mb-2 block">Upload Image to Refine</label>
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSketchFileUpload}
                          className="hidden"
                          id="sketch-file-upload"
                        />
                        <label
                          htmlFor="sketch-file-upload"
                          className={`flex items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                            sketchUploadFile 
                              ? 'border-rose-300 bg-rose-50' 
                              : 'border-slate-300 hover:border-rose-400 hover:bg-rose-50'
                          }`}
                        >
                          {sketchUploadPreview ? (
                            <div className="flex items-center gap-4">
                              <img 
                                src={sketchUploadPreview} 
                                alt="Preview" 
                                className="w-16 h-16 object-cover rounded-lg shadow-md"
                              />
                              <div className="text-left">
                                <p className="font-medium text-slate-800">{sketchUploadFile?.name}</p>
                                <p className="text-sm text-slate-500">Click to change</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              <Upload className="w-6 h-6 text-slate-400" />
                              <div className="text-center">
                                <p className="font-medium text-slate-600">Upload your sketch</p>
                                <p className="text-sm text-slate-400">Hand-drawn, rough sketch, or existing image</p>
                              </div>
                            </>
                          )}
                        </label>
                      </div>
                    </div>
                  )}
                  
                  {/* Mode-specific hints */}
                  <div className="flex items-start gap-2 text-xs text-rose-600 bg-white p-3 rounded-lg">
                    <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {figureType === 'sketch-auto' && "AI will analyze your paper content and generate a relevant illustration automatically."}
                      {figureType === 'sketch-guided' && "Provide detailed instructions for exactly what you want AI to illustrate."}
                      {figureType === 'sketch-refine' && "Upload a rough sketch or existing image, and AI will refine it for academic use."}
                    </span>
                  </div>
                </div>
              )}

              {/* Primary action */}
              {(figureType.startsWith('sketch-') || category === 'ILLUSTRATED_FIGURE') ? (
                <Button 
                  onClick={handleGenerateSketch}
                  disabled={isGeneratingSketch || !title.trim() || (figureType === 'sketch-refine' && !sketchUploadFile)}
                  className={`w-full h-12 rounded-xl text-white font-medium shadow-lg ${
                    category === 'ILLUSTRATED_FIGURE'
                      ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 shadow-orange-500/25'
                      : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 shadow-rose-500/25'
                  }`}
                >
                  {isGeneratingSketch ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      {category === 'ILLUSTRATED_FIGURE' ? 'Generating Illustration...' : 'Generating Sketch...'}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      {category === 'ILLUSTRATED_FIGURE' ? 'Generate Scientific Illustration' : 'Generate AI Sketch'}
                    </>
                  )}
                </Button>
              ) : (
                <Button 
                  onClick={handleCreate}
                  disabled={isCreating || !title.trim()}
                  className={`w-full h-12 rounded-xl text-white font-medium shadow-lg ${
                    pendingSuggestionMeta
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-amber-500/25'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/25'
                  }`}
                >
                  {isCreating ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : pendingSuggestionMeta ? (
                    <>
                      <Zap className="w-5 h-5 mr-2" />
                      Generate Figure/Plot
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 mr-2" />
                      Generate Figure/Plot
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {generationFeedback && activeGenerationMessage && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50 via-white to-indigo-50 p-4 shadow-sm"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{getGenerationHeading(generationFeedback)}</p>
                    <Badge className="border-blue-200 bg-blue-100 text-blue-700 hover:bg-blue-100">
                      Backend active
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{activeGenerationMessage}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    The request is still running on the backend. You can stay on this page while the figure is being prepared.
                  </p>
                  {generationMessages.length > 1 && (
                    <div className="mt-3 flex items-center gap-1.5">
                      {generationMessages.map((_, index) => (
                        <span
                          key={`${generationFeedback.kind}-${index}`}
                          className={`h-1.5 rounded-full transition-all ${
                            index === generationMessageIndex % generationMessages.length
                              ? 'w-5 bg-blue-600'
                              : 'w-1.5 bg-blue-200'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Figures List */}
        {figures.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-medium text-slate-700 px-1">Your Figures</h3>
            
            <div className="space-y-3">
              <AnimatePresence>
                {figures.map((figure) => {
                  const typeInfo = FIGURE_OPTIONS.find(t => t.value === figure.figureType);
                  const Icon = typeInfo?.icon || ImageIcon;
                  const isGenerating = generating === figure.id;
                  
                  return (
                    <motion.div
                      key={figure.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-stretch">
                        {/* Thumbnail - clickable for any non-generating figure */}
                        <div 
                          className={`w-24 h-24 bg-slate-100 flex items-center justify-center shrink-0 ${
                            figure.status !== 'GENERATING' ? 'cursor-pointer hover:bg-slate-200 transition-colors' : ''
                          }`}
                          onClick={() => figure.status !== 'GENERATING' && setPreviewFigure(figure)}
                        >
                          {figure.status === 'GENERATING' ? (
                            <div className="flex flex-col items-center gap-1">
                              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                              <span className="text-[10px] text-slate-400">Generating</span>
                            </div>
                          ) : figure.imagePath ? (
                            <img 
                              src={figure.imagePath} 
                              alt={figure.title}
                              className="w-full h-full object-cover"
                            />
                          ) : figure.status === 'FAILED' ? (
                            <div className="flex flex-col items-center gap-1">
                              <X className="w-6 h-6 text-red-400" />
                              <span className="text-[10px] text-red-400">Failed</span>
                            </div>
                          ) : (
                            <Icon className="w-8 h-8 text-slate-300" />
                          )}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 p-4 flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-400">Fig. {figure.figureNo}</span>
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                figure.status === 'GENERATED' ? 'bg-emerald-500' :
                                figure.status === 'GENERATING' ? 'bg-blue-500 animate-pulse' :
                                figure.status === 'FAILED' ? 'bg-red-500' :
                                'bg-slate-300'
                              }`} />
                            </div>
                            <h4 className="font-medium text-slate-900 truncate">{figure.title}</h4>
                            <p className="text-sm text-slate-500 truncate">{figure.caption}</p>
                            {isGenerating && activeGenerationMessage && (
                              <p className="mt-1 max-w-xl text-xs text-blue-600">
                                {activeGenerationMessage}
                              </p>
                            )}
                          </div>
                          
                          {/* Actions - always visible for every status */}
                          <div className="flex items-center gap-1 ml-4">
                            {/* Generate / Regenerate / Retry - always available */}
                            {figure.status === 'PLANNED' ? (
                              <Button
                                size="sm"
                                onClick={() => handleGenerate(figure)}
                                disabled={isGenerating}
                                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                Generate
                              </Button>
                            ) : figure.status === 'FAILED' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleGenerate(figure)}
                                disabled={isGenerating}
                                className="rounded-lg text-red-600 border-red-200 hover:bg-red-50 gap-1"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Retry
                              </Button>
                            ) : figure.status === 'GENERATING' ? null : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleGenerate(figure)}
                                disabled={isGenerating}
                                className="rounded-lg"
                                title="Regenerate"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </Button>
                            )}

                            {/* View - available when image exists (GENERATED or FAILED with partial image) */}
                            {figure.imagePath && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPreviewFigure(figure)}
                                className="rounded-lg"
                                title="View figure"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}

                            {/* Modify - available for GENERATED and FAILED (opens preview with modify input) */}
                            {(figure.status === 'GENERATED' || figure.status === 'FAILED') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setPreviewFigure(figure);
                                  setShowModifyInput(true);
                                }}
                                className="rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                title="Request modifications and regenerate"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            )}

                            {/* Download - direct download when image exists */}
                            {figure.imagePath && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = figure.imagePath!;
                                  link.download = `figure-${figure.figureNo}-${figure.title.replace(/\s+/g, '-').toLowerCase()}.png`;
                                  link.click();
                                }}
                                className="rounded-lg text-slate-500 hover:text-slate-700"
                                title="Download image"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            )}

                            {/* Clear Image - available when image exists */}
                            {figure.imagePath && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClearImage(figure.id)}
                                className="rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                title="Remove generated image (keep plan)"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}

                            {/* Delete figure - always available */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(figure.id)}
                              className="rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Delete figure"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={figureListEndRef} className="h-px" />
            </div>
            
            {/* Generate All Button */}
            {plannedFigures.length > 1 && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={handleGenerateAll}
                  disabled={!!generating || isGeneratingBatch}
                  className="rounded-xl gap-2"
                >
                  {isGeneratingBatch ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  Generate All ({plannedFigures.length})
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {figures.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <ImageIcon className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">No figures yet</h3>
            <p className="text-slate-500 mt-1">Create your first figure above or get AI suggestions</p>
          </div>
        )}
        <div ref={figures.length === 0 ? figureListEndRef : undefined} className="h-px" />
      </div>

      {/* AI Suggestions Dialog */}
      <Dialog open={showSuggestions} onOpenChange={setShowSuggestions}>
        <DialogContent className="max-w-5xl bg-white border-0 shadow-2xl rounded-2xl">
          <DialogHeader className="pb-4 border-b border-slate-100">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Suggest Figures and Charts From Your Data
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 max-h-[75vh] overflow-y-auto space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">Preference Profile</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGetSuggestions}
                  disabled={loadingSuggestions}
                  className="gap-2"
                >
                  {loadingSuggestions ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {suggestionsRequested ? 'Refresh Suggestions' : 'Let AI Suggest'}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div className="relative text-xs text-slate-600 space-y-1">
                  <span className="block">Source sections</span>
                  <button
                    type="button"
                    onClick={() => setShowSectionScopeDropdown((open) => !open)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{suggestionScopeLabel}</span>
                    <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  </button>
                  {showSectionScopeDropdown && (
                    <div className="absolute z-40 mt-1 w-full min-w-[260px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                      <div className="grid grid-cols-2 gap-1 mb-2">
                        <button
                          type="button"
                          onClick={() => setSuggestionScopeMode('selected_sections')}
                          className={`rounded-lg px-2 py-1.5 text-xs font-medium ${suggestionScopeMode === 'selected_sections' ? 'bg-amber-100 text-amber-800' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          Selected
                        </button>
                        <button
                          type="button"
                          onClick={() => setSuggestionScopeMode('full_draft')}
                          className={`rounded-lg px-2 py-1.5 text-xs font-medium ${suggestionScopeMode === 'full_draft' ? 'bg-amber-100 text-amber-800' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          Full draft
                        </button>
                      </div>
                      {suggestionScopeMode === 'selected_sections' && (
                        <div className="max-h-56 overflow-y-auto space-y-1">
                          {suggestionSectionOptions.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-slate-500">No non-empty draft sections found.</p>
                          ) : (
                            suggestionSectionOptions.map((section) => {
                              const checked = selectedSuggestionSectionSet.has(section.sectionKey);
                              return (
                                <button
                                  key={section.sectionKey}
                                  type="button"
                                  onClick={() => toggleSuggestionSectionKey(section.sectionKey)}
                                  className="w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50 flex items-start gap-2"
                                >
                                  <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 text-transparent'}`}>
                                    <Check className="w-3 h-3" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-xs font-medium text-slate-700">{section.label}</span>
                                    <span className="block text-[10px] text-slate-400">{section.wordCount} words</span>
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Style preset</span>
                  <select
                    value={suggestionPreferences.stylePreset}
                    onChange={(e) => updatePreference('stylePreset', e.target.value as FigureSuggestionPreferences['stylePreset'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.stylePreset.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Output mix</span>
                  <select
                    value={suggestionPreferences.outputMix}
                    onChange={(e) => updatePreference('outputMix', e.target.value as FigureSuggestionPreferences['outputMix'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.outputMix.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Chart preference</span>
                  <select
                    value={suggestionPreferences.chartPreference}
                    onChange={(e) => updatePreference('chartPreference', e.target.value as FigureSuggestionPreferences['chartPreference'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.chartPreference.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Diagram preference</span>
                  <select
                    value={suggestionPreferences.diagramPreference}
                    onChange={(e) => updatePreference('diagramPreference', e.target.value as FigureSuggestionPreferences['diagramPreference'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.diagramPreference.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Visual tone</span>
                  <select
                    value={suggestionPreferences.visualTone}
                    onChange={(e) => updatePreference('visualTone', e.target.value as FigureSuggestionPreferences['visualTone'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.visualTone.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Color mode</span>
                  <select
                    value={suggestionPreferences.colorMode}
                    onChange={(e) => updatePreference('colorMode', e.target.value as FigureSuggestionPreferences['colorMode'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.colorMode.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Detail level</span>
                  <select
                    value={suggestionPreferences.detailLevel}
                    onChange={(e) => updatePreference('detailLevel', e.target.value as FigureSuggestionPreferences['detailLevel'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.detailLevel.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Annotation density</span>
                  <select
                    value={suggestionPreferences.annotationDensity}
                    onChange={(e) => updatePreference('annotationDensity', e.target.value as FigureSuggestionPreferences['annotationDensity'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.annotationDensity.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Target audience</span>
                  <select
                    value={suggestionPreferences.targetAudience}
                    onChange={(e) => updatePreference('targetAudience', e.target.value as FigureSuggestionPreferences['targetAudience'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.targetAudience.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span className="block">Strictness</span>
                  <select
                    value={suggestionPreferences.strictness}
                    onChange={(e) => updatePreference('strictness', e.target.value as FigureSuggestionPreferences['strictness'])}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {PREFERENCE_OPTIONS.strictness.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              {/* Before user triggers AI - show call-to-action */}
              {!suggestionsRequested && !loadingSuggestions ? (
                <div className="py-12 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center mx-auto">
                    <Lightbulb className="w-8 h-8 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-slate-700 font-medium text-base">Ready to Analyze Your Paper</p>
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                      Configure your preferences above, then click &ldquo;Let AI Suggest&rdquo; to analyze your paper content and recommend relevant figures and charts.
                    </p>
                    <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
                      Or use the &ldquo;New Figure&rdquo; form below the dialog to create figures manually with full control.
                    </p>
                  </div>
                  <Button
                    onClick={handleGetSuggestions}
                    className="gap-2 bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 text-base rounded-xl shadow-lg shadow-amber-500/25"
                  >
                    <Sparkles className="w-5 h-5" />
                    Let AI Suggest
                  </Button>
                </div>
              ) : (
                <>
                  {/* Filters - only visible once suggestions have been requested */}
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <label className="text-xs text-slate-600">
                      <span className="block mb-1">Section filter</span>
                      <select
                        value={sectionFilter}
                        onChange={(e) => setSectionFilter(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value={SUGGESTION_SECTION_FILTER_ALL}>All sections</option>
                        {suggestionSections.map((section) => (
                          <option key={section} value={section}>{section}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      <span className="block mb-1">Category filter</span>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value={SUGGESTION_SECTION_FILTER_ALL}>All categories</option>
                        {Object.keys(CATEGORY_COLORS).map((value) => (
                          <option key={value} value={value}>{value.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      <span className="block mb-1">Importance filter</span>
                      <select
                        value={importanceFilter}
                        onChange={(e) => setImportanceFilter(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value={SUGGESTION_SECTION_FILTER_ALL}>All priorities</option>
                        <option value="required">Required</option>
                        <option value="recommended">Recommended</option>
                        <option value="optional">Optional</option>
                      </select>
                    </label>
                    <Button size="sm" variant="outline" onClick={toggleSelectAllFiltered} className="mt-5">
                      {filteredSuggestions.filter(s => s.status !== 'used' && s.status !== 'dismissed').length > 0 &&
                      filteredSuggestions.filter(s => s.status !== 'used' && s.status !== 'dismissed').every((item) => selectedSuggestionIds.includes(item.id))
                        ? 'Deselect filtered'
                        : 'Select pending'}
                    </Button>
                  </div>

                  {loadingSuggestions ? (
                    <div className="py-12 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-3" />
                      <p className="text-slate-600">Analyzing your paper and blueprint context...</p>
                    </div>
                  ) : filteredSuggestions.length === 0 ? (
                    <div className="py-12 text-center">
                      <FileImage className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-600">No suggestions for current filter set</p>
                      <p className="text-sm text-slate-400 mt-1">Adjust filters or refresh with different preferences</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredSuggestions.map((suggestion) => {
                        const isSelected = selectedSuggestionIds.includes(suggestion.id);
                        const isUsed = suggestion.status === 'used';
                        const isDismissed = suggestion.status === 'dismissed';
                        const importanceTone = suggestion.importance === 'required'
                          ? 'border-red-200 text-red-700'
                          : suggestion.importance === 'recommended'
                            ? 'border-blue-200 text-blue-700'
                            : 'border-slate-200 text-slate-600';

                        return (
                          <div
                            key={suggestion.id}
                            className={`rounded-xl border p-4 transition-all ${CATEGORY_ACCENTS[suggestion.category]} ${isSelected ? 'ring-2 ring-amber-300' : ''} ${isUsed ? 'opacity-60' : ''} ${isDismissed ? 'opacity-40' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                type="button"
                                onClick={() => !isUsed && !isDismissed && toggleSuggestionSelection(suggestion)}
                                disabled={isUsed}
                                className={`mt-1 h-5 w-5 rounded border flex items-center justify-center ${isSelected ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'} ${isUsed ? 'cursor-not-allowed' : ''}`}
                              >
                                {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <Badge className={`${CATEGORY_COLORS[suggestion.category]} text-white text-[10px]`}>
                                    {suggestion.category.replace('_', ' ')}
                                  </Badge>
                                  <Badge variant="outline" className={`text-[10px] ${importanceTone}`}>
                                    {(suggestion.importance || 'optional').toUpperCase()}
                                  </Badge>
                                  {suggestion.relevantSection && (
                                    <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-600">
                                      {suggestion.relevantSection}
                                    </Badge>
                                  )}
                                  {isUsed && (
                                    <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50">
                                      <Check className="w-3 h-3 mr-0.5" /> USED
                                    </Badge>
                                  )}
                                  {isDismissed && (
                                    <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-400">
                                      DISMISSED
                                    </Badge>
                                  )}
                                </div>
                                <h4 className={`font-medium ${isUsed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{suggestion.title}</h4>
                                <p className="text-sm text-slate-600 mt-1">{suggestion.description}</p>
                                {suggestion.dataNeeded && (
                                  <p className="text-xs text-slate-500 mt-2">Data needed: {suggestion.dataNeeded}</p>
                                )}
                                {suggestion.whyThisFigure && (
                                  <p className="text-xs text-slate-500 mt-1">Why: {suggestion.whyThisFigure}</p>
                                )}
                              </div>
                              {isUsed ? (
                                <span className="shrink-0 text-xs text-green-600 font-medium px-2 py-1">Added</span>
                              ) : (
                                <div className="shrink-0 flex flex-col gap-1.5">
                                  <Button size="sm" variant="outline" onClick={() => applySuggestion(suggestion)}>
                                    <Plus className="w-4 h-4 mr-1" />
                                    Use
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => dismissSuggestion(suggestion.id)}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <X className="w-3.5 h-3.5 mr-1" />
                                    Discard
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="sticky bottom-0 bg-white pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {selectedSuggestions.length} selected for batch creation and generation
                {suggestions.some(s => s.status === 'used') && (
                  <span className="ml-2 text-green-600">
                    ({suggestions.filter(s => s.status === 'used').length} already used)
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={dismissSelectedSuggestions}
                  disabled={selectedSuggestions.length === 0 || isApplyingSuggestionBatch}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  Discard Selected
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedSuggestionIds([])}
                  disabled={selectedSuggestionIds.length === 0 || isApplyingSuggestionBatch}
                >
                  Clear Selection
                </Button>
                <Button
                  onClick={handleCreateAndGenerateFromSuggestions}
                  disabled={selectedSuggestions.length === 0 || isApplyingSuggestionBatch}
                  className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {isApplyingSuggestionBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Accept Batch and Generate
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog with Modification Feature */}
      <Dialog open={!!previewFigure} onOpenChange={(open) => {
        if (!open) {
          setPreviewFigure(null);
          setShowModifyInput(false);
          setModificationRequest('');
        }
      }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[92vh] bg-white border-0 shadow-2xl rounded-2xl flex flex-col overflow-hidden">
          <DialogHeader className="pb-4 flex-shrink-0">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <span>Figure {previewFigure?.figureNo}: {previewFigure?.title}</span>
              {previewFigure?.status && (
                <Badge className={`text-[10px] font-medium ${
                  previewFigure.status === 'GENERATED' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                  previewFigure.status === 'FAILED' ? 'bg-red-100 text-red-700 border-red-200' :
                  previewFigure.status === 'GENERATING' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                  'bg-slate-100 text-slate-700 border-slate-200'
                }`} variant="outline">
                  {previewFigure.status}
                </Badge>
              )}
            </DialogTitle>
            <div className="mt-3 flex flex-col gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Caption
              </label>
              <div className="flex gap-2">
                <Input
                  value={editingCaption}
                  onChange={(event) => setEditingCaption(event.target.value)}
                  placeholder="Add an academic caption"
                  className="rounded-xl border-slate-200"
                />
                <Button
                  variant="outline"
                  onClick={handleSaveCaption}
                  disabled={isSavingCaption || !editingCaption.trim() || editingCaption.trim() === (previewFigure?.caption || '')}
                  className="rounded-xl"
                >
                  {isSavingCaption ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Figure Preview or Status Placeholder */}
          <div className="bg-slate-50 rounded-xl p-4 md:p-6 relative min-h-[120px] max-h-[52vh] overflow-auto">
            {isModifying && (
              <div className="absolute inset-0 bg-white/80 rounded-xl flex flex-col items-center justify-center z-10">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p className="text-slate-600 font-medium">Regenerating with your changes...</p>
                <p className="text-slate-400 text-sm">This may take a moment</p>
              </div>
            )}
            {previewFigure?.imagePath ? (
              <img 
                src={previewFigure.imagePath} 
                alt={previewFigure.title}
                className="max-w-full max-h-[46vh] h-auto mx-auto rounded-lg shadow-sm object-contain"
              />
            ) : previewFigure?.status === 'FAILED' ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-3">
                  <X className="w-7 h-7 text-red-500" />
                </div>
                <p className="text-slate-700 font-medium">Generation Failed</p>
                <p className="text-slate-500 text-sm mt-1 max-w-sm">
                  The figure could not be rendered. You can modify the description and retry, or regenerate with different settings.
                </p>
              </div>
            ) : previewFigure?.status === 'GENERATING' ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-3" />
                <p className="text-slate-600 font-medium">Generating...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center mb-3">
                  <ImageIcon className="w-7 h-7 text-slate-400" />
                </div>
                <p className="text-slate-700 font-medium">No Image Generated Yet</p>
                <p className="text-slate-500 text-sm mt-1">Click Regenerate below or add a description to generate this figure.</p>
              </div>
            )}
          </div>
          
          {/* Modification Request Section */}
          <div className="border-t border-slate-100 pt-4">
            {!showModifyInput ? (
              <button
                onClick={() => setShowModifyInput(true)}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-500 hover:text-blue-600 transition-colors group"
              >
                <Pencil className="w-4 h-4" />
                <span className="font-medium">Request modifications</span>
                <span className="text-slate-400 group-hover:text-blue-400 text-sm">(AI will regenerate based on your feedback)</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">What would you like to change?</span>
                </div>
                <Textarea
                  value={modificationRequest}
                  onChange={e => setModificationRequest(e.target.value)}
                  placeholder="E.g., Make the bars blue instead of green, add a legend on the right side, increase font size for labels, change the title to..."
                  rows={3}
                  className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400 resize-none"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => previewFigure && handleModify(previewFigure)}
                    disabled={isModifying || !modificationRequest.trim()}
                    className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white gap-2"
                  >
                    {isModifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Apply Changes
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowModifyInput(false);
                      setModificationRequest('');
                    }}
                    disabled={isModifying}
                    className="rounded-xl"
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-slate-400 text-center">
                  AI will regenerate the figure incorporating your feedback
                </p>
              </div>
            )}
          </div>
          </div>

          <DialogFooter className="pt-4 border-t border-slate-100 flex-wrap gap-2 flex-shrink-0 bg-white">
            <div className="flex items-center gap-2 mr-auto">
              <Button 
                variant="outline"
                onClick={() => {
                  if (!previewFigure) return;
                  handleClearImage(previewFigure.id);
                }}
                disabled={isModifying || !previewFigure?.imagePath}
                className="rounded-lg gap-2 text-amber-600 border-amber-200 hover:bg-amber-50 hover:border-amber-300"
                title="Remove the generated image but keep the figure plan"
              >
                <X className="w-4 h-4" />
                Clear Image
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  if (!previewFigure) return;
                  if (confirm('Delete this figure entirely? This cannot be undone.')) {
                    handleDelete(previewFigure.id);
                  }
                }}
                disabled={isModifying}
                className="rounded-lg gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4" />
                Delete Figure
              </Button>
            </div>
            <Button variant="outline" onClick={() => {
              setPreviewFigure(null);
              setShowModifyInput(false);
              setModificationRequest('');
            }} className="rounded-lg">
              Close
            </Button>
            <Button 
              variant="outline"
              onClick={() => previewFigure && handleGenerate(previewFigure)}
              disabled={isModifying}
              className="rounded-lg gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </Button>
            <Button
              className="rounded-lg bg-slate-900 hover:bg-slate-800 gap-2"
              disabled={!previewFigure?.imagePath}
              onClick={() => {
                if (!previewFigure?.imagePath) return;
                const link = document.createElement('a');
                link.href = previewFigure.imagePath;
                link.download = `figure-${previewFigure.figureNo}-${previewFigure.title.replace(/\s+/g, '-').toLowerCase()}.png`;
                link.click();
              }}
            >
              <Download className="w-4 h-4" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
