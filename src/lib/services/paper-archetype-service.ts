import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { llmGateway } from '@/lib/metering/gateway';

const ARCHETYPE_VERSION = 1;
const MIN_CONFIDENCE_FOR_AUTO_APPLY = 0.75;

const ArchetypeSchema = z.enum([
  'SYSTEM_ALGO_EVALUATION',
  'CONTROLLED_EXPERIMENTAL_STUDY',
  'EMPIRICAL_OBSERVATIONAL_STUDY',
  'MIXED_METHODS_APPLIED_STUDY'
]);

const ContributionModeSchema = z.enum([
  'NOVEL_METHOD',
  'APPLICATION_VALIDATION',
  'COMPARATIVE_BENCHMARK',
  'CONCEPTUAL_FRAMEWORK'
]);

const EvaluationScopeSchema = z.enum([
  'BENCHMARK',
  'CONTROLLED_LAB',
  'REAL_WORLD',
  'RETROSPECTIVE_DATA',
  'PROSPECTIVE',
  'UNSPECIFIED'
]);

const EvidenceModalitySchema = z.enum([
  'QUANTITATIVE',
  'QUALITATIVE',
  'MIXED'
]);

const DetectionOutputSchema = z.object({
  archetype: ArchetypeSchema,
  routingTags: z.object({
    contributionMode: ContributionModeSchema,
    evaluationScope: EvaluationScopeSchema,
    evidenceModality: EvidenceModalitySchema
  }).strict(),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string()).min(1).max(4),
  missingSignals: z.array(z.string()),
  contradictions: z.array(z.string())
}).strict();

type ArchetypeId = z.infer<typeof ArchetypeSchema>;
type ContributionMode = z.infer<typeof ContributionModeSchema>;
type EvaluationScope = z.infer<typeof EvaluationScopeSchema>;
type EvidenceModality = z.infer<typeof EvidenceModalitySchema>;
type DetectionOutput = z.infer<typeof DetectionOutputSchema>;

type TopicSnapshot = {
  title: string | null;
  field: string | null;
  subfield: string | null;
  topicDescription: string | null;
  researchQuestion: string | null;
  subQuestions: string[];
  problemStatement: string | null;
  researchGaps: string | null;
  methodology: string | null;
  methodologyApproach: string | null;
  techniques: string[];
  datasetDescription: string | null;
  dataCollection: string | null;
  sampleSize: string | null;
  tools: string[];
  experiments: string | null;
  hypothesis: string | null;
  expectedResults: string | null;
  contributionType: string | null;
  novelty: string | null;
  limitations: string | null;
  keywords: string[];
  abstractDraft: string | null;
};

type DraftingSnapshot = {
  paperTypeId: string | null;
  targetWordCount: number | null;
  publicationVenueId: string | null;
};

const EMPTY_TOPIC: TopicSnapshot = {
  title: null,
  field: null,
  subfield: null,
  topicDescription: null,
  researchQuestion: null,
  subQuestions: [],
  problemStatement: null,
  researchGaps: null,
  methodology: null,
  methodologyApproach: null,
  techniques: [],
  datasetDescription: null,
  dataCollection: null,
  sampleSize: null,
  tools: [],
  experiments: null,
  hypothesis: null,
  expectedResults: null,
  contributionType: null,
  novelty: null,
  limitations: null,
  keywords: [],
  abstractDraft: null
};

const MODULE_PLAN_BY_ARCHETYPE: Record<ArchetypeId, string[]> = {
  SYSTEM_ALGO_EVALUATION: [
    'task/problem framing',
    'method/system architecture',
    'dataset/corpus description',
    'evaluation protocol (splits, baselines, thresholding, analytic unit)',
    'metrics (definitions + usage)',
    'deployment/runtime (latency/hardware if relevant)',
    'limitations/threats'
  ],
  CONTROLLED_EXPERIMENTAL_STUDY: [
    'hypothesis/variables/operationalization',
    'participants/data source/inclusion-exclusion',
    'intervention/design/control conditions',
    'outcomes/metrics',
    'statistical analysis/tests',
    'limitations/bias'
  ],
  EMPIRICAL_OBSERVATIONAL_STUDY: [
    'cohort/data source',
    'variable definitions/features',
    'modeling/analysis approach',
    'validation strategy (if predictive)',
    'confounding/bias',
    'limitations/generalizability'
  ],
  MIXED_METHODS_APPLIED_STUDY: [
    'task/problem framing',
    'method/system architecture',
    'dataset/corpus description',
    'evaluation protocol (splits, baselines, thresholding, analytic unit)',
    'metrics (definitions + usage)',
    'deployment/runtime (latency/hardware if relevant)',
    'limitations/threats',
    'qualitative sampling/recruitment',
    'instrument (interview/survey)',
    'analysis approach (coding/thematic) + trustworthiness',
    'adoption/ethics/privacy constraints'
  ]
};

const ARRAY_TOPIC_KEYS = ['subQuestions', 'techniques', 'tools', 'keywords'] as const;
const TEXT_TOPIC_KEYS = [
  'title',
  'field',
  'subfield',
  'topicDescription',
  'researchQuestion',
  'problemStatement',
  'researchGaps',
  'methodology',
  'methodologyApproach',
  'datasetDescription',
  'dataCollection',
  'sampleSize',
  'experiments',
  'hypothesis',
  'expectedResults',
  'contributionType',
  'novelty',
  'limitations',
  'abstractDraft'
] as const;

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 50);
};

const hasValue = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const toSentenceList = (values: string[], maxItems = 4): string[] =>
  values
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);

function normalizeFallbackReason(reason?: string | null): string {
  const normalized = String(reason || 'structured LLM output was unavailable')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/, '');
  return normalized.slice(0, 260);
}

function parseJsonOutput(output: string): any | null {
  let jsonText = (output || '').trim();
  if (!jsonText) return null;

  const fenceStart = jsonText.indexOf('```');
  if (fenceStart !== -1) {
    jsonText = jsonText.slice(fenceStart + 3);
    jsonText = jsonText.replace(/^json\s*/i, '');
    const fenceEnd = jsonText.indexOf('```');
    if (fenceEnd !== -1) {
      jsonText = jsonText.slice(0, fenceEnd);
    }
  }

  const startBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
    jsonText = jsonText.slice(startBrace, lastBrace + 1);
  }

  jsonText = jsonText
    .replace(/`+/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(quotedKeys);
    } catch {
      return null;
    }
  }
}

function sanitizeOutput(raw: DetectionOutput): DetectionOutput {
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence || 0)));
  const rationale = toSentenceList(raw.rationale, 4);
  const missingSignals = Array.from(
    new Set((raw.missingSignals || []).map(v => String(v || '').trim()).filter(Boolean))
  ).slice(0, 12);
  const contradictions = Array.from(
    new Set((raw.contradictions || []).map(v => String(v || '').trim()).filter(Boolean))
  ).slice(0, 12);

  return {
    archetype: raw.archetype,
    routingTags: raw.routingTags,
    confidence,
    rationale: rationale.length > 0 ? rationale : ['Conservative fallback classification due to limited reliable signals.'],
    missingSignals,
    contradictions
  };
}

function detectMissingSignals(topic: TopicSnapshot): string[] {
  const missing: string[] = [];
  if (!hasValue(topic.problemStatement)) missing.push('problemStatement');
  if (!hasValue(topic.methodologyApproach)) missing.push('methodologyApproach');
  if (!hasValue(topic.dataCollection)) missing.push('dataCollection');
  if (!hasValue(topic.experiments)) missing.push('experiments');
  if (!hasValue(topic.datasetDescription)) missing.push('datasetDescription');
  if (!hasValue(topic.sampleSize)) missing.push('sampleSize');
  if ((topic.techniques || []).length === 0) missing.push('techniques');
  if ((topic.keywords || []).length < 3) missing.push('keywords');
  return missing;
}

function detectContradictions(topic: TopicSnapshot, output: DetectionOutput): string[] {
  const contradictions: string[] = [];
  const source = [
    topic.methodology,
    topic.methodologyApproach,
    topic.experiments,
    topic.dataCollection,
    topic.topicDescription,
    topic.problemStatement,
    topic.researchQuestion
  ].filter(Boolean).join(' ').toLowerCase();

  const hasQualSignals = /\b(interview|focus group|thematic|ethnograph|qualitative|coding|expert feedback)\b/.test(source);
  const hasQuantSignals = /\b(accuracy|precision|recall|f1|auc|benchmark|statistical|p-value|regression|quantitative|dataset)\b/.test(source);
  const hasInterventionSignals = /\b(intervention|treatment|control group|randomized|randomised|experiment|rct|placebo)\b/.test(source);

  if (output.routingTags.evidenceModality === 'QUANTITATIVE' && hasQualSignals) {
    contradictions.push('Qualitative evidence signals detected but evidenceModality is QUANTITATIVE.');
  }
  if (output.routingTags.evidenceModality === 'QUALITATIVE' && hasQuantSignals) {
    contradictions.push('Quantitative evidence signals detected but evidenceModality is QUALITATIVE.');
  }
  if (output.archetype === 'CONTROLLED_EXPERIMENTAL_STUDY' && !hasInterventionSignals) {
    contradictions.push('Archetype indicates controlled intervention, but intervention/control signals are weak or missing.');
  }
  if (output.archetype === 'MIXED_METHODS_APPLIED_STUDY' && !(hasQualSignals && hasQuantSignals)) {
    contradictions.push('Mixed-methods archetype chosen, but both qualitative and quantitative signals are not clearly present.');
  }

  return contradictions;
}

function hasMinimumSignals(topic: TopicSnapshot): boolean {
  const hasProblemSignal =
    hasValue(topic.problemStatement) ||
    hasValue(topic.researchQuestion) ||
    hasValue(topic.topicDescription);

  const hasMethodSignal =
    hasValue(topic.methodologyApproach) ||
    hasValue(topic.experiments) ||
    hasValue(topic.dataCollection) ||
    hasValue(topic.datasetDescription) ||
    hasValue(topic.sampleSize) ||
    (topic.techniques || []).length > 0;

  return hasProblemSignal && hasMethodSignal;
}

function buildFallbackClassification(topic: TopicSnapshot, reason?: string | null): DetectionOutput {
  const source = [
    topic.title,
    topic.topicDescription,
    topic.problemStatement,
    topic.researchQuestion,
    topic.researchGaps,
    topic.methodology,
    topic.methodologyApproach,
    topic.datasetDescription,
    topic.dataCollection,
    topic.sampleSize,
    topic.experiments,
    topic.hypothesis,
    topic.expectedResults,
    topic.novelty,
    topic.abstractDraft,
    ...(topic.techniques || []),
    ...(topic.tools || []),
    ...(topic.keywords || [])
  ].filter(Boolean).join(' ').toLowerCase();

  const hasQual = /\b(interview|focus group|thematic|ethnograph|qualitative|coding|expert panel|usability study)\b/.test(source);
  const hasQuant = /\b(accuracy|precision|recall|f1|auc|benchmark|statistical|p-value|regression|quantitative|dataset|metric|sensitivity|specificity)\b/.test(source);
  const hasIntervention = /\b(intervention|treatment|control group|randomized|randomised|experiment|rct|placebo)\b/.test(source);
  const hasObservational = /\b(observational|cohort|retrospective|registry|ehr|real-world data|cross-sectional|longitudinal)\b/.test(source);
  const hasSystem = /\b(algorithm|model|pipeline|system|architecture|framework|prototype)\b/.test(source);
  const hasBenchmark = /\b(benchmark|baseline|leaderboard|dataset split|cross-validation)\b/.test(source);
  const hasRealWorld = /\b(real-world|field deployment|in situ|production|clinical workflow)\b/.test(source);
  const hasProspective = /\b(prospective|longitudinal follow-up|planned recruitment)\b/.test(source);
  const hasComparative = [
    /\b(against|versus|vs\.?|relative to|compared to|compared with)\b.{0,80}\b(baseline|baselines|state-of-the-art|sota|existing methods?|prior methods?|traditional methods?|benchmark model)\b/,
    /\b(baseline|baselines|state-of-the-art|sota|existing methods?|prior methods?|traditional methods?|benchmark model)\b.{0,80}\b(against|versus|vs\.?|relative to|compared to|compared with)\b/,
    /\b(outperform|outperforms|outperformed)\b.{0,80}\b(baseline|baselines|state-of-the-art|sota|existing methods?|prior methods?|traditional methods?|benchmark model)\b/
  ].some(pattern => pattern.test(source));
  const hasConceptual = /\b(conceptual framework|taxonomy|theoretical framework|reference model)\b/.test(source);
  const fallbackReason = normalizeFallbackReason(reason);

  let archetype: ArchetypeId = 'SYSTEM_ALGO_EVALUATION';
  if (hasQual && hasQuant) {
    archetype = 'MIXED_METHODS_APPLIED_STUDY';
  } else if (hasIntervention) {
    archetype = 'CONTROLLED_EXPERIMENTAL_STUDY';
  } else if (hasObservational && !hasIntervention) {
    archetype = 'EMPIRICAL_OBSERVATIONAL_STUDY';
  } else if (hasSystem || hasQuant) {
    archetype = 'SYSTEM_ALGO_EVALUATION';
  }

  let contributionMode: ContributionMode = 'APPLICATION_VALIDATION';
  if (hasComparative) contributionMode = 'COMPARATIVE_BENCHMARK';
  else if (hasConceptual && !hasQuant && !hasIntervention) contributionMode = 'CONCEPTUAL_FRAMEWORK';
  else if (/\b(novel|new|propose|design|introduce)\b/.test(source) && hasSystem) contributionMode = 'NOVEL_METHOD';

  let evaluationScope: EvaluationScope = 'UNSPECIFIED';
  if (hasBenchmark) evaluationScope = 'BENCHMARK';
  else if (hasIntervention) evaluationScope = 'CONTROLLED_LAB';
  else if (hasRealWorld) evaluationScope = 'REAL_WORLD';
  else if (/\b(retrospective|historical|existing data|secondary data|cohort)\b/.test(source)) evaluationScope = 'RETROSPECTIVE_DATA';
  else if (hasProspective) evaluationScope = 'PROSPECTIVE';

  let evidenceModality: EvidenceModality = 'QUANTITATIVE';
  if (hasQual && hasQuant) evidenceModality = 'MIXED';
  else if (hasQual) evidenceModality = 'QUALITATIVE';

  const missingSignals = detectMissingSignals(topic);
  const confidenceBase = hasMinimumSignals(topic) ? 0.62 : 0.45;
  const confidencePenalty = Math.min(0.25, missingSignals.length * 0.02);
  const confidence = Math.max(0.2, +(confidenceBase - confidencePenalty).toFixed(2));

  const output: DetectionOutput = {
    archetype,
    routingTags: {
      contributionMode,
      evaluationScope,
      evidenceModality
    },
    confidence,
    rationale: [
      `Fallback classification used: ${fallbackReason}.`,
      `Primary signal pattern matched ${archetype} with ${evidenceModality.toLowerCase()} evidence emphasis.`,
    ],
    missingSignals,
    contradictions: []
  };

  output.contradictions = detectContradictions(topic, output);
  return output;
}

function coalesce(base: TopicSnapshot, override?: Partial<TopicSnapshot>, preferBase = false): TopicSnapshot {
  if (!override) return base;

  const merged: TopicSnapshot = { ...base };
  for (const key of ARRAY_TOPIC_KEYS) {
    const baseArr = base[key];
    const overrideArr = Array.isArray(override[key]) ? override[key]! : [];
    if (preferBase && baseArr.length > 0) {
      merged[key] = baseArr;
    } else {
      merged[key] = overrideArr.length > 0 ? overrideArr : baseArr;
    }
  }

  for (const key of TEXT_TOPIC_KEYS) {
    const baseText = stringOrNull(base[key]);
    const overrideText = stringOrNull(override[key]);
    if (preferBase && hasValue(baseText)) {
      merged[key] = baseText;
    } else {
      merged[key] = overrideText ?? baseText;
    }
  }
  return merged;
}

function buildDigest(topic: TopicSnapshot, session: DraftingSnapshot): string {
  const normalized = {
    ...topic,
    subQuestions: [...(topic.subQuestions || [])].map(v => v.trim()).filter(Boolean),
    techniques: [...(topic.techniques || [])].map(v => v.trim()).filter(Boolean),
    tools: [...(topic.tools || [])].map(v => v.trim()).filter(Boolean),
    keywords: [...(topic.keywords || [])].map(v => v.trim()).filter(Boolean),
    session
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function toTopicSnapshot(topic: any | null): TopicSnapshot {
  if (!topic) return { ...EMPTY_TOPIC };
  return {
    title: stringOrNull(topic.title),
    field: stringOrNull(topic.field),
    subfield: stringOrNull(topic.subfield),
    topicDescription: stringOrNull(topic.topicDescription),
    researchQuestion: stringOrNull(topic.researchQuestion),
    subQuestions: stringArray(topic.subQuestions),
    problemStatement: stringOrNull(topic.problemStatement),
    researchGaps: stringOrNull(topic.researchGaps),
    methodology: stringOrNull(topic.methodology),
    methodologyApproach: stringOrNull(topic.methodologyApproach),
    techniques: stringArray(topic.techniques),
    datasetDescription: stringOrNull(topic.datasetDescription),
    dataCollection: stringOrNull(topic.dataCollection),
    sampleSize: stringOrNull(topic.sampleSize),
    tools: stringArray(topic.tools),
    experiments: stringOrNull(topic.experiments),
    hypothesis: stringOrNull(topic.hypothesis),
    expectedResults: stringOrNull(topic.expectedResults),
    contributionType: stringOrNull(topic.contributionType),
    novelty: stringOrNull(topic.novelty),
    limitations: stringOrNull(topic.limitations),
    keywords: stringArray(topic.keywords),
    abstractDraft: stringOrNull(topic.abstractDraft)
  };
}

function buildPrompt(
  topic: TopicSnapshot,
  draftingSession: DraftingSnapshot,
  helperNotes?: Record<string, unknown> | null
): string {
  return `SYSTEM ROLE:
You are an academic methodology classifier for a research paper writing system.
Your job is to infer the idea's research archetype and routing tags conservatively, using only the provided fields.
Prioritize correctness and explicit uncertainty over guessing.

STRICT OUTPUT: Return ONLY valid JSON (no markdown, no extra text).

INPUTS
You will receive:
- researchTopic: persisted idea fields for the current session
- draftingSession: paper config fields
- Optional helperNotes: extraction notes (non-authoritative)

TASK
Infer:
- archetype (choose exactly one)
- routingTags: contributionMode, evaluationScope, evidenceModality
- confidence (0.00-1.00)
- rationale (max 4 short sentences)
- missingSignals (fields that are missing/too vague and reduce confidence)
- contradictions (explicit conflicts across provided fields)

ARCHEYPES (choose exactly one)
- SYSTEM_ALGO_EVALUATION
- CONTROLLED_EXPERIMENTAL_STUDY
- EMPIRICAL_OBSERVATIONAL_STUDY
- MIXED_METHODS_APPLIED_STUDY

ROUTING TAGS
contributionMode (choose one): NOVEL_METHOD | APPLICATION_VALIDATION | COMPARATIVE_BENCHMARK | CONCEPTUAL_FRAMEWORK
evaluationScope (choose one): BENCHMARK | CONTROLLED_LAB | REAL_WORLD | RETROSPECTIVE_DATA | PROSPECTIVE | UNSPECIFIED
evidenceModality (choose one): QUANTITATIVE | QUALITATIVE | MIXED

DECISION RULES (important)
- Use methodologyApproach / experiments / dataCollection / sampleSize / tools as primary signals, not field label.
- If qualitative signals appear and quantitative evaluation is also present, choose MIXED_METHODS_APPLIED_STUDY.
- If user explicitly states experimental design/intervention/control, choose CONTROLLED_EXPERIMENTAL_STUDY.
- If no intervention and plan is analysis of existing/cohort/field data, choose EMPIRICAL_OBSERVATIONAL_STUDY.
- Otherwise default to SYSTEM_ALGO_EVALUATION if a system/model is proposed with metrics/dataset evaluation.
- If key info is missing, lower confidence and populate missingSignals; do NOT guess details.
- Detect contradictions (e.g., claims interviews but no qualitative method described; claims RCT but no intervention/variables).

OUTPUT JSON SCHEMA (MUST FOLLOW)
{
  "archetype": "SYSTEM_ALGO_EVALUATION|CONTROLLED_EXPERIMENTAL_STUDY|EMPIRICAL_OBSERVATIONAL_STUDY|MIXED_METHODS_APPLIED_STUDY",
  "routingTags": {
    "contributionMode": "NOVEL_METHOD|APPLICATION_VALIDATION|COMPARATIVE_BENCHMARK|CONCEPTUAL_FRAMEWORK",
    "evaluationScope": "BENCHMARK|CONTROLLED_LAB|REAL_WORLD|RETROSPECTIVE_DATA|PROSPECTIVE|UNSPECIFIED",
    "evidenceModality": "QUANTITATIVE|QUALITATIVE|MIXED"
  },
  "confidence": 0.0,
  "rationale": [
    "Sentence 1",
    "Sentence 2"
  ],
  "missingSignals": [
    "fieldName1"
  ],
  "contradictions": [
    "Describe contradiction succinctly"
  ]
}

CRITICAL:
- Output must start with { and end with }.
- No extra keys.
- confidence must be between 0 and 1.
- rationale must have 2-4 items max.

INPUT DATA:
researchTopic: ${JSON.stringify(topic)}
draftingSession: ${JSON.stringify(draftingSession)}
helperNotes: ${JSON.stringify(helperNotes || null)}`;
}

export interface ArchetypeDetectionResult {
  archetype: ArchetypeId;
  routingTags: {
    contributionMode: ContributionMode;
    evaluationScope: EvaluationScope;
    evidenceModality: EvidenceModality;
  };
  confidence: number;
  rationale: string[];
  missingSignals: string[];
  contradictions: string[];
  modulePlan: string[];
  digest: string;
  changed: boolean;
  evidenceStale: boolean;
  shouldAutoApply: boolean;
  usedFallback?: boolean;
  fallbackReason?: string | null;
  skipped?: 'unchanged' | 'insufficient_signals';
}

export interface RunDetectionOptions {
  sessionId: string;
  headers: Record<string, string>;
  userId?: string;
  source: 'TOPIC_SAVE' | 'TOPIC_EXTRACT' | 'TOPIC_ASSIST' | 'MANUAL';
  force?: boolean;
  helperNotes?: Record<string, unknown> | null;
  topicOverride?: Partial<TopicSnapshot>;
  preferPersistedTopic?: boolean;
}

class PaperArchetypeService {
  async detectAndPersist(options: RunDetectionOptions): Promise<ArchetypeDetectionResult | null> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: options.sessionId },
      include: {
        researchTopic: true
      }
    });

    if (!session) return null;

    const baseTopic = toTopicSnapshot(session.researchTopic);
    const mergedTopic = coalesce(
      baseTopic,
      options.topicOverride,
      Boolean(options.preferPersistedTopic)
    );
    const draftingSnapshot: DraftingSnapshot = {
      paperTypeId: session.paperTypeId || null,
      targetWordCount: session.targetWordCount ?? null,
      publicationVenueId: session.publicationVenueId || null
    };
    const digest = buildDigest(mergedTopic, draftingSnapshot);

    const existingArchetype = stringOrNull(session.archetypeId) as ArchetypeId | null;
    const existingTags = {
      contributionMode: stringOrNull(session.contributionMode) as ContributionMode | null,
      evaluationScope: stringOrNull(session.evaluationScope) as EvaluationScope | null,
      evidenceModality: stringOrNull(session.evidenceModality) as EvidenceModality | null
    };

    if (!options.force && session.archetypeInputDigest && session.archetypeInputDigest === digest) {
      if (existingArchetype && existingTags.contributionMode && existingTags.evaluationScope && existingTags.evidenceModality) {
        return {
          archetype: existingArchetype,
          routingTags: {
            contributionMode: existingTags.contributionMode,
            evaluationScope: existingTags.evaluationScope,
            evidenceModality: existingTags.evidenceModality
          },
          confidence: Number(session.archetypeConfidence || 0),
          rationale: toSentenceList(String(session.archetypeRationale || '').split(/(?<=[.!?])\s+/), 4),
          missingSignals: Array.isArray(session.archetypeMissingSignals) ? (session.archetypeMissingSignals as string[]) : [],
          contradictions: Array.isArray(session.archetypeContradictions) ? (session.archetypeContradictions as string[]) : [],
          modulePlan: MODULE_PLAN_BY_ARCHETYPE[existingArchetype],
          digest,
          changed: false,
          evidenceStale: Boolean(session.archetypeEvidenceStale),
          shouldAutoApply: Number(session.archetypeConfidence || 0) >= MIN_CONFIDENCE_FOR_AUTO_APPLY && !session.archetypeEvidenceStale,
          skipped: 'unchanged'
        };
      }
    }

    const missingSignals = detectMissingSignals(mergedTopic);
    const hasSignals = hasMinimumSignals(mergedTopic);
    if (!options.force && !hasSignals && existingArchetype && existingTags.contributionMode && existingTags.evaluationScope && existingTags.evidenceModality) {
      return {
        archetype: existingArchetype,
        routingTags: {
          contributionMode: existingTags.contributionMode,
          evaluationScope: existingTags.evaluationScope,
          evidenceModality: existingTags.evidenceModality
        },
        confidence: Number(session.archetypeConfidence || 0),
        rationale: toSentenceList(String(session.archetypeRationale || '').split(/(?<=[.!?])\s+/), 4),
        missingSignals,
        contradictions: Array.isArray(session.archetypeContradictions) ? (session.archetypeContradictions as string[]) : [],
        modulePlan: MODULE_PLAN_BY_ARCHETYPE[existingArchetype],
        digest,
        changed: false,
        evidenceStale: Boolean(session.archetypeEvidenceStale),
        shouldAutoApply: false,
        skipped: 'insufficient_signals'
      };
    }

    const prompt = buildPrompt(mergedTopic, draftingSnapshot, options.helperNotes);
    let output: DetectionOutput | null = null;
    let fallbackReason: string | null = null;
    let usedFallback = false;

    try {
      const llm = await llmGateway.executeLLMOperation(
        { headers: options.headers },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'PAPER_ARCHETYPE_DETECTION',
          prompt,
          parameters: { temperature: 0.1 },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId: options.sessionId,
            action: 'paper_archetype_detection',
            source: options.source,
            module: 'publication_ideation'
          }
        }
      );

      if (!llm.success) {
        fallbackReason = `LLM gateway returned an error: ${String(llm.error?.message || 'Unknown gateway error')}`;
      } else if (!llm.response?.output || !String(llm.response.output).trim()) {
        fallbackReason = 'LLM response contained no output text';
      } else {
        const parsedRaw = parseJsonOutput(llm.response.output || '');
        if (!parsedRaw || typeof parsedRaw !== 'object') {
          fallbackReason = 'LLM output did not contain parseable JSON';
        } else {
          const parsed = DetectionOutputSchema.safeParse(parsedRaw);
          if (parsed.success) {
            output = sanitizeOutput(parsed.data);
          } else {
            const issue = parsed.error.issues[0];
            const issuePath = issue?.path?.length ? issue.path.join('.') : '(root)';
            const issueMessage = issue?.message || 'Unknown schema violation';
            fallbackReason = `LLM JSON failed schema validation at ${issuePath}: ${issueMessage}`;
          }
        }
      }
    } catch (error) {
      fallbackReason = `LLM request threw: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (!output) {
      usedFallback = true;
      output = buildFallbackClassification(mergedTopic, fallbackReason);
      console.warn('[PaperArchetype] Using deterministic fallback classification', {
        sessionId: options.sessionId,
        source: options.source,
        reason: normalizeFallbackReason(fallbackReason)
      });
    }

    const mergedContradictions = Array.from(
      new Set([
        ...output.contradictions,
        ...detectContradictions(mergedTopic, output)
      ])
    );
    output = {
      ...output,
      missingSignals: Array.from(new Set([...output.missingSignals, ...missingSignals])),
      contradictions: mergedContradictions
    };

    const changed = Boolean(existingArchetype && existingArchetype !== output.archetype);
    const nextEvidenceStale = changed ? true : Boolean(session.archetypeEvidenceStale);
    const modulePlan = MODULE_PLAN_BY_ARCHETYPE[output.archetype];
    const rationaleText = output.rationale.join(' ').slice(0, 1200);

    await prisma.draftingSession.update({
      where: { id: options.sessionId },
      data: {
        archetypeId: output.archetype,
        archetypeConfidence: output.confidence,
        contributionMode: output.routingTags.contributionMode,
        evaluationScope: output.routingTags.evaluationScope,
        evidenceModality: output.routingTags.evidenceModality,
        archetypeRationale: rationaleText,
        archetypeComputedAt: new Date(),
        archetypeVersion: ARCHETYPE_VERSION,
        archetypeInputDigest: digest,
        archetypeMissingSignals: output.missingSignals as any,
        archetypeContradictions: output.contradictions as any,
        archetypeEvidenceStale: nextEvidenceStale
      }
    });

    if (options.userId) {
      await prisma.draftingHistory.create({
      data: {
        sessionId: options.sessionId,
        action: changed ? 'PAPER_ARCHETYPE_CHANGED' : 'PAPER_ARCHETYPE_DETECTED',
          userId: options.userId,
          stage: session.status,
          newData: {
            source: options.source,
            archetype: output.archetype,
            confidence: output.confidence,
            routingTags: output.routingTags,
            changed,
            evidenceStale: nextEvidenceStale,
            usedFallback,
            fallbackReason: usedFallback ? normalizeFallbackReason(fallbackReason) : null,
            missingSignals: output.missingSignals,
            contradictions: output.contradictions
          }
        }
      });
    }

    return {
      archetype: output.archetype,
      routingTags: output.routingTags,
      confidence: output.confidence,
      rationale: output.rationale,
      missingSignals: output.missingSignals,
      contradictions: output.contradictions,
      modulePlan,
      digest,
      changed,
      evidenceStale: nextEvidenceStale,
      shouldAutoApply: output.confidence >= MIN_CONFIDENCE_FOR_AUTO_APPLY && !nextEvidenceStale,
      usedFallback,
      fallbackReason: usedFallback ? normalizeFallbackReason(fallbackReason) : null
    };
  }

  async getSessionArchetype(sessionId: string): Promise<ArchetypeDetectionResult | null> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: {
        archetypeId: true,
        archetypeConfidence: true,
        contributionMode: true,
        evaluationScope: true,
        evidenceModality: true,
        archetypeRationale: true,
        archetypeInputDigest: true,
        archetypeMissingSignals: true,
        archetypeContradictions: true,
        archetypeEvidenceStale: true
      }
    });

    if (!session?.archetypeId || !session.contributionMode || !session.evaluationScope || !session.evidenceModality) {
      return null;
    }

    const archetype = session.archetypeId as ArchetypeId;
    const contributionMode = session.contributionMode as ContributionMode;
    const evaluationScope = session.evaluationScope as EvaluationScope;
    const evidenceModality = session.evidenceModality as EvidenceModality;
    const rationale = toSentenceList(String(session.archetypeRationale || '').split(/(?<=[.!?])\s+/), 4);

    return {
      archetype,
      routingTags: {
        contributionMode,
        evaluationScope,
        evidenceModality
      },
      confidence: Number(session.archetypeConfidence || 0),
      rationale: rationale.length ? rationale : ['No rationale available.'],
      missingSignals: Array.isArray(session.archetypeMissingSignals) ? (session.archetypeMissingSignals as string[]) : [],
      contradictions: Array.isArray(session.archetypeContradictions) ? (session.archetypeContradictions as string[]) : [],
      modulePlan: MODULE_PLAN_BY_ARCHETYPE[archetype],
      digest: session.archetypeInputDigest || '',
      changed: false,
      evidenceStale: Boolean(session.archetypeEvidenceStale),
      shouldAutoApply: Number(session.archetypeConfidence || 0) >= MIN_CONFIDENCE_FOR_AUTO_APPLY && !session.archetypeEvidenceStale
    };
  }
}

export const paperArchetypeService = new PaperArchetypeService();
export { PaperArchetypeService };
export type { TopicSnapshot, ArchetypeId, ContributionMode, EvaluationScope, EvidenceModality };
