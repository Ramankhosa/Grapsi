'use client';

/**
 * BlueprintStage - Interactive Paper Blueprint Editor
 * 
 * A mind-map style interface for viewing and editing the paper blueprint.
 * Users can:
 * - Generate blueprint from research topic
 * - Edit thesis statement and central objective
 * - Add/edit/delete dimensions in each section
 * - Freeze blueprint when ready for section generation
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Target,
  Lightbulb,
  AlertCircle,
  Loader2,
  BookOpen,
  Layers,
  GitBranch,
  Zap,
  Ban,
  Link2,
  ArrowLeft,
  ArrowRight,
  ListFilter,
  ArrowUp,
  ArrowDown,
  RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

// ============================================================================
// Types
// ============================================================================

interface DimensionType {
  dimension: string;
  type?: 'foundational' | 'methodological' | 'empirical' | 'comparative' | 'gap';
}

type RhetoricalCitationMode = 'optional' | 'none' | 'required';

interface RhetoricalCitationPolicy {
  mode: RhetoricalCitationMode;
  maxCitations: number;
}

interface RhetoricalSlot {
  key: string;
  required: boolean;
  placement: string;
  intent: string;
  constraints: string[];
  citationPolicy: RhetoricalCitationPolicy;
}

interface RhetoricalBlueprint {
  enabled: boolean;
  slots: RhetoricalSlot[];
}

interface ThematicBlueprint {
  mustCover: string[];
  mustAvoid: string[];
  mustCoverTyping?: Record<string, string>;
  suggestedCitationCount?: number;
}

interface SectionPlanItem {
  sectionKey: string;
  purpose: string;
  mustCover: string[];
  mustCoverTyping?: Record<string, string>;
  mustAvoid: string[];
  wordBudget?: number;
  dependencies: string[];
  outputsPromised: string[];
  suggestedCitationCount?: number;
  thematicBlueprint?: ThematicBlueprint;
  rhetoricalBlueprint?: RhetoricalBlueprint;
}

interface Blueprint {
  id: string;
  sessionId: string;
  thesisStatement: string;
  centralObjective: string;
  keyContributions: string[];
  sectionPlan: SectionPlanItem[];
  preferredTerms: Record<string, string> | null;
  narrativeArc?: string;
  status: 'DRAFT' | 'FROZEN' | 'REVISION_PENDING';
  version: number;
  blueprintSchemaVersion?: number;
}

interface BlueprintStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  onNavigateToStage?: (stage: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DIMENSION_TYPES = [
  { value: 'foundational', label: 'Foundational', color: 'bg-purple-500', description: 'Seminal/historical concepts' },
  { value: 'methodological', label: 'Methodological', color: 'bg-blue-500', description: 'Techniques & approaches' },
  { value: 'empirical', label: 'Empirical', color: 'bg-green-500', description: 'Evidence & data' },
  { value: 'comparative', label: 'Comparative', color: 'bg-orange-500', description: 'Alternatives & baselines' },
  { value: 'gap', label: 'Gap', color: 'bg-red-500', description: 'Limitations & gaps' }
];

const SECTION_ICONS: Record<string, any> = {
  introduction: Lightbulb,
  literature_review: BookOpen,
  methodology: Layers,
  results: Target,
  discussion: GitBranch,
  conclusion: Zap,
  default: BookOpen
};

const ALL_SECTIONS_FILTER = '__all_sections__';
const RHETORICAL_PLACEMENTS = ['start', 'middle', 'end', 'final'] as const;

const RHETORICAL_DEFAULTS_BY_SECTION: Record<string, RhetoricalSlot[]> = {
  introduction: [
    {
      key: 'ContextBackground',
      required: true,
      placement: 'start',
      intent: 'Introduce domain context and establish background.',
      constraints: ['No novelty claims', 'Keep 1-2 paragraphs max'],
      citationPolicy: { mode: 'optional', maxCitations: 2 }
    },
    {
      key: 'GapResearchQuestion',
      required: true,
      placement: 'end',
      intent: 'State the gap and research question clearly near section close.',
      constraints: ['Ground the gap in thematic evidence', 'Avoid solution details'],
      citationPolicy: { mode: 'optional', maxCitations: 2 }
    },
    {
      key: 'Contributions',
      required: true,
      placement: 'final',
      intent: 'Provide the contribution list as the final paragraph.',
      constraints: ['Must match ResearchIntentLock contributions exactly', 'No new claims'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    },
    {
      key: 'PaperStructure',
      required: false,
      placement: 'final',
      intent: 'Optionally preview section flow.',
      constraints: ['1 short paragraph max'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    }
  ],
  literature_review: [
    {
      key: 'ResearchLandscape',
      required: true,
      placement: 'start',
      intent: 'Frame the research landscape at a high level.',
      constraints: ['Use thematic clusters, not paper-by-paper narration'],
      citationPolicy: { mode: 'optional', maxCitations: 2 }
    },
    {
      key: 'ThematicSynthesis',
      required: true,
      placement: 'middle',
      intent: 'Synthesize literature thematically with tension and overlap.',
      constraints: ['Keep claims tied to evidence digest'],
      citationPolicy: { mode: 'optional', maxCitations: 2 }
    },
    {
      key: 'Limitations',
      required: true,
      placement: 'end',
      intent: 'Highlight unresolved limitations in prior work.',
      constraints: ['Do not introduce the paper method yet'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    },
    {
      key: 'StudyPositioning',
      required: false,
      placement: 'end',
      intent: 'Position the current study relative to the mapped gap.',
      constraints: ['Stay concise'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    }
  ],
  methodology: [
    {
      key: 'ResearchDesign',
      required: true,
      placement: 'start',
      intent: 'Declare the research design and rationale.',
      constraints: ['Do not report results'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'SystemArchitecture',
      required: true,
      placement: 'middle',
      intent: 'Describe the system/approach architecture.',
      constraints: ['Align terminology with prior sections'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'DataProtocol',
      required: true,
      placement: 'middle',
      intent: 'Detail data sources, preprocessing, and sampling protocol.',
      constraints: ['Report reproducibility-critical settings'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'EvaluationStrategy',
      required: true,
      placement: 'end',
      intent: 'Define evaluation metrics and comparison plan.',
      constraints: ['No outcome claims'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'ImplementationDetails',
      required: false,
      placement: 'end',
      intent: 'Optional implementation details and tooling notes.',
      constraints: ['Keep concise and reproducible'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    }
  ],
  results: [
    {
      key: 'ExperimentalContext',
      required: true,
      placement: 'start',
      intent: 'State experimental setup context for interpreting outcomes.',
      constraints: ['No method restatement'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'EmpiricalFindings',
      required: true,
      placement: 'middle',
      intent: 'Report empirical findings clearly and directly.',
      constraints: ['Use measured outcomes only'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'ComparativeAnalysis',
      required: true,
      placement: 'end',
      intent: 'Compare findings against baselines or alternatives.',
      constraints: ['Avoid causal overclaims'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    },
    {
      key: 'Robustness',
      required: false,
      placement: 'end',
      intent: 'Optional robustness and sensitivity checks.',
      constraints: ['Mention uncertainty where relevant'],
      citationPolicy: { mode: 'none', maxCitations: 0 }
    }
  ],
  discussion: [
    {
      key: 'Interpretation',
      required: true,
      placement: 'start',
      intent: 'Interpret core findings and their meaning.',
      constraints: ['Tie interpretation to reported results'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    },
    {
      key: 'RelationToLiterature',
      required: true,
      placement: 'middle',
      intent: 'Relate findings to prior literature and disagreements.',
      constraints: ['Use explicit reinforce/contradict/extend framing'],
      citationPolicy: { mode: 'optional', maxCitations: 2 }
    },
    {
      key: 'Implications',
      required: true,
      placement: 'middle',
      intent: 'Explain theoretical/practical implications.',
      constraints: ['Do not introduce unsupported new results'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    },
    {
      key: 'LimitationsFuture',
      required: true,
      placement: 'end',
      intent: 'Close with limitations and future work.',
      constraints: ['Maintain scope discipline'],
      citationPolicy: { mode: 'optional', maxCitations: 1 }
    }
  ]
};

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function toRhetoricalTemplateKey(sectionKey: string): string {
  const normalized = normalizeSectionKey(sectionKey);
  if (normalized === 'related_work') return 'literature_review';
  return normalized;
}

function cloneRhetoricalSlot(slot: RhetoricalSlot): RhetoricalSlot {
  return {
    key: slot.key,
    required: Boolean(slot.required),
    placement: slot.placement,
    intent: slot.intent,
    constraints: [...(slot.constraints || [])],
    citationPolicy: {
      mode: slot.citationPolicy?.mode || 'optional',
      maxCitations: typeof slot.citationPolicy?.maxCitations === 'number'
        ? Math.max(0, Math.min(2, Math.round(slot.citationPolicy.maxCitations)))
        : 1
    }
  };
}

function buildDefaultRhetoricalBlueprint(sectionKey: string): RhetoricalBlueprint {
  const templateKey = toRhetoricalTemplateKey(sectionKey);
  const slots = RHETORICAL_DEFAULTS_BY_SECTION[templateKey] || [];
  return {
    enabled: false,
    slots: slots.map(cloneRhetoricalSlot)
  };
}

function resolveRhetoricalBlueprint(section: SectionPlanItem): RhetoricalBlueprint {
  const fallback = buildDefaultRhetoricalBlueprint(section.sectionKey);
  const incoming = section.rhetoricalBlueprint;
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.slots)) {
    return fallback;
  }

  return {
    enabled: Boolean(incoming.enabled),
    slots: incoming.slots.map(cloneRhetoricalSlot)
  };
}

function syncThematicBlueprint(section: SectionPlanItem): SectionPlanItem {
  const mustCover = Array.isArray(section.mustCover)
    ? section.mustCover.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const mustAvoid = Array.isArray(section.mustAvoid)
    ? section.mustAvoid.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const mustCoverTyping = section.mustCoverTyping && typeof section.mustCoverTyping === 'object'
    ? section.mustCoverTyping
    : undefined;
  const suggestedCitationCount = typeof section.suggestedCitationCount === 'number'
    ? section.suggestedCitationCount
    : section.thematicBlueprint?.suggestedCitationCount;

  return {
    ...section,
    mustCover,
    mustAvoid,
    ...(mustCoverTyping ? { mustCoverTyping } : {}),
    thematicBlueprint: {
      mustCover,
      mustAvoid,
      ...(mustCoverTyping ? { mustCoverTyping } : {}),
      ...(typeof suggestedCitationCount === 'number' ? { suggestedCitationCount } : {})
    }
  };
}

function formatSectionName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================================================
// Sub-Components
// ============================================================================

interface DimensionCardProps {
  dimension: string;
  type?: string;
  sectionKey: string;
  isEditing: boolean;
  isFrozen: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSave: (newDimension: string, newType: string) => void;
  onCancel: () => void;
}

function DimensionCard({
  dimension,
  type = 'empirical',
  isEditing,
  isFrozen,
  onEdit,
  onDelete,
  onSave,
  onCancel
}: DimensionCardProps) {
  const [editValue, setEditValue] = useState(dimension);
  const [editType, setEditType] = useState(type);

  const typeConfig = DIMENSION_TYPES.find(t => t.value === type) || DIMENSION_TYPES[2];

  if (isEditing) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-2 border-blue-300 dark:border-blue-600 shadow-lg"
      >
        <Textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="Enter a citation-mappable dimension..."
          className="text-sm mb-2 min-h-[60px] resize-none bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
          autoFocus
        />
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DIMENSION_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setEditType(t.value)}
              className={`
                px-2 py-1 rounded-full text-xs font-medium transition-all
                ${editType === t.value
                  ? `${t.color} text-white shadow-md scale-105`
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:scale-105'
                }
              `}
              title={t.description}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-slate-500"
          >
            <X className="w-4 h-4 mr-1" /> Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onSave(editValue.trim(), editType)}
            disabled={!editValue.trim() || editValue.trim().length < 10}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Check className="w-4 h-4 mr-1" /> Save
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      whileHover={{ scale: isFrozen ? 1 : 1.02 }}
      className={`
        group relative p-3 rounded-xl
        bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900
        border border-slate-200 dark:border-slate-700
        shadow-sm hover:shadow-md transition-all duration-200
        ${!isFrozen ? 'cursor-pointer' : ''}
      `}
      onClick={() => !isFrozen && onEdit()}
    >
      {/* Type indicator dot */}
      <div className={`absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${typeConfig.color} shadow-lg`} />
      
      {/* Dimension text */}
      <p className="text-sm text-slate-700 dark:text-slate-200 pr-16 leading-relaxed">
        {dimension}
      </p>
      
      {/* Type badge */}
      <Badge
        variant="outline"
        className={`absolute top-2 right-2 text-[10px] px-1.5 py-0 ${typeConfig.color} bg-opacity-10 border-0 text-white`}
      >
        {typeConfig.label}
      </Badge>
      
      {/* Action buttons (visible on hover, hidden when frozen) */}
      {!isFrozen && (
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1 rounded-md bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded-md bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

interface RhetoricalSlotCardProps {
  slot: RhetoricalSlot;
  index: number;
  isEditing: boolean;
  isFrozen: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSave: (slot: RhetoricalSlot) => void;
  onCancel: () => void;
}

function RhetoricalSlotCard({
  slot,
  index,
  isEditing,
  isFrozen,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSave,
  onCancel
}: RhetoricalSlotCardProps) {
  const [draftKey, setDraftKey] = useState(slot.key || '');
  const [draftIntent, setDraftIntent] = useState(slot.intent || '');
  const [draftPlacement, setDraftPlacement] = useState(slot.placement || 'middle');
  const [draftRequired, setDraftRequired] = useState(Boolean(slot.required));
  const [draftMode, setDraftMode] = useState<RhetoricalCitationMode>(slot.citationPolicy?.mode || 'optional');
  const [draftMaxCitations, setDraftMaxCitations] = useState(
    typeof slot.citationPolicy?.maxCitations === 'number'
      ? Math.max(0, Math.min(2, Math.round(slot.citationPolicy.maxCitations)))
      : 1
  );
  const [draftConstraints, setDraftConstraints] = useState((slot.constraints || []).join('\n'));

  useEffect(() => {
    setDraftKey(slot.key || '');
    setDraftIntent(slot.intent || '');
    setDraftPlacement(slot.placement || 'middle');
    setDraftRequired(Boolean(slot.required));
    setDraftMode(slot.citationPolicy?.mode || 'optional');
    setDraftMaxCitations(
      typeof slot.citationPolicy?.maxCitations === 'number'
        ? Math.max(0, Math.min(2, Math.round(slot.citationPolicy.maxCitations)))
        : 1
    );
    setDraftConstraints((slot.constraints || []).join('\n'));
  }, [slot, isEditing]);

  if (isEditing) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border-2 border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 p-3 shadow-sm"
      >
        <div className="grid md:grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Slot Key
            </label>
            <input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="Contributions"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Placement
            </label>
            <select
              value={draftPlacement}
              onChange={(e) => setDraftPlacement(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-sm"
            >
              {RHETORICAL_PLACEMENTS.map((placement) => (
                <option key={placement} value={placement}>
                  {placement}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Intent
          </label>
          <Textarea
            value={draftIntent}
            onChange={(e) => setDraftIntent(e.target.value)}
            className="mt-1 min-h-[80px] resize-y"
          />
        </div>

        <div className="mb-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Constraints (one per line)
          </label>
          <Textarea
            value={draftConstraints}
            onChange={(e) => setDraftConstraints(e.target.value)}
            className="mt-1 min-h-[70px] resize-y"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-2 items-end mb-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-2 text-sm">
            <input
              type="checkbox"
              checked={draftRequired}
              onChange={(e) => setDraftRequired(e.target.checked)}
            />
            Required
          </label>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Citation Mode
            </label>
            <select
              value={draftMode}
              onChange={(e) => setDraftMode(e.target.value as RhetoricalCitationMode)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-sm"
            >
              <option value="optional">optional</option>
              <option value="none">none</option>
              <option value="required">required</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Max Citations
            </label>
            <input
              type="number"
              min={0}
              max={2}
              value={draftMaxCitations}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isFinite(parsed)) {
                  setDraftMaxCitations(0);
                  return;
                }
                setDraftMaxCitations(Math.max(0, Math.min(2, Math.round(parsed))));
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const constraints = draftConstraints
                .split('\n')
                .map(entry => entry.trim())
                .filter(Boolean);
              onSave({
                key: draftKey.trim(),
                required: draftRequired,
                placement: draftPlacement.trim() || 'middle',
                intent: draftIntent.trim(),
                constraints,
                citationPolicy: {
                  mode: draftMode,
                  maxCitations: Math.max(0, Math.min(2, Math.round(draftMaxCitations)))
                }
              });
            }}
            disabled={!draftKey.trim() || !draftIntent.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Check className="w-4 h-4 mr-1" />
            Save Slot
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">
              #{index + 1}
            </Badge>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{slot.key}</span>
            <Badge variant="outline" className="text-[10px]">
              {slot.placement}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${slot.required ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
            >
              {slot.required ? 'required' : 'optional'}
            </Badge>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200 mt-2">{slot.intent}</p>
          {slot.constraints.length > 0 && (
            <ul className="mt-2 space-y-1">
              {slot.constraints.map((constraint, constraintIndex) => (
                <li key={`${slot.key}-constraint-${constraintIndex}`} className="text-xs text-slate-500 dark:text-slate-400">
                  - {constraint}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Citation policy: {slot.citationPolicy.mode}, max {slot.citationPolicy.maxCitations}
          </div>
        </div>

        {!isFrozen && (
          <div className="flex items-center gap-1">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 disabled:opacity-30"
              title="Move up"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 disabled:opacity-30"
              title="Move down"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-md border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-300"
              title="Edit slot"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-md border border-red-200 dark:border-red-700 text-red-600 dark:text-red-300"
              title="Delete slot"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface SectionNodeProps {
  section: SectionPlanItem;
  isFrozen: boolean;
  isFocused?: boolean;
  onUpdateSection: (updated: SectionPlanItem) => void;
}

function SectionNode({ section, isFrozen, isFocused = false, onUpdateSection }: SectionNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'thematic' | 'rhetorical'>('thematic');
  const [editingDimensionIndex, setEditingDimensionIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [isAddingSlot, setIsAddingSlot] = useState(false);

  const Icon = SECTION_ICONS[section.sectionKey] || SECTION_ICONS.default;
  const rhetoricalBlueprint = resolveRhetoricalBlueprint(section);
  const dimensionCount = section.mustCover?.length || 0;
  const mustAvoidCount = section.mustAvoid?.length || 0;
  const dependencyCount = section.dependencies?.length || 0;
  const outputsCount = section.outputsPromised?.length || 0;
  const rhetoricalSlotCount = rhetoricalBlueprint.slots.length;
  const requiredRhetoricalSlots = rhetoricalBlueprint.slots.filter(slot => slot.required).length;

  const pushSectionUpdate = (updated: SectionPlanItem) => {
    onUpdateSection(syncThematicBlueprint(updated));
  };

  const handleSaveDimension = (index: number, newDimension: string, newType: string) => {
    const updated = { ...section };
    updated.mustCover = [...section.mustCover];
    updated.mustCover[index] = newDimension;
    updated.mustCoverTyping = { ...section.mustCoverTyping, [newDimension]: newType };
    
    // Remove old key if dimension text changed
    if (section.mustCover[index] !== newDimension && section.mustCoverTyping?.[section.mustCover[index]]) {
      delete updated.mustCoverTyping[section.mustCover[index]];
    }
    
    pushSectionUpdate(updated);
    setEditingDimensionIndex(null);
  };

  const handleDeleteDimension = (index: number) => {
    const updated = { ...section };
    const removedDimension = section.mustCover[index];
    updated.mustCover = section.mustCover.filter((_, i) => i !== index);
    
    if (section.mustCoverTyping?.[removedDimension]) {
      updated.mustCoverTyping = { ...section.mustCoverTyping };
      delete updated.mustCoverTyping[removedDimension];
    }
    
    pushSectionUpdate(updated);
  };

  const handleAddDimension = (newDimension: string, newType: string) => {
    const updated = { ...section };
    updated.mustCover = [...section.mustCover, newDimension];
    updated.mustCoverTyping = { ...section.mustCoverTyping, [newDimension]: newType };
    pushSectionUpdate(updated);
    setIsAddingNew(false);
  };

  const updateRhetoricalBlueprint = (next: RhetoricalBlueprint) => {
    pushSectionUpdate({
      ...section,
      rhetoricalBlueprint: next
    });
  };

  const handleToggleRhetoricalEnabled = () => {
    updateRhetoricalBlueprint({
      ...rhetoricalBlueprint,
      enabled: !rhetoricalBlueprint.enabled
    });
  };

  const handleSaveRhetoricalSlot = (index: number, slot: RhetoricalSlot) => {
    const updatedSlots = [...rhetoricalBlueprint.slots];
    updatedSlots[index] = cloneRhetoricalSlot(slot);
    updateRhetoricalBlueprint({
      ...rhetoricalBlueprint,
      slots: updatedSlots
    });
    setEditingSlotIndex(null);
  };

  const handleDeleteRhetoricalSlot = (index: number) => {
    const updatedSlots = rhetoricalBlueprint.slots.filter((_, slotIndex) => slotIndex !== index);
    updateRhetoricalBlueprint({
      ...rhetoricalBlueprint,
      slots: updatedSlots
    });
    setEditingSlotIndex(null);
  };

  const handleMoveRhetoricalSlot = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= rhetoricalBlueprint.slots.length) return;
    const updatedSlots = [...rhetoricalBlueprint.slots];
    const [moved] = updatedSlots.splice(fromIndex, 1);
    updatedSlots.splice(toIndex, 0, moved);
    updateRhetoricalBlueprint({
      ...rhetoricalBlueprint,
      slots: updatedSlots
    });
    setEditingSlotIndex(toIndex);
  };

  const handleAddRhetoricalSlot = (slot: RhetoricalSlot) => {
    updateRhetoricalBlueprint({
      ...rhetoricalBlueprint,
      slots: [...rhetoricalBlueprint.slots, cloneRhetoricalSlot(slot)]
    });
    setIsAddingSlot(false);
  };

  const handleResetRhetoricalDefaults = () => {
    const defaults = buildDefaultRhetoricalBlueprint(section.sectionKey);
    defaults.enabled = rhetoricalBlueprint.enabled;
    updateRhetoricalBlueprint(defaults);
    setEditingSlotIndex(null);
    setIsAddingSlot(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative"
    >
      {/* Connector line from center */}
      <div className="absolute -left-8 top-8 w-8 h-0.5 bg-gradient-to-r from-blue-300 to-transparent dark:from-blue-600" />
      
      <Card className={`overflow-hidden border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm ${isFocused ? 'ring-2 ring-blue-300 dark:ring-blue-700 shadow-blue-200/40 dark:shadow-blue-900/20' : ''}`}>
        {/* Section Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-semibold text-slate-900 dark:text-white">
              {formatSectionName(section.sectionKey)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
              {section.purpose}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">{dimensionCount} must have</Badge>
            <Badge variant="outline" className="text-xs border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300">{mustAvoidCount} don&apos;t do</Badge>
            <Badge
              variant="outline"
              className={`text-xs ${rhetoricalBlueprint.enabled ? 'border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
            >
              rhetorical {rhetoricalBlueprint.enabled ? 'on' : 'off'}
            </Badge>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-5 h-5 text-slate-400" />
            </motion.div>
          </div>
        </button>

        {/* Dimensions List */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <CardContent className="pt-0 pb-4 px-4">
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                      Purpose
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                      {section.purpose || 'No purpose defined.'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 p-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setActiveTab('thematic')}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                          activeTab === 'thematic'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Thematic Blueprint
                      </button>
                      <button
                        onClick={() => setActiveTab('rhetorical')}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                          activeTab === 'rhetorical'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Rhetorical Blueprint
                      </button>
                    </div>
                  </div>

                  {activeTab === 'thematic' ? (
                    <>
                      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/20 p-3">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            Must Have ({dimensionCount})
                          </div>
                          {section.suggestedCitationCount && (
                            <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                              ~{section.suggestedCitationCount} citations
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-2 ml-2 border-l-2 border-emerald-200/80 dark:border-emerald-900/70 pl-4">
                          {section.mustCover.map((dim, idx) => (
                            <DimensionCard
                              key={`${section.sectionKey}-${idx}`}
                              dimension={dim}
                              type={section.mustCoverTyping?.[dim]}
                              sectionKey={section.sectionKey}
                              isEditing={editingDimensionIndex === idx}
                              isFrozen={isFrozen}
                              onEdit={() => setEditingDimensionIndex(idx)}
                              onDelete={() => handleDeleteDimension(idx)}
                              onSave={(newDim, newType) => handleSaveDimension(idx, newDim, newType)}
                              onCancel={() => setEditingDimensionIndex(null)}
                            />
                          ))}

                          {dimensionCount === 0 && (
                            <div className="text-sm text-emerald-700/70 dark:text-emerald-300/70">
                              No must-have dimensions yet.
                            </div>
                          )}

                          {isAddingNew ? (
                            <DimensionCard
                              dimension=""
                              type="empirical"
                              sectionKey={section.sectionKey}
                              isEditing={true}
                              isFrozen={false}
                              onEdit={() => {}}
                              onDelete={() => setIsAddingNew(false)}
                              onSave={handleAddDimension}
                              onCancel={() => setIsAddingNew(false)}
                            />
                          ) : !isFrozen && (
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setIsAddingNew(true)}
                              className="w-full p-3 rounded-xl border-2 border-dashed border-emerald-300 dark:border-emerald-700
                                text-emerald-700 dark:text-emerald-400 hover:border-emerald-500 hover:text-emerald-800
                                dark:hover:border-emerald-500 dark:hover:text-emerald-300
                                flex items-center justify-center gap-2 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                              <span className="text-sm">Add Must-Have Dimension</span>
                            </motion.button>
                          )}
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/20 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300 mb-2 flex items-center gap-1.5">
                            <Ban className="w-3.5 h-3.5" />
                            Don&apos;t Do ({mustAvoidCount})
                          </div>
                          {mustAvoidCount > 0 ? (
                            <ul className="space-y-1.5">
                              {section.mustAvoid.map((item, idx) => (
                                <li key={`${section.sectionKey}-avoid-${idx}`} className="flex items-start gap-2 text-sm text-rose-800 dark:text-rose-200">
                                  <span className="mt-0.5 text-rose-500 dark:text-rose-400">
                                    <X className="w-3.5 h-3.5" />
                                  </span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-rose-700/70 dark:text-rose-300/70">No explicit avoid rules defined.</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1.5">
                            <Link2 className="w-3.5 h-3.5" />
                            Must Do Before ({dependencyCount})
                          </div>
                          {dependencyCount > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {section.dependencies.map((dependency) => (
                                <Badge
                                  key={`${section.sectionKey}-dependency-${dependency}`}
                                  variant="outline"
                                  className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                                >
                                  {formatSectionName(dependency)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-amber-700/70 dark:text-amber-300/70">No required dependency sections.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/20 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-2 flex items-center gap-1.5">
                          <ChevronRight className="w-3.5 h-3.5" />
                          Outputs Promised ({outputsCount})
                        </div>
                        {outputsCount > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {section.outputsPromised.map((output, idx) => (
                              <Badge
                                key={`${section.sectionKey}-output-${idx}`}
                                className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-900/60 dark:text-indigo-200"
                              >
                                {output}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-indigo-700/70 dark:text-indigo-300/70">No downstream outputs listed.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                              Prompt-Level Argument Moves
                            </div>
                            <p className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-1">
                              Rhetorical slots guide section structure only and are excluded from evidence mapping and citation coverage validators.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleToggleRhetoricalEnabled}
                              disabled={isFrozen}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                                rhetoricalBlueprint.enabled
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                              } ${isFrozen ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {rhetoricalBlueprint.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                            {!isFrozen && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleResetRhetoricalDefaults}
                                className="text-xs"
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                Reset Defaults
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300">
                            {rhetoricalSlotCount} slots
                          </Badge>
                          <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                            {requiredRhetoricalSlots} required
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {rhetoricalBlueprint.slots.map((slot, slotIndex) => (
                          <RhetoricalSlotCard
                            key={`${section.sectionKey}-slot-${slotIndex}-${slot.key}`}
                            slot={slot}
                            index={slotIndex}
                            isEditing={editingSlotIndex === slotIndex}
                            isFrozen={isFrozen}
                            canMoveUp={slotIndex > 0}
                            canMoveDown={slotIndex < rhetoricalBlueprint.slots.length - 1}
                            onEdit={() => setEditingSlotIndex(slotIndex)}
                            onDelete={() => handleDeleteRhetoricalSlot(slotIndex)}
                            onMoveUp={() => handleMoveRhetoricalSlot(slotIndex, slotIndex - 1)}
                            onMoveDown={() => handleMoveRhetoricalSlot(slotIndex, slotIndex + 1)}
                            onSave={(nextSlot) => handleSaveRhetoricalSlot(slotIndex, nextSlot)}
                            onCancel={() => setEditingSlotIndex(null)}
                          />
                        ))}

                        {rhetoricalBlueprint.slots.length === 0 && (
                          <div className="rounded-xl border border-slate-300 dark:border-slate-700 border-dashed p-4 text-sm text-slate-500 dark:text-slate-400">
                            No rhetorical slots configured for this section.
                          </div>
                        )}

                        {isAddingSlot ? (
                          <RhetoricalSlotCard
                            slot={{
                              key: '',
                              required: true,
                              placement: 'middle',
                              intent: '',
                              constraints: [],
                              citationPolicy: { mode: 'optional', maxCitations: 1 }
                            }}
                            index={rhetoricalBlueprint.slots.length}
                            isEditing={true}
                            isFrozen={false}
                            canMoveUp={false}
                            canMoveDown={false}
                            onEdit={() => {}}
                            onDelete={() => setIsAddingSlot(false)}
                            onMoveUp={() => {}}
                            onMoveDown={() => {}}
                            onSave={handleAddRhetoricalSlot}
                            onCancel={() => setIsAddingSlot(false)}
                          />
                        ) : !isFrozen && (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setIsAddingSlot(true)}
                            className="w-full p-3 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-800
                              text-blue-700 dark:text-blue-300 hover:border-blue-500 dark:hover:border-blue-600
                              flex items-center justify-center gap-2 transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                            <span className="text-sm">Add Rhetorical Slot</span>
                          </motion.button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 flex-wrap">
                  {section.wordBudget ? (
                    <Badge variant="secondary" className="text-xs">
                      ~{section.wordBudget} words
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-slate-500 border-slate-300 dark:border-slate-700 dark:text-slate-400">
                      Word budget not set
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                    {dimensionCount} must-have dimensions
                  </Badge>
                  <Badge variant="outline" className="text-xs border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300">
                    {mustAvoidCount} avoid rules
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs ${rhetoricalBlueprint.enabled ? 'border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
                  >
                    {rhetoricalSlotCount} rhetorical slots
                  </Badge>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BlueprintStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage
}: BlueprintStageProps) {
  // Debug: Log props on every render - this should appear in browser console
  console.log('[BlueprintStage] RENDER - sessionId:', sessionId, 'authToken:', authToken ? 'present' : 'null');
  
  const { showToast } = useToast();
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Editing states
  const [editingThesis, setEditingThesis] = useState(false);
  const [editingObjective, setEditingObjective] = useState(false);
  const [thesisValue, setThesisValue] = useState('');
  const [objectiveValue, setObjectiveValue] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>(ALL_SECTIONS_FILTER);

  // Load blueprint
  const loadBlueprint = useCallback(async () => {
    console.log('[BlueprintStage] loadBlueprint called - authToken:', authToken ? 'present' : 'null', 'sessionId:', sessionId);
    
    if (!authToken || !sessionId) {
      // If auth token or session ID is not yet available, stop loading but don't error
      console.log('[BlueprintStage] Missing authToken or sessionId, setting loading=false');
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      console.log('[BlueprintStage] Fetching blueprint from API...');
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      
      const data = await res.json();
      console.log('[BlueprintStage] API response:', { ok: res.ok, hasBlueprint: !!data.blueprint, status: res.status });
      
      if (!res.ok) throw new Error(data.error || 'Failed to load blueprint');
      
      setBlueprint(data.blueprint);
      if (data.blueprint) {
        setThesisValue(data.blueprint.thesisStatement || '');
        setObjectiveValue(data.blueprint.centralObjective || '');
      }
      setError(null);
    } catch (err) {
      console.error('[BlueprintStage] Error loading blueprint:', err);
      setError(err instanceof Error ? err.message : 'Failed to load blueprint');
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    loadBlueprint();
  }, [loadBlueprint]);

  // Generate blueprint
  const handleGenerate = async () => {
    if (!authToken) return;
    
    try {
      setGenerating(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'generate' })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate blueprint');
      
      setBlueprint(data.blueprint);
      setThesisValue(data.blueprint.thesisStatement || '');
      setObjectiveValue(data.blueprint.centralObjective || '');
      showToast({ type: 'success', title: 'Blueprint generated!', message: 'Review and customize your paper structure.' });
    } catch (err) {
      showToast({ 
        type: 'error',
        title: 'Generation failed', 
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setGenerating(false);
    }
  };

  // Save blueprint updates
  const handleSave = async (updates: Partial<Blueprint>) => {
    if (!authToken || !blueprint) return;
    
    try {
      setSaving(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'update', ...updates })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      
      setBlueprint(data.blueprint);
      showToast({ type: 'success', title: 'Saved', message: 'Blueprint updated successfully.' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Freeze/unfreeze blueprint
  const handleToggleFreeze = async () => {
    if (!authToken || !blueprint) return;
    
    const action = blueprint.status === 'FROZEN' ? 'unfreeze' : 'freeze';
    
    try {
      setSaving(true);
      const res = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action}`);
      
      setBlueprint(data.blueprint);
      showToast({
        type: 'success',
        title: action === 'freeze' ? 'Blueprint Frozen' : 'Blueprint Unlocked',
        message: action === 'freeze' 
          ? 'Your blueprint is now locked. You can proceed to literature search.'
          : 'Blueprint unlocked for editing. Existing sections marked as stale.'
      });
      
      // Navigate to literature search after freezing
      if (action === 'freeze' && onNavigateToStage) {
        setTimeout(() => onNavigateToStage('LITERATURE_SEARCH'), 1500);
      }
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Action failed',
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Update section
  const handleUpdateSection = (sectionKey: string, updated: SectionPlanItem) => {
    if (!blueprint) return;
    
    const newSectionPlan = blueprint.sectionPlan.map(s =>
      s.sectionKey === sectionKey ? syncThematicBlueprint(updated) : s
    );
    
    handleSave({ sectionPlan: newSectionPlan } as any);
  };

  const isFrozen = blueprint?.status === 'FROZEN';
  const sections = useMemo(() => blueprint?.sectionPlan ?? [], [blueprint?.sectionPlan]);

  useEffect(() => {
    if (!sections.length) {
      setSectionFilter(ALL_SECTIONS_FILTER);
      return;
    }

    if (sectionFilter !== ALL_SECTIONS_FILTER && !sections.some(section => section.sectionKey === sectionFilter)) {
      setSectionFilter(ALL_SECTIONS_FILTER);
    }
  }, [sections, sectionFilter]);

  const filteredSections = sectionFilter === ALL_SECTIONS_FILTER
    ? sections
    : sections.filter(section => section.sectionKey === sectionFilter);

  const selectedSectionIndex = sections.findIndex(section => section.sectionKey === sectionFilter);
  const totalMustHave = sections.reduce((sum, section) => sum + (section.mustCover?.length || 0), 0);
  const totalDontDo = sections.reduce((sum, section) => sum + (section.mustAvoid?.length || 0), 0);
  const totalRhetoricalEnabled = sections.reduce((sum, section) => (
    resolveRhetoricalBlueprint(section).enabled ? sum + 1 : sum
  ), 0);

  const moveSectionFilter = (direction: -1 | 1) => {
    if (!sections.length || sectionFilter === ALL_SECTIONS_FILTER) return;
    const nextIndex = selectedSectionIndex + direction;
    if (nextIndex >= 0 && nextIndex < sections.length) {
      setSectionFilter(sections[nextIndex].sectionKey);
    }
  };

  // Debug: Log current state - this should appear in browser console
  console.log('[BlueprintStage] STATE - loading:', loading, 'blueprint:', blueprint ? 'exists' : 'null', 'error:', error, 'authToken:', authToken ? 'present' : 'null');

  // ============================================================================
  // DEBUG: Visible state panel (temporary for debugging)
  // ============================================================================
  
  const debugInfo = {
    sessionId: sessionId || 'null',
    authToken: authToken ? 'present' : 'null',
    loading,
    blueprint: blueprint ? 'exists' : 'null',
    error: error || 'null'
  };

  // ============================================================================
  // Render: Missing Auth Token - Show waiting message
  // ============================================================================
  
  if (!authToken) {
    console.log('[BlueprintStage] Rendering: No auth token available');
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Waiting for authentication...</p>
          <p className="text-xs text-slate-400 mt-2">If this persists, try refreshing the page or logging in again.</p>
        </div>
        {/* Debug panel */}
        <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-mono">
          <div className="text-slate-500 mb-1">Debug Info:</div>
          <pre className="text-slate-600 dark:text-slate-300">{JSON.stringify(debugInfo, null, 2)}</pre>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Loading State
  // ============================================================================
  
  if (loading) {
    console.log('[BlueprintStage] Rendering: loading state');
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Loading blueprint...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: No Blueprint (Generate CTA)
  // ============================================================================

  if (!blueprint) {
    console.log('[BlueprintStage] Rendering: no-blueprint CTA (Generate Blueprint button)');
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          {/* Hero Icon */}
          <div className="relative mx-auto w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl rotate-6 opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl -rotate-3 opacity-40" />
            <div className="relative bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl w-full h-full flex items-center justify-center shadow-xl">
              <Target className="w-12 h-12 text-white" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
            Create Your Paper Blueprint
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8 max-w-md mx-auto">
            Generate an intelligent blueprint that defines the structure and key dimensions 
            each section must cover. This ensures coherent, well-organized academic writing.
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={generating}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating Blueprint...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Blueprint
              </>
            )}
          </Button>

          <p className="mt-4 text-xs text-slate-400">
            Make sure you&apos;ve completed the Research Topic stage first
          </p>
        </motion.div>
      </div>
    );
  }

  // ============================================================================
  // Render: Blueprint Editor (Mind Map Style)
  // ============================================================================

  console.log('[BlueprintStage] Rendering blueprint editor - sections:', blueprint.sectionPlan?.length || 0);

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Paper Blueprint</h1>
              <div className="flex items-center gap-2">
                <Badge variant={isFrozen ? 'default' : 'secondary'} className="text-xs">
                  {isFrozen ? (
                    <><Lock className="w-3 h-3 mr-1" /> Frozen</>
                  ) : (
                    <><Unlock className="w-3 h-3 mr-1" /> Draft</>
                  )}
                </Badge>
                <span className="text-xs text-slate-400">v{blueprint.version}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </span>
            )}
            <Button
              variant={isFrozen ? 'outline' : 'default'}
              onClick={handleToggleFreeze}
              disabled={saving}
              className={!isFrozen ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white' : ''}
            >
              {isFrozen ? (
                <><Unlock className="w-4 h-4 mr-2" /> Unlock for Editing</>
              ) : (
                <><Lock className="w-4 h-4 mr-2" /> Freeze & Continue</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Frozen Warning Banner */}
      {isFrozen && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Blueprint is frozen. Unlock to make changes.</span>
          </div>
        </div>
      )}

      {/* Main Content - Mind Map Layout */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Central Node: Thesis & Objective */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative max-w-2xl mx-auto mb-12"
        >
          <Card className="border-0 shadow-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 overflow-hidden">
            {/* Decorative background */}
            <div className="absolute inset-0 opacity-5">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl" />
            </div>

            <CardContent className="relative p-6">
              {/* Thesis Statement */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                    Thesis Statement
                  </span>
                  {!isFrozen && !editingThesis && (
                    <button
                      onClick={() => setEditingThesis(true)}
                      className="ml-auto p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingThesis ? (
                  <div className="space-y-2">
                    <Textarea
                      value={thesisValue}
                      onChange={(e) => setThesisValue(e.target.value)}
                      className="min-h-[80px] resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setThesisValue(blueprint.thesisStatement);
                        setEditingThesis(false);
                      }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => {
                        handleSave({ thesisStatement: thesisValue });
                        setEditingThesis(false);
                      }}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    {blueprint.thesisStatement}
                  </p>
                )}
              </div>

              {/* Central Objective */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                    Central Objective
                  </span>
                  {!isFrozen && !editingObjective && (
                    <button
                      onClick={() => setEditingObjective(true)}
                      className="ml-auto p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-500"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingObjective ? (
                  <div className="space-y-2">
                    <Textarea
                      value={objectiveValue}
                      onChange={(e) => setObjectiveValue(e.target.value)}
                      className="min-h-[60px] resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setObjectiveValue(blueprint.centralObjective);
                        setEditingObjective(false);
                      }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => {
                        handleSave({ centralObjective: objectiveValue });
                        setEditingObjective(false);
                      }}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                    {blueprint.centralObjective}
                  </p>
                )}
              </div>

              {/* Key Contributions */}
              {blueprint.keyContributions && blueprint.keyContributions.length > 0 && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">
                    Key Contributions
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {blueprint.keyContributions.map((contrib, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {contrib.length > 60 ? contrib.slice(0, 60) + '...' : contrib}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {blueprint.narrativeArc && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">
                    Narrative Arc
                  </span>
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {blueprint.narrativeArc}
                  </p>
                </div>
              )}

              {blueprint.preferredTerms && Object.keys(blueprint.preferredTerms).length > 0 && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 block">
                    Preferred Terms
                  </span>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {Object.entries(blueprint.preferredTerms).map(([term, definition]) => (
                      <div
                        key={term}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 px-3 py-2"
                      >
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{term}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{definition}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Connector to sections */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-8 w-0.5 h-8 bg-gradient-to-b from-blue-300 to-transparent dark:from-blue-600" />
        </motion.div>

        {/* Section Review Filters */}
        <div className="mb-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-sm p-4 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <ListFilter className="w-4 h-4 text-blue-500" />
                Section-Wise Review
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Filter to one section to reduce overload, or keep all visible.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-xs">
                {sections.length} sections
              </Badge>
              <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">
                {totalMustHave} must-have
              </Badge>
              <Badge variant="outline" className="text-xs border-rose-300 text-rose-700 dark:border-rose-900 dark:text-rose-300">
                {totalDontDo} don&apos;t-do
              </Badge>
              <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-300">
                {totalRhetoricalEnabled} rhetorical enabled
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSectionFilter(ALL_SECTIONS_FILTER)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                sectionFilter === ALL_SECTIONS_FILTER
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-blue-400'
              }`}
            >
              All Sections
            </button>
            {sections.map((section, index) => (
              <button
                key={section.sectionKey}
                onClick={() => setSectionFilter(section.sectionKey)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  sectionFilter === section.sectionKey
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-indigo-400'
                }`}
                title={`Must have: ${section.mustCover?.length || 0} | Don't do: ${section.mustAvoid?.length || 0}`}
              >
                {index + 1}. {formatSectionName(section.sectionKey)}
              </button>
            ))}
          </div>

          {sectionFilter !== ALL_SECTIONS_FILTER && selectedSectionIndex >= 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reviewing section {selectedSectionIndex + 1} of {sections.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => moveSectionFilter(-1)}
                  disabled={selectedSectionIndex <= 0}
                  className="text-xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => moveSectionFilter(1)}
                  disabled={selectedSectionIndex >= sections.length - 1}
                  className="text-xs"
                >
                  Next
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Section Nodes */}
        <div className={`grid gap-6 ${sectionFilter === ALL_SECTIONS_FILTER ? 'md:grid-cols-2 pl-8' : 'max-w-3xl mx-auto'}`}>
          {filteredSections.map((section) => (
            <SectionNode
              key={section.sectionKey}
              section={section}
              isFrozen={isFrozen}
              isFocused={sectionFilter !== ALL_SECTIONS_FILTER}
              onUpdateSection={(updated) => handleUpdateSection(section.sectionKey, updated)}
            />
          ))}
        </div>

        {/* Dimension Type Legend */}
        <div className="mt-12 flex items-center justify-center gap-6 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">DIMENSION TYPES:</span>
          {DIMENSION_TYPES.map(type => (
            <div key={type.value} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${type.color}`} />
              <span className="text-xs text-slate-500 dark:text-slate-400">{type.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

