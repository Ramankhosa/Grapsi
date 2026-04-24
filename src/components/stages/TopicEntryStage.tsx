'use client';

import { useEffect, useMemo, useState, useCallback, useRef, TextareaHTMLAttributes } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Check,
  X,
  Loader2,
  Lightbulb,
  BookOpen,
  Target,
  FlaskConical,
  Tags,
  FileText,
  ChevronDown,
  ChevronRight,
  Rocket,
  HelpCircle,
  Database,
  Beaker,
  Brain,
  ArrowRight,
  ArrowLeft,
  MessageSquare,
  CheckCircle2,
  Circle,
  Compass,
  Users,
  BarChart3,
  Upload,
  FileUp,
  File,
  AlertCircle
} from 'lucide-react';
import {
  normalizeTopicExtraction
} from '@/lib/paper-topic-extraction';

// ============================================================================
// Auto-Resize Textarea Component
// ============================================================================

interface AutoResizeTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  minRows?: number;
  maxRows?: number;
}

function AutoResizeTextarea({ 
  minRows = 2, 
  maxRows = 12, 
  value, 
  className = '',
  ...props 
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate line height (approx 24px per line)
    const lineHeight = 24;
    const minHeight = minRows * lineHeight + 24; // +24 for padding
    const maxHeight = maxRows * lineHeight + 24;
    
    // Set new height based on content
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [minRows, maxRows]);

  // Adjust height on value change
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  // Adjust on mount
  useEffect(() => {
    adjustHeight();
  }, [adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      className={`${className} overflow-y-auto transition-[height] duration-200`}
      style={{ minHeight: `${minRows * 24 + 24}px` }}
      {...props}
    />
  );
}

// ============================================================================
// Types & Constants
// ============================================================================

interface TopicEntryStageProps {
  sessionId: string;
  authToken: string | null;
  onTopicSaved?: (topic: any) => void;
}

type UserMode = 'select' | 'expert' | 'guided';
type GuidedStep = 'basics' | 'question' | 'methodology' | 'data' | 'review';

interface ResearchSegments {
  // Basic Info Segment
  basics: {
    title: string;
    field: string;
    subfield: string;
    topicDescription: string;
  };
  // Research Question Segment
  question: {
    mainQuestion: string;
    subQuestions: string[];
    problemStatement: string;
    researchGaps: string;
  };
  // Methodology Segment
  methodology: {
    type: string;
    approach: string;
    techniques: string[];
    justification: string;
  };
  // Data & Experimentation Segment
  data: {
    datasetDescription: string;
    dataCollection: string;
    sampleSize: string;
    tools: string[];
    experiments: string;
  };
  // Expected Outcomes Segment
  outcomes: {
    hypothesis: string;
    expectedResults: string;
    contributionType: string;
    novelty: string;
    limitations: string;
  };
  // Keywords
  keywords: string[];
  // Abstract Draft
  abstractDraft: string;
}

interface ArchetypeDetectionView {
  archetype: string;
  routingTags: {
    contributionMode: string;
    evaluationScope: string;
    evidenceModality: string;
  };
  confidence: number;
  rationale: string[];
  missingSignals: string[];
  contradictions: string[];
  modulePlan: string[];
  changed?: boolean;
  evidenceStale?: boolean;
  skipped?: 'unchanged' | 'insufficient_signals';
}

const EMPTY_SEGMENTS: ResearchSegments = {
  basics: { title: '', field: '', subfield: '', topicDescription: '' },
  question: { mainQuestion: '', subQuestions: [], problemStatement: '', researchGaps: '' },
  methodology: { type: 'QUALITATIVE', approach: '', techniques: [], justification: '' },
  data: { datasetDescription: '', dataCollection: '', sampleSize: '', tools: [], experiments: '' },
  outcomes: { hypothesis: '', expectedResults: '', contributionType: 'EMPIRICAL', novelty: '', limitations: '' },
  keywords: [],
  abstractDraft: ''
};

const METHODOLOGIES = [
  { value: 'QUALITATIVE', label: 'Qualitative', description: 'In-depth understanding through interviews, observations', icon: MessageSquare },
  { value: 'QUANTITATIVE', label: 'Quantitative', description: 'Statistical analysis and measurable data', icon: BarChart3 },
  { value: 'MIXED_METHODS', label: 'Mixed Methods', description: 'Combining qualitative and quantitative', icon: Compass },
  { value: 'THEORETICAL', label: 'Theoretical', description: 'Conceptual frameworks and theory development', icon: Brain },
  { value: 'CASE_STUDY', label: 'Case Study', description: 'In-depth investigation of specific cases', icon: Target },
  { value: 'EXPERIMENTAL', label: 'Experimental', description: 'Controlled experiments with variables', icon: Beaker },
  { value: 'SURVEY', label: 'Survey', description: 'Data collection through questionnaires', icon: Users },
  { value: 'ACTION_RESEARCH', label: 'Action Research', description: 'Participatory research for social change', icon: Rocket }
];

const CONTRIBUTIONS = [
  { value: 'THEORETICAL', label: 'Theoretical', description: 'New theories or conceptual frameworks' },
  { value: 'EMPIRICAL', label: 'Empirical', description: 'Data-driven insights and findings' },
  { value: 'METHODOLOGICAL', label: 'Methodological', description: 'New methods or techniques' },
  { value: 'APPLIED', label: 'Applied', description: 'Practical applications and solutions' },
  { value: 'REVIEW', label: 'Review', description: 'Synthesis of existing literature' },
  { value: 'CONCEPTUAL', label: 'Conceptual', description: 'New conceptualizations or models' }
];

const RESEARCH_FIELDS = [
  'Computer Science', 'Engineering', 'Medicine', 'Physics', 'Chemistry', 'Biology',
  'Mathematics', 'Economics', 'Psychology', 'Sociology', 'Education', 'Law',
  'Business', 'Arts & Humanities', 'Environmental Science', 'Other'
];

const GUIDED_STEPS: { key: GuidedStep; label: string; description: string; icon: any }[] = [
  { key: 'basics', label: 'Basic Info', description: 'Topic and field', icon: Lightbulb },
  { key: 'question', label: 'Research Question', description: 'What you want to find', icon: Target },
  { key: 'methodology', label: 'Methodology', description: 'How you will research', icon: FlaskConical },
  { key: 'data', label: 'Data & Tools', description: 'What you will use', icon: Database },
  { key: 'review', label: 'Review', description: 'Confirm details', icon: CheckCircle2 }
];

function toArchetypeDetectionView(value: any): ArchetypeDetectionView | null {
  if (!value || typeof value !== 'object') return null;
  if (!value.archetype || !value.routingTags) return null;
  const tags = value.routingTags || {};
  return {
    archetype: String(value.archetype),
    routingTags: {
      contributionMode: String(tags.contributionMode || 'APPLICATION_VALIDATION'),
      evaluationScope: String(tags.evaluationScope || 'UNSPECIFIED'),
      evidenceModality: String(tags.evidenceModality || 'QUANTITATIVE')
    },
    confidence: Number(value.confidence || 0),
    rationale: Array.isArray(value.rationale) ? value.rationale.map((v: unknown) => String(v)).filter(Boolean) : [],
    missingSignals: Array.isArray(value.missingSignals) ? value.missingSignals.map((v: unknown) => String(v)).filter(Boolean) : [],
    contradictions: Array.isArray(value.contradictions) ? value.contradictions.map((v: unknown) => String(v)).filter(Boolean) : [],
    modulePlan: Array.isArray(value.modulePlan) ? value.modulePlan.map((v: unknown) => String(v)).filter(Boolean) : [],
    changed: Boolean(value.changed),
    evidenceStale: Boolean(value.evidenceStale),
    skipped: value.skipped === 'unchanged' || value.skipped === 'insufficient_signals' ? value.skipped : undefined
  };
}

function buildDetectionFromSession(session: any): ArchetypeDetectionView | null {
  if (!session?.archetypeId) return null;
  return {
    archetype: String(session.archetypeId),
    routingTags: {
      contributionMode: String(session.contributionMode || 'APPLICATION_VALIDATION'),
      evaluationScope: String(session.evaluationScope || 'UNSPECIFIED'),
      evidenceModality: String(session.evidenceModality || 'QUANTITATIVE')
    },
    confidence: Number(session.archetypeConfidence || 0),
    rationale: session.archetypeRationale
      ? String(session.archetypeRationale).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 4)
      : [],
    missingSignals: Array.isArray(session.archetypeMissingSignals) ? session.archetypeMissingSignals.map((v: unknown) => String(v)) : [],
    contradictions: Array.isArray(session.archetypeContradictions) ? session.archetypeContradictions.map((v: unknown) => String(v)) : [],
    modulePlan: [],
    evidenceStale: Boolean(session.archetypeEvidenceStale)
  };
}

// ============================================================================
// Helper Components
// ============================================================================

interface ModeSelectorProps {
  onSelect: (mode: 'expert' | 'guided') => void;
  onFileExtracted: (result: any) => void;
  sessionId: string;
  authToken: string | null;
}

function ModeSelector({ onSelect, onFileExtracted, sessionId, authToken }: ModeSelectorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!authToken) {
      setUploadError('Not authenticated. Please refresh the page.');
      return;
    }

    // Validate file type
    const allowedTypes = [
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    ];
    const allowedExtensions = ['.txt', '.docx', '.md'];
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExt)) {
      setUploadError('Please upload a .txt, .docx, or .md file.');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be less than 10MB.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress('Reading file...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      setUploadProgress('Extracting research information with AI...');

      const response = await fetch(`/api/papers/${sessionId}/topic/extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract information from file');
      }

      setUploadProgress('Populating form fields...');

      // Short delay to show the success state
      await new Promise(resolve => setTimeout(resolve, 500));

      // Pass the full backend response so the parent can use persisted topic data too.
      onFileExtracted(data);

    } catch (err) {
      console.error('File upload error:', err);
      setUploadError(err instanceof Error ? err.message : 'Failed to process file');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }, [authToken, sessionId, onFileExtracted]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) {
      setIsDragOver(true);
    }
  }, [isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (isUploading) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [isUploading, handleFileUpload]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFileUpload]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30 mb-6">
          <Lightbulb className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          Define Your Research Topic
        </h1>
        <p className="text-lg text-slate-600 max-w-xl mx-auto">
          Tell us about your research. Upload an existing document or choose your preferred entry method.
        </p>
      </div>

      {/* File Upload Zone */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`
            relative cursor-pointer rounded-2xl border-2 border-dashed p-8 transition-all
            ${isDragOver 
              ? 'border-violet-400 bg-violet-50 scale-[1.02]' 
              : 'border-slate-300 bg-gradient-to-br from-slate-50 to-white hover:border-violet-300 hover:bg-violet-50/50'
            }
            ${isUploading ? 'pointer-events-none' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.docx,.md"
            onChange={handleFileInputChange}
            className="hidden"
            disabled={isUploading}
          />

          <div className="flex flex-col items-center text-center">
            {isUploading ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 animate-pulse">
                  <Sparkles className="w-8 h-8 text-white animate-spin" />
                </div>
                <h3 className="text-lg font-semibold text-violet-700 mb-2">
                  {uploadProgress || 'Processing...'}
                </h3>
                <p className="text-sm text-violet-600">
                  AI is analyzing your document to extract research information
                </p>
                <div className="mt-4 w-48 h-2 bg-violet-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 animate-pulse rounded-full w-3/4" />
                </div>
              </>
            ) : (
              <>
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all ${
                  isDragOver 
                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 scale-110' 
                    : 'bg-gradient-to-br from-violet-400 to-purple-500'
                }`}>
                  <FileUp className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">
                  Upload an Existing Document
                </h3>
                <p className="text-sm text-slate-600 mb-3 max-w-md">
                  Have a research proposal, draft, or notes? Upload it and we&apos;ll automatically extract 
                  the research topic, methodology, keywords, and more.
                </p>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <File className="w-3.5 h-3.5" />
                    .txt
                  </span>
                  <span className="flex items-center gap-1">
                    <File className="w-3.5 h-3.5" />
                    .docx
                  </span>
                  <span className="flex items-center gap-1">
                    <File className="w-3.5 h-3.5" />
                    .md
                  </span>
                  <span className="text-slate-400">|</span>
                  <span>Max 10MB</span>
                </div>
                <button
                  type="button"
                  className="mt-4 px-6 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-violet-600 hover:to-purple-700 transition-all shadow-lg shadow-violet-500/30"
                >
                  <span className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Choose File or Drag & Drop
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {uploadError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">{uploadError}</p>
              <button
                onClick={() => setUploadError(null)}
                className="text-xs text-red-600 hover:text-red-800 mt-1"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Divider */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-sm font-medium text-slate-400">or choose how to enter manually</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Expert Mode */}
        <motion.button
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('expert')}
          className="relative p-8 bg-white rounded-2xl border-2 border-slate-200 hover:border-emerald-400 hover:shadow-xl transition-all text-left group"
        >
          <div className="absolute top-4 right-4 px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">
            Recommended for experienced researchers
          </div>
          
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
            <Rocket className="w-7 h-7 text-white" />
          </div>
          
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            I Know What I Need
          </h3>
          
          <p className="text-slate-600 mb-4">
            You have clear research questions, methodology plans, and know your datasets. 
            Provide all details at once in a comprehensive form.
          </p>
          
          <ul className="space-y-2 text-sm text-slate-500">
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              Complete form with all fields
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              AI refinement available
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              Fast, efficient entry
            </li>
          </ul>

          <div className="mt-6 flex items-center gap-2 text-emerald-600 font-medium">
            Get Started <ArrowRight className="w-4 h-4" />
          </div>
        </motion.button>

        {/* Guided Mode */}
        <motion.button
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('guided')}
          className="relative p-8 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all text-left group"
        >
          <div className="absolute top-4 right-4 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
            Ideal for those starting out
          </div>
          
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
            <HelpCircle className="w-7 h-7 text-white" />
          </div>
          
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            I Need Some Guidance
          </h3>
          
          <p className="text-slate-600 mb-4">
            You have a topic idea but need help structuring your research. 
            We&apos;ll guide you step by step with AI assistance.
          </p>
          
          <ul className="space-y-2 text-sm text-slate-500">
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-blue-500" />
              Step-by-step wizard
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-blue-500" />
              AI suggestions at each step
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-blue-500" />
              Clarifying questions
            </li>
          </ul>

          <div className="mt-6 flex items-center gap-2 text-blue-600 font-medium">
            Start Guided Flow <ArrowRight className="w-4 h-4" />
          </div>
        </motion.button>
      </div>
    </div>
  );
}

function StepProgress({ currentStep, steps }: { currentStep: GuidedStep; steps: typeof GUIDED_STEPS }) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const isActive = step.key === currentStep;
        const isCompleted = index < currentIndex;
        const Icon = step.icon;

        return (
          <div key={step.key} className="flex items-center">
            <div className={`
              flex items-center gap-2 px-4 py-2 rounded-full transition-all
              ${isActive 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' 
                : isCompleted 
                  ? 'bg-emerald-100 text-emerald-700' 
                  : 'bg-slate-100 text-slate-400'
              }
            `}>
              {isCompleted ? (
                <Check className="w-4 h-4" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              <span className="text-sm font-medium hidden sm:inline">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <ChevronRight className={`w-4 h-4 mx-1 ${isCompleted ? 'text-emerald-400' : 'text-slate-300'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AIAssistButton({ onClick, loading, label = 'Get AI Help' }: { onClick: () => void; loading: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-violet-600 hover:to-purple-700 transition-all shadow-lg shadow-violet-500/30 disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
      {label}
    </button>
  );
}

function KeywordInput({ keywords, onAdd, onRemove }: { keywords: string[]; onAdd: (kw: string) => void; onRemove: (kw: string) => void }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      onAdd(input.trim());
      setInput('');
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a keyword and press Enter"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          className="flex-1 px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button onClick={handleAdd} className="px-4 py-2.5 text-sm font-medium text-white bg-slate-800 rounded-xl hover:bg-slate-700">
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <AnimatePresence>
          {keywords.map(kw => (
            <motion.span
              key={kw}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full"
            >
              {kw}
              <button onClick={() => onRemove(kw)} className="w-4 h-4 rounded-full bg-blue-200 hover:bg-red-400 hover:text-white flex items-center justify-center">
                <X className="w-2.5 h-2.5" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function TopicEntryStage({ sessionId, authToken, onTopicSaved }: TopicEntryStageProps) {
  const [mode, setMode] = useState<UserMode>('select');
  const [guidedStep, setGuidedStep] = useState<GuidedStep>('basics');
  const [segments, setSegments] = useState<ResearchSegments>(EMPTY_SEGMENTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);
  const [paperTypeCode, setPaperTypeCode] = useState<string | null>(null);
  const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);
  const [extractionNotes, setExtractionNotes] = useState<string | null>(null);
  const [topicSaved, setTopicSaved] = useState<boolean>(false);
  const [archetypeDetection, setArchetypeDetection] = useState<ArchetypeDetectionView | null>(null);
  const [detectingArchetype, setDetectingArchetype] = useState(false);

  // ============================================================================
  // Data Loading
  // ============================================================================

  useEffect(() => {
    const loadData = async () => {
      if (!sessionId || !authToken) return;
      
      try {
        setLoading(true);
        const [topicRes, sessionRes] = await Promise.all([
          fetch(`/api/papers/${sessionId}/topic`, { headers: { Authorization: `Bearer ${authToken}` } }),
          fetch(`/api/papers/${sessionId}`, { headers: { Authorization: `Bearer ${authToken}` } })
        ]);

        if (sessionRes.ok) {
          const data = await sessionRes.json();
          setPaperTypeCode(data.session?.paperType?.code || null);
          setArchetypeDetection(buildDetectionFromSession(data.session));
        }

        if (topicRes.ok) {
          const data = await topicRes.json();
          const topic = data?.topic;
          if (topic) {
            // Map existing topic data to segments
            setSegments({
              basics: {
                title: topic.title || '',
                field: topic.field || '',
                subfield: topic.subfield || '',
                topicDescription: topic.topicDescription || ''
              },
              question: {
                mainQuestion: topic.researchQuestion || '',
                subQuestions: topic.subQuestions || [],
                problemStatement: topic.problemStatement || '',
                researchGaps: topic.researchGaps || ''
              },
              methodology: {
                type: topic.methodology || 'QUALITATIVE',
                approach: topic.methodologyApproach || '',
                techniques: topic.techniques || [],
                justification: topic.methodologyJustification || ''
              },
              data: {
                datasetDescription: topic.datasetDescription || '',
                dataCollection: topic.dataCollection || '',
                sampleSize: topic.sampleSize || '',
                tools: topic.tools || [],
                experiments: topic.experiments || ''
              },
              outcomes: {
                hypothesis: topic.hypothesis || '',
                expectedResults: topic.expectedResults || '',
                contributionType: topic.contributionType || 'EMPIRICAL',
                novelty: topic.novelty || '',
                limitations: topic.limitations || ''
              },
              keywords: topic.keywords || [],
              abstractDraft: topic.abstractDraft || ''
            });
            // Always keep the upload / entry chooser as the first screen when entering this stage.
            // Saved topic data is still preloaded so selecting Expert or Guided resumes from the
            // existing content instead of starting over.
            if (topic.researchQuestion && topic.researchQuestion.length >= 20) {
              setTopicSaved(true);
            }
          }
        }
      } catch (err) {
        setError('Failed to load topic data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [sessionId, authToken]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const updateSegment = useCallback(<K extends keyof ResearchSegments>(
    segment: K,
    updates: Partial<ResearchSegments[K]>
  ) => {
    setSegments(prev => ({
      ...prev,
      [segment]: typeof prev[segment] === 'object' && !Array.isArray(prev[segment])
        ? { ...prev[segment], ...updates }
        : updates
    }));
  }, []);

  const addKeyword = useCallback((keyword: string) => {
    setSegments(prev => ({
      ...prev,
      keywords: Array.from(new Set([...prev.keywords, keyword]))
    }));
  }, []);

  const removeKeyword = useCallback((keyword: string) => {
    setSegments(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keyword)
    }));
  }, []);

  const buildTopicPayload = useCallback((sourceSegments: ResearchSegments) => ({
    title: sourceSegments.basics.title,
    field: sourceSegments.basics.field,
    subfield: sourceSegments.basics.subfield,
    topicDescription: sourceSegments.basics.topicDescription,
    researchQuestion: sourceSegments.question.mainQuestion,
    subQuestions: sourceSegments.question.subQuestions,
    problemStatement: sourceSegments.question.problemStatement,
    researchGaps: sourceSegments.question.researchGaps,
    methodology: sourceSegments.methodology.type,
    methodologyApproach: sourceSegments.methodology.approach,
    techniques: sourceSegments.methodology.techniques,
    methodologyJustification: sourceSegments.methodology.justification,
    datasetDescription: sourceSegments.data.datasetDescription,
    dataCollection: sourceSegments.data.dataCollection,
    sampleSize: sourceSegments.data.sampleSize,
    tools: sourceSegments.data.tools,
    experiments: sourceSegments.data.experiments,
    hypothesis: sourceSegments.outcomes.hypothesis,
    expectedResults: sourceSegments.outcomes.expectedResults,
    contributionType: sourceSegments.outcomes.contributionType,
    novelty: sourceSegments.outcomes.novelty,
    limitations: sourceSegments.outcomes.limitations,
    keywords: sourceSegments.keywords,
    abstractDraft: sourceSegments.abstractDraft
  }), []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      // Flatten segments for API
      const payload = buildTopicPayload(segments);

      const response = await fetch(`/api/papers/${sessionId}/topic`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save topic');
      }

      const data = await response.json();
      setSuccess('Research topic saved successfully!');
      setTopicSaved(true);
      if (data?.archetypeDetection) {
        const parsed = toArchetypeDetectionView(data.archetypeDetection);
        if (parsed) setArchetypeDetection(parsed);
      }
      onTopicSaved?.(data.topic);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save topic');
    } finally {
      setSaving(false);
    }
  };

  const runAIAssist = async (action: string, context?: any) => {
    if (!authToken) return;
    
    try {
      setAiLoading(true);
      setAiSuggestions(null);

      // Flatten the segments structure for the API
      // The API expects flat string fields, not nested objects
      const flattenedData = {
        action,
        // Basic info
        title: segments.basics.title,
        field: segments.basics.field,
        subfield: segments.basics.subfield,
        topicDescription: segments.basics.topicDescription,
        // Research question
        researchQuestion: segments.question.mainQuestion,
        problemStatement: segments.question.problemStatement,
        researchGaps: segments.question.researchGaps,
        // Methodology - flatten to strings
        methodology: segments.methodology.type,
        methodologyApproach: segments.methodology.approach,
        // Data
        datasetDescription: segments.data.datasetDescription,
        // Outcomes
        hypothesis: segments.outcomes.hypothesis,
        expectedResults: segments.outcomes.expectedResults,
        contributionType: segments.outcomes.contributionType,
        novelty: segments.outcomes.novelty,
        // Keywords and abstract
        keywords: segments.keywords,
        abstractDraft: segments.abstractDraft,
        // Additional context
        context: context || {}
      };

      const response = await fetch(`/api/papers/${sessionId}/topic/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(flattenedData)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI request failed');

      const result = data.result;
      if (data?.archetypeDetection) {
        const parsedDetection = toArchetypeDetectionView(data.archetypeDetection);
        if (parsedDetection) {
          setArchetypeDetection(parsedDetection);
        }
      }
      setAiSuggestions(result);

      // Ensure we have a valid result object
      if (!result || typeof result !== 'object') {
        console.warn('[AI Assist] Invalid result format:', result);
        return;
      }

      console.log('[AI Assist] Action:', action, 'Result:', JSON.stringify(result, null, 2));

      // Helper to safely get array from result
      const safeGetArray = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
        return [];
      };

      // Helper to safely get string from result
      const safeGetString = (value: unknown): string | null => {
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
        return null;
      };

      // Auto-apply suggestions based on action
      if (action === 'suggest_keywords') {
        const keywords = safeGetArray(result.keywords);
        if (keywords.length > 0) {
          // Batch add all keywords at once to avoid multiple re-renders
          setSegments(prev => ({
            ...prev,
            keywords: Array.from(new Set([...prev.keywords, ...keywords]))
          }));
          setSuccess(`Added ${keywords.length} keywords: ${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? '...' : ''}`);
          console.log(`[AI Assist] Added ${keywords.length} keywords:`, keywords);
        } else {
          console.warn('[AI Assist] No valid keywords in response');
          setError('AI did not return valid keywords. Try again or add manually.');
        }
      }
      
      if (action === 'refine_question') {
        const question = safeGetString(result.researchQuestion);
        if (question) {
          updateSegment('question', { mainQuestion: question });
        }
      }
      
      if (action === 'generate_hypothesis') {
        const hypothesis = safeGetString(result.hypothesis);
        if (hypothesis) {
          updateSegment('outcomes', { hypothesis });
          setSuccess('Hypothesis generated successfully!');
          console.log('[AI Assist] Generated hypothesis:', hypothesis.substring(0, 100) + '...');
        } else {
          console.warn('[AI Assist] No hypothesis in response, result:', result);
        }
      }
      
      if (action === 'draft_abstract') {
        const abstract = safeGetString(result.abstractDraft);
        if (abstract) {
          setSegments(prev => ({ ...prev, abstractDraft: abstract }));
        }
      }
      
      // Handle help_formulate_question (Guided mode)
      if (action === 'help_formulate_question') {
        const question = safeGetString(result.researchQuestion);
        if (question) {
          updateSegment('question', { mainQuestion: question });
        }
        // Result also contains questionType, clarifyingQuestions, and suggestions 
        // which are displayed via aiSuggestions state
      }
      
      // Handle suggest_all (AI Enhance All) - apply all returned suggestions
      if (action === 'suggest_all') {
        setSegments(prev => {
          const updated = { ...prev };
          
          // Update title if provided
          const title = safeGetString(result.title);
          if (title) {
            updated.basics = { ...updated.basics, title };
          }
          
          // Update research question if provided
          const researchQuestion = safeGetString(result.researchQuestion);
          if (researchQuestion) {
            updated.question = { ...updated.question, mainQuestion: researchQuestion };
          }
          
          // Update hypothesis if provided
          const hypothesis = safeGetString(result.hypothesis);
          if (hypothesis) {
            updated.outcomes = { ...updated.outcomes, hypothesis };
          }
          
          // Update keywords if provided (merge with existing)
          const keywords = safeGetArray(result.keywords);
          if (keywords.length > 0) {
            updated.keywords = Array.from(new Set([...updated.keywords, ...keywords]));
          }
          
          // Update methodology suggestions if provided
          const methodologySuggestions = safeGetString(result.methodologySuggestions);
          if (methodologySuggestions) {
            updated.methodology = { 
              ...updated.methodology, 
              approach: updated.methodology.approach 
                ? `${updated.methodology.approach}\n\n📝 AI Suggestions:\n${methodologySuggestions}`
                : methodologySuggestions 
            };
          }
          
          // Update research gaps if provided
          const gaps = safeGetArray(result.gaps);
          if (gaps.length > 0) {
            const gapsText = gaps.join('\n• ');
            updated.question = {
              ...updated.question,
              researchGaps: updated.question.researchGaps 
                ? `${updated.question.researchGaps}\n\n📝 AI Identified Gaps:\n• ${gapsText}`
                : `• ${gapsText}`
            };
          }
          
          return updated;
        });
        
        // Show success notification for applied changes
        const appliedFields: string[] = [];
        if (safeGetString(result.title)) appliedFields.push('title');
        if (safeGetString(result.researchQuestion)) appliedFields.push('research question');
        if (safeGetString(result.hypothesis)) appliedFields.push('hypothesis');
        const keywordCount = safeGetArray(result.keywords).length;
        if (keywordCount > 0) appliedFields.push(`${keywordCount} keywords`);
        if (safeGetString(result.methodologySuggestions)) appliedFields.push('methodology suggestions');
        const gapCount = safeGetArray(result.gaps).length;
        if (gapCount > 0) appliedFields.push(`${gapCount} research gaps`);
        
        if (appliedFields.length > 0) {
          setSuccess(`AI applied: ${appliedFields.join(', ')}`);
          console.log(`[AI Enhance] Applied: ${appliedFields.join(', ')}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleRedetectArchetype = useCallback(async () => {
    if (!authToken) return;
    try {
      setDetectingArchetype(true);
      const response = await fetch(`/api/papers/${sessionId}/archetype`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          force: true,
          topic: buildTopicPayload(segments)
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to re-detect archetype');
      }
      const parsed = toArchetypeDetectionView(data.archetypeDetection);
      if (parsed) {
        setArchetypeDetection(parsed);
        setSuccess(`Archetype updated: ${parsed.archetype} (${Math.round(parsed.confidence * 100)}%)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-detect archetype');
    } finally {
      setDetectingArchetype(false);
    }
  }, [authToken, sessionId, buildTopicPayload, segments]);

  const goToNextStep = () => {
    const idx = GUIDED_STEPS.findIndex(s => s.key === guidedStep);
    if (idx < GUIDED_STEPS.length - 1) {
      setGuidedStep(GUIDED_STEPS[idx + 1].key);
    }
  };

  const goToPrevStep = () => {
    const idx = GUIDED_STEPS.findIndex(s => s.key === guidedStep);
    if (idx > 0) {
      setGuidedStep(GUIDED_STEPS[idx - 1].key);
    }
  };

  // ============================================================================
  // File Extraction Handler
  // ============================================================================

  // Helper function to save topic data directly (used for auto-save after extraction)
  const saveTopicData = useCallback(async (topicSegments: ResearchSegments) => {
    if (!sessionId || !authToken) return false;

    try {
      // Check if data meets minimum requirements
      const hasQuestion = topicSegments.question.mainQuestion.length >= 10;
      const hasKeywords = topicSegments.keywords.length >= 1;
      const hasTitle = topicSegments.basics.title.length > 0;
      
      // Need at least some valid data to save
      if (!hasQuestion && !hasTitle) {
        console.log('[TopicEntry] Auto-save skipped: insufficient data');
        return false;
      }

      // Flatten segments for API
      const payload = {
        ...buildTopicPayload(topicSegments),
        title: topicSegments.basics.title || 'Untitled Research',
        researchQuestion: topicSegments.question.mainQuestion || 'Research question to be defined'
      };

      const response = await fetch(`/api/papers/${sessionId}/topic`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.archetypeDetection) {
          const parsed = toArchetypeDetectionView(data.archetypeDetection);
          if (parsed) setArchetypeDetection(parsed);
        }
        console.log('[TopicEntry] Auto-saved extracted data successfully');
        return true;
      } else {
        console.warn('[TopicEntry] Auto-save failed:', await response.text());
        return false;
      }
    } catch (err) {
      console.warn('[TopicEntry] Auto-save error:', err);
      return false;
    }
  }, [sessionId, authToken, buildTopicPayload]);

  const handleFileExtracted = useCallback(async (payload: any) => {
    const normalizedPayload = payload?.extracted
      ? payload
      : { extracted: payload };
    const extracted = normalizeTopicExtraction(normalizedPayload?.extracted || {});
    const persistedTopic = normalizedPayload?.topic || null;

    console.log('[TopicEntry] File extraction received:', normalizedPayload);

    const chooseText = (nextValue: string | null, currentValue: string): string =>
      nextValue && nextValue.trim().length > 0 ? nextValue : currentValue;
    const chooseArray = (nextValue: string[], currentValue: string[]): string[] =>
      Array.isArray(nextValue) && nextValue.length > 0 ? nextValue : currentValue;

    const mergedSegments: ResearchSegments = {
      basics: {
        title: chooseText(extracted.title, segments.basics.title),
        field: chooseText(extracted.field, segments.basics.field),
        subfield: chooseText(extracted.subfield, segments.basics.subfield),
        topicDescription: chooseText(extracted.topicDescription, segments.basics.topicDescription)
      },
      question: {
        mainQuestion: chooseText(extracted.researchQuestion, segments.question.mainQuestion),
        subQuestions: chooseArray(extracted.subQuestions, segments.question.subQuestions),
        problemStatement: chooseText(extracted.problemStatement, segments.question.problemStatement),
        researchGaps: chooseText(extracted.researchGaps, segments.question.researchGaps)
      },
      methodology: {
        type: chooseText(extracted.methodology, segments.methodology.type || 'QUALITATIVE') || 'QUALITATIVE',
        approach: chooseText(extracted.methodologyApproach, segments.methodology.approach),
        techniques: chooseArray(extracted.techniques, segments.methodology.techniques),
        justification: chooseText(extracted.methodologyJustification, segments.methodology.justification)
      },
      data: {
        datasetDescription: chooseText(extracted.datasetDescription, segments.data.datasetDescription),
        dataCollection: chooseText(extracted.dataCollection, segments.data.dataCollection),
        sampleSize: chooseText(extracted.sampleSize, segments.data.sampleSize),
        tools: chooseArray(extracted.tools, segments.data.tools),
        experiments: chooseText(extracted.experiments, segments.data.experiments)
      },
      outcomes: {
        hypothesis: chooseText(extracted.hypothesis, segments.outcomes.hypothesis),
        expectedResults: chooseText(extracted.expectedResults, segments.outcomes.expectedResults),
        contributionType: chooseText(extracted.contributionType, segments.outcomes.contributionType || 'EMPIRICAL') || 'EMPIRICAL',
        novelty: chooseText(extracted.novelty, segments.outcomes.novelty),
        limitations: chooseText(extracted.limitations, segments.outcomes.limitations)
      },
      keywords: chooseArray(extracted.keywords, segments.keywords),
      abstractDraft: chooseText(extracted.abstractDraft, segments.abstractDraft)
    };

    setSegments(mergedSegments);

    if (typeof extracted.confidence === 'number') {
      setExtractionConfidence(extracted.confidence);
    }
    if (extracted.extractionNotes) {
      setExtractionNotes(extracted.extractionNotes);
    }
    if (normalizedPayload?.archetypeDetection) {
      const parsedDetection = toArchetypeDetectionView(normalizedPayload.archetypeDetection);
      if (parsedDetection) {
        setArchetypeDetection(parsedDetection);
      }
    }

    const extractedFieldCount = Object.entries(extracted).filter(([key, value]) => {
      if (key === 'confidence' || key === 'extractionNotes') return false;
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== '';
    }).length;

    if (persistedTopic) {
      setTopicSaved(true);
      setSuccess(`Successfully extracted ${extractedFieldCount} fields from your document and saved automatically. You can review and edit the information below.`);
      onTopicSaved?.(persistedTopic);
    } else {
      const saved = await saveTopicData(mergedSegments);
      if (saved) {
        setTopicSaved(true);
        setSuccess(`Successfully extracted ${extractedFieldCount} fields from your document and saved automatically. You can review and edit the information below.`);
        onTopicSaved?.({
          title: mergedSegments.basics.title,
          researchQuestion: mergedSegments.question.mainQuestion,
          keywords: mergedSegments.keywords,
          methodology: mergedSegments.methodology.type
        });
      } else {
        setSuccess(`Successfully extracted ${extractedFieldCount} fields from your document. Please review and click "Save Research Topic" to persist your changes.`);
      }
    }

    // Switch to expert mode to show the populated form
    setMode('expert');
  }, [onTopicSaved, saveTopicData, segments]);

  // ============================================================================
  // Validation
  // ============================================================================

  const isValid = useMemo(() => {
    return segments.question.mainQuestion.length >= 20 && segments.keywords.length >= 3;
  }, [segments]);

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-amber-500 animate-spin" />
          <p className="text-slate-500 text-sm">Loading research topic...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <AnimatePresence mode="wait">
        {/* Mode Selection */}
        {mode === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <ModeSelector 
              onSelect={(m) => setMode(m)} 
              onFileExtracted={handleFileExtracted}
              sessionId={sessionId}
              authToken={authToken}
            />
          </motion.div>
        )}

        {/* Expert Mode - Comprehensive Form */}
        {mode === 'expert' && (
          <motion.div
            key="expert"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-4xl mx-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <button onClick={() => setMode('select')} className="p-2 hover:bg-slate-100 rounded-lg">
                  <ArrowLeft className="w-5 h-5 text-slate-600" />
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Research Topic Details</h1>
                  <p className="text-slate-500">Provide comprehensive details about your research</p>
                </div>
              </div>
              <AIAssistButton onClick={() => runAIAssist('suggest_all')} loading={aiLoading} label="AI Enhance All" />
            </div>

            {/* Extraction Confidence Banner */}
            {extractionConfidence !== null && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={`mb-6 p-4 rounded-xl border flex items-start gap-3 ${
                  extractionConfidence >= 0.7 
                    ? 'bg-emerald-50 border-emerald-200' 
                    : extractionConfidence >= 0.4 
                      ? 'bg-amber-50 border-amber-200' 
                      : 'bg-orange-50 border-orange-200'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  extractionConfidence >= 0.7 
                    ? 'bg-emerald-100' 
                    : extractionConfidence >= 0.4 
                      ? 'bg-amber-100' 
                      : 'bg-orange-100'
                }`}>
                  <FileText className={`w-5 h-5 ${
                    extractionConfidence >= 0.7 
                      ? 'text-emerald-600' 
                      : extractionConfidence >= 0.4 
                        ? 'text-amber-600' 
                        : 'text-orange-600'
                  }`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-800">Document Extracted</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      extractionConfidence >= 0.7 
                        ? 'bg-emerald-200 text-emerald-800' 
                        : extractionConfidence >= 0.4 
                          ? 'bg-amber-200 text-amber-800' 
                          : 'bg-orange-200 text-orange-800'
                    }`}>
                      {Math.round(extractionConfidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">
                    {extractionNotes || 'Fields have been pre-filled from your uploaded document. Please review and complete any missing information.'}
                  </p>
                  <button 
                    onClick={() => { setExtractionConfidence(null); setExtractionNotes(null); }}
                    className="text-xs text-slate-500 hover:text-slate-700 mt-2"
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            )}

            {/* Archetype Detection Banner */}
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className={`mb-6 p-4 rounded-xl border ${
                archetypeDetection?.evidenceStale
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-sky-50 border-sky-200'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-600" />
                    <span className="text-sm font-semibold text-slate-800">Archetype Detection</span>
                    {archetypeDetection ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-900 text-white">
                        {archetypeDetection.archetype}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                        Not detected yet
                      </span>
                    )}
                    {archetypeDetection && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                        {Math.round((archetypeDetection.confidence || 0) * 100)}%
                      </span>
                    )}
                  </div>

                  {archetypeDetection && (
                    <div className="text-xs text-slate-700 space-y-1">
                      <p>
                        Tags: {archetypeDetection.routingTags.contributionMode} • {archetypeDetection.routingTags.evaluationScope} • {archetypeDetection.routingTags.evidenceModality}
                      </p>
                      {archetypeDetection.rationale.length > 0 && (
                        <p>Why: {archetypeDetection.rationale.slice(0, 2).join(' ')}</p>
                      )}
                      {archetypeDetection.evidenceStale && (
                        <p className="text-amber-700 font-medium">
                          Evidence packs may be outdated. Refresh mappings in Literature stage.
                        </p>
                      )}
                      {archetypeDetection.missingSignals.length > 0 && (
                        <p className="text-slate-600">
                          Missing signals: {archetypeDetection.missingSignals.slice(0, 4).join(', ')}
                        </p>
                      )}
                      {archetypeDetection.modulePlan.length > 0 && (
                        <p className="text-slate-600">
                          Evidence modules: {archetypeDetection.modulePlan.slice(0, 4).join('; ')}
                          {archetypeDetection.modulePlan.length > 4 ? ' ...' : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleRedetectArchetype}
                  disabled={detectingArchetype || !authToken}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {detectingArchetype ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Re-detect archetype
                </button>
              </div>
            </motion.div>

            <div className="space-y-8">
              {/* Basic Information */}
              <section className="bg-white rounded-2xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-amber-500" />
                  Basic Information
                </h2>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Paper Title</label>
                    <input
                      type="text"
                      value={segments.basics.title}
                      onChange={(e) => updateSegment('basics', { title: e.target.value })}
                      placeholder="Enter your paper title"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Research Field</label>
                      <select
                        value={segments.basics.field}
                        onChange={(e) => updateSegment('basics', { field: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select field</option>
                        {RESEARCH_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Subfield / Specialization</label>
                      <input
                        type="text"
                        value={segments.basics.subfield}
                        onChange={(e) => updateSegment('basics', { subfield: e.target.value })}
                        placeholder="e.g., Machine Learning, Organic Chemistry"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Topic Description</label>
                    <AutoResizeTextarea
                      value={segments.basics.topicDescription}
                      onChange={(e) => updateSegment('basics', { topicDescription: e.target.value })}
                      placeholder="Briefly describe what your research is about..."
                      minRows={3}
                      maxRows={10}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* Research Question */}
              <section className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <Target className="w-5 h-5 text-blue-600" />
                    Research Question
                    <span className="text-xs font-normal text-slate-500 ml-2">Required</span>
                  </h2>
                  <AIAssistButton onClick={() => runAIAssist('refine_question')} loading={aiLoading} label="Refine" />
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Main Research Question</label>
                    <AutoResizeTextarea
                      value={segments.question.mainQuestion}
                      onChange={(e) => updateSegment('question', { mainQuestion: e.target.value })}
                      placeholder="What specific question does your research aim to answer?"
                      minRows={3}
                      maxRows={8}
                      className="w-full px-4 py-3 bg-white border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                    <p className={`text-xs mt-1 ${segments.question.mainQuestion.length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {segments.question.mainQuestion.length}/20 characters minimum
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Problem Statement</label>
                    <AutoResizeTextarea
                      value={segments.question.problemStatement}
                      onChange={(e) => updateSegment('question', { problemStatement: e.target.value })}
                      placeholder="What problem are you trying to solve?"
                      minRows={2}
                      maxRows={8}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Research Gaps Identified</label>
                    <AutoResizeTextarea
                      value={segments.question.researchGaps}
                      onChange={(e) => updateSegment('question', { researchGaps: e.target.value })}
                      placeholder="What gaps in existing research does your study address?"
                      minRows={2}
                      maxRows={10}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* Methodology */}
              <section className="bg-white rounded-2xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-teal-500" />
                  Methodology
                </h2>
                <div className="grid gap-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Methodology Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {METHODOLOGIES.slice(0, 4).map(m => {
                          const Icon = m.icon;
                          const isSelected = segments.methodology.type === m.value;
                          return (
                            <button
                              key={m.value}
                              onClick={() => updateSegment('methodology', { type: m.value })}
                              className={`p-3 rounded-xl border-2 text-left transition-all ${
                                isSelected 
                                  ? 'border-teal-500 bg-teal-50' 
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <Icon className={`w-4 h-4 mb-1 ${isSelected ? 'text-teal-600' : 'text-slate-400'}`} />
                              <div className={`text-sm font-medium ${isSelected ? 'text-teal-700' : 'text-slate-700'}`}>{m.label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Research Approach</label>
                      <AutoResizeTextarea
                        value={segments.methodology.approach}
                        onChange={(e) => updateSegment('methodology', { approach: e.target.value })}
                        placeholder="Describe your research approach in detail..."
                        minRows={4}
                        maxRows={15}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 resize-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Justification</label>
                    <AutoResizeTextarea
                      value={segments.methodology.justification}
                      onChange={(e) => updateSegment('methodology', { justification: e.target.value })}
                      placeholder="Why is this methodology appropriate for your research?"
                      minRows={2}
                      maxRows={8}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* Data & Experimentation */}
              <section className="bg-white rounded-2xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Database className="w-5 h-5 text-purple-500" />
                  Data & Experimentation
                </h2>
                <div className="grid gap-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Dataset Description</label>
                      <AutoResizeTextarea
                        value={segments.data.datasetDescription}
                        onChange={(e) => updateSegment('data', { datasetDescription: e.target.value })}
                        placeholder="Describe the datasets you will use..."
                        minRows={3}
                        maxRows={10}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Data Collection Method</label>
                      <AutoResizeTextarea
                        value={segments.data.dataCollection}
                        onChange={(e) => updateSegment('data', { dataCollection: e.target.value })}
                        placeholder="How will you collect your data?"
                        minRows={3}
                        maxRows={10}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Sample Size</label>
                      <input
                        type="text"
                        value={segments.data.sampleSize}
                        onChange={(e) => updateSegment('data', { sampleSize: e.target.value })}
                        placeholder="e.g., 500 participants, 10,000 records"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Experiments Planned</label>
                      <input
                        type="text"
                        value={segments.data.experiments}
                        onChange={(e) => updateSegment('data', { experiments: e.target.value })}
                        placeholder="Describe experiments you will conduct..."
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Expected Outcomes */}
              <section className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-amber-600" />
                    Expected Outcomes
                  </h2>
                  <AIAssistButton onClick={() => runAIAssist('generate_hypothesis')} loading={aiLoading} label="Generate Hypothesis" />
                </div>
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Hypothesis</label>
                    <AutoResizeTextarea
                      value={segments.outcomes.hypothesis}
                      onChange={(e) => updateSegment('outcomes', { hypothesis: e.target.value })}
                      placeholder="What do you expect to find? State a testable hypothesis..."
                      minRows={3}
                      maxRows={10}
                      className="w-full px-4 py-3 bg-white border border-amber-200 rounded-xl resize-none"
                    />
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Contribution Type</label>
                      <select
                        value={segments.outcomes.contributionType}
                        onChange={(e) => updateSegment('outcomes', { contributionType: e.target.value })}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl"
                      >
                        {CONTRIBUTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Novelty / Innovation</label>
                      <input
                        type="text"
                        value={segments.outcomes.novelty}
                        onChange={(e) => updateSegment('outcomes', { novelty: e.target.value })}
                        placeholder="What makes your research novel?"
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Keywords */}
              <section className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <Tags className="w-5 h-5 text-purple-500" />
                    Keywords
                    <span className={`text-xs ml-2 ${segments.keywords.length >= 3 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {segments.keywords.length}/3 minimum
                    </span>
                  </h2>
                  <AIAssistButton onClick={() => runAIAssist('suggest_keywords')} loading={aiLoading} label="Suggest Keywords" />
                </div>
                <KeywordInput keywords={segments.keywords} onAdd={addKeyword} onRemove={removeKeyword} />
              </section>

              {/* Save Section */}
              {(error || success) && (
                <div className={`p-4 rounded-xl ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {error || success}
                </div>
              )}

              <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl">
                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 ${segments.question.mainQuestion.length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {segments.question.mainQuestion.length >= 20 ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    Research Question
                  </div>
                  <div className={`flex items-center gap-2 ${segments.keywords.length >= 3 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {segments.keywords.length >= 3 ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    Keywords (3+)
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving || !isValid}
                  className={`px-8 py-3 rounded-xl font-semibold transition-all ${
                    isValid 
                      ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg' 
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Research Topic'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Guided Mode - Step by Step */}
        {mode === 'guided' && (
          <motion.div
            key="guided"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-3xl mx-auto"
          >
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
              <button onClick={() => setMode('select')} className="p-2 hover:bg-slate-100 rounded-lg">
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Guided Research Setup</h1>
                <p className="text-slate-500">Let&apos;s build your research topic step by step</p>
              </div>
            </div>

            {/* Step Progress */}
            <StepProgress currentStep={guidedStep} steps={GUIDED_STEPS} />

            {/* Step Content */}
            <AnimatePresence mode="wait">
              {/* Step 1: Basics */}
              {guidedStep === 'basics' && (
                <motion.div
                  key="basics"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 p-8"
                >
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4">
                      <Lightbulb className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Let&apos;s Start with the Basics</h2>
                    <p className="text-slate-500">Tell us about your research topic in simple terms</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        What is your paper about? <span className="text-slate-400 font-normal">(Working title)</span>
                      </label>
                      <input
                        type="text"
                        value={segments.basics.title}
                        onChange={(e) => updateSegment('basics', { title: e.target.value })}
                        placeholder="e.g., Impact of Social Media on Student Mental Health"
                        className="w-full px-4 py-4 text-lg bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        What field is this in?
                      </label>
                      <select
                        value={segments.basics.field}
                        onChange={(e) => updateSegment('basics', { field: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        <option value="">Select your research field</option>
                        {RESEARCH_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Describe your topic in a few sentences
                      </label>
                      <AutoResizeTextarea
                        value={segments.basics.topicDescription}
                        onChange={(e) => updateSegment('basics', { topicDescription: e.target.value })}
                        placeholder="Just tell us what you're interested in researching. Don't worry about being formal yet..."
                        minRows={4}
                        maxRows={12}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                      <p className="text-xs text-slate-400 mt-2">💡 Tip: Write as if you&apos;re explaining to a friend</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Step 2: Research Question */}
              {guidedStep === 'question' && (
                <motion.div
                  key="question"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 p-8"
                >
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center mb-4">
                      <Target className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">What Do You Want to Find Out?</h2>
                    <p className="text-slate-500">Transform your topic into a clear research question</p>
                  </div>

                  <div className="flex justify-end mb-4">
                    <AIAssistButton onClick={() => runAIAssist('help_formulate_question')} loading={aiLoading} label="Help Me Formulate" />
                  </div>

                  <div className="space-y-6">
                    <div className="bg-blue-50 rounded-xl p-4 mb-6">
                      <p className="text-sm text-blue-800">
                        <strong>Based on your topic:</strong> &quot;{segments.basics.topicDescription || segments.basics.title || 'Your topic'}&quot;
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Your Main Research Question
                      </label>
                      <AutoResizeTextarea
                        value={segments.question.mainQuestion}
                        onChange={(e) => updateSegment('question', { mainQuestion: e.target.value })}
                        placeholder="Start with: How does..., What is the impact of..., Why do..., To what extent..."
                        minRows={4}
                        maxRows={10}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                      <p className={`text-xs mt-2 ${segments.question.mainQuestion.length >= 20 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {segments.question.mainQuestion.length >= 20 ? '✓ Good question!' : `${segments.question.mainQuestion.length}/20 characters minimum`}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        What problem are you trying to solve?
                      </label>
                      <textarea
                        value={segments.question.problemStatement}
                        onChange={(e) => updateSegment('question', { problemStatement: e.target.value })}
                        placeholder="Describe the problem or gap you've identified..."
                        rows={3}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>
                  </div>

                  {aiSuggestions?.clarifyingQuestions && (
                    <div className="mt-6 p-4 bg-violet-50 rounded-xl">
                      <p className="text-sm font-semibold text-violet-800 mb-2">🤔 Consider these questions:</p>
                      <ul className="space-y-1">
                        {aiSuggestions.clarifyingQuestions.map((q: string, i: number) => (
                          <li key={i} className="text-sm text-violet-700 flex items-start gap-2">
                            <span>•</span> {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Step 3: Methodology */}
              {guidedStep === 'methodology' && (
                <motion.div
                  key="methodology"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 p-8"
                >
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center mb-4">
                      <FlaskConical className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">How Will You Research This?</h2>
                    <p className="text-slate-500">Choose the approach that fits your research question</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-3">
                        Select your methodology type
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {METHODOLOGIES.map(m => {
                          const Icon = m.icon;
                          const isSelected = segments.methodology.type === m.value;
                          return (
                            <button
                              key={m.value}
                              onClick={() => updateSegment('methodology', { type: m.value })}
                              className={`p-4 rounded-xl border-2 text-center transition-all ${
                                isSelected 
                                  ? 'border-teal-500 bg-teal-50 shadow-lg' 
                                  : 'border-slate-200 hover:border-teal-300'
                              }`}
                            >
                              <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? 'text-teal-600' : 'text-slate-400'}`} />
                              <div className={`text-sm font-medium ${isSelected ? 'text-teal-700' : 'text-slate-700'}`}>{m.label}</div>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-sm text-slate-500 mt-3 text-center">
                        {METHODOLOGIES.find(m => m.value === segments.methodology.type)?.description}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Describe your approach
                      </label>
                      <textarea
                        value={segments.methodology.approach}
                        onChange={(e) => updateSegment('methodology', { approach: e.target.value })}
                        placeholder="How will you conduct your research? What steps will you take?"
                        rows={4}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Step 4: Data */}
              {guidedStep === 'data' && (
                <motion.div
                  key="data"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 p-8"
                >
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center mb-4">
                      <Database className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">What Data Will You Use?</h2>
                    <p className="text-slate-500">Tell us about your data sources and tools</p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Describe your data or dataset
                      </label>
                      <textarea
                        value={segments.data.datasetDescription}
                        onChange={(e) => updateSegment('data', { datasetDescription: e.target.value })}
                        placeholder="What kind of data will you collect or use? Surveys, experiments, existing datasets..."
                        rows={3}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          How will you collect data?
                        </label>
                        <input
                          type="text"
                          value={segments.data.dataCollection}
                          onChange={(e) => updateSegment('data', { dataCollection: e.target.value })}
                          placeholder="e.g., Online surveys, interviews, web scraping"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Expected sample size
                        </label>
                        <input
                          type="text"
                          value={segments.data.sampleSize}
                          onChange={(e) => updateSegment('data', { sampleSize: e.target.value })}
                          placeholder="e.g., 200 participants, 5000 records"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Any specific experiments planned?
                      </label>
                      <textarea
                        value={segments.data.experiments}
                        onChange={(e) => updateSegment('data', { experiments: e.target.value })}
                        placeholder="Describe any experiments or tests you plan to conduct... (optional)"
                        rows={2}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Step 5: Review */}
              {guidedStep === 'review' && (
                <motion.div
                  key="review"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 p-8"
                >
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Review Your Research Topic</h2>
                    <p className="text-slate-500">Let&apos;s add the finishing touches</p>
                  </div>

                  {/* Summary */}
                  <div className="space-y-4 mb-8">
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Title</div>
                      <div className="text-lg font-semibold text-slate-900">{segments.basics.title || 'Not set'}</div>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-xl">
                      <div className="text-xs font-semibold text-blue-600 uppercase mb-1">Research Question</div>
                      <div className="text-slate-800">{segments.question.mainQuestion || 'Not set'}</div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="p-4 bg-teal-50 rounded-xl">
                        <div className="text-xs font-semibold text-teal-600 uppercase mb-1">Methodology</div>
                        <div className="text-slate-800">{METHODOLOGIES.find(m => m.value === segments.methodology.type)?.label}</div>
                      </div>
                      <div className="p-4 bg-purple-50 rounded-xl">
                        <div className="text-xs font-semibold text-purple-600 uppercase mb-1">Field</div>
                        <div className="text-slate-800">{segments.basics.field || 'Not set'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Keywords */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Tags className="w-4 h-4" />
                        Keywords 
                        <span className={segments.keywords.length >= 3 ? 'text-emerald-600' : 'text-slate-400'}>
                          ({segments.keywords.length}/3 min)
                        </span>
                      </label>
                      <AIAssistButton onClick={() => runAIAssist('suggest_keywords')} loading={aiLoading} label="Suggest" />
                    </div>
                    <KeywordInput keywords={segments.keywords} onAdd={addKeyword} onRemove={removeKeyword} />
                  </div>

                  {/* Hypothesis */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-slate-700">Expected Outcome / Hypothesis</label>
                      <AIAssistButton onClick={() => runAIAssist('generate_hypothesis')} loading={aiLoading} label="Generate" />
                    </div>
                    <textarea
                      value={segments.outcomes.hypothesis}
                      onChange={(e) => updateSegment('outcomes', { hypothesis: e.target.value })}
                      placeholder="What do you expect to find?"
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl resize-none"
                    />
                    {segments.outcomes.hypothesis && (
                      <p className="text-xs text-emerald-600 mt-1">✓ Hypothesis set ({segments.outcomes.hypothesis.length} chars)</p>
                    )}
                  </div>

                  {/* AI Suggestions Display */}
                  {aiSuggestions?.clarifyingQuestions && aiSuggestions.clarifyingQuestions.length > 0 && (
                    <div className="mb-6 p-4 bg-violet-50 rounded-xl">
                      <p className="text-sm font-semibold text-violet-800 mb-2">🤔 Consider these questions:</p>
                      <ul className="space-y-1">
                        {aiSuggestions.clarifyingQuestions.map((q: string, i: number) => (
                          <li key={i} className="text-sm text-violet-700 flex items-start gap-2">
                            <span>•</span> {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(error || success) && (
                    <div className={`p-4 rounded-xl mb-4 ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {error || success}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={goToPrevStep}
                disabled={guidedStep === 'basics'}
                className="flex items-center gap-2 px-6 py-3 text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-30"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              {guidedStep === 'review' ? (
                <button
                  onClick={handleSave}
                  disabled={saving || !isValid}
                  className={`flex items-center gap-2 px-8 py-3 rounded-xl font-semibold transition-all ${
                    isValid 
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg' 
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  Save Research Topic
                </button>
              ) : (
                <button
                  onClick={goToNextStep}
                  className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 shadow-lg"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
