'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  BookOpen,
  GraduationCap,
  Briefcase,
  Newspaper,
  Target,
  Sparkles,
  GripVertical,
  Plus,
  Minus,
  Building2,
  Quote,
  Layers,
  Settings2,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface OutlinePlanningStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  onNavigateToStage?: (stage: string) => void;
}

interface PaperTypeItem {
  code: string;
  name: string;
  description?: string | null;
  requiredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  defaultWordLimits: Record<string, number>;
  defaultCitationStyle?: string | null;
}

interface CitationStyleItem {
  code: string;
  name: string;
  inTextFormatTemplate: string;
}

interface VenueItem {
  code: string;
  name: string;
  venueType: string;
  citationStyle?: { code: string; name: string };
  acceptedPaperTypes?: string[];
  sectionOverrides?: any;
  wordLimitOverrides?: Record<string, number>;
}

// ============================================================================
// Paper Type Icons & Categories
// ============================================================================

const PAPER_TYPE_ICONS: Record<string, any> = {
  JOURNAL_ARTICLE: Newspaper,
  CONFERENCE_PAPER: Briefcase,
  REVIEW_ARTICLE: BookOpen,
  THESIS_PHD: GraduationCap,
  THESIS_MASTERS: GraduationCap,
  CASE_STUDY: Target,
  RESEARCH_PROPOSAL: FileText,
  DISSERTATION: GraduationCap,
  DEFAULT: FileText
};

const PAPER_TYPE_COLORS: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  JOURNAL_ARTICLE: { bg: 'bg-blue-50', border: 'border-blue-200', accent: 'bg-blue-600', icon: 'text-blue-600' },
  CONFERENCE_PAPER: { bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-600', icon: 'text-violet-600' },
  REVIEW_ARTICLE: { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-600', icon: 'text-emerald-600' },
  THESIS_PHD: { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'bg-amber-600', icon: 'text-amber-600' },
  THESIS_MASTERS: { bg: 'bg-orange-50', border: 'border-orange-200', accent: 'bg-orange-600', icon: 'text-orange-600' },
  CASE_STUDY: { bg: 'bg-rose-50', border: 'border-rose-200', accent: 'bg-rose-600', icon: 'text-rose-600' },
  DEFAULT: { bg: 'bg-slate-50', border: 'border-slate-200', accent: 'bg-slate-600', icon: 'text-slate-600' }
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatSectionLabel(sectionKey: string): string {
  return sectionKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPaperTypeColors(code: string) {
  return PAPER_TYPE_COLORS[code] || PAPER_TYPE_COLORS.DEFAULT;
}

function getPaperTypeIcon(code: string) {
  return PAPER_TYPE_ICONS[code] || PAPER_TYPE_ICONS.DEFAULT;
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StepIndicatorProps {
  step: number;
  label: string;
  completed: boolean;
  active: boolean;
  onClick: () => void;
}

function StepIndicator({ step, label, completed, active, onClick }: StepIndicatorProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300
        ${active 
          ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' 
          : completed 
            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }
      `}
    >
      <div className={`
        w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold
        ${active 
          ? 'bg-white text-slate-900' 
          : completed 
            ? 'bg-emerald-500 text-white' 
            : 'bg-slate-300 text-slate-600'
        }
      `}>
        {completed ? <Check className="w-4 h-4" /> : step}
      </div>
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

interface PaperTypeCardProps {
  paperType: PaperTypeItem;
  selected: boolean;
  onSelect: () => void;
}

function PaperTypeCard({ paperType, selected, onSelect }: PaperTypeCardProps) {
  const colors = getPaperTypeColors(paperType.code);
  const Icon = getPaperTypeIcon(paperType.code);

  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative p-6 rounded-2xl border-2 text-left transition-all duration-300
        ${selected 
          ? `${colors.bg} ${colors.border} ring-2 ring-offset-2 ring-slate-900` 
          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'
        }
      `}
    >
      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute -top-2 -right-2 w-6 h-6 ${colors.accent} rounded-full flex items-center justify-center`}
        >
          <Check className="w-4 h-4 text-white" />
        </motion.div>
      )}

      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl ${selected ? colors.accent : 'bg-slate-100'}`}>
          <Icon className={`w-6 h-6 ${selected ? 'text-white' : colors.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold text-lg ${selected ? 'text-slate-900' : 'text-slate-800'}`}>
            {paperType.name}
          </h3>
          {paperType.description && (
            <p className={`text-sm mt-1 line-clamp-2 ${selected ? 'text-slate-700' : 'text-slate-500'}`}>
              {paperType.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <span className={`text-xs px-2 py-1 rounded-full ${selected ? 'bg-white/80 text-slate-700' : 'bg-slate-100 text-slate-600'}`}>
              {paperType.requiredSections?.length || 0} required sections
            </span>
            <span className={`text-xs px-2 py-1 rounded-full ${selected ? 'bg-white/80 text-slate-700' : 'bg-slate-100 text-slate-600'}`}>
              {paperType.optionalSections?.length || 0} optional
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

interface CitationStyleCardProps {
  style: CitationStyleItem;
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}

function CitationStyleCard({ style, selected, recommended, onSelect }: CitationStyleCardProps) {
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative p-4 rounded-xl border-2 text-left transition-all duration-300
        ${selected 
          ? 'bg-slate-900 border-slate-900 text-white' 
          : 'bg-white border-slate-200 hover:border-slate-400'
        }
      `}
    >
      {recommended && !selected && (
        <div className="absolute -top-2 left-4 px-2 py-0.5 bg-amber-500 text-white text-xs font-medium rounded-full flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Recommended
        </div>
      )}
      
      <div className="flex items-center gap-3">
        <Quote className={`w-5 h-5 ${selected ? 'text-white' : 'text-slate-400'}`} />
        <div className="flex-1">
          <h4 className={`font-semibold ${selected ? 'text-white' : 'text-slate-800'}`}>
            {style.name}
          </h4>
          <p className={`text-xs mt-0.5 font-mono ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
            {style.inTextFormatTemplate || 'Preview not available'}
          </p>
        </div>
        {selected && <Check className="w-5 h-5 text-white" />}
      </div>
    </motion.button>
  );
}

interface SectionItemProps {
  sectionKey: string;
  isRequired: boolean;
  wordLimit: number;
  onWordLimitChange: (value: number) => void;
  onRemove?: () => void;
}

function SectionItem({ sectionKey, isRequired, wordLimit, onWordLimitChange, onRemove }: SectionItemProps) {
  return (
    <Reorder.Item
      value={sectionKey}
      className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-3">
        <GripVertical className="w-5 h-5 text-slate-300" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">
              {formatSectionLabel(sectionKey)}
            </span>
            {isRequired && (
              <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                Required
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            value={wordLimit || ''}
            onChange={(e) => onWordLimitChange(parseInt(e.target.value) || 0)}
            placeholder="Words"
            className="w-24 px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
          />
          <span className="text-xs text-slate-400">words</span>
        </div>

        {!isRequired && onRemove && (
          <button
            onClick={onRemove}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
        )}
      </div>
    </Reorder.Item>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function OutlinePlanningStage({ sessionId, authToken, onSessionUpdated, onNavigateToStage }: OutlinePlanningStageProps) {
  // Data state
  const [paperTypes, setPaperTypes] = useState<PaperTypeItem[]>([]);
  const [citationStyles, setCitationStyles] = useState<CitationStyleItem[]>([]);
  const [venues, setVenues] = useState<VenueItem[]>([]);
  
  // Selection state
  const [selectedPaperType, setSelectedPaperType] = useState('');
  const [selectedCitationStyle, setSelectedCitationStyle] = useState('');
  const [selectedVenue, setSelectedVenue] = useState('');
  const [targetWordCount, setTargetWordCount] = useState('');
  
  // Section configuration
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [requiredSections, setRequiredSections] = useState<string[]>([]);
  const [optionalSections, setOptionalSections] = useState<string[]>([]);
  const [wordLimits, setWordLimits] = useState<Record<string, number>>({});
  
  // UI state
  const [activeStep, setActiveStep] = useState<'type' | 'style' | 'structure'>('type');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const storageKey = `paper_section_config_${sessionId}`;

  // ============================================================================
  // Data Loading
  // ============================================================================

  useEffect(() => {
    const loadData = async () => {
      if (!sessionId || !authToken) return;
      
      setLoading(true);
      try {
        const headers = { Authorization: `Bearer ${authToken}` };
        const [typesRes, stylesRes, venuesRes, sessionRes] = await Promise.all([
          fetch('/api/paper-types', { headers }),
          fetch('/api/citation-styles', { headers }),
          fetch('/api/publication-venues', { headers }),
          fetch(`/api/papers/${sessionId}`, { headers })
        ]);

        if (typesRes.ok) {
          const data = await typesRes.json();
          setPaperTypes(data.paperTypes || []);
        }

        if (stylesRes.ok) {
          const data = await stylesRes.json();
          setCitationStyles(data.styles || []);
        }

        if (venuesRes.ok) {
          const data = await venuesRes.json();
          setVenues(data.venues || []);
        }

        if (sessionRes.ok) {
          const data = await sessionRes.json();
          const session = data.session;
          setSelectedPaperType(session?.paperType?.code || '');
          setSelectedCitationStyle(session?.citationStyle?.code || '');
          setSelectedVenue(session?.publicationVenue?.code || '');
          setTargetWordCount(session?.targetWordCount ? String(session.targetWordCount) : '');
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [sessionId, authToken]);

  // ============================================================================
  // Derived State
  // ============================================================================

  const selectedType = useMemo(
    () => paperTypes.find((type) => type.code === selectedPaperType),
    [paperTypes, selectedPaperType]
  );

  const selectedVenueItem = useMemo(
    () => venues.find((venue) => venue.code === selectedVenue),
    [venues, selectedVenue]
  );

  const recommendedCitationStyle = useMemo(
    () => selectedVenueItem?.citationStyle?.code || selectedType?.defaultCitationStyle,
    [selectedVenueItem, selectedType]
  );

  const totalWordLimit = useMemo(
    () => sectionOrder.reduce((sum, key) => sum + (Number(wordLimits[key]) || 0), 0),
    [sectionOrder, wordLimits]
  );

  const completionStatus = useMemo(() => ({
    type: !!selectedPaperType,
    style: !!selectedCitationStyle,
    structure: sectionOrder.length > 0
  }), [selectedPaperType, selectedCitationStyle, sectionOrder]);

  const isFoundationComplete = completionStatus.type && completionStatus.style;

  // ============================================================================
  // Section Configuration
  // ============================================================================

  useEffect(() => {
    if (!selectedType) return;
    if (typeof window === 'undefined') return;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.paperTypeCode === selectedType.code) {
          setSectionOrder(parsed.sectionOrder || selectedType.sectionOrder || []);
          setRequiredSections(parsed.requiredSections || selectedType.requiredSections || []);
          setOptionalSections(parsed.optionalSections || selectedType.optionalSections || []);
          setWordLimits(parsed.wordLimits || selectedType.defaultWordLimits || {});
          return;
        }
      } catch {
        // Ignore parse errors
      }
    }

    setSectionOrder(selectedType.sectionOrder || []);
    setRequiredSections(selectedType.requiredSections || []);
    setOptionalSections(selectedType.optionalSections || []);
    setWordLimits(selectedType.defaultWordLimits || {});
  }, [selectedType, storageKey]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const updateSession = useCallback(async (payload: Record<string, any>) => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/papers/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update settings');
      }

      onSessionUpdated?.(data.session);

      if (data.session?.paperType?.code) {
        setSelectedPaperType(data.session.paperType.code);
      }
      if (data.session?.citationStyle?.code) {
        setSelectedCitationStyle(data.session.citationStyle.code);
      }
      if (data.session?.publicationVenue?.code) {
        setSelectedVenue(data.session.publicationVenue.code);
      }
      if (data.session?.targetWordCount) {
        setTargetWordCount(String(data.session.targetWordCount));
      }

      setMessage({ type: 'success', text: 'Settings saved successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }, [sessionId, authToken, onSessionUpdated]);

  const handleSelectPaperType = useCallback((code: string) => {
    setSelectedPaperType(code);
    updateSession({ paperTypeCode: code });
    
    // Auto-advance to next step
    setTimeout(() => setActiveStep('style'), 300);
  }, [updateSession]);

  const handleSelectCitationStyle = useCallback((code: string) => {
    setSelectedCitationStyle(code);
    updateSession({ citationStyleCode: code });
  }, [updateSession]);

  const handleSelectVenue = useCallback((code: string) => {
    setSelectedVenue(code);
    updateSession({ publicationVenueCode: code });
    
    const venue = venues.find((item) => item.code === code);
    if (venue?.acceptedPaperTypes?.length && !selectedPaperType) {
      handleSelectPaperType(venue.acceptedPaperTypes[0]);
    }
  }, [updateSession, venues, selectedPaperType, handleSelectPaperType]);

  const handleToggleOptional = useCallback((sectionKey: string) => {
    const isSelected = sectionOrder.includes(sectionKey);
    if (isSelected) {
      setSectionOrder((prev) => prev.filter((key) => key !== sectionKey));
    } else {
      setSectionOrder((prev) => [...prev, sectionKey]);
    }
  }, [sectionOrder]);

  const handleWordLimitChange = useCallback((sectionKey: string, value: number) => {
    setWordLimits((prev) => ({ ...prev, [sectionKey]: value }));
  }, []);

  const saveSectionConfig = useCallback((navigateAfterSave = false) => {
    if (typeof window === 'undefined' || !selectedType) return;
    
    const payload = {
      paperTypeCode: selectedType.code,
      sectionOrder,
      requiredSections,
      optionalSections,
      wordLimits
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
    setMessage({ type: 'success', text: 'Section configuration saved' });
    
    if (navigateAfterSave && onNavigateToStage) {
      // Navigate to next stage after a brief delay to show the success message
      setTimeout(() => {
        onNavigateToStage('TOPIC_ENTRY');
      }, 500);
    } else {
      setTimeout(() => setMessage(null), 3000);
    }
  }, [selectedType, sectionOrder, requiredSections, optionalSections, wordLimits, storageKey, onNavigateToStage]);

  const handleContinueToResearchTopic = useCallback(() => {
    // Save configuration first, then navigate
    saveSectionConfig(true);
  }, [saveSectionConfig]);

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
          <p className="text-slate-500 text-sm">Loading paper configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-lg shadow-slate-900/20">
            <Layers className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Paper Foundation
            </h1>
            <p className="text-slate-500 mt-0.5">
              Configure the structure and formatting of your research paper
            </p>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-3 mb-8 p-2 bg-slate-100 rounded-2xl">
        <StepIndicator
          step={1}
          label="Paper Type"
          completed={completionStatus.type}
          active={activeStep === 'type'}
          onClick={() => setActiveStep('type')}
        />
        <ChevronRight className="w-5 h-5 text-slate-400" />
        <StepIndicator
          step={2}
          label="Citation Style"
          completed={completionStatus.style}
          active={activeStep === 'style'}
          onClick={() => setActiveStep('style')}
        />
        <ChevronRight className="w-5 h-5 text-slate-400" />
        <StepIndicator
          step={3}
          label="Structure"
          completed={completionStatus.structure}
          active={activeStep === 'structure'}
          onClick={() => setActiveStep('structure')}
        />
      </div>

      {/* Status Message */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`
              mb-6 p-4 rounded-xl flex items-center gap-3
              ${message.type === 'success' 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                : 'bg-red-50 text-red-700 border border-red-200'
              }
            `}
          >
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="font-medium">{message.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <AnimatePresence mode="wait">
        {/* Step 1: Paper Type */}
        {activeStep === 'type' && (
          <motion.div
            key="type"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Select Paper Type</h2>
              <p className="text-sm text-slate-500">
                Choose the type of academic paper you're writing. This determines the structure and required sections.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {paperTypes.map((type) => (
                <PaperTypeCard
                  key={type.code}
                  paperType={type}
                  selected={selectedPaperType === type.code}
                  onSelect={() => handleSelectPaperType(type.code)}
                />
              ))}
            </div>

            {selectedPaperType && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-end"
              >
                <button
                  onClick={() => setActiveStep('style')}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
                >
                  Continue to Citation Style
                  <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Step 2: Citation Style */}
        {activeStep === 'style' && (
          <motion.div
            key="style"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Choose Citation Style</h2>
              <p className="text-sm text-slate-500">
                Select how citations and references will be formatted in your paper.
              </p>
            </div>

            {/* Venue Selection (Optional) */}
            <div className="bg-slate-50 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <Building2 className="w-5 h-5 text-slate-600" />
                <div>
                  <h3 className="font-medium text-slate-900">Target Publication Venue</h3>
                  <p className="text-xs text-slate-500">Optional - selecting a venue can auto-configure formatting</p>
                </div>
              </div>
              
              <select
                value={selectedVenue}
                onChange={(e) => handleSelectVenue(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none appearance-none cursor-pointer"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 16px center'
                }}
              >
                <option value="">Select a venue (optional)</option>
                {venues.map((venue) => (
                  <option key={venue.code} value={venue.code}>
                    {venue.name}
                  </option>
                ))}
              </select>

              {selectedVenueItem?.citationStyle && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
                  <Sparkles className="w-4 h-4" />
                  <span>
                    <strong>{selectedVenueItem.name}</strong> recommends {selectedVenueItem.citationStyle.name}
                  </span>
                </div>
              )}
            </div>

            {/* Citation Styles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              {citationStyles.map((style) => (
                <CitationStyleCard
                  key={style.code}
                  style={style}
                  selected={selectedCitationStyle === style.code}
                  recommended={recommendedCitationStyle === style.code}
                  onSelect={() => handleSelectCitationStyle(style.code)}
                />
              ))}
            </div>

            {selectedCitationStyle && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-between"
              >
                <button
                  onClick={() => setActiveStep('type')}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setActiveStep('structure')}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
                >
                  Continue to Structure
                  <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Step 3: Structure */}
        {activeStep === 'structure' && (
          <motion.div
            key="structure"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {!selectedType ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl">
                <Settings2 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a Paper Type First</h3>
                <p className="text-slate-500 mb-4">
                  Choose your paper type to configure the section structure.
                </p>
                <button
                  onClick={() => setActiveStep('type')}
                  className="px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
                >
                  Go to Paper Type
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Configure Section Structure</h2>
                  <p className="text-sm text-slate-500">
                    Arrange sections and set word limits. Drag to reorder sections.
                  </p>
                </div>

                {/* Summary Card */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 mb-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Selected Paper Type</div>
                      <div className="text-xl font-semibold">{selectedType.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400 mb-1">Total Word Target</div>
                      <div className="text-xl font-semibold">
                        {totalWordLimit > 0 ? totalWordLimit.toLocaleString() : '—'} words
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sections List */}
                <div className="bg-slate-50 rounded-2xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-900">Included Sections</h3>
                    <span className="text-sm text-slate-500">
                      {sectionOrder.length} sections
                    </span>
                  </div>

                  <Reorder.Group
                    axis="y"
                    values={sectionOrder}
                    onReorder={setSectionOrder}
                    className="space-y-2"
                  >
                    {sectionOrder.map((sectionKey) => (
                      <SectionItem
                        key={sectionKey}
                        sectionKey={sectionKey}
                        isRequired={requiredSections.includes(sectionKey)}
                        wordLimit={wordLimits[sectionKey] || 0}
                        onWordLimitChange={(value) => handleWordLimitChange(sectionKey, value)}
                        onRemove={
                          !requiredSections.includes(sectionKey)
                            ? () => handleToggleOptional(sectionKey)
                            : undefined
                        }
                      />
                    ))}
                  </Reorder.Group>
                </div>

                {/* Optional Sections */}
                {optionalSections.filter((s) => !sectionOrder.includes(s)).length > 0 && (
                  <div className="mb-6">
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Add Optional Sections
                    </button>

                    <AnimatePresence>
                      {showAdvanced && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mt-3 overflow-hidden"
                        >
                          <div className="flex flex-wrap gap-2 p-4 bg-slate-100 rounded-xl">
                            {optionalSections
                              .filter((s) => !sectionOrder.includes(s))
                              .map((sectionKey) => (
                                <button
                                  key={sectionKey}
                                  onClick={() => handleToggleOptional(sectionKey)}
                                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-all"
                                >
                                  <Plus className="w-4 h-4" />
                                  {formatSectionLabel(sectionKey)}
                                </button>
                              ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                  <button
                    onClick={() => setActiveStep('style')}
                    className="flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                  >
                    Back
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => saveSectionConfig(false)}
                      disabled={saving}
                      className="flex items-center gap-2 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-300 transition-colors disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Save Configuration
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleContinueToResearchTopic}
                      disabled={saving}
                      className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      Save & Continue
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Foundation Complete Indicator */}
      {isFoundationComplete && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 p-6 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-emerald-900 text-lg">Paper Foundation Complete!</h3>
              <p className="text-emerald-700 text-sm">
                You've set up your paper type and citation style. Continue to define your research topic.
              </p>
            </div>
            <button
              onClick={handleContinueToResearchTopic}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
            >
              Continue to Research Topic
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
