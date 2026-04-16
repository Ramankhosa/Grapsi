'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  BookOpen,
  Wand2,
  Plus,
  GripVertical,
  Loader2,
  Check,
  X,
  ArrowUpRight,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  AlignLeft,
  AlignJustify,
  Scissors,
  FileText,
  Lightbulb,
  Quote,
  Eye,
  Download,
  Search,
  Info,
  AlertCircle,
  Zap,
  Move,
  RotateCcw,
  HelpCircle,
  GitBranch,
  BarChart3,
  Network,
  ExternalLink,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  Settings2,
  ListFilter,
  CheckCircle2,
  Circle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  extractFigureSuggestionMeta,
  type FigureSuggestionStatus,
  type FigureSuggestionTransport,
} from '@/lib/figure-generation/suggestion-meta';

// ============================================================================
// Types
// ============================================================================

interface FigurePlan {
  id: string;
  figureNo: number;
  title: string;
  caption?: string;
  description?: string;
  imagePath?: string;
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
  category?: string;
  figureType?: string;
}

interface AISuggestion {
  id: string;
  type: 'figure' | 'citation' | 'rewrite' | 'expand';
  title: string;
  description: string;
  actionLabel: string;
  relevance: number;
}

interface TextSelection {
  text: string;
  start: number;
  end: number;
}

interface Citation {
  id: string;
  title: string;
  authors?: string;
  year?: string | number;
  venue?: string;
  doi?: string;
  citationKey: string;
  source: 'paper' | 'library';
  sourceType?: string;
  usageCount?: number;
  abstract?: string;
  usages?: Array<{ id: string; sectionKey?: string }>;
  tags?: string[];
  url?: string;
}

interface CitationAiReviewData {
  citationId: string;
  citationKey: string;
  hasReview: boolean;
  aiReview: {
    relevanceScore: number | null;
    relevanceToResearch: string | null;
    keyContribution: string | null;
    keyFindings: string | null;
    methodologicalApproach: string | null;
    limitationsOrGaps: string | null;
    analyzedAt: string | null;
  };
  mappings: Array<{
    sectionKey: string;
    dimension: string | null;
    remark: string | null;
    confidence: string | null;
    mappingSource: string | null;
    updatedAt: string | Date;
  }>;
  error?: string;
}

interface FloatingWritingPanelProps {
  sessionId: string;
  authToken: string | null;
  currentSection?: string;
  currentContent?: string;
  figures?: FigurePlan[];
  citations?: Citation[];
  onInsertFigure?: (figureId: string, position?: 'cursor' | 'end') => void;
  onInsertCitation?: (citation: Citation) => void;
  onTextAction?: (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections',
    selectedText: string,
    instructions?: string
  ) => Promise<string>;
  onGenerateFigure?: (description: string, meta?: SmartFigureMeta) => void;
  onGenerateExistingFigure?: (figureId: string) => Promise<void> | void;
  selectedText?: TextSelection | null;
  onRefreshFigures?: () => void;
  onRefreshCitations?: () => void;
  onNavigateToStage?: (stageKey: string) => void;
  onOpenBibliographyPanel?: () => void;
  isVisible?: boolean;
  // Bibliography management (merged from Citations Panel)
  bibliographyStyle?: string;
  onBibliographyStyleChange?: (style: string) => void;
  bibliographySortOrder?: 'alphabetical' | 'order_of_appearance';
  onBibliographySortOrderChange?: (order: 'alphabetical' | 'order_of_appearance') => void;
  onGenerateBibliography?: () => void;
  generatingBibliography?: boolean;
  usedCitationCount?: number;
  isNumericStyleBibliography?: boolean;
  sequenceInfo?: {
    styleCode: string;
    version: number | null;
    changed: boolean;
    added: number;
    removed: number;
    renumbered: number;
    historyCount: number;
  } | null;
  onAddCitationViaPicker?: () => void;
  onCitationsUpdated?: (citations: any[]) => void;
}

/** Metadata passed from the floating panel's smart figure suggestion flow */
interface SmartFigureMeta extends FigureSuggestionTransport {
  id?: string;
  status?: FigureSuggestionStatus;
  sourceSection?: string;
  sourceText?: string;
}

// ============================================================================
// Help Tooltip Component
// ============================================================================

function HelpTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg max-w-[200px] text-center whitespace-normal"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Panel Tab Component
// ============================================================================

type TabId = 'figures' | 'ai' | 'actions' | 'citations';

interface PanelTab {
  id: TabId;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

// ============================================================================
// Figure Card Component
// ============================================================================

function FigureCard({ 
  figure, 
  onInsert, 
  onPreview,
  onGenerate,
  isGenerating = false,
  compact = false 
}: { 
  figure: FigurePlan; 
  onInsert: () => void;
  onPreview: () => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  compact?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const canGenerate = figure.status === 'PLANNED' || figure.status === 'FAILED';
  
  return (
    <motion.div
      className={`relative bg-white border border-slate-200 rounded-xl overflow-hidden transition-all cursor-pointer ${
        isHovered ? 'shadow-lg border-blue-300' : 'shadow-sm'
      } ${compact ? 'p-2' : 'p-3'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      onClick={() => {
        if (figure.status === 'GENERATED') {
          onPreview();
          return;
        }
        if (canGenerate && onGenerate) {
          onGenerate();
        }
      }}
      draggable
      onDragStart={(e) => {
        // Set drag data for drop handling
        const event = e as unknown as React.DragEvent;
        event.dataTransfer?.setData('text/plain', `[Figure ${figure.figureNo}]`);
        event.dataTransfer?.setData('application/figure-id', figure.id);
      }}
    >
      {/* Thumbnail */}
      <div className={`bg-slate-100 rounded-lg flex items-center justify-center ${compact ? 'h-16' : 'h-20'} mb-2 overflow-hidden`}>
        {figure.status === 'GENERATING' ? (
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        ) : figure.imagePath ? (
          <img 
            src={figure.imagePath} 
            alt={figure.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon className="w-6 h-6 text-slate-300" />
        )}
      </div>
      
      {/* Info */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-medium text-slate-400">Fig. {figure.figureNo}</span>
          <div className={`w-1.5 h-1.5 rounded-full ${
            figure.status === 'GENERATED' ? 'bg-emerald-500' :
            figure.status === 'GENERATING' ? 'bg-blue-500 animate-pulse' :
            figure.status === 'FAILED' ? 'bg-red-500' :
            'bg-slate-300'
          }`} />
        </div>
        <p className="text-xs font-medium text-slate-700 line-clamp-2">{figure.title}</p>
      </div>
      
      {/* Hover Actions */}
      <AnimatePresence>
        {isHovered && figure.status === 'GENERATED' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent rounded-xl flex items-end justify-center p-2 gap-1"
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              className="h-7 px-2 text-xs rounded-lg"
            >
              <Eye className="w-3 h-3 mr-1" />
              View
            </Button>
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); onInsert(); }}
              className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              <Plus className="w-3 h-3 mr-1" />
              Insert
            </Button>
          </motion.div>
        )}
        {isHovered && canGenerate && onGenerate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent rounded-xl flex items-end justify-center p-2"
          >
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate();
              }}
              disabled={isGenerating}
              className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              {isGenerating ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Zap className="w-3 h-3 mr-1" />
              )}
              {figure.status === 'FAILED' ? 'Retry' : 'Generate'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Drag hint */}
      {figure.status === 'GENERATED' && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-4 h-4 text-slate-400" />
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// AI Suggestion Card Component
// ============================================================================

function SuggestionCard({ 
  suggestion, 
  onApply,
  isLoading = false 
}: { 
  suggestion: AISuggestion; 
  onApply: () => void;
  isLoading?: boolean;
}) {
  const iconMap = {
    figure: <ImageIcon className="w-4 h-4" />,
    citation: <Quote className="w-4 h-4" />,
    rewrite: <Pencil className="w-4 h-4" />,
    expand: <AlignJustify className="w-4 h-4" />
  };
  
  const colorMap = {
    figure: 'text-violet-600 bg-violet-50 border-violet-200',
    citation: 'text-amber-600 bg-amber-50 border-amber-200',
    rewrite: 'text-blue-600 bg-blue-50 border-blue-200',
    expand: 'text-emerald-600 bg-emerald-50 border-emerald-200'
  };
  
  return (
    <div className={`p-3 rounded-xl border ${colorMap[suggestion.type]} transition-all hover:shadow-md`}>
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-lg ${colorMap[suggestion.type]}`}>
          {iconMap[suggestion.type]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">{suggestion.title}</p>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{suggestion.description}</p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onApply}
        disabled={isLoading}
        className="w-full mt-2 h-8 text-xs rounded-lg"
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Zap className="w-3 h-3 mr-1" />
        )}
        {suggestion.actionLabel}
      </Button>
    </div>
  );
}

// ============================================================================
// Text Action Button Component with Expandable Remarks
// ============================================================================

function TextActionButton({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  loading = false,
  actionId,
  expandedAction,
  onToggleExpand,
  customRemarks,
  onRemarksChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: (remarks?: string) => void;
  disabled?: boolean;
  loading?: boolean;
  actionId: string;
  expandedAction: string | null;
  onToggleExpand: (id: string | null) => void;
  customRemarks: string;
  onRemarksChange: (remarks: string) => void;
}) {
  const isExpanded = expandedAction === actionId;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (!isExpanded) {
              onClick();
            }
          }}
          disabled={disabled || loading}
          className="flex-1 p-2.5 text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{label}</p>
              <p className="text-[10px] text-slate-500 truncate">{description}</p>
            </div>
          </div>
        </button>
        
        {/* Remarks toggle button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(isExpanded ? null : actionId);
            if (!isExpanded) {
              onRemarksChange('');
            }
          }}
          disabled={disabled || loading}
          className={`p-2 rounded-lg border transition-all ${
            isExpanded 
              ? 'bg-blue-100 border-blue-300 text-blue-600' 
              : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Add custom instructions"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>
      
      {/* Expandable remarks input */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-blue-500" />
                <span className="text-[10px] font-medium text-blue-700">Custom Instructions</span>
              </div>
              <Textarea
                value={customRemarks}
                onChange={(e) => onRemarksChange(e.target.value)}
                placeholder={`E.g., "Focus on clarity" or "Keep technical terms"...`}
                rows={2}
                className="text-xs rounded-lg resize-none bg-white border-blue-200 focus:border-blue-400"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onClick(customRemarks)}
                  disabled={loading}
                  className="flex-1 h-7 rounded-lg text-xs bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <Zap className="w-3 h-3 mr-1" />
                  )}
                  {label} with Instructions
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onToggleExpand(null)}
                  className="h-7 rounded-lg text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main Floating Panel Component
// ============================================================================

export default function FloatingWritingPanel({
  sessionId,
  authToken,
  currentSection,
  currentContent,
  figures = [],
  citations = [],
  onInsertFigure,
  onInsertCitation,
  onTextAction,
  onGenerateFigure,
  onGenerateExistingFigure,
  selectedText,
  onRefreshFigures,
  onRefreshCitations,
  onNavigateToStage,
  onOpenBibliographyPanel,
  isVisible = true,
  // Bibliography management props
  bibliographyStyle = 'APA7',
  onBibliographyStyleChange,
  bibliographySortOrder = 'alphabetical',
  onBibliographySortOrderChange,
  onGenerateBibliography,
  generatingBibliography = false,
  usedCitationCount = 0,
  isNumericStyleBibliography = false,
  sequenceInfo = null,
  onAddCitationViaPicker,
  onCitationsUpdated,
}: FloatingWritingPanelProps) {
  // Panel state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('figures');
  const [searchQuery, setSearchQuery] = useState('');
  const [citationSearch, setCitationSearch] = useState('');
  
  // Drag state
  const dragControls = useDragControls();
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  });

  // Resize state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 288, height: 500 }); // Default w-72 = 288px
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Min/max size constraints
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const MIN_HEIGHT = 400;
  const MAX_HEIGHT = Math.max(MIN_HEIGHT, viewportSize.height - 48);

  const clampPanelPosition = useCallback(
    (
      candidate: { x: number; y: number },
      sizeOverride?: { width: number; height: number }
    ) => {
      const width = sizeOverride?.width ?? panelSize.width;
      const height = sizeOverride?.height ?? panelSize.height;
      const minX = width - viewportSize.width + 32;
      const maxX = 16;
      const minY = -16;
      const maxY = Math.max(-16, viewportSize.height - height - 32);
      return {
        x: Math.max(minX, Math.min(maxX, candidate.x)),
        y: Math.max(minY, Math.min(maxY, candidate.y))
      };
    },
    [panelSize.height, panelSize.width, viewportSize.height, viewportSize.width]
  );

  // Load saved position and size from localStorage
  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const savedPosition = localStorage.getItem('floatingPanelPosition');
    const savedSize = localStorage.getItem('floatingPanelSize');
    if (savedPosition) {
      try {
        const parsed = JSON.parse(savedPosition);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          setPosition(parsed);
        }
      } catch {
        // Ignore parse errors
      }
    }
    if (savedSize) {
      try {
        const parsed = JSON.parse(savedSize);
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          setPanelSize({
            width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width)),
            height: Math.max(MIN_HEIGHT, parsed.height)
          });
        }
      } catch {
        // Ignore parse errors
      }
    }
    setLayoutReady(true);
  }, []);

  useEffect(() => {
    if (!layoutReady) return;
    localStorage.setItem('floatingPanelSize', JSON.stringify(panelSize));
  }, [layoutReady, panelSize]);

  useEffect(() => {
    if (!layoutReady) return;
    localStorage.setItem('floatingPanelPosition', JSON.stringify(position));
  }, [layoutReady, position]);

  useEffect(() => {
    if (isFullscreen) return;
    const constrainedSize = {
      width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, panelSize.width)),
      height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, panelSize.height))
    };
    if (constrainedSize.width !== panelSize.width || constrainedSize.height !== panelSize.height) {
      setPanelSize(constrainedSize);
    }
    setPosition((prev) => {
      const clamped = clampPanelPosition(prev, constrainedSize);
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      return clamped;
    });
  }, [MAX_HEIGHT, clampPanelPosition, isFullscreen, panelSize.height, panelSize.width]);

  // Save position to localStorage when it changes
  const handleDragEnd = useCallback((_: any, info: { offset: { x: number; y: number } }) => {
    setIsDragging(false);
    setPosition((prev) => clampPanelPosition({
      x: prev.x + info.offset.x,
      y: prev.y + info.offset.y
    }));
  }, [clampPanelPosition]);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'corner' | 'left' | 'bottom' | 'top' | 'top-left-corner') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
      startPosX: position.x,
      startPosY: position.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;

      const deltaX = moveEvent.clientX - resizeRef.current.startX;
      const deltaY = moveEvent.clientY - resizeRef.current.startY;
      let newWidth = resizeRef.current.startWidth;
      let newHeight = resizeRef.current.startHeight;
      let newY = resizeRef.current.startPosY;

      if (direction === 'corner' || direction === 'left' || direction === 'top-left-corner') {
        // Resize from left - moving left increases width, moving right decreases
        newWidth = resizeRef.current.startWidth - deltaX;
      }
      if (direction === 'corner' || direction === 'bottom') {
        newHeight = resizeRef.current.startHeight + deltaY;
      }
      if (direction === 'top' || direction === 'top-left-corner') {
        // Resize from top while keeping the bottom edge stable.
        newHeight = resizeRef.current.startHeight - deltaY;
        newY = resizeRef.current.startPosY + deltaY;
      }

      // Apply constraints
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));

      const nextSize = { width: newWidth, height: newHeight };
      const nextPos = clampPanelPosition({ x: resizeRef.current.startPosX, y: newY }, nextSize);
      setPanelSize(nextSize);
      setPosition(nextPos);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [MAX_HEIGHT, clampPanelPosition, panelSize.height, panelSize.width, position.x, position.y]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Reset position and size to default
  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setPanelSize({ width: 288, height: 500 });
    setIsFullscreen(false);
    localStorage.removeItem('floatingPanelPosition');
    localStorage.removeItem('floatingPanelSize');
  }, []);
  
  // Figure preview state
  const [previewFigure, setPreviewFigure] = useState<FigurePlan | null>(null);
  
  // AI state
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  
  // Quick figure generation state
  const [showQuickFigure, setShowQuickFigure] = useState(false);
  const [figureDescription, setFigureDescription] = useState('');
  const [generatingFigure, setGeneratingFigure] = useState(false);
  const [generatingExistingFigureId, setGeneratingExistingFigureId] = useState<string | null>(null);
  
  // Smart figure suggestion state
  const [showSmartSuggest, setShowSmartSuggest] = useState(false);
  const [smartSuggestions, setSmartSuggestions] = useState<SmartFigureMeta[]>([]);
  const [loadingSmartSuggest, setLoadingSmartSuggest] = useState(false);
  const [generatingSmartFigure, setGeneratingSmartFigure] = useState<string | null>(null); // track which suggestion is being generated

  const persistSmartSuggestionStatuses = useCallback(async (
    updates: Array<{ id: string; status: 'pending' | 'used' | 'dismissed'; usedByFigureId?: string | null }>
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
      console.error('[SmartFigureSuggest] Failed to persist suggestion status:', err);
    }
  }, [authToken, sessionId]);
  
  // Custom instructions for text actions
  const [customInstructions, setCustomInstructions] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  
  // Expandable action state - tracks which action has remarks expanded
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [actionRemarks, setActionRemarks] = useState('');
  
  // Citation management state
  const [citationSourceFilter, setCitationSourceFilter] = useState<'all' | 'paper' | 'library'>('all');
  const [loadingCitations, setLoadingCitations] = useState(false);
  const [paperCitations, setPaperCitations] = useState<Citation[]>([]);
  const [citationCounts, setCitationCounts] = useState({ paper: 0, library: 0, total: 0 });
  const [citationUsageByKey, setCitationUsageByKey] = useState<Record<string, number>>({});
  const [importingCitation, setImportingCitation] = useState<string | null>(null);
  
  // Add citation state (DOI / BibTeX)
  const [showAddCitation, setShowAddCitation] = useState(false);
  const [addCitationMode, setAddCitationMode] = useState<'doi' | 'bibtex'>('doi');
  const [doiInput, setDoiInput] = useState('');
  const [bibtexInput, setBibtexInput] = useState('');
  const [addingCitation, setAddingCitation] = useState(false);
  const [addCitationError, setAddCitationError] = useState<string | null>(null);
  
  // Merged citations management state
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all');
  const [showBibTools, setShowBibTools] = useState(false);
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());
  const [expandedAiReviews, setExpandedAiReviews] = useState<Set<string>>(new Set());
  const [loadingAiReviews, setLoadingAiReviews] = useState<Record<string, boolean>>({});
  const [aiReviewsByCitation, setAiReviewsByCitation] = useState<Record<string, CitationAiReviewData>>({});
  const [editingCitation, setEditingCitation] = useState<any | null>(null);
  const [editValues, setEditValues] = useState({
    title: '', authors: '', year: '', venue: '', volume: '', issue: '', pages: '',
    doi: '', url: '', isbn: '', publisher: '', edition: '', editors: '',
    publicationPlace: '', publicationDate: '', accessedDate: '', articleNumber: '',
    issn: '', journalAbbreviation: '', pmid: '', pmcid: '', arxivId: '',
    abstract: '', notes: '', tags: ''
  });
  const [editStatusMessage, setEditStatusMessage] = useState<string | null>(null);
  const [fetchingAbstract, setFetchingAbstract] = useState(false);
  
  // Help panel state
  const [showHelp, setShowHelp] = useState(false);
  const paperCitationCount = Math.max(citationCounts.paper, citations.length);

  // Enrich panel citations with usage extracted from section content.
  // `citationUsageByKey` is computed server-side from draft section markers.
  const enrichedCitations = useMemo(() => {
    const parentMap = new Map<string, any>();
    for (const c of citations) {
      const key = c.citationKey || c.id;
      if (key) parentMap.set(key, c);
    }

    const merged: Citation[] = [];
    const seenIds = new Set<string>();

    for (const pc of paperCitations) {
      seenIds.add(pc.id);
      const parent = parentMap.get(pc.citationKey);
      const normalizedKey = String(pc.citationKey || '').trim().toLowerCase();
      const usageCount = pc.source === 'paper'
        ? Number(citationUsageByKey[normalizedKey] || 0)
        : Number(pc.usageCount || 0);
      merged.push({
        ...pc,
        usageCount,
        abstract: pc.abstract || parent?.abstract || '',
        usages: parent?.usages ?? pc.usages ?? [],
        tags: parent?.tags ?? pc.tags ?? [],
      });
    }

    for (const c of citations) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const normalizedKey = String(c.citationKey || '').trim().toLowerCase();
      merged.push({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : String(c.title || ''),
        authors: typeof c.authors === 'string' ? c.authors : '',
        year: c.year,
        venue: typeof c.venue === 'string' ? c.venue : undefined,
        doi: typeof c.doi === 'string' ? c.doi : undefined,
        citationKey: c.citationKey || '',
        source: 'paper' as const,
        sourceType: c.sourceType,
        usageCount: Number(citationUsageByKey[normalizedKey] || 0),
        abstract: typeof c.abstract === 'string' ? c.abstract : '',
        usages: c.usages ?? [],
        tags: c.tags ?? [],
      });
    }

    return merged;
  }, [paperCitations, citations, citationUsageByKey]);

  // Usage summary for paper citations - uses full enriched set
  const usageSummary = useMemo(() => {
    const paperItems = enrichedCitations.filter(c => c.source === 'paper');
    const used = paperItems.filter(c => Number(c.usageCount || 0) > 0).length;
    // Also consider the parent-provided usedCitationCount (client-side extraction)
    // which may be more up-to-date than DB-backed CitationUsage records
    const effectiveUsed = Math.max(used, usedCitationCount);
    return {
      total: paperItems.length,
      used: effectiveUsed,
      unused: Math.max(0, paperItems.length - effectiveUsed),
    };
  }, [enrichedCitations, usedCitationCount]);

  // Apply usage filter on top of source filter
  const displayCitations = useMemo(() => {
    if (usageFilter === 'all') return enrichedCitations;
    return enrichedCitations.filter(c => {
      if (c.source === 'library') return false; // hide library items when filtering by usage
      const count = Number(c.usageCount || 0);
      if (usageFilter === 'used') return count > 0;
      if (usageFilter === 'unused') return count <= 0;
      return true;
    });
  }, [enrichedCitations, usageFilter]);

  // Tabs configuration
  const tabs: PanelTab[] = [
    { id: 'figures', icon: <ImageIcon className="w-4 h-4" />, label: 'Figures', badge: figures.length },
    { id: 'ai', icon: <Sparkles className="w-4 h-4" />, label: 'AI Assist', badge: aiSuggestions.length },
    { id: 'actions', icon: <Wand2 className="w-4 h-4" />, label: 'Actions' },
    { id: 'citations', icon: <BookOpen className="w-4 h-4" />, label: 'Citations', badge: paperCitationCount },
  ];

  // Filter figures based on search
  const filteredFigures = figures.filter(f => 
    f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Smart Figure Suggestion: sends selected text / section content to the
  //    suggestion API and shows the user AI-recommended figures inline.
  //    When user has highlighted text → focusMode='selection', only that text is visualized.
  //    When no selection → focusMode='section', full section content is the focus.
  const handleSmartFigureSuggest = useCallback(async () => {
    if (!authToken || !sessionId) return;

    // Determine focus: selected text = 'selection' mode, full section = 'section' mode
    const hasSelection = !!selectedText?.text?.trim();
    const sourceText = hasSelection ? selectedText!.text : (currentContent || '');
    if (!sourceText.trim()) return;

    const focusMode = hasSelection ? 'selection' as const : 'section' as const;

    setLoadingSmartSuggest(true);
    setShowSmartSuggest(true);
    setSmartSuggestions([]);
    try {
      const response = await fetch(`/api/papers/${sessionId}/figures/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          // Still send the section content for broader grounding context
          sections: currentContent
            ? { [currentSection || '_current']: currentContent.slice(0, 4000) }
            : undefined,
          useLLM: true,
          preferences: { outputMix: 'balanced', detailLevel: 'moderate' },
          // Focus fields — the LLM will constrain all suggestions to this text
          focusText: sourceText.slice(0, 4000),
          focusSection: currentSection || undefined,
          focusMode
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to get suggestions');

      const items: SmartFigureMeta[] = (data.suggestions || []).map((s: any) => {
        const suggestionMeta = extractFigureSuggestionMeta(s);

        return {
          id: s.id,
          status: (s.status as FigureSuggestionStatus) || 'pending',
          title: s.title,
          description: s.description,
          category: s.category || 'DIAGRAM',
          importance: s.importance || 'optional',
          suggestedType: s.suggestedType || 'flowchart',
          ...suggestionMeta,
          relevantSection: currentSection || suggestionMeta?.relevantSection,
          sourceSection: currentSection,
          sourceText: sourceText.slice(0, 500)
        };
      });
      setSmartSuggestions(items);
    } catch (err) {
      console.error('[SmartFigureSuggest] Error:', err);
      setSmartSuggestions([]);
    } finally {
      setLoadingSmartSuggest(false);
    }
  }, [authToken, sessionId, selectedText, currentContent, currentSection]);

  const handleDismissSmartSuggestion = useCallback((index: number, suggestionId?: string) => {
    setSmartSuggestions((prev) => prev.filter((_, i) => i !== index));
    if (suggestionId) {
      persistSmartSuggestionStatuses([{ id: suggestionId, status: 'dismissed', usedByFigureId: null }]);
    }
  }, [persistSmartSuggestionStatuses]);

  const handleDismissAllSmartSuggestions = useCallback(() => {
    const ids = smartSuggestions.map((s) => s.id).filter((id): id is string => !!id);
    setSmartSuggestions([]);
    setShowSmartSuggest(false);
    if (ids.length > 0) {
      persistSmartSuggestionStatuses(ids.map((id) => ({ id, status: 'dismissed', usedByFigureId: null })));
    }
  }, [persistSmartSuggestionStatuses, smartSuggestions]);

  const handleGenerateExistingFigureClick = useCallback(async (figureId: string) => {
    if (!onGenerateExistingFigure) return;
    setGeneratingExistingFigureId(figureId);
    try {
      await onGenerateExistingFigure(figureId);
      onRefreshFigures?.();
    } finally {
      setGeneratingExistingFigureId(null);
    }
  }, [onGenerateExistingFigure, onRefreshFigures]);

  /** Accept a smart suggestion: create + generate the figure immediately */
  const handleAcceptSmartSuggestion = useCallback(async (suggestion: SmartFigureMeta, index?: number) => {
    if (!onGenerateFigure) return;
    const key = suggestion.id || suggestion.title || `figure-${index ?? 0}`;
    setGeneratingSmartFigure(key);
    try {
      await onGenerateFigure(suggestion.description || suggestion.title || '', suggestion);
      // After successful generation, refresh figures
      onRefreshFigures?.();
      if (typeof index === 'number') {
        setSmartSuggestions((prev) => prev.filter((_, i) => i !== index));
      }
      if (suggestion.id) {
        persistSmartSuggestionStatuses([{ id: suggestion.id, status: 'used', usedByFigureId: null }]);
      }
    } catch (err) {
      console.error('[SmartFigureSuggest] Generation failed:', err);
    } finally {
      setGeneratingSmartFigure(null);
    }
  }, [onGenerateFigure, onRefreshFigures, persistSmartSuggestionStatuses]);

  const figureColumnCount = isFullscreen
    ? Math.max(2, Math.min(4, Math.floor((viewportSize.width - 120) / 200)))
    : panelSize.width >= 520
      ? 3
      : panelSize.width >= 380
        ? 2
        : 1;
  const smartSuggestMaxHeight = Math.max(180, Math.min(420, panelSize.height - 260));

  /** Navigate to Figure Planner stage with context pre-filled */
  const handleOpenInFigurePlanner = useCallback(() => {
    if (!onNavigateToStage) return;
    const hasSelection = !!selectedText?.text?.trim();
    // Store context in sessionStorage so the Figure Planner can pick it up
    const context = {
      sourceSection: currentSection,
      sourceText: (hasSelection ? selectedText!.text : (currentContent || '')).slice(0, 4000),
      focusMode: hasSelection ? 'selection' : 'section',
      timestamp: Date.now()
    };
    try {
      sessionStorage.setItem(`figure_planner_context_${sessionId}`, JSON.stringify(context));
    } catch { /* ignore storage errors */ }
    onNavigateToStage('FIGURE_PLANNER');
  }, [onNavigateToStage, currentSection, selectedText, currentContent, sessionId]);

  const canOpenBibliographyPanel = Boolean(onOpenBibliographyPanel || onNavigateToStage);
  const handleOpenBibliographyPanel = useCallback(() => {
    if (onOpenBibliographyPanel) {
      onOpenBibliographyPanel();
      return;
    }
    onNavigateToStage?.('SECTION_DRAFTING');
  }, [onNavigateToStage, onOpenBibliographyPanel]);

  // Generate AI suggestions based on current context
  const generateSuggestions = useCallback(async () => {
    if (!currentContent || !currentSection) return;
    
    setLoadingSuggestions(true);
    try {
      // Analyze content and generate contextual suggestions
      const suggestions: AISuggestion[] = [];
      
      // Check if section could benefit from a figure
      if (currentContent.length > 200 && figures.length === 0) {
        suggestions.push({
          id: 'suggest-figure',
          type: 'figure',
          title: 'Add a visualization',
          description: 'This section could benefit from a diagram or chart to illustrate the concepts.',
          actionLabel: 'Generate Figure',
          relevance: 0.9
        });
      }
      
      // Check for opportunities to expand
      if (currentContent.length < 500) {
        suggestions.push({
          id: 'suggest-expand',
          type: 'expand',
          title: 'Expand this section',
          description: 'Add more detail and depth to strengthen your argument.',
          actionLabel: 'Expand Content',
          relevance: 0.7
        });
      }
      
      // Check for long paragraphs that could be rewritten
      const paragraphs = currentContent.split('\n\n');
      if (paragraphs.some(p => p.length > 800)) {
        suggestions.push({
          id: 'suggest-rewrite',
          type: 'rewrite',
          title: 'Improve readability',
          description: 'Break up long paragraphs for better flow.',
          actionLabel: 'Rewrite Section',
          relevance: 0.8
        });
      }
      
      setAiSuggestions(suggestions);
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [currentContent, currentSection, figures.length]);

  // Generate suggestions when content changes significantly
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentContent && currentContent.length > 100) {
        generateSuggestions();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [currentContent, generateSuggestions]);

  // Fetch citations from API
  const fetchCitations = useCallback(async () => {
    if (!authToken || !sessionId) return;
    
    setLoadingCitations(true);
    try {
      const params = new URLSearchParams({
        source: citationSourceFilter,
        q: citationSearch,
        limit: '100', // limit applies to library items only; paper citations are always returned in full
      });
      
      const response = await fetch(`/api/papers/${sessionId}/panel-citations?${params}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setPaperCitations(data.citations || []);
        setCitationCounts(data.counts || { paper: 0, library: 0, total: 0 });
        if (citationSourceFilter !== 'library' && data.usageByKey && typeof data.usageByKey === 'object') {
          setCitationUsageByKey((prev) => ({
            ...prev,
            ...(data.usageByKey as Record<string, number>)
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch citations:', err);
    } finally {
      setLoadingCitations(false);
    }
  }, [authToken, sessionId, citationSourceFilter, citationSearch]);

  // Fetch citations when tab opens or filter changes
  useEffect(() => {
    if (activeTab === 'citations') {
      fetchCitations();
    }
  }, [activeTab, citationSourceFilter, fetchCitations]);

  // Debounced search for citations
  useEffect(() => {
    if (activeTab !== 'citations') return;
    
    const timer = setTimeout(() => {
      fetchCitations();
    }, 300);
    return () => clearTimeout(timer);
  }, [citationSearch, activeTab, fetchCitations]);

  // Import citation from library to paper
  const handleImportCitation = async (referenceId: string) => {
    if (!authToken || !sessionId) return;
    
    setImportingCitation(referenceId);
    try {
      const response = await fetch(`/api/papers/${sessionId}/panel-citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ referenceId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        // Update the local list
        if (data.imported) {
          // Replace the library item with paper item
          setPaperCitations(prev => {
            const filtered = prev.filter(c => c.id !== referenceId);
            return [data.citation, ...filtered];
          });
          setCitationCounts(prev => ({
            ...prev,
            paper: prev.paper + 1,
          }));
        }
        // Insert the citation
        if (onInsertCitation) {
          onInsertCitation(data.citation);
        }
        onRefreshCitations?.();
        fetchCitations();
      }
    } catch (err) {
      console.error('Failed to import citation:', err);
    } finally {
      setImportingCitation(null);
    }
  };

  // Open edit dialog for a citation
  const openEditCitation = useCallback((citation: any) => {
    setEditingCitation(citation);
    setEditValues({
      title: citation.title || '',
      authors: typeof citation.authors === 'string' ? citation.authors : (Array.isArray(citation.authors) ? citation.authors.join(', ') : ''),
      year: citation.year ? String(citation.year) : '',
      venue: citation.venue || '',
      volume: citation.volume || '',
      issue: citation.issue || '',
      pages: citation.pages || '',
      doi: citation.doi || '',
      url: citation.url || '',
      isbn: citation.isbn || '',
      publisher: citation.publisher || '',
      edition: citation.edition || '',
      editors: Array.isArray(citation.editors) ? citation.editors.join(', ') : '',
      publicationPlace: citation.publicationPlace || '',
      publicationDate: citation.publicationDate || '',
      accessedDate: citation.accessedDate || '',
      articleNumber: citation.articleNumber || '',
      issn: citation.issn || '',
      journalAbbreviation: citation.journalAbbreviation || '',
      pmid: citation.pmid || '',
      pmcid: citation.pmcid || '',
      arxivId: citation.arxivId || '',
      abstract: citation.abstract || '',
      notes: citation.notes || '',
      tags: Array.isArray(citation.tags) ? citation.tags.join(', ') : ''
    });
    setEditStatusMessage(null);
  }, []);

  // Save edited citation
  const handleEditSave = async () => {
    if (!editingCitation || !authToken) return;
    try {
      setEditStatusMessage(null);
      const payload = {
        title: editValues.title,
        authors: editValues.authors.split(',').map(a => a.trim()).filter(Boolean),
        year: editValues.year ? Number(editValues.year) : undefined,
        venue: editValues.venue || undefined,
        volume: editValues.volume || undefined,
        issue: editValues.issue || undefined,
        pages: editValues.pages || undefined,
        doi: editValues.doi || undefined,
        url: editValues.url || undefined,
        isbn: editValues.isbn || undefined,
        publisher: editValues.publisher || undefined,
        edition: editValues.edition || undefined,
        editors: editValues.editors.split(',').map(a => a.trim()).filter(Boolean),
        publicationPlace: editValues.publicationPlace || undefined,
        publicationDate: editValues.publicationDate || undefined,
        accessedDate: editValues.accessedDate || undefined,
        articleNumber: editValues.articleNumber || undefined,
        issn: editValues.issn || undefined,
        journalAbbreviation: editValues.journalAbbreviation || undefined,
        pmid: editValues.pmid || undefined,
        pmcid: editValues.pmcid || undefined,
        arxivId: editValues.arxivId || undefined,
        abstract: editValues.abstract || undefined,
        notes: editValues.notes || undefined,
        tags: editValues.tags.split(',').map(tag => tag.trim()).filter(Boolean)
      };
      const response = await fetch(`/api/papers/${sessionId}/citations/${editingCitation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update citation');
      }
      setEditingCitation(null);
      fetchCitations();
      onRefreshCitations?.();
    } catch (err) {
      setEditStatusMessage(err instanceof Error ? err.message : 'Failed to update citation');
    }
  };

  // Delete a citation
  const handleDeleteCitation = async (citation: any) => {
    if (!citation || !authToken) return;
    const confirmed = window.confirm('Delete this citation? This cannot be undone.');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/papers/${sessionId}/citations/${citation.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await response.json();

      if (response.status === 409 && data.warning) {
        const archive = window.confirm(`${data.warning} Archive instead?`);
        if (archive) {
          await fetch(`/api/papers/${sessionId}/citations/${citation.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ isActive: false })
          });
        }
      }

      fetchCitations();
      onRefreshCitations?.();
    } catch (err) {
      console.error('Failed to delete citation:', err);
    }
  };

  // Fetch abstract from external sources
  const handleFetchAbstract = async () => {
    if (!editingCitation || !authToken) return;
    try {
      setFetchingAbstract(true);
      setEditStatusMessage(null);
      const response = await fetch(
        `/api/papers/${sessionId}/citations/${editingCitation.id}/abstract`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch abstract');
      if (data.found && data.abstracts?.length > 0) {
        setEditValues(prev => ({ ...prev, abstract: data.abstracts[0].abstract }));
        setEditStatusMessage(`Abstract found from ${data.abstracts[0].source}`);
      } else {
        setEditStatusMessage('No abstract found online.');
      }
    } catch (err) {
      setEditStatusMessage(err instanceof Error ? err.message : 'Failed to fetch abstract');
    } finally {
      setFetchingAbstract(false);
      setTimeout(() => setEditStatusMessage(null), 5000);
    }
  };

  // Toggle abstract visibility
  const toggleAbstract = useCallback((citationId: string) => {
    setExpandedAbstracts(prev => {
      const next = new Set(prev);
      if (next.has(citationId)) next.delete(citationId);
      else next.add(citationId);
      return next;
    });
  }, []);

  const toggleAiReview = useCallback(async (citation: Citation) => {
    if (citation.source === 'library') return;

    const citationId = citation.id;
    const isExpanded = expandedAiReviews.has(citationId);
    setExpandedAiReviews((prev) => {
      const next = new Set(prev);
      if (next.has(citationId)) next.delete(citationId);
      else next.add(citationId);
      return next;
    });

    if (isExpanded) return;
    if (!authToken || !sessionId) return;
    if (aiReviewsByCitation[citationId] || loadingAiReviews[citationId]) return;

    setLoadingAiReviews((prev) => ({ ...prev, [citationId]: true }));
    try {
      const response = await fetch(`/api/papers/${sessionId}/citations/${citationId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load AI relevance review');
      }
      setAiReviewsByCitation((prev) => ({ ...prev, [citationId]: data as CitationAiReviewData }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load AI relevance review';
      setAiReviewsByCitation((prev) => ({
        ...prev,
        [citationId]: {
          citationId,
          citationKey: citation.citationKey,
          hasReview: false,
          aiReview: {
            relevanceScore: null,
            relevanceToResearch: null,
            keyContribution: null,
            keyFindings: null,
            methodologicalApproach: null,
            limitationsOrGaps: null,
            analyzedAt: null
          },
          mappings: [],
          error: message
        }
      }));
    } finally {
      setLoadingAiReviews((prev) => ({ ...prev, [citationId]: false }));
    }
  }, [aiReviewsByCitation, authToken, expandedAiReviews, loadingAiReviews, sessionId]);

  // Handle DOI lookup and add citation
  const handleAddCitationByDOI = async () => {
    if (!authToken || !sessionId || !doiInput.trim()) return;
    
    setAddingCitation(true);
    setAddCitationError(null);
    
    try {
      // Clean DOI - extract from URL if needed
      let cleanDOI = doiInput.trim();
      if (cleanDOI.includes('doi.org/')) {
        cleanDOI = cleanDOI.split('doi.org/')[1];
      }
      cleanDOI = cleanDOI.replace(/^https?:\/\//, '');
      
      // Fetch metadata from CrossRef
      const crossRefResponse = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDOI)}`, {
        headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' },
      });
      
      if (!crossRefResponse.ok) {
        throw new Error('DOI not found. Please check the DOI and try again.');
      }
      
      const crossRefData = await crossRefResponse.json();
      const work = crossRefData.message;
      
      const authors = (work.author || []).map((a: any) =>
        `${a.given || ''} ${a.family || ''}`.trim()
      ).filter(Boolean);
      
      // Create citation in paper
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          citation: {
            sourceType: 'JOURNAL_ARTICLE',
            title: work.title?.[0] || '',
            authors: authors.length > 0 ? authors : ['Unknown'],
            year: work.issued?.['date-parts']?.[0]?.[0],
            venue: work['container-title']?.[0] || work.publisher,
            volume: work.volume,
            issue: work.issue,
            pages: work.page,
            doi: work.DOI,
            url: work.URL,
            editors: (work.editor || []).map((e: any) => `${e.given || ''} ${e.family || ''}`.trim()).filter(Boolean),
            publicationPlace: work['publisher-location'],
            publicationDate: Array.isArray(work.issued?.['date-parts']?.[0])
              ? work.issued['date-parts'][0].map((part: number, idx: number) => idx > 0 ? String(part).padStart(2, '0') : String(part)).join('-')
              : undefined,
            articleNumber: work['article-number'],
            issn: Array.isArray(work.ISSN) ? work.ISSN[0] : undefined,
            journalAbbreviation: Array.isArray(work['short-container-title']) ? work['short-container-title'][0] : undefined,
          }
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add citation');
      }
      
      // Success - refresh citations and reset form
      setDoiInput('');
      setShowAddCitation(false);
      fetchCitations();
      onRefreshCitations?.();
    } catch (err) {
      setAddCitationError(err instanceof Error ? err.message : 'Failed to add citation');
    } finally {
      setAddingCitation(false);
    }
  };

  // Handle BibTeX import
  const handleAddCitationByBibTeX = async () => {
    if (!authToken || !sessionId || !bibtexInput.trim()) return;
    
    setAddingCitation(true);
    setAddCitationError(null);
    
    try {
      // Parse BibTeX client-side to extract basic info
      const bibtex = bibtexInput.trim();
      
      // Simple regex parsing for common BibTeX fields
      const titleMatch = bibtex.match(/title\s*=\s*[{"]([^}"]+)[}"]/i);
      const authorMatch = bibtex.match(/author\s*=\s*[{"]([^}"]+)[}"]/i);
      const yearMatch = bibtex.match(/year\s*=\s*[{"]?(\d{4})[}"']?/i);
      const journalMatch = bibtex.match(/(?:journal|booktitle)\s*=\s*[{"]([^}"]+)[}"]/i);
      const volumeMatch = bibtex.match(/volume\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const issueMatch = bibtex.match(/(?:number|issue)\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const pagesMatch = bibtex.match(/pages\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const doiMatch = bibtex.match(/doi\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const urlMatch = bibtex.match(/url\s*=\s*[{"]([^}"]+)[}"]/i);
      const publisherMatch = bibtex.match(/publisher\s*=\s*[{"]([^}"]+)[}"]/i);
      const editorMatch = bibtex.match(/editor\s*=\s*[{"]([^}"]+)[}"]/i);
      const addressMatch = bibtex.match(/address\s*=\s*[{"]([^}"]+)[}"]/i);
      const issnMatch = bibtex.match(/issn\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const articleNumberMatch = bibtex.match(/(?:article-number|number)\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const pmidMatch = bibtex.match(/pmid\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const pmcidMatch = bibtex.match(/pmcid\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      const arxivMatch = bibtex.match(/(?:eprint|arxivid|arxiv)\s*=\s*[{"]?([^,}"]+)[}"']?/i);
      
      // Parse authors (handle "and" separator)
      let authors: string[] = ['Unknown'];
      if (authorMatch) {
        authors = authorMatch[1]
          .split(/\s+and\s+/i)
          .map(a => a.trim().replace(/[{}]/g, ''))
          .filter(Boolean);
      }
      
      // Detect source type from entry type
      const typeMatch = bibtex.match(/@(\w+)\s*\{/i);
      let sourceType = 'OTHER';
      if (typeMatch) {
        const entryType = typeMatch[1].toLowerCase();
        if (entryType === 'article') sourceType = 'JOURNAL_ARTICLE';
        else if (entryType === 'inproceedings' || entryType === 'conference') sourceType = 'CONFERENCE_PAPER';
        else if (entryType === 'book') sourceType = 'BOOK';
        else if (entryType === 'incollection') sourceType = 'BOOK_CHAPTER';
        else if (entryType === 'phdthesis' || entryType === 'mastersthesis') sourceType = 'THESIS';
        else if (entryType === 'techreport') sourceType = 'REPORT';
        else if (entryType === 'misc' || entryType === 'online') sourceType = 'WEBSITE';
      }
      
      if (!titleMatch) {
        throw new Error('Could not parse title from BibTeX. Please check the format.');
      }
      
      // Create citation in paper
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          citation: {
            sourceType,
            title: titleMatch[1].replace(/[{}]/g, ''),
            authors,
            year: yearMatch ? parseInt(yearMatch[1]) : undefined,
            venue: journalMatch?.[1]?.replace(/[{}]/g, '') || publisherMatch?.[1]?.replace(/[{}]/g, ''),
            volume: volumeMatch?.[1]?.replace(/[{}]/g, ''),
            issue: issueMatch?.[1]?.replace(/[{}]/g, ''),
            pages: pagesMatch?.[1]?.replace(/[{}]/g, '').replace(/--/g, '-'),
            doi: doiMatch?.[1]?.replace(/[{}]/g, ''),
            url: urlMatch?.[1],
            editors: editorMatch?.[1]
              ? editorMatch[1].split(/\s+and\s+/i).map(a => a.trim()).filter(Boolean)
              : undefined,
            publicationPlace: addressMatch?.[1]?.replace(/[{}]/g, ''),
            articleNumber: articleNumberMatch?.[1]?.replace(/[{}]/g, ''),
            issn: issnMatch?.[1]?.replace(/[{}]/g, ''),
            pmid: pmidMatch?.[1]?.replace(/[{}]/g, ''),
            pmcid: pmcidMatch?.[1]?.replace(/[{}]/g, ''),
            arxivId: arxivMatch?.[1]?.replace(/[{}]/g, ''),
          }
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add citation');
      }
      
      // Success - refresh citations and reset form
      setBibtexInput('');
      setShowAddCitation(false);
      fetchCitations();
      onRefreshCitations?.();
    } catch (err) {
      setAddCitationError(err instanceof Error ? err.message : 'Failed to parse BibTeX');
    } finally {
      setAddingCitation(false);
    }
  };

  // Handle text action with optional inline remarks
  const handleTextAction = async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections',
    inlineRemarks?: string
  ) => {
    if (!selectedText?.text || !onTextAction) return;
    
    setLoadingAction(action);
    try {
      // Use inline remarks if provided, otherwise fall back to custom instructions
      const instructions = inlineRemarks || customInstructions || undefined;
      await onTextAction(action, selectedText.text, instructions);
      setCustomInstructions('');
      setShowCustomInput(false);
      setExpandedAction(null);
      setActionRemarks('');
    } catch (err) {
      console.error('Text action failed:', err);
    } finally {
      setLoadingAction(null);
    }
  };

  // Handle quick figure generation
  const handleQuickFigure = async () => {
    if (!figureDescription.trim() || !onGenerateFigure) return;
    
    setGeneratingFigure(true);
    try {
      await onGenerateFigure(figureDescription);
      setFigureDescription('');
      setShowQuickFigure(false);
    } catch (err) {
      console.error('Figure generation failed:', err);
    } finally {
      setGeneratingFigure(false);
    }
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Drag constraints container - covers the whole viewport */}
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-30" />
      
      {/* Main Panel */}
      <motion.div
        ref={panelRef}
        drag={!isFullscreen && !isResizing}
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0.1}
        dragConstraints={constraintsRef}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ 
          opacity: 1, 
          scale: 1,
          width: isFullscreen ? '100vw' : isCollapsed ? 56 : panelSize.width,
          height: isFullscreen ? '100vh' : undefined,
        }}
        whileDrag={{ scale: 1.02, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
        style={{ 
          x: isFullscreen ? 0 : position.x, 
          y: isFullscreen ? 0 : position.y,
          position: 'fixed',
          right: isFullscreen ? 0 : 24,
          top: isFullscreen ? 0 : 24,
          marginTop: 0,
          zIndex: isFullscreen ? 100 : 40,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`${isDragging ? 'cursor-grabbing' : ''} ${isResizing ? 'select-none' : ''}`}
      >
        <div 
          className={`bg-white shadow-2xl border overflow-hidden transition-colors flex flex-col ${
            isDragging ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
          } ${isFullscreen ? 'rounded-none h-full' : 'rounded-2xl'}`}
          style={{ 
            height: isFullscreen ? '100%' : isCollapsed ? 'auto' : panelSize.height,
          }}
        >
          {/* Collapse Toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-12 bg-white border border-slate-200 rounded-l-lg shadow-md flex items-center justify-center hover:bg-slate-50 transition-colors z-10"
          >
            {isCollapsed ? (
              <ChevronLeft className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {isCollapsed ? (
            // Collapsed View - Icon Bar
            <div className="py-4 flex flex-col items-center gap-2">
              {/* Drag Handle for collapsed */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="w-10 h-6 rounded-lg flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors mb-1"
                title="Drag to move"
              >
                <GripVertical className="w-4 h-4" />
              </div>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setIsCollapsed(false); }}
                  className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'
                  }`}
                  title={tab.label}
                >
                  {tab.icon}
                  {tab.badge && tab.badge > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            // Expanded View
            <>
              {/* Drag Handle Header */}
              <div 
                onPointerDown={(e) => !isFullscreen && dragControls.start(e)}
                className={`px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white select-none ${
                  isFullscreen ? '' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {!isFullscreen && <Move className="w-3.5 h-3.5 text-slate-400" />}
                    <h3 className="font-semibold text-slate-800 text-sm">Writing Assistant</h3>
                    {isFullscreen && (
                      <Badge className="bg-blue-100 text-blue-700 text-[10px]">Fullscreen</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isFullscreen && (
                      <button
                        onClick={resetPosition}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Reset position & size"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={toggleFullscreen}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {!isFullscreen && (
                      <Badge variant="outline" className="text-[10px]">
                        {currentSection || 'No section'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-100">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
                      activeTab === tab.id 
                        ? 'text-blue-600' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {tab.icon}
                      {tab.badge && tab.badge > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">
                          {tab.badge}
                        </span>
                      )}
                    </div>
                    {activeTab === tab.id && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className={`overflow-y-auto ${isFullscreen ? 'flex-1' : ''}`} style={{ maxHeight: isFullscreen ? 'none' : panelSize.height - 120 }}>
                <AnimatePresence mode="wait">
                  {/* Figures Tab */}
                  {activeTab === 'figures' && (
                    <motion.div
                      key="figures"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Search figures..."
                          className="pl-9 h-9 text-sm rounded-xl"
                        />
                      </div>

                      {/* Smart Figure Suggestion – AI analyzes selected text or section content */}
                      <div className="space-y-2">
                        <button
                          onClick={handleSmartFigureSuggest}
                          disabled={loadingSmartSuggest || (!selectedText?.text && !currentContent)}
                          className="w-full p-3 rounded-xl border-2 border-dashed border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-colors flex items-center justify-center gap-2 text-sm text-amber-600 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingSmartSuggest ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          {selectedText?.text
                            ? `Suggest Figures for Selection (${selectedText.text.length} chars)`
                            : 'AI Suggest Figures for This Section'}
                        </button>

                        {/* Inline Smart Suggestions */}
                        <AnimatePresence>
                          {showSmartSuggest && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2 overflow-y-auto" style={{ maxHeight: smartSuggestMaxHeight }}>
                                {loadingSmartSuggest ? (
                                  <div className="py-6 text-center">
                                    <Loader2 className="w-5 h-5 animate-spin text-amber-500 mx-auto mb-2" />
                                    <p className="text-xs text-amber-700">Analyzing content and finding the best visualizations...</p>
                                  </div>
                                ) : smartSuggestions.length === 0 ? (
                                  <div className="py-4 text-center text-xs text-slate-500">
                                    No suggestions found. Try selecting specific data or a longer section.
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-[10px] font-medium text-amber-700 px-1">
                                      {smartSuggestions.length} suggestion{smartSuggestions.length !== 1 ? 's' : ''} found
                                    </p>
                                    {smartSuggestions.map((s, idx) => {
                                      const catIcon = s.category === 'DATA_CHART' || s.category === 'STATISTICAL_PLOT'
                                        ? <BarChart3 className="w-3.5 h-3.5" />
                                        : s.category === 'SKETCH' || s.category === 'ILLUSTRATION'
                                          ? <ImageIcon className="w-3.5 h-3.5" />
                                          : <GitBranch className="w-3.5 h-3.5" />;
                                      const suggestionKey = s.id || s.title || `fig-${idx}`;
                                      const isGenerating = generatingSmartFigure === suggestionKey;
                                      const catColor = s.category === 'DATA_CHART' || s.category === 'STATISTICAL_PLOT'
                                        ? 'bg-blue-100 text-blue-700'
                                        : s.category === 'SKETCH' || s.category === 'ILLUSTRATION'
                                          ? 'bg-purple-100 text-purple-700'
                                          : 'bg-emerald-100 text-emerald-700';

                                      return (
                                        <div key={idx} className="p-2.5 bg-white rounded-lg border border-amber-100 space-y-1.5">
                                          <div className="flex items-start gap-2">
                                            <div className={`mt-0.5 p-1 rounded ${catColor}`}>{catIcon}</div>
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${catColor}`}>
                                                  {(s.category || 'DIAGRAM').replace('_', ' ')}
                                                </span>
                                                {s.importance === 'required' && (
                                                  <span className="text-[9px] text-red-600 font-medium">Required</span>
                                                )}
                                                {s.importance === 'recommended' && (
                                                  <span className="text-[9px] text-blue-600 font-medium">Recommended</span>
                                                )}
                                              </div>
                                              <h5 className="text-xs font-medium text-slate-800 mt-1 leading-snug">{s.title}</h5>
                                              <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{s.description}</p>
                                              {s.whyThisFigure && (
                                                <p className="text-[10px] text-amber-600 mt-1 italic">Why: {s.whyThisFigure}</p>
                                              )}
                                            </div>
                                            <button
                                              onClick={() => handleDismissSmartSuggestion(idx, s.id)}
                                              disabled={isGenerating}
                                              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                              title="Discard this suggestion"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                          <div className="flex gap-1.5 pt-1">
                                            <Button
                                              size="sm"
                                              onClick={() => handleAcceptSmartSuggestion(s, idx)}
                                              disabled={!!generatingSmartFigure}
                                              className="flex-1 h-7 rounded-lg text-[10px] bg-amber-600 hover:bg-amber-700 text-white"
                                            >
                                              {isGenerating ? (
                                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                              ) : (
                                                <Zap className="w-3 h-3 mr-1" />
                                              )}
                                              {isGenerating ? 'Generating...' : 'Generate Now'}
                                            </Button>
                                            {onNavigateToStage && (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleOpenInFigurePlanner}
                                                disabled={!!generatingSmartFigure}
                                                className="h-7 rounded-lg text-[10px]"
                                                title="Open in Figure Planner for full control"
                                              >
                                                <ExternalLink className="w-3 h-3" />
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* Link to full Figure Planner */}
                                    {onNavigateToStage && (
                                      <button
                                        onClick={handleOpenInFigurePlanner}
                                        className="w-full p-2 rounded-lg text-[10px] text-amber-700 hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5 font-medium"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        Open Figure Planner for full control
                                      </button>
                                    )}
                                    <button
                                      onClick={handleDismissAllSmartSuggestions}
                                      className="w-full p-2 rounded-lg text-[10px] text-red-600 hover:bg-red-50 transition-colors font-medium"
                                    >
                                      Discard all suggestions
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => setShowSmartSuggest(false)}
                                  className="w-full p-1.5 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Quick Create (manual) – fallback for users who know exactly what they want */}
                      <button
                        onClick={() => setShowQuickFigure(!showQuickFigure)}
                        className="w-full p-2 rounded-lg border border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-blue-600"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Quick Generate (manual description)
                      </button>

                      <AnimatePresence>
                        {showQuickFigure && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
                              <Textarea
                                value={figureDescription}
                                onChange={e => setFigureDescription(e.target.value)}
                                placeholder="Describe the figure/plot you want to generate. You can also paste raw CSV, TSV, or x/y rows here."
                                rows={2}
                                className="text-sm rounded-lg resize-none"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={handleQuickFigure}
                                  disabled={generatingFigure || !figureDescription.trim()}
                                  className="flex-1 h-8 rounded-lg text-xs"
                                >
                                  {generatingFigure ? (
                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                  ) : (
                                    <Sparkles className="w-3 h-3 mr-1" />
                                  )}
                                  Generate
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowQuickFigure(false)}
                                  className="h-8 rounded-lg text-xs"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Figure Grid */}
                      {filteredFigures.length > 0 ? (
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${figureColumnCount}, minmax(0, 1fr))` }}>
                          {filteredFigures.map(figure => (
                            <FigureCard
                              key={figure.id}
                              figure={figure}
                              compact
                              onInsert={() => onInsertFigure?.(figure.id)}
                              onPreview={() => setPreviewFigure(figure)}
                              onGenerate={onGenerateExistingFigure ? () => handleGenerateExistingFigureClick(figure.id) : undefined}
                              isGenerating={generatingExistingFigureId === figure.id}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">No figures yet</p>
                          <p className="text-xs text-slate-400 mt-1">Create one above or go to Figure Planner</p>
                        </div>
                      )}

                      {/* Refresh Button */}
                      {figures.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onRefreshFigures}
                          className="w-full h-8 text-xs text-slate-500"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Refresh Figures
                        </Button>
                      )}

                      {/* Drag Hint */}
                      <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg text-xs text-slate-500">
                        <Info className="w-3 h-3" />
                        <span>Drag figures to insert at cursor position</span>
                      </div>
                    </motion.div>
                  )}

                  {/* AI Suggestions Tab */}
                  {activeTab === 'ai' && (
                    <motion.div
                      key="ai"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600">Context-aware suggestions</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={generateSuggestions}
                          disabled={loadingSuggestions}
                          className="h-7 px-2 text-xs"
                        >
                          {loadingSuggestions ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                        </Button>
                      </div>

                      {loadingSuggestions ? (
                        <div className="py-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Analyzing your content...</p>
                        </div>
                      ) : aiSuggestions.length > 0 ? (
                        <div className="space-y-2">
                          {aiSuggestions.map(suggestion => (
                            <SuggestionCard
                              key={suggestion.id}
                              suggestion={suggestion}
                              onApply={() => {
                                if (suggestion.type === 'figure') {
                                  setActiveTab('figures');
                                  setShowQuickFigure(true);
                                } else if (suggestion.type === 'rewrite' || suggestion.type === 'expand') {
                                  setActiveTab('actions');
                                }
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">No suggestions right now</p>
                          <p className="text-xs text-slate-400 mt-1">Keep writing and I&apos;ll offer tips</p>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Text Actions Tab */}
                  {activeTab === 'actions' && (
                    <motion.div
                      key="actions"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-3"
                    >
                      {/* Selection indicator - simplified, no animation for stability */}
                      {selectedText?.text ? (
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-blue-500" />
                              <p className="text-xs text-blue-700 font-semibold">Text Selected</p>
                            </div>
                            <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                              {selectedText.text.length} chars
                            </span>
                          </div>
                          <div className="p-2 bg-white/80 rounded-lg border border-blue-100">
                            <p className="text-xs text-slate-700 line-clamp-2 leading-relaxed">&ldquo;{selectedText.text.slice(0, 100)}{selectedText.text.length > 100 ? '...' : ''}&rdquo;</p>
                          </div>
                          <p className="mt-1.5 text-[10px] text-blue-600 text-center">
                            Choose an action below
                          </p>
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-amber-700">No text selected</p>
                            <p className="text-[10px] text-amber-600 mt-0.5">Highlight text in the editor to use AI actions</p>
                          </div>
                        </div>
                      )}

                      {/* Text Transformation Actions */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-xs font-medium text-slate-600">Text Transformations</p>
                          <HelpTooltip text="AI rewrites your selected text while preserving meaning. Click the pencil icon to add custom instructions." />
                        </div>
                        <div className="space-y-1.5">
                          <TextActionButton
                            icon={<Pencil className="w-3.5 h-3.5" />}
                            label="Rewrite"
                            description="Improve clarity and flow"
                            onClick={(remarks) => handleTextAction('rewrite', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'rewrite'}
                            actionId="rewrite"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<AlignJustify className="w-3.5 h-3.5" />}
                            label="Expand"
                            description="Add more detail and depth"
                            onClick={(remarks) => handleTextAction('expand', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'expand'}
                            actionId="expand"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<Scissors className="w-3.5 h-3.5" />}
                            label="Condense"
                            description="Make it shorter and tighter"
                            onClick={(remarks) => handleTextAction('condense', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'condense'}
                            actionId="condense"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<FileText className="w-3.5 h-3.5" />}
                            label="More Formal"
                            description="Academic tone adjustment"
                            onClick={(remarks) => handleTextAction('formal', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'formal'}
                            actionId="formal"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<AlignLeft className="w-3.5 h-3.5" />}
                            label="Simplify"
                            description="Easier to understand"
                            onClick={(remarks) => handleTextAction('simple', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'simple'}
                            actionId="simple"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                          <TextActionButton
                            icon={<GitBranch className="w-3.5 h-3.5" />}
                            label="Create Sections"
                            description="Split into headed sections"
                            onClick={(remarks) => handleTextAction('create_sections', remarks)}
                            disabled={!selectedText?.text}
                            loading={loadingAction === 'create_sections'}
                            actionId="create_sections"
                            expandedAction={expandedAction}
                            onToggleExpand={setExpandedAction}
                            customRemarks={actionRemarks}
                            onRemarksChange={setActionRemarks}
                          />
                        </div>
                      </div>

                      {/* Tip for custom instructions */}
                      <div className="pt-2 border-t border-slate-100">
                        <div className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-500">
                          <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
                          <span>
                            Click the <Pencil className="w-2.5 h-2.5 inline mx-0.5" /> icon next to any action to add custom instructions before executing.
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Citations Tab - Merged Citations Manager */}
                  {activeTab === 'citations' && (
                    <motion.div
                      key="citations"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="p-3 space-y-2 flex flex-col h-full"
                    >
                      {/* Header with Add + Refresh + Picker */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-slate-600">Citations</p>
                          <span className="text-[10px] text-slate-400">
                            ({paperCitationCount} in paper)
                          </span>
                          {usageSummary.used > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-0.5">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {usageSummary.used} cited
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {onAddCitationViaPicker && (
                            <button
                              onClick={onAddCitationViaPicker}
                              className="p-1.5 rounded-md hover:bg-blue-100 text-blue-500 transition-colors"
                              title="Search & pick citations"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setShowAddCitation(!showAddCitation)}
                            className={`p-1.5 rounded-md transition-colors ${
                              showAddCitation 
                                ? 'bg-emerald-100 text-emerald-600' 
                                : 'hover:bg-slate-100 text-slate-500'
                            }`}
                            title="Add citation via DOI or BibTeX"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={fetchCitations}
                            disabled={loadingCitations}
                            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-50"
                            title="Refresh"
                          >
                            {loadingCitations ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Bibliography & Style - Expandable Inline Section */}
                      <div className="rounded-lg border border-purple-200 bg-purple-50/50 overflow-hidden">
                        <button
                          onClick={() => setShowBibTools(!showBibTools)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-purple-100/50 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-purple-600" />
                            <span className="text-[11px] font-medium text-purple-700">Bibliography & Style</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">
                              {bibliographyStyle}
                            </span>
                          </div>
                          {showBibTools ? (
                            <ChevronUp className="w-3.5 h-3.5 text-purple-500" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                          )}
                        </button>
                        <AnimatePresence>
                          {showBibTools && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-2.5 pb-2.5 space-y-2 border-t border-purple-100">
                                <div className="space-y-1.5 pt-2">
                                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Citation Style</label>
                                  <select
                                    value={bibliographyStyle}
                                    onChange={(e) => onBibliographyStyleChange?.(e.target.value)}
                                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                                  >
                                    <option value="APA7">APA 7th Edition</option>
                                    <option value="IEEE">IEEE</option>
                                    <option value="CHICAGO_AUTHOR_DATE">Chicago (Author-Date)</option>
                                    <option value="MLA9">MLA 9th Edition</option>
                                    <option value="HARVARD">Harvard</option>
                                    <option value="VANCOUVER">Vancouver</option>
                                  </select>

                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => onBibliographySortOrderChange?.('alphabetical')}
                                      disabled={isNumericStyleBibliography}
                                      className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                                        bibliographySortOrder === 'alphabetical'
                                          ? 'bg-purple-50 border-purple-200 text-purple-700 font-medium'
                                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                      } ${isNumericStyleBibliography ? 'opacity-40 cursor-not-allowed hover:bg-white' : ''}`}
                                    >
                                      A→Z Alphabetical
                                    </button>
                                    <button
                                      onClick={() => onBibliographySortOrderChange?.('order_of_appearance')}
                                      className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                                        bibliographySortOrder === 'order_of_appearance'
                                          ? 'bg-purple-50 border-purple-200 text-purple-700 font-medium'
                                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                      }`}
                                    >
                                      1→N Appearance
                                    </button>
                                  </div>

                                  {isNumericStyleBibliography && (
                                    <p className="text-[10px] text-slate-500">
                                      IEEE/Vancouver uses order-of-appearance numbering.
                                    </p>
                                  )}
                                  {isNumericStyleBibliography && sequenceInfo && (
                                    <p className="text-[10px] text-slate-500">
                                      Sequence {sequenceInfo.version ? `v${sequenceInfo.version}` : 'unversioned'} | snapshots {sequenceInfo.historyCount}
                                      {sequenceInfo.changed
                                        ? ` | delta +${sequenceInfo.added}/-${sequenceInfo.removed}, renumbered ${sequenceInfo.renumbered}`
                                        : ' | no numbering changes'}
                                    </p>
                                  )}
                                </div>

                                <button
                                  onClick={() => {
                                    setShowBibTools(false);
                                    onGenerateBibliography?.();
                                  }}
                                  disabled={generatingBibliography}
                                  className="w-full flex items-center justify-center gap-2 text-[11px] font-medium text-purple-600 hover:text-purple-700 py-1.5 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50 bg-white"
                                  title="Generates bibliography only for citations used in the paper"
                                >
                                  {generatingBibliography ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                                  Generate Bibliography ({usedCitationCount} used)
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Add Citation Panel (DOI / BibTeX) */}
                      <AnimatePresence>
                        {showAddCitation && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100 space-y-2">
                              <div className="flex p-0.5 bg-emerald-100 rounded-lg">
                                <button
                                  onClick={() => { setAddCitationMode('doi'); setAddCitationError(null); }}
                                  className={`flex-1 py-1 px-2 text-[10px] font-medium rounded-md transition-all ${
                                    addCitationMode === 'doi' ? 'bg-white text-emerald-800 shadow-sm' : 'text-emerald-600'
                                  }`}
                                >
                                  DOI Lookup
                                </button>
                                <button
                                  onClick={() => { setAddCitationMode('bibtex'); setAddCitationError(null); }}
                                  className={`flex-1 py-1 px-2 text-[10px] font-medium rounded-md transition-all ${
                                    addCitationMode === 'bibtex' ? 'bg-white text-emerald-800 shadow-sm' : 'text-emerald-600'
                                  }`}
                                >
                                  BibTeX
                                </button>
                              </div>
                              
                              {addCitationMode === 'doi' ? (
                                <div className="space-y-1.5">
                                  <Input
                                    value={doiInput}
                                    onChange={e => setDoiInput(e.target.value)}
                                    placeholder="10.1000/xyz123 or https://doi.org/..."
                                    className="h-8 text-xs rounded-lg"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={handleAddCitationByDOI}
                                    disabled={addingCitation || !doiInput.trim()}
                                    className="w-full h-7 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700"
                                  >
                                    {addingCitation ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                                    Lookup & Add
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <Textarea
                                    value={bibtexInput}
                                    onChange={e => setBibtexInput(e.target.value)}
                                    placeholder="@article{key,&#10;  title = {Title},&#10;  author = {Name},&#10;  year = {2024},&#10;  ...&#10;}"
                                    rows={3}
                                    className="text-[10px] rounded-lg resize-none font-mono"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={handleAddCitationByBibTeX}
                                    disabled={addingCitation || !bibtexInput.trim()}
                                    className="w-full h-7 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700"
                                  >
                                    {addingCitation ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                                    Parse & Add
                                  </Button>
                                </div>
                              )}
                              
                              {addCitationError && (
                                <p className="text-[10px] text-red-600 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  {addCitationError}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Source Filter Tabs */}
                      <div className="flex p-0.5 bg-slate-100 rounded-lg">
                        {[
                          { id: 'all' as const, label: 'All', count: citationCounts.total },
                          { id: 'paper' as const, label: 'Paper', count: citationCounts.paper },
                          { id: 'library' as const, label: 'Library', count: citationCounts.library },
                        ].map((filter) => (
                          <button
                            key={filter.id}
                            onClick={() => { setCitationSourceFilter(filter.id); setUsageFilter('all'); }}
                            className={`flex-1 py-1 px-1.5 text-[10px] font-medium rounded-md transition-all ${
                              citationSourceFilter === filter.id
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {filter.label}
                            {filter.count > 0 && (
                              <span className={`ml-0.5 text-[9px] ${
                                citationSourceFilter === filter.id ? 'text-blue-600' : 'text-slate-400'
                              }`}>
                                {filter.count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Usage Filter - only when viewing Paper or All */}
                      {citationSourceFilter !== 'library' && usageSummary.total > 0 && (
                        <div className="flex items-center gap-1">
                          <ListFilter className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <div className="flex p-0.5 bg-slate-50 rounded-md flex-1">
                            {[
                              { id: 'all' as const, label: 'All' },
                              { id: 'used' as const, label: `Used (${usageSummary.used})` },
                              { id: 'unused' as const, label: `Unused (${usageSummary.unused})` },
                            ].map((uf) => (
                              <button
                                key={uf.id}
                                onClick={() => setUsageFilter(uf.id)}
                                className={`flex-1 py-0.5 px-1 text-[9px] font-medium rounded transition-all ${
                                  usageFilter === uf.id
                                    ? 'bg-white text-slate-700 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600'
                                }`}
                              >
                                {uf.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <Input
                          value={citationSearch}
                          onChange={e => setCitationSearch(e.target.value)}
                          placeholder="Search..."
                          className="pl-8 h-8 text-xs rounded-lg"
                        />
                      </div>

                      {/* Citation List */}
                      {loadingCitations ? (
                        <div className="py-6 text-center flex-1">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mx-auto mb-2" />
                          <p className="text-xs text-slate-500">Loading...</p>
                        </div>
                      ) : displayCitations.length > 0 ? (
                        <div className="space-y-1.5 flex-1 overflow-y-auto pr-1" style={{ minHeight: 0 }}>
                          {displayCitations.map(citation => {
                            const isLibrary = citation.source === 'library';
                            const usageCount = Number(citation.usageCount || 0);
                            const hasAbstract = citation.abstract && citation.abstract.length > 30;
                            const isAbstractExpanded = expandedAbstracts.has(citation.id);
                            const isAiReviewExpanded = expandedAiReviews.has(citation.id);
                            const isAiReviewLoading = Boolean(loadingAiReviews[citation.id]);
                            const aiReviewData = aiReviewsByCitation[citation.id];

                            return (
                              <div
                                key={citation.id}
                                className={`p-2 rounded-lg border transition-all group ${
                                  isLibrary
                                    ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50'
                                    : usageCount > 0
                                      ? 'border-green-200 bg-green-50/30 hover:border-green-300 hover:bg-green-50/50 border-l-2 border-l-green-400'
                                      : 'border-blue-200 bg-blue-50/50 hover:border-blue-300 hover:bg-blue-50'
                                }`}
                              >
                                {/* Title + Primary Action */}
                                <div className="flex items-start gap-1.5">
                                  {/* Usage indicator symbol - always visible */}
                                  {!isLibrary && (
                                    <div className="flex-shrink-0 mt-0.5" title={usageCount > 0 ? `Cited ${usageCount} time${usageCount > 1 ? 's' : ''} in paper` : 'Not yet cited in paper'}>
                                      {usageCount > 0 ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                      ) : (
                                        <Circle className="w-3.5 h-3.5 text-slate-300" />
                                      )}
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <button
                                      onClick={() => {
                                        if (isLibrary) {
                                          handleImportCitation(citation.id);
                                        } else {
                                          onInsertCitation?.(citation);
                                          // Refresh citations after a short delay to pick up updated usage counts
                                          setTimeout(() => {
                                            fetchCitations();
                                            onRefreshCitations?.();
                                          }, 1500);
                                        }
                                      }}
                                      className="w-full text-left"
                                      title={isLibrary ? 'Import to paper & insert' : 'Insert citation at cursor'}
                                    >
                                      <p className={`text-xs font-medium line-clamp-2 ${
                                        isLibrary ? 'text-amber-800' : 'text-blue-800'
                                      }`}>
                                        {citation.title}
                                      </p>
                                    </button>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                      {citation.authors && (
                                        <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
                                          {citation.authors}
                                        </span>
                                      )}
                                      {citation.year && (
                                        <span className="text-[10px] text-slate-400">({citation.year})</span>
                                      )}
                                      <span className={`text-[9px] px-1 py-0.5 rounded-full ${
                                        isLibrary ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                                      }`}>
                                        {isLibrary ? 'Library' : 'Paper'}
                                      </span>
                                      {!isLibrary && usageCount > 0 && (
                                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                                          {usageCount}x
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Primary action button */}
                                  <div className="flex-shrink-0">
                                    {isLibrary ? (
                                      <button
                                        onClick={() => handleImportCitation(citation.id)}
                                        disabled={importingCitation === citation.id}
                                        className="p-1.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors disabled:opacity-50"
                                        title="Import to paper & insert"
                                      >
                                        {importingCitation === citation.id ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Download className="w-3 h-3" />
                                        )}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          onInsertCitation?.(citation);
                                          setTimeout(() => {
                                            fetchCitations();
                                            onRefreshCitations?.();
                                          }, 1500);
                                        }}
                                        className="p-1.5 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
                                        title="Insert citation at cursor"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Abstract + AI relevance (on-demand) */}
                                {(hasAbstract || !isLibrary) && (
                                  <div className="mt-1 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {hasAbstract && (
                                        <button
                                          onClick={() => toggleAbstract(citation.id)}
                                          className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors"
                                        >
                                          {isAbstractExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                                          {isAbstractExpanded ? 'Hide abstract' : 'View abstract'}
                                        </button>
                                      )}
                                      {!isLibrary && (
                                        <button
                                          onClick={() => toggleAiReview(citation)}
                                          className="text-[10px] text-rose-500 hover:text-rose-700 flex items-center gap-0.5 transition-colors"
                                        >
                                          {isAiReviewLoading ? (
                                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                          ) : isAiReviewExpanded ? (
                                            <ChevronUp className="w-2.5 h-2.5" />
                                          ) : (
                                            <ChevronDown className="w-2.5 h-2.5" />
                                          )}
                                          AI Relevance
                                        </button>
                                      )}
                                    </div>

                                    {isAbstractExpanded && hasAbstract && (
                                      <p className="text-[10px] text-slate-600 bg-white/70 p-1.5 rounded leading-relaxed line-clamp-6">
                                        {citation.abstract}
                                      </p>
                                    )}

                                    {isAiReviewExpanded && !isLibrary && (
                                      <div className="text-[10px] text-slate-600 bg-white/70 p-1.5 rounded leading-relaxed space-y-1">
                                        {isAiReviewLoading ? (
                                          <p className="flex items-center gap-1 text-slate-500">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Loading AI relevance review...
                                          </p>
                                        ) : aiReviewData?.error ? (
                                          <p className="text-red-600">{aiReviewData.error}</p>
                                        ) : aiReviewData?.hasReview ? (
                                          <>
                                            {aiReviewData.aiReview.relevanceScore !== null && (
                                              <p><span className="font-medium text-slate-700">Relevance score:</span> {aiReviewData.aiReview.relevanceScore}/100</p>
                                            )}
                                            {aiReviewData.aiReview.relevanceToResearch && (
                                              <p><span className="font-medium text-slate-700">Why relevant:</span> {aiReviewData.aiReview.relevanceToResearch}</p>
                                            )}
                                            {aiReviewData.aiReview.keyContribution && (
                                              <p><span className="font-medium text-slate-700">Contribution:</span> {aiReviewData.aiReview.keyContribution}</p>
                                            )}
                                            {aiReviewData.aiReview.keyFindings && (
                                              <p><span className="font-medium text-slate-700">Key findings:</span> {aiReviewData.aiReview.keyFindings}</p>
                                            )}
                                            {aiReviewData.aiReview.methodologicalApproach && (
                                              <p><span className="font-medium text-slate-700">Method:</span> {aiReviewData.aiReview.methodologicalApproach}</p>
                                            )}
                                            {aiReviewData.aiReview.limitationsOrGaps && (
                                              <p><span className="font-medium text-slate-700">Limitations:</span> {aiReviewData.aiReview.limitationsOrGaps}</p>
                                            )}
                                            {Array.isArray(aiReviewData.mappings) && aiReviewData.mappings.length > 0 && (
                                              <p><span className="font-medium text-slate-700">Mapped evidence:</span> {aiReviewData.mappings[0].remark || `${aiReviewData.mappings[0].sectionKey} - ${aiReviewData.mappings[0].dimension || 'dimension'}`}</p>
                                            )}
                                          </>
                                        ) : (
                                          <p className="text-slate-500">AI relevance review is not available for this citation yet.</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Bottom row: citation key + actions */}
                                <div className="mt-1.5 flex items-center justify-between gap-1">
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(`[${citation.citationKey}]`);
                                    }}
                                    className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-0.5 transition-colors truncate"
                                    title="Copy citation key"
                                  >
                                    <Copy className="w-2.5 h-2.5 flex-shrink-0" />
                                    <span className="truncate">[{citation.citationKey}]</span>
                                  </button>
                                  
                                  {/* Inline action buttons */}
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                    {!isLibrary && (
                                      <>
                                        <button
                                          onClick={() => openEditCitation(citation)}
                                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-blue-600 transition-colors"
                                          title="Edit citation details"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteCitation(citation)}
                                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 transition-colors"
                                          title="Delete citation"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </>
                                    )}
                                    {citation.doi && (
                                      <button
                                        onClick={() => window.open(`https://doi.org/${citation.doi}`, '_blank')}
                                        className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-slate-600 transition-colors"
                                        title="View source"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Venue */}
                                {citation.venue && (
                                  <div className="mt-0.5">
                                    <span className="text-[9px] text-slate-400 truncate block">{citation.venue}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : citationCounts.total === 0 ? (
                        <div className="text-center py-4 flex-1 flex flex-col items-center justify-center">
                          <BookOpen className="w-6 h-6 text-slate-300 mb-1" />
                          <p className="text-xs text-slate-500">No citations yet</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Use + button to add via DOI or BibTeX</p>
                        </div>
                      ) : (
                        <div className="text-center py-4 flex-1 flex flex-col items-center justify-center">
                          <Search className="w-5 h-5 text-slate-300 mb-1" />
                          <p className="text-xs text-slate-500">No matches</p>
                          {usageFilter !== 'all' && (
                            <button
                              onClick={() => setUsageFilter('all')}
                              className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                            >
                              Clear usage filter
                            </button>
                          )}
                        </div>
                      )}

                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer with hints and help */}
              <div className="p-2 border-t border-slate-100 bg-slate-50 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    {isFullscreen ? (
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Minimize2 className="w-3 h-3" /> Press ESC or click minimize to exit
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Move className="w-3 h-3" /> Drag header to move • Drag any edge to resize
                        </p>
                        <p className="text-[10px] text-slate-400">
                          <kbd className="px-1 py-0.5 bg-white rounded text-[10px] border">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-white rounded text-[10px] border">.</kbd> toggle
                        </p>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setShowHelp(!showHelp)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      showHelp ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-400'
                    }`}
                    title="Help"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>

                {/* Help Panel */}
                <AnimatePresence>
                  {showHelp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mt-2 overflow-hidden"
                    >
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2 text-xs">
                        <h4 className="font-semibold text-blue-800">Quick Guide</h4>
                        
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <ImageIcon className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Figures</p>
                              <p className="text-blue-600/80">View, insert, and generate figures. Drag thumbnails to insert references.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">AI Assist</p>
                              <p className="text-blue-600/80">Context-aware suggestions based on your content - figures, citations, improvements.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <Wand2 className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Actions</p>
                              <p className="text-blue-600/80">Select text → Rewrite, Expand, Condense, formalize, simplify, or create sections.</p>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-2">
                            <BookOpen className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-700">Citations</p>
                              <p className="text-blue-600/80">Search and insert citations. Click any citation to add [Author, Year] at cursor.</p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-blue-200">
                          <p className="text-blue-600/80">
                            <strong>Tip:</strong> The AI models used can be configured by your administrator in Super Admin → LLM Config.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* Resize Handles - only show when not collapsed and not fullscreen */}
          {!isCollapsed && !isFullscreen && (
            <>
              {/* Left edge resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'left')}
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize group"
              >
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Top edge resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'top')}
                className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize group"
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Bottom edge resize handle */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'bottom')}
                className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize group"
              >
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Corner resize handle (top-left) */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'top-left-corner')}
                className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize group z-10"
              >
                <div className="absolute top-1 left-1 w-2 h-2 border-l-2 border-t-2 border-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Corner resize handle (bottom-left) */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'corner')}
                className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize group z-10"
              >
                <div className="absolute bottom-1 left-1 w-2 h-2 border-l-2 border-b-2 border-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* Figure Preview Modal */}
      <AnimatePresence>
        {previewFigure && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setPreviewFigure(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="font-semibold text-slate-800">Figure {previewFigure.figureNo}: {previewFigure.title}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">{previewFigure.description}</p>
                </div>
                <button
                  onClick={() => setPreviewFigure(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {previewFigure.imagePath && (
                <div className="p-4 bg-slate-50 overflow-auto flex-1">
                  <img
                    src={previewFigure.imagePath}
                    alt={previewFigure.title}
                    className="max-w-full max-h-[58vh] h-auto mx-auto rounded-lg shadow-md object-contain"
                  />
                </div>
              )}
              <div className="p-4 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0 bg-white">
                <Button
                  variant="outline"
                  onClick={() => setPreviewFigure(null)}
                >
                  Close
                </Button>
                {onGenerateExistingFigure && previewFigure.status !== 'GENERATED' && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      setGeneratingExistingFigureId(previewFigure.id);
                      try {
                        await onGenerateExistingFigure(previewFigure.id);
                        await onRefreshFigures?.();
                        setPreviewFigure(null);
                      } finally {
                        setGeneratingExistingFigureId(null);
                      }
                    }}
                    disabled={generatingExistingFigureId === previewFigure.id}
                  >
                    {generatingExistingFigureId === previewFigure.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <Zap className="w-4 h-4 mr-1" />
                    )}
                    {previewFigure.status === 'FAILED' ? 'Retry Generation' : 'Generate Figure'}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    onInsertFigure?.(previewFigure.id);
                    setPreviewFigure(null);
                  }}
                  disabled={previewFigure.status !== 'GENERATED'}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Insert Figure
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Citation Dialog */}
      <Dialog open={!!editingCitation} onOpenChange={() => setEditingCitation(null)}>
        <DialogContent className="max-w-2xl bg-white border-gray-200 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit citation</DialogTitle>
            <DialogDescription>Update the bibliographic details below.</DialogDescription>
          </DialogHeader>

          {editStatusMessage && (
            <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">{editStatusMessage}</div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={editValues.title}
              onChange={e => setEditValues(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Title"
            />
            <Input
              value={editValues.authors}
              onChange={e => setEditValues(prev => ({ ...prev, authors: e.target.value }))}
              placeholder="Authors (comma-separated)"
            />
            <Input
              value={editValues.year}
              onChange={e => setEditValues(prev => ({ ...prev, year: e.target.value }))}
              placeholder="Year"
            />
            <Input
              value={editValues.venue}
              onChange={e => setEditValues(prev => ({ ...prev, venue: e.target.value }))}
              placeholder="Venue / Journal"
            />
            <Input
              value={editValues.volume}
              onChange={e => setEditValues(prev => ({ ...prev, volume: e.target.value }))}
              placeholder="Volume"
            />
            <Input
              value={editValues.issue}
              onChange={e => setEditValues(prev => ({ ...prev, issue: e.target.value }))}
              placeholder="Issue"
            />
            <Input
              value={editValues.pages}
              onChange={e => setEditValues(prev => ({ ...prev, pages: e.target.value }))}
              placeholder="Pages"
            />
            <Input
              value={editValues.doi}
              onChange={e => setEditValues(prev => ({ ...prev, doi: e.target.value }))}
              placeholder="DOI"
            />
            <Input
              value={editValues.url}
              onChange={e => setEditValues(prev => ({ ...prev, url: e.target.value }))}
              placeholder="URL"
            />
            <Input
              value={editValues.publisher}
              onChange={e => setEditValues(prev => ({ ...prev, publisher: e.target.value }))}
              placeholder="Publisher"
            />
            <Input
              value={editValues.edition}
              onChange={e => setEditValues(prev => ({ ...prev, edition: e.target.value }))}
              placeholder="Edition"
            />
            <Input
              value={editValues.editors}
              onChange={e => setEditValues(prev => ({ ...prev, editors: e.target.value }))}
              placeholder="Editors (comma-separated)"
            />
            <Input
              value={editValues.isbn}
              onChange={e => setEditValues(prev => ({ ...prev, isbn: e.target.value }))}
              placeholder="ISBN"
            />
            <Input
              value={editValues.publicationPlace}
              onChange={e => setEditValues(prev => ({ ...prev, publicationPlace: e.target.value }))}
              placeholder="Publication place"
            />
            <Input
              value={editValues.publicationDate}
              onChange={e => setEditValues(prev => ({ ...prev, publicationDate: e.target.value }))}
              placeholder="Publication date (YYYY-MM-DD)"
            />
            <Input
              value={editValues.accessedDate}
              onChange={e => setEditValues(prev => ({ ...prev, accessedDate: e.target.value }))}
              placeholder="Accessed date (YYYY-MM-DD)"
            />
            <Input
              value={editValues.articleNumber}
              onChange={e => setEditValues(prev => ({ ...prev, articleNumber: e.target.value }))}
              placeholder="Article number"
            />
            <Input
              value={editValues.issn}
              onChange={e => setEditValues(prev => ({ ...prev, issn: e.target.value }))}
              placeholder="ISSN"
            />
            <Input
              value={editValues.journalAbbreviation}
              onChange={e => setEditValues(prev => ({ ...prev, journalAbbreviation: e.target.value }))}
              placeholder="Journal abbreviation"
            />
            <Input
              value={editValues.pmid}
              onChange={e => setEditValues(prev => ({ ...prev, pmid: e.target.value }))}
              placeholder="PMID"
            />
            <Input
              value={editValues.pmcid}
              onChange={e => setEditValues(prev => ({ ...prev, pmcid: e.target.value }))}
              placeholder="PMCID"
            />
            <Input
              value={editValues.arxivId}
              onChange={e => setEditValues(prev => ({ ...prev, arxivId: e.target.value }))}
              placeholder="arXiv ID"
            />
            <Input
              value={editValues.tags}
              onChange={e => setEditValues(prev => ({ ...prev, tags: e.target.value }))}
              placeholder="Tags (comma-separated)"
            />
          </div>

          {/* Abstract Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Abstract</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchAbstract}
                disabled={fetchingAbstract}
                className="text-xs"
              >
                {fetchingAbstract ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <Search className="w-3 h-3 mr-1" />
                    Auto-fetch from web
                  </>
                )}
              </Button>
            </div>
            <Textarea
              value={editValues.abstract}
              onChange={e => setEditValues(prev => ({ ...prev, abstract: e.target.value }))}
              placeholder="Paste or type the abstract here, or click 'Auto-fetch from web' to search academic databases..."
              rows={4}
              className="font-serif text-sm"
            />
            <p className="text-xs text-gray-500">
              {editValues.abstract.length} characters
              {editValues.abstract.length > 0 && editValues.abstract.length < 50 && ' (recommended: 50+ for better AI analysis)'}
            </p>
          </div>

          <Textarea
            value={editValues.notes}
            onChange={e => setEditValues(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Notes"
            rows={2}
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingCitation(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave}>
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
