'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Target,
  ListChecks,
  Lightbulb,
  AlertTriangle,
  Check,
  X,
  Loader2,
  Lock,
  Unlock,
  RefreshCw,
  Edit3,
  ChevronDown,
  ChevronRight,
  Sparkles,
  BookOpen,
  LayoutList,
  MessageSquare,
  Save,
  Wand2,
  ScrollText,
  Layers,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface SectionPlanItem {
  sectionKey: string;
  purpose: string;
  mustCover: string[];
  mustAvoid: string[];
  wordBudget?: number;
  dependencies: string[];
  outputsPromised: string[];
}

interface Blueprint {
  id: string;
  sessionId: string;
  version: number;
  status: 'DRAFT' | 'FROZEN';
  thesisStatement: string;
  centralObjective: string;
  keyContributions: string[];
  sectionPlan: SectionPlanItem[];
  methodologyType?: string;
  preferredTerms?: Record<string, string>;
  changeLog?: Array<{ version: number; changedAt: string; changes: string[] }>;
  frozenAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface BlueprintApprovalPanelProps {
  sessionId: string;
  authToken: string | null;
  hasResearchTopic: boolean;
  onBlueprintApproved?: (blueprint: Blueprint) => void;
  onBlueprintUpdated?: (blueprint: Blueprint) => void;
}

// ============================================================================
// Section Display Names
// ============================================================================

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  literature_review: 'Literature Review',
  related_work: 'Related Work',
  methodology: 'Methodology',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  acknowledgments: 'Acknowledgments',
  references: 'References',
  future_directions: 'Future Directions',
  future_work: 'Future Work',
  case_description: 'Case Description',
  analysis: 'Analysis',
  recommendations: 'Recommendations',
  main_content: 'Main Content',
  case_studies: 'Case Studies',
  main_findings: 'Main Findings',
  appendix: 'Appendix'
};

const SECTION_COLORS: Record<string, string> = {
  abstract: 'from-violet-500 to-purple-600',
  introduction: 'from-blue-500 to-indigo-600',
  literature_review: 'from-teal-500 to-emerald-600',
  related_work: 'from-teal-500 to-emerald-600',
  methodology: 'from-amber-500 to-orange-600',
  results: 'from-green-500 to-emerald-600',
  discussion: 'from-pink-500 to-rose-600',
  conclusion: 'from-slate-600 to-slate-800'
};

// ============================================================================
// Sub-Components
// ============================================================================

function SectionPlanCard({ 
  section, 
  index, 
  isExpanded, 
  onToggle,
  isEditing,
  onEdit,
  onSave
}: { 
  section: SectionPlanItem; 
  index: number; 
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  onEdit: (updates: Partial<SectionPlanItem>) => void;
  onSave: () => void;
}) {
  const displayName = SECTION_DISPLAY_NAMES[section.sectionKey] || section.sectionKey;
  const gradient = SECTION_COLORS[section.sectionKey] || 'from-slate-500 to-slate-700';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
          <span className="text-white font-bold text-sm">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800">{displayName}</div>
          <div className="text-sm text-slate-500 truncate">{section.purpose}</div>
        </div>
        <div className="flex items-center gap-2">
          {section.wordBudget && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
              ~{section.wordBudget} words
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-0 space-y-4">
              {/* Purpose */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <Target className="w-3.5 h-3.5" />
                  Purpose
                </label>
                {isEditing ? (
                  <textarea
                    value={section.purpose}
                    onChange={(e) => onEdit({ purpose: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg resize-none"
                    rows={2}
                  />
                ) : (
                  <p className="text-sm text-slate-700">{section.purpose}</p>
                )}
              </div>

              {/* Must Cover */}
              <div>
                <label className="text-xs font-semibold text-emerald-600 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <Check className="w-3.5 h-3.5" />
                  Must Cover
                </label>
                <ul className="space-y-1">
                  {section.mustCover.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="text-emerald-500 mt-0.5">✓</span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={item}
                          onChange={(e) => {
                            const newItems = [...section.mustCover];
                            newItems[i] = e.target.value;
                            onEdit({ mustCover: newItems });
                          }}
                          className="flex-1 px-2 py-1 text-sm bg-slate-50 border border-slate-200 rounded"
                        />
                      ) : (
                        <span>{item}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Must Avoid */}
              {section.mustAvoid.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-red-600 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <X className="w-3.5 h-3.5" />
                    Must Avoid
                  </label>
                  <ul className="space-y-1">
                    {section.mustAvoid.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-red-400 mt-0.5">✗</span>
                        {isEditing ? (
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const newItems = [...section.mustAvoid];
                              newItems[i] = e.target.value;
                              onEdit({ mustAvoid: newItems });
                            }}
                            className="flex-1 px-2 py-1 text-sm bg-slate-50 border border-slate-200 rounded"
                          />
                        ) : (
                          <span>{item}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Dependencies */}
              {section.dependencies.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Depends On
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {section.dependencies.map(dep => (
                      <span key={dep} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                        {SECTION_DISPLAY_NAMES[dep] || dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Outputs Promised */}
              {section.outputsPromised.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <ArrowRight className="w-3.5 h-3.5" />
                    Outputs for Later Sections
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {section.outputsPromised.map((output, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                        {output}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BlueprintApprovalPanel({
  sessionId,
  authToken,
  hasResearchTopic,
  onBlueprintApproved,
  onBlueprintUpdated
}: BlueprintApprovalPanelProps) {
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // UI State
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [editedBlueprint, setEditedBlueprint] = useState<Blueprint | null>(null);
  const [showFullBlueprint, setShowFullBlueprint] = useState(true);

  // ============================================================================
  // Data Loading
  // ============================================================================

  const loadBlueprint = useCallback(async () => {
    if (!sessionId || !authToken) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/papers/${sessionId}/blueprint`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load blueprint');
      }

      if (data.blueprint) {
        setBlueprint(data.blueprint);
        setEditedBlueprint(data.blueprint);
      }
    } catch (err) {
      console.error('Blueprint load error:', err);
      // Don't show error if blueprint just doesn't exist yet
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    loadBlueprint();
  }, [loadBlueprint]);

  // ============================================================================
  // Actions
  // ============================================================================

  const generateBlueprint = async () => {
    if (!authToken || !hasResearchTopic) return;

    try {
      setGenerating(true);
      setError(null);

      const response = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'generate' })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate blueprint');
      }

      setBlueprint(data.blueprint);
      setEditedBlueprint(data.blueprint);
      setSuccess('Blueprint generated! Review and approve to start drafting.');
      onBlueprintUpdated?.(data.blueprint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate blueprint');
    } finally {
      setGenerating(false);
    }
  };

  const freezeBlueprint = async () => {
    if (!authToken || !blueprint) return;

    try {
      setFreezing(true);
      setError(null);

      const response = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'freeze' })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve blueprint');
      }

      setBlueprint(data.blueprint);
      setEditedBlueprint(data.blueprint);
      setSuccess('Blueprint approved! You can now proceed to section drafting.');
      setIsEditing(false);
      onBlueprintApproved?.(data.blueprint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve blueprint');
    } finally {
      setFreezing(false);
    }
  };

  const unfreezeBlueprint = async () => {
    if (!authToken || !blueprint) return;

    try {
      setFreezing(true);
      setError(null);

      const response = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ action: 'unfreeze' })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to unlock blueprint');
      }

      setBlueprint(data.blueprint);
      setEditedBlueprint(data.blueprint);
      setSuccess('Blueprint unlocked. Existing sections marked as stale.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock blueprint');
    } finally {
      setFreezing(false);
    }
  };

  const saveChanges = async () => {
    if (!authToken || !editedBlueprint) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch(`/api/papers/${sessionId}/blueprint`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action: 'update',
          thesisStatement: editedBlueprint.thesisStatement,
          centralObjective: editedBlueprint.centralObjective,
          keyContributions: editedBlueprint.keyContributions,
          sectionPlan: editedBlueprint.sectionPlan,
          preferredTerms: editedBlueprint.preferredTerms
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save blueprint');
      }

      setBlueprint(data.blueprint);
      setEditedBlueprint(data.blueprint);
      setIsEditing(false);
      setSuccess('Blueprint updated successfully!');
      onBlueprintUpdated?.(data.blueprint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save blueprint');
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    setEditedBlueprint(blueprint);
    setIsEditing(false);
  };

  const toggleSection = (sectionKey: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  const updateEditedSection = (index: number, updates: Partial<SectionPlanItem>) => {
    if (!editedBlueprint) return;
    const newPlan = [...editedBlueprint.sectionPlan];
    newPlan[index] = { ...newPlan[index], ...updates };
    setEditedBlueprint({ ...editedBlueprint, sectionPlan: newPlan });
  };

  // ============================================================================
  // Render - Loading State
  // ============================================================================

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8">
        <div className="flex items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading blueprint...</span>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render - No Research Topic
  // ============================================================================

  if (!hasResearchTopic) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-200 flex items-center justify-center mb-4">
            <ScrollText className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">Paper Blueprint</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Save your research topic first to generate a paper blueprint. 
            The blueprint will define the structure and goals for each section.
          </p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render - No Blueprint Yet
  // ============================================================================

  if (!blueprint) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 rounded-2xl border border-indigo-200 p-8"
      >
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-indigo-500/30">
            <Wand2 className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-3">Generate Your Paper Blueprint</h3>
          <p className="text-slate-600 mb-6 max-w-lg mx-auto">
            Based on your research topic, we'll create a comprehensive blueprint that defines:
          </p>
          
          <div className="grid md:grid-cols-3 gap-4 mb-8 max-w-2xl mx-auto text-left">
            <div className="bg-white/70 backdrop-blur rounded-xl p-4 border border-indigo-100">
              <Target className="w-6 h-6 text-indigo-600 mb-2" />
              <h4 className="font-semibold text-slate-800 text-sm">Thesis & Objectives</h4>
              <p className="text-xs text-slate-500">Clear thesis statement and research objectives</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-xl p-4 border border-violet-100">
              <LayoutList className="w-6 h-6 text-violet-600 mb-2" />
              <h4 className="font-semibold text-slate-800 text-sm">Section Plan</h4>
              <p className="text-xs text-slate-500">What each section must cover and avoid</p>
            </div>
            <div className="bg-white/70 backdrop-blur rounded-xl p-4 border border-purple-100">
              <Lightbulb className="w-6 h-6 text-purple-600 mb-2" />
              <h4 className="font-semibold text-slate-800 text-sm">Key Contributions</h4>
              <p className="text-xs text-slate-500">Your unique contributions to the field</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={generateBlueprint}
            disabled={generating}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/30 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Blueprint...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate Blueprint
              </>
            )}
          </button>
          
          <p className="text-xs text-slate-400 mt-4">
            This usually takes 15-30 seconds
          </p>
        </div>
      </motion.div>
    );
  }

  // ============================================================================
  // Render - Blueprint Exists
  // ============================================================================

  const isFrozen = blueprint.status === 'FROZEN';
  const currentBlueprint = isEditing ? editedBlueprint! : blueprint;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className={`rounded-2xl border p-6 ${
        isFrozen 
          ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200' 
          : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
              isFrozen 
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600' 
                : 'bg-gradient-to-br from-amber-500 to-orange-600'
            }`}>
              {isFrozen ? (
                <Lock className="w-7 h-7 text-white" />
              ) : (
                <ScrollText className="w-7 h-7 text-white" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Paper Blueprint
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isFrozen 
                    ? 'bg-emerald-200 text-emerald-800' 
                    : 'bg-amber-200 text-amber-800'
                }`}>
                  {isFrozen ? 'Approved' : 'Draft'}
                </span>
                <span className="text-xs text-slate-400 font-normal">v{blueprint.version}</span>
              </h2>
              <p className="text-slate-600 text-sm mt-1">
                {isFrozen 
                  ? 'Your blueprint is locked. Section generation will follow this plan.'
                  : 'Review and approve this blueprint to begin section drafting.'
                }
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isFrozen && !isEditing && (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={generateBlueprint}
                  disabled={generating}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  Regenerate
                </button>
              </>
            )}

            {isEditing && (
              <>
                <button
                  onClick={cancelEditing}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </>
            )}

            {isFrozen && (
              <button
                onClick={unfreezeBlueprint}
                disabled={freezing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {freezing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                Unlock for Editing
              </button>
            )}
          </div>
        </div>

        {/* Alerts */}
        {(error || success) && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${
            error ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {error || success}
          </div>
        )}
      </div>

      {/* Toggle Full View */}
      <button
        onClick={() => setShowFullBlueprint(!showFullBlueprint)}
        className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {showFullBlueprint ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {showFullBlueprint ? 'Collapse Blueprint Details' : 'Expand Blueprint Details'}
      </button>

      <AnimatePresence>
        {showFullBlueprint && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-6 overflow-hidden"
          >
            {/* Thesis Statement */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-indigo-500" />
                Thesis Statement
              </h3>
              {isEditing ? (
                <textarea
                  value={currentBlueprint.thesisStatement}
                  onChange={(e) => setEditedBlueprint(prev => prev ? { ...prev, thesisStatement: e.target.value } : null)}
                  className="w-full px-4 py-3 text-lg bg-slate-50 border border-slate-200 rounded-xl resize-none"
                  rows={3}
                />
              ) : (
                <p className="text-lg text-slate-800 leading-relaxed">{currentBlueprint.thesisStatement}</p>
              )}
            </div>

            {/* Central Objective */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-violet-500" />
                Central Objective
              </h3>
              {isEditing ? (
                <textarea
                  value={currentBlueprint.centralObjective}
                  onChange={(e) => setEditedBlueprint(prev => prev ? { ...prev, centralObjective: e.target.value } : null)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                  rows={3}
                />
              ) : (
                <p className="text-slate-700">{currentBlueprint.centralObjective}</p>
              )}
            </div>

            {/* Key Contributions */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                Key Contributions
              </h3>
              <ul className="space-y-2">
                {currentBlueprint.keyContributions.map((contribution, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                      {i + 1}
                    </span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={contribution}
                        onChange={(e) => {
                          const newContributions = [...currentBlueprint.keyContributions];
                          newContributions[i] = e.target.value;
                          setEditedBlueprint(prev => prev ? { ...prev, keyContributions: newContributions } : null);
                        }}
                        className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    ) : (
                      <span className="text-slate-700">{contribution}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Section Plan */}
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2 mb-4">
                <LayoutList className="w-4 h-4 text-teal-500" />
                Section Plan ({currentBlueprint.sectionPlan.length} sections)
              </h3>
              <div className="space-y-3">
                {currentBlueprint.sectionPlan.map((section, index) => (
                  <SectionPlanCard
                    key={section.sectionKey}
                    section={section}
                    index={index}
                    isExpanded={expandedSections.has(section.sectionKey)}
                    onToggle={() => toggleSection(section.sectionKey)}
                    isEditing={isEditing}
                    onEdit={(updates) => updateEditedSection(index, updates)}
                    onSave={saveChanges}
                  />
                ))}
              </div>
            </div>

            {/* Methodology Type */}
            {currentBlueprint.methodologyType && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <span className="text-xs font-semibold text-slate-500 uppercase">Methodology:</span>
                <span className="ml-2 text-slate-700">{currentBlueprint.methodologyType}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approve Button - Only show for draft blueprints */}
      {!isFrozen && !isEditing && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-slate-800">Ready to approve?</h4>
                <p className="text-sm text-slate-600">
                  Once approved, this blueprint will guide all section generation. You can unlock it later if needed.
                </p>
              </div>
            </div>
            <button
              onClick={freezeBlueprint}
              disabled={freezing}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-semibold hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-50 flex-shrink-0"
            >
              {freezing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Approve Blueprint
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

