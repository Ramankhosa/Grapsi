import fs from 'fs';
import { z } from 'zod';
import { llmGateway, type TenantContext } from '../metering';
import {
  extractionCardSchema,
  EVIDENCE_CLAIM_TYPES,
  EVIDENCE_CONFIDENCE_LEVELS,
  NOT_EXTRACTED_FROM_SOURCE,
  type ExtractedEvidenceCard,
  type PreparedPaperText,
  type DeepAnalysisLabel,
  type ReferenceArchetype,
  DEFAULT_CARD_TARGETS,
} from './deep-analysis-types';

const SINGLE_CALL_TOKEN_LIMIT = 25_000;
const LLM_MAX_RETRIES = 1;
const LLM_RETRY_DELAY_MS = 2_000;
const ENABLE_NATIVE_PDF_INPUT = process.env.DEEP_ANALYSIS_USE_NATIVE_PDF === 'true';
const DEFAULT_NATIVE_PDF_MAX_BYTES = 12 * 1024 * 1024;
const NATIVE_PDF_MAX_BYTES = (() => {
  const parsed = Number.parseInt(String(process.env.DEEP_ANALYSIS_NATIVE_PDF_MAX_BYTES || ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_NATIVE_PDF_MAX_BYTES;
})();

const SYSTEM_PROMPT_BASE = `You are a research evidence extractor.
Read the paper text and return structured evidence cards for academic drafting.

CRITICAL RULES:
1. Every card must include sourceFragment as an exact verbatim quote (1-3 sentences).
2. Quantitative claims must include exact numbers from the text (metrics, n, p-values, CI where present).
3. For FINDING and METHOD cards, doesNotSupport is mandatory.
4. Set confidence strictly from evidence strength in the text:
   - HIGH: clear quantitative evidence with strong methodological support
   - MEDIUM: evidence present but partial detail or narrower scope
   - LOW: weak, indirect, or uncertain evidence
5. Output valid JSON only. No markdown, no explanations.
6. SCOPE TRANSPARENCY:
   Every FINDING card must include scopeCondition.
   If not stated in the paper, write: "Not extracted from source."
7. BOUNDARY NOTES:
   For quantitative claims, include boundaryNote.
   If not explicitly stated, write: "Not extracted from source."
8. TRADE-OFFS:
   For METHOD and FINDING cards, extract trade-offs ONLY if explicitly stated.
   If not found in the source text, write: "Not extracted from source."
9. COMPETING EXPLANATIONS:
   Extract only if authors explicitly mention alternative explanations.
   Otherwise write: "Not extracted from source."

IMPORTANT:
- "Not extracted from source" means absence of extracted evidence.
- It does NOT mean the trade-off or boundary does not exist.
- boundaryNote, tradeOff, and competingExplanation must be grounded in sourceFragment or adjacent text.
- Do NOT infer trade-offs unless explicitly stated.

OUTPUT FORMAT:
Return a JSON array of objects with fields:
claim, claimType, quantitativeDetail, conditions, comparableMetrics,
doesNotSupport, scopeCondition, boundaryNote, tradeOff, competingExplanation, studyDesign, rigorIndicators,
sourceFragment, pageHint, confidence, sourceSection.`;

const ARCHETYPE_INSTRUCTIONS: Record<ReferenceArchetype, string> = {
  SYSTEM_ALGO_EVALUATION: `Focus on metrics, baselines, datasets, architecture decisions, and ablations.
Use studyDesign values like benchmark evaluation, ablation study, user study, simulation.`,
  CONTROLLED_EXPERIMENTAL_STUDY: `Focus on intervention/control details, effect sizes, confidence intervals, p-values,
randomization/blinding, and group sizes.`,
  EMPIRICAL_OBSERVATIONAL_STUDY: `Focus on associations/predictors with coefficients, AUC, OR, R2, and confounders.
Always note that causation is not established in doesNotSupport when applicable.`,
  MIXED_METHODS_APPLIED_STUDY: `Extract both quantitative and qualitative findings. Prefix claim with [QUANT] or [QUAL].
Capture triangulation and divergence between components.`,
  SYNTHESIS_REVIEW: `Focus on pooled estimates, heterogeneity, number of studies, search strategy scope,
quality/risk of bias, and explicit research gaps.`,
  POSITION_CONCEPTUAL: `Focus on definitions, frameworks, and conceptual arguments.
Use doesNotSupport to state these are theoretical claims, not empirical proof.`,
};

const DEPTH_INSTRUCTIONS: Record<Exclude<DeepAnalysisLabel, 'LIT_ONLY'>, string> = {
  DEEP_ANCHOR: `Extract 8-15 cards across all sections, balancing grounded findings, synthesis-ready metrics,
methodological rigor, boundaries, and verbatim accuracy.`,
  DEEP_SUPPORT: `Extract 3-6 focused cards mainly from methods/results. Prioritize grounded findings and methodology details.`,
  DEEP_STRESS_TEST: `Extract 4-8 cards from methods/results/discussion/limitations.
Prioritize boundaries, contrasts, and methodological caveats.`,
};

function normalizeArchetype(value: string | null | undefined): ReferenceArchetype {
  const upper = String(value || '').trim().toUpperCase();
  if ((Object.keys(ARCHETYPE_INSTRUCTIONS) as ReferenceArchetype[]).includes(upper as ReferenceArchetype)) {
    return upper as ReferenceArchetype;
  }
  return 'SYSTEM_ALGO_EVALUATION';
}

function normalizeDepth(value: string | null | undefined): Exclude<DeepAnalysisLabel, 'LIT_ONLY'> {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'DEEP_ANCHOR' || upper === 'DEEP_SUPPORT' || upper === 'DEEP_STRESS_TEST') {
    return upper;
  }
  return 'DEEP_SUPPORT';
}

interface ExtractionPrompt {
  system: string;
  user: string;
}

function buildExtractionPrompt(
  archetype: ReferenceArchetype,
  depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
  preparedText: PreparedPaperText,
  blueprintDimensions: string[]
): ExtractionPrompt {
  const system = [
    SYSTEM_PROMPT_BASE,
    ARCHETYPE_INSTRUCTIONS[archetype],
    DEPTH_INSTRUCTIONS[depthLabel],
    `Output format: JSON array of cards with fields:
claim, claimType, quantitativeDetail, conditions, comparableMetrics,
doesNotSupport, scopeCondition, boundaryNote, tradeOff, competingExplanation, studyDesign, rigorIndicators,
sourceFragment, pageHint, confidence, sourceSection`,
  ].join('\n\n');

  const dimensionContext = blueprintDimensions.length > 0
    ? `Blueprint context dimensions (for relevance only):\n${blueprintDimensions.map(d => `- ${d}`).join('\n')}`
    : '';

  const user = [
    '=== PAPER TEXT ===',
    preparedText.fullText,
    dimensionContext,
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

function buildNativePdfPrompt(
  archetype: ReferenceArchetype,
  depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
  blueprintDimensions: string[]
): ExtractionPrompt {
  const system = [
    SYSTEM_PROMPT_BASE.replace('Read the paper text', 'Read the attached paper PDF'),
    ARCHETYPE_INSTRUCTIONS[archetype],
    DEPTH_INSTRUCTIONS[depthLabel],
    'The full paper is attached as a PDF file in the same message.',
    'Do not request extra files. Use only evidence from the attached PDF.',
    `Output format: JSON array of cards with fields:
claim, claimType, quantitativeDetail, conditions, comparableMetrics,
doesNotSupport, scopeCondition, boundaryNote, tradeOff, competingExplanation, studyDesign, rigorIndicators,
sourceFragment, pageHint, confidence, sourceSection`,
  ].join('\n\n');

  const dimensionContext = blueprintDimensions.length > 0
    ? `Blueprint context dimensions (for relevance only):\n${blueprintDimensions.map(d => `- ${d}`).join('\n')}`
    : '';

  const user = [
    'Extract evidence cards directly from the attached PDF.',
    'Return only a JSON array.',
    dimensionContext,
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

function stripJsonFences(value: string): string {
  const trimmed = String(value || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}

function recoverJsonArray(raw: string): { parsed: unknown; recovered: boolean } {
  const candidate = String(raw || '').trim();
  if (!candidate) {
    throw new Error('Empty response');
  }

  try {
    return {
      parsed: JSON.parse(candidate),
      recovered: false,
    };
  } catch {
    // Fall through to recovery attempts.
  }

  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start !== -1 && end > start) {
    return {
      parsed: JSON.parse(candidate.slice(start, end + 1)),
      recovered: true,
    };
  }

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return {
      parsed: [JSON.parse(candidate.slice(objectStart, objectEnd + 1))],
      recovered: true,
    };
  }

  throw new Error('Unable to recover JSON');
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeExtractedField(value: string | null | undefined): string | null {
  if (!hasNonEmptyText(value)) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === NOT_EXTRACTED_FROM_SOURCE.toLowerCase()) {
    return NOT_EXTRACTED_FROM_SOURCE;
  }
  return trimmed;
}

function downgradeConfidence(confidence: ExtractedEvidenceCard['confidence']): ExtractedEvidenceCard['confidence'] {
  if (confidence === 'HIGH') return 'MEDIUM';
  if (confidence === 'MEDIUM') return 'LOW';
  return 'LOW';
}

function enforceCardRules(card: ExtractedEvidenceCard, index: number, warnings: string[]): ExtractedEvidenceCard {
  let next = { ...card };

  if ((next.claimType === 'FINDING' || next.claimType === 'METHOD') && !hasNonEmptyText(next.doesNotSupport)) {
    warnings.push(`Card ${index}: doesNotSupport missing for ${next.claimType}, confidence downgraded`);
    next.doesNotSupport = 'Not explicitly stated in source text.';
    next.confidence = downgradeConfidence(next.confidence);
  }

  if (hasNonEmptyText(next.quantitativeDetail) && !next.comparableMetrics) {
    warnings.push(`Card ${index}: quantitativeDetail present without comparableMetrics, confidence downgraded`);
    next.confidence = downgradeConfidence(next.confidence);
  }

  // Scope transparency for findings.
  const normalizedScopeCondition = normalizeExtractedField(next.scopeCondition);
  if (next.claimType === 'FINDING' && !normalizedScopeCondition) {
    warnings.push(`Card ${index}: scopeCondition missing for FINDING, default applied`);
  }
  next.scopeCondition = normalizedScopeCondition || (next.claimType === 'FINDING'
    ? NOT_EXTRACTED_FROM_SOURCE
    : next.scopeCondition);

  // Boundary notes must exist for quantitative claims.
  const normalizedBoundaryNote = normalizeExtractedField(next.boundaryNote);
  if (hasNonEmptyText(next.quantitativeDetail) && !normalizedBoundaryNote) {
    warnings.push(`Card ${index}: boundaryNote missing for quantitative claim, default applied`);
  }
  next.boundaryNote = normalizedBoundaryNote || NOT_EXTRACTED_FROM_SOURCE;

  // Trade-offs are only extracted when explicit; default when absent.
  const normalizedTradeOff = normalizeExtractedField(next.tradeOff);
  if ((next.claimType === 'FINDING' || next.claimType === 'METHOD') && !normalizedTradeOff) {
    warnings.push(`Card ${index}: tradeOff not explicit for ${next.claimType}, default applied`);
  }
  next.tradeOff = normalizedTradeOff || NOT_EXTRACTED_FROM_SOURCE;

  // Competing explanations must be explicit in source text.
  const normalizedCompetingExplanation = normalizeExtractedField(next.competingExplanation);
  if (!normalizedCompetingExplanation) {
    warnings.push(`Card ${index}: competingExplanation missing, default applied`);
  }
  next.competingExplanation = normalizedCompetingExplanation || NOT_EXTRACTED_FROM_SOURCE;

  return next;
}

const CLAIM_TYPE_SET = new Set<string>(EVIDENCE_CLAIM_TYPES);
const CONFIDENCE_SET = new Set<string>(EVIDENCE_CONFIDENCE_LEVELS);

const CLAIM_TYPE_ALIASES: Record<string, string> = {
  FINDINGS: 'FINDING',
  RESULT: 'FINDING',
  RESULTS: 'FINDING',
  OBSERVATION: 'FINDING',
  EVIDENCE: 'FINDING',
  OUTCOME: 'FINDING',
  PERFORMANCE: 'FINDING',
  COMPARISON: 'FINDING',
  METHODOLOGY: 'METHOD',
  METHODS: 'METHOD',
  APPROACH: 'METHOD',
  TECHNIQUE: 'METHOD',
  PROCEDURE: 'METHOD',
  ALGORITHM: 'METHOD',
  IMPLEMENTATION: 'METHOD',
  DESIGN: 'METHOD',
  SETUP: 'METHOD',
  DATASET: 'METHOD',
  DATA: 'METHOD',
  EXPERIMENT: 'METHOD',
  EVALUATION: 'METHOD',
  BENCHMARK: 'METHOD',
  METRIC: 'METHOD',
  BOUNDARY: 'LIMITATION',
  CONSTRAINT: 'LIMITATION',
  WEAKNESS: 'LIMITATION',
  THREAT: 'LIMITATION',
  CAVEAT: 'LIMITATION',
  BIAS: 'LIMITATION',
  RESEARCH_GAP: 'GAP',
  FUTURE_WORK: 'GAP',
  OPEN_PROBLEM: 'GAP',
  CONCEPT: 'DEFINITION',
  TERM: 'DEFINITION',
  THEORY: 'FRAMEWORK',
  MODEL: 'FRAMEWORK',
  ARCHITECTURE: 'FRAMEWORK',
  PARADIGM: 'FRAMEWORK',
  CONTEXT: 'FINDING',
  BACKGROUND: 'FINDING',
  CONTRIBUTION: 'FINDING',
};

function coerceToStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const joined = value.map(item => String(item ?? '')).filter(Boolean).join('; ');
    return joined || null;
  }
  return String(value);
}

function normalizeCardBeforeParse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const result = { ...obj };

  if (typeof result.claimType === 'string') {
    const upper = result.claimType.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (CLAIM_TYPE_SET.has(upper)) {
      result.claimType = upper;
    } else if (CLAIM_TYPE_ALIASES[upper]) {
      result.claimType = CLAIM_TYPE_ALIASES[upper];
    } else {
      result.claimType = 'FINDING';
    }
  }

  if (typeof result.confidence === 'string') {
    const upper = result.confidence.trim().toUpperCase();
    result.confidence = CONFIDENCE_SET.has(upper) ? upper : 'MEDIUM';
  }

  if (typeof result.claim_type === 'string' && !result.claimType) {
    const upper = String(result.claim_type).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (CLAIM_TYPE_SET.has(upper)) {
      result.claimType = upper;
    } else if (CLAIM_TYPE_ALIASES[upper]) {
      result.claimType = CLAIM_TYPE_ALIASES[upper];
    } else {
      result.claimType = 'FINDING';
    }
    delete result.claim_type;
  }
  if (result.source_fragment !== undefined && !result.sourceFragment) {
    result.sourceFragment = coerceToStringOrNull(result.source_fragment) ?? result.source_fragment;
    delete result.source_fragment;
  }
  if (result.source_section !== undefined && !result.sourceSection) {
    result.sourceSection = coerceToStringOrNull(result.source_section) ?? result.source_section;
    delete result.source_section;
  }
  if (result.quantitative_detail !== undefined && result.quantitativeDetail === undefined) {
    result.quantitativeDetail = coerceToStringOrNull(result.quantitative_detail);
    delete result.quantitative_detail;
  }
  if (result.does_not_support !== undefined && result.doesNotSupport === undefined) {
    result.doesNotSupport = coerceToStringOrNull(result.does_not_support);
    delete result.does_not_support;
  }
  if (result.scope_condition !== undefined && result.scopeCondition === undefined) {
    result.scopeCondition = coerceToStringOrNull(result.scope_condition);
    delete result.scope_condition;
  }
  if (result.boundary_note !== undefined && result.boundaryNote === undefined) {
    result.boundaryNote = coerceToStringOrNull(result.boundary_note);
    delete result.boundary_note;
  }
  if (result.trade_off !== undefined && result.tradeOff === undefined) {
    result.tradeOff = coerceToStringOrNull(result.trade_off);
    delete result.trade_off;
  }
  if (result.competing_explanation !== undefined && result.competingExplanation === undefined) {
    result.competingExplanation = coerceToStringOrNull(result.competing_explanation);
    delete result.competing_explanation;
  }
  if (result.study_design !== undefined && result.studyDesign === undefined) {
    result.studyDesign = coerceToStringOrNull(result.study_design);
    delete result.study_design;
  }
  if (result.rigor_indicators !== undefined && result.rigorIndicators === undefined) {
    result.rigorIndicators = coerceToStringOrNull(result.rigor_indicators);
    delete result.rigor_indicators;
  }
  if (result.page_hint !== undefined && result.pageHint === undefined) {
    result.pageHint = coerceToStringOrNull(result.page_hint);
    delete result.page_hint;
  }
  if (result.comparable_metrics !== undefined && result.comparableMetrics === undefined) {
    result.comparableMetrics = result.comparable_metrics;
    delete result.comparable_metrics;
  }

  // Coerce camelCase fields that LLMs may return as arrays instead of strings
  const stringFields = [
    'rigorIndicators', 'studyDesign', 'scopeCondition', 'doesNotSupport',
    'boundaryNote', 'tradeOff', 'competingExplanation',
    'quantitativeDetail', 'conditions', 'pageHint',
  ] as const;
  for (const field of stringFields) {
    if (result[field] !== undefined && result[field] !== null && typeof result[field] !== 'string') {
      result[field] = coerceToStringOrNull(result[field]);
    }
  }

  if (typeof result.comparableMetrics === 'string') {
    const metricsStr = result.comparableMetrics.trim();
    if (!metricsStr) {
      result.comparableMetrics = null;
    } else {
      try {
        const parsed = JSON.parse(metricsStr);
        result.comparableMetrics = typeof parsed === 'object' && parsed !== null ? parsed : { value: metricsStr };
      } catch {
        const pairs: Record<string, string> = {};
        const segments = metricsStr.split(/[;,]\s*/);
        for (const segment of segments) {
          const colonIdx = segment.indexOf(':');
          if (colonIdx > 0) {
            pairs[segment.slice(0, colonIdx).trim()] = segment.slice(colonIdx + 1).trim();
          } else {
            pairs.value = (pairs.value ? pairs.value + '; ' : '') + segment.trim();
          }
        }
        result.comparableMetrics = Object.keys(pairs).length > 0 ? pairs : { value: metricsStr };
      }
    }
  }

  if (Array.isArray(result.comparableMetrics)) {
    const obj: Record<string, string> = {};
    (result.comparableMetrics as unknown[]).forEach((item, i) => {
      if (typeof item === 'string') {
        obj[`metric_${i}`] = item;
      } else if (item && typeof item === 'object') {
        Object.assign(obj, item);
      }
    });
    result.comparableMetrics = Object.keys(obj).length > 0 ? obj : null;
  }

  return result;
}

function parseExtractionResponse(rawOutput: string, depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>): { cards: ExtractedEvidenceCard[]; warnings: string[] } {
  const warnings: string[] = [];
  let jsonText = stripJsonFences(rawOutput);

  let parsed: unknown;
  try {
    const recovered = recoverJsonArray(jsonText);
    parsed = recovered.parsed;
    if (recovered.recovered) {
      warnings.push('JSON recovered from partial response');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid output';
    console.error(`[EvidenceExtraction] JSON parse failed. Raw output (first 500 chars): ${rawOutput.slice(0, 500)}`);
    throw new Error(`LLM returned invalid JSON (${message})`);
  }

  if (!Array.isArray(parsed)) {
    console.error(`[EvidenceExtraction] Output is not array. Type=${typeof parsed}. Raw (first 300 chars): ${rawOutput.slice(0, 300)}`);
    throw new Error('LLM extraction output is not an array');
  }

  console.log(`[EvidenceExtraction] Received ${parsed.length} raw cards from LLM, validating...`);

  const validCards: ExtractedEvidenceCard[] = [];

  for (let index = 0; index < parsed.length; index += 1) {
    const normalized = normalizeCardBeforeParse(parsed[index]);

    const strict = extractionCardSchema.safeParse(normalized);
    if (strict.success) {
      validCards.push(enforceCardRules(strict.data, index, warnings));
      continue;
    }

    const lenientSchema = extractionCardSchema.extend({
      sourceFragment: z.string().min(1).max(1200),
      rigorIndicators: z.string().nullable().default(null),
      studyDesign: z.string().nullable().default(null),
      conditions: z.string().nullable().default(null),
    });
    const lenient = lenientSchema.safeParse(normalized);

    if (lenient.success) {
      warnings.push(`Card ${index}: lenient validation applied, confidence downgraded to LOW`);
      validCards.push(enforceCardRules({ ...lenient.data, confidence: 'LOW' }, index, warnings));
    } else {
      const firstError = strict.error.errors[0];
      const message = firstError
        ? `${firstError.path.join('.')}: ${firstError.message}`
        : 'validation failed';
      console.warn(`[EvidenceExtraction] Card ${index} dropped: ${message}. Keys: ${Object.keys(parsed[index] || {}).join(',')}`);
      warnings.push(`Card ${index}: dropped (${message})`);
    }
  }

  const expectedMin = depthLabel === 'DEEP_ANCHOR' ? 5 : 2;
  if (validCards.length < expectedMin) {
    warnings.push(`Only ${validCards.length} valid cards (expected >=${expectedMin})`);
  }

  if (validCards.length === 0) {
    const sampleKeys = parsed[0] ? Object.keys(parsed[0] as object).join(', ') : '(empty)';
    const sampleClaimType = parsed[0] ? String((parsed[0] as any).claimType || (parsed[0] as any).claim_type || '(missing)') : '(no card)';
    console.error(`[EvidenceExtraction] All ${parsed.length} cards failed validation. Sample keys=[${sampleKeys}], claimType="${sampleClaimType}"`);
    throw new Error(`No valid evidence cards extracted (${parsed.length} cards received but all failed schema validation)`);
  }

  console.log(`[EvidenceExtraction] Validated ${validCards.length}/${parsed.length} cards`);
  return { cards: validCards, warnings };
}

function deduplicateCards(cards: ExtractedEvidenceCard[]): ExtractedEvidenceCard[] {
  const rank: Record<ExtractedEvidenceCard['confidence'], number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };
  const byFingerprint = new Map<string, ExtractedEvidenceCard>();

  for (const card of cards) {
    const fingerprint = `${card.claimType}:${card.claim.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    const existing = byFingerprint.get(fingerprint);
    if (!existing || rank[card.confidence] > rank[existing.confidence]) {
      byFingerprint.set(fingerprint, card);
    }
  }

  return Array.from(byFingerprint.values());
}

function splitAtMidpoint(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  const paragraphBreak = text.indexOf('\n\n', mid);
  if (paragraphBreak !== -1 && paragraphBreak <= mid + 2000) {
    return [text.slice(0, paragraphBreak), text.slice(paragraphBreak)];
  }

  const lineBreak = text.indexOf('\n', mid);
  if (lineBreak !== -1) {
    return [text.slice(0, lineBreak), text.slice(lineBreak)];
  }

  return [text.slice(0, mid), text.slice(mid)];
}

function splitPreparedText(preparedText: PreparedPaperText): [PreparedPaperText, PreparedPaperText] {
  if (preparedText.sections && preparedText.sections.length >= 2) {
    const sections = preparedText.sections;
    const frontPattern = /intro|method|material|experimental|dataset|setup|participant/i;
    const backPattern = /result|finding|discussion|conclusion|limitation|future/i;
    const frontMatches = sections.filter(section => frontPattern.test(section.heading));
    const backMatches = sections.filter(section => backPattern.test(section.heading));

    if (frontMatches.length > 0 && backMatches.length > 0) {
      const firstBackIdx = sections.indexOf(backMatches[0]);
      const splitPoint = Math.max(1, firstBackIdx);
      const firstHalf = sections.slice(0, splitPoint);
      const secondHalf = sections.slice(splitPoint);

      if (firstHalf.length > 0 && secondHalf.length > 0) {
        const frontText = firstHalf.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
        const backText = secondHalf.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
        return [
          { ...preparedText, sections: firstHalf, fullText: frontText, estimatedTokens: Math.ceil(frontText.length / 4) },
          { ...preparedText, sections: secondHalf, fullText: backText, estimatedTokens: Math.ceil(backText.length / 4) },
        ];
      }
    }

    const midpoint = Math.ceil(sections.length / 2);
    const first = sections.slice(0, midpoint);
    const second = sections.slice(midpoint);
    const firstText = first.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
    const secondText = second.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');

    return [
      { ...preparedText, sections: first, fullText: firstText, estimatedTokens: Math.ceil(firstText.length / 4) },
      { ...preparedText, sections: second, fullText: secondText, estimatedTokens: Math.ceil(secondText.length / 4) },
    ];
  }

  const [firstHalf, secondHalf] = splitAtMidpoint(preparedText.fullText);
  return [
    { ...preparedText, sections: undefined, fullText: firstHalf, estimatedTokens: Math.ceil(firstHalf.length / 4) },
    { ...preparedText, sections: undefined, fullText: secondHalf, estimatedTokens: Math.ceil(secondHalf.length / 4) },
  ];
}

export interface ExtractEvidenceCardsInput {
  citationId: string;
  citationKey: string;
  referenceArchetype?: string | null;
  deepAnalysisLabel?: string | null;
  preparedText: PreparedPaperText;
  allowTextFallback?: boolean;
  pdfAttachment?: {
    filePath: string;
    filename: string;
    mimeType: string;
  } | null;
  blueprintDimensions: string[];
  tenantContext?: TenantContext | null;
}

export interface ExtractEvidenceCardsResult {
  cards: ExtractedEvidenceCard[];
  warnings: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

class EvidenceExtractionService {
  private canTryNativePdf(input: ExtractEvidenceCardsInput): boolean {
    if (!ENABLE_NATIVE_PDF_INPUT) return false;
    const filePath = String(input.pdfAttachment?.filePath || '').trim();
    return Boolean(filePath && fs.existsSync(filePath));
  }

  private resolveNativePdfPayload(
    input: ExtractEvidenceCardsInput,
    prompt: ExtractionPrompt
  ): {
    content: {
      parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; file: { data: string; mimeType?: string; filename?: string } }
      >;
    } | null;
    warning: string | null;
  } | null {
    if (!ENABLE_NATIVE_PDF_INPUT) {
      return null;
    }

    const attachment = input.pdfAttachment;
    const filePath = String(attachment?.filePath || '').trim();
    if (!filePath) {
      return null;
    }

    if (!fs.existsSync(filePath)) {
      return {
        content: null,
        warning: `Native PDF mode skipped: file not found (${filePath})`,
      };
    }

    try {
      const stats = fs.statSync(filePath);
      if (stats.size <= 0) {
        return {
          content: null,
          warning: 'Native PDF mode skipped: empty PDF file',
        };
      }
      if (stats.size > NATIVE_PDF_MAX_BYTES) {
        return {
          content: null,
          warning: `Native PDF mode skipped: PDF size ${stats.size} bytes exceeds limit ${NATIVE_PDF_MAX_BYTES} bytes`,
        };
      }

      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      if (!base64Data) {
        return {
          content: null,
          warning: 'Native PDF mode skipped: failed to encode PDF payload',
        };
      }

      return {
        content: {
          parts: [
            { type: 'text', text: `${prompt.system}\n\n${prompt.user}` },
            {
              type: 'file',
              file: {
                data: base64Data,
                mimeType: String(attachment?.mimeType || 'application/pdf').trim() || 'application/pdf',
                filename: attachment?.filename || 'document.pdf',
              },
            },
          ],
        },
        warning: null,
      };
    } catch (error) {
      return {
        content: null,
        warning: `Native PDF mode skipped: failed to read PDF (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }

  private async runExtractionRequest(
    input: ExtractEvidenceCardsInput,
    preparedText: PreparedPaperText,
    depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
    archetype: ReferenceArchetype,
    attempt: number,
    mode: 'text' | 'native_pdf',
    prompt?: ExtractionPrompt,
    content?: {
      parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; file: { data: string; mimeType?: string; filename?: string } }
      >;
    }
  ): Promise<ExtractEvidenceCardsResult> {
    const response = await llmGateway.executeLLMOperation(
      input.tenantContext ? { tenantContext: input.tenantContext } : { headers: {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'PAPER_LITERATURE_SUMMARIZE',
        ...(mode === 'text'
          ? { prompt: `${prompt?.system || ''}\n\n${prompt?.user || ''}` }
          : { content }),
        parameters: {
          purpose: 'full_text_evidence_extraction',
          extractionMode: mode,
          temperature: 0,
        },
        idempotencyKey: `evidence_extract_${input.citationId}_${depthLabel}_${archetype}_${preparedText.source}_${mode}_a${attempt}`,
        metadata: {
          citationId: input.citationId,
          citationKey: input.citationKey,
          archetype,
          depthLabel,
          source: preparedText.source,
          inputMode: mode,
          attempt,
        },
      }
    );

    if (!response.success || !response.response) {
      throw new Error(response.error?.message || 'Evidence extraction LLM call failed');
    }

    const rawOutput = response.response.output;
    console.log(
      `[EvidenceExtraction] (${mode}) LLM returned ${rawOutput?.length ?? 0} chars for ${input.citationKey}. First 200: ${String(rawOutput || '').slice(0, 200)}`
    );

    const parsed = parseExtractionResponse(rawOutput, depthLabel);

    return {
      cards: parsed.cards,
      warnings: [...parsed.warnings],
      usage: {
        inputTokens: Number((response.response.metadata as any)?.inputTokens || preparedText.estimatedTokens || 0),
        outputTokens: Number(response.response.outputTokens || 0),
      },
    };
  }

  private async extractSingle(
    input: ExtractEvidenceCardsInput,
    preparedText: PreparedPaperText,
    depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
    archetype: ReferenceArchetype
  ): Promise<ExtractEvidenceCardsResult> {
    const allowTextFallback = input.allowTextFallback === true;
    const hasPreparedText = hasNonEmptyText(preparedText.fullText);
    const prompt = hasPreparedText
      ? buildExtractionPrompt(
        archetype,
        depthLabel,
        preparedText,
        input.blueprintDimensions
      )
      : null;
    const nativePdfPrompt = buildNativePdfPrompt(
      archetype,
      depthLabel,
      input.blueprintDimensions
    );
    const nativePdfPayload = this.resolveNativePdfPayload(input, nativePdfPrompt);
    const hasNativePayload = Boolean(nativePdfPayload?.content && nativePdfPayload.content.parts.length > 0);

    if (!hasNativePayload && !hasPreparedText) {
      throw new Error('No native PDF payload or parsed text available for evidence extraction');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[EvidenceExtraction] Retrying ${input.citationKey} (attempt ${attempt}/${LLM_MAX_RETRIES}) after ${LLM_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, LLM_RETRY_DELAY_MS));
      }

      try {
        const warnings: string[] = [];
        if (nativePdfPayload?.warning) {
          warnings.push(nativePdfPayload.warning);
        }

        if (nativePdfPayload?.content && nativePdfPayload.content.parts.length > 0) {
          try {
            const nativeResult = await this.runExtractionRequest(
              input,
              preparedText,
              depthLabel,
              archetype,
              attempt,
              'native_pdf',
              undefined,
              nativePdfPayload.content
            );
            if (attempt > 0) {
              nativeResult.warnings.push(`Succeeded on retry attempt ${attempt}`);
            }
            nativeResult.warnings = [...warnings, ...nativeResult.warnings];
            return nativeResult;
          } catch (nativeError) {
            const nativeMessage = nativeError instanceof Error ? nativeError.message : String(nativeError);
            if (!allowTextFallback) {
              throw new Error(
                `Native PDF mode failed (${nativeMessage.slice(0, 180)}). `
                + 'Run text extraction and retry with text fallback enabled.'
              );
            }
            const fallbackWarning = `Native PDF mode failed; fell back to parsed text (${nativeMessage.slice(0, 180)})`;
            warnings.push(fallbackWarning);
            console.warn(`[EvidenceExtraction] ${fallbackWarning}`);
          }
        }

        if (!hasPreparedText || !prompt) {
          throw new Error('Parsed text fallback unavailable. Run text extraction and retry.');
        }

        const textResult = await this.runExtractionRequest(
          input,
          preparedText,
          depthLabel,
          archetype,
          attempt,
          'text',
          prompt
        );

        const mergedWarnings = [...warnings, ...textResult.warnings];
        if (attempt > 0) {
          mergedWarnings.push(`Succeeded on retry attempt ${attempt}`);
        }

        return {
          ...textResult,
          warnings: mergedWarnings,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[EvidenceExtraction] Attempt ${attempt} failed for ${input.citationKey}: ${lastError.message}`);
        if (attempt < LLM_MAX_RETRIES) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('Evidence extraction failed after retries');
  }

  async extractCards(input: ExtractEvidenceCardsInput): Promise<ExtractEvidenceCardsResult> {
    const depthLabel = normalizeDepth(input.deepAnalysisLabel);
    const archetype = normalizeArchetype(input.referenceArchetype);
    const targets = DEFAULT_CARD_TARGETS[depthLabel];
    const hasNativePdfCandidate = this.canTryNativePdf(input);

    if (hasNativePdfCandidate || input.preparedText.estimatedTokens <= SINGLE_CALL_TOKEN_LIMIT) {
      const single = await this.extractSingle(input, input.preparedText, depthLabel, archetype);
      const deduped = deduplicateCards(single.cards).slice(0, targets.max);
      return {
        ...single,
        cards: deduped,
      };
    }

    const [firstHalf, secondHalf] = splitPreparedText(input.preparedText);
    const [firstResult, secondResult] = await Promise.all([
      this.extractSingle(input, firstHalf, depthLabel, archetype),
      this.extractSingle(input, secondHalf, depthLabel, archetype),
    ]);

    const merged = deduplicateCards([...firstResult.cards, ...secondResult.cards]);
    const warnings = [...firstResult.warnings, ...secondResult.warnings];
    warnings.push('Long paper fallback used: extracted in two parts');

    return {
      cards: merged.slice(0, targets.max),
      warnings,
      usage: {
        inputTokens: firstResult.usage.inputTokens + secondResult.usage.inputTokens,
        outputTokens: firstResult.usage.outputTokens + secondResult.usage.outputTokens,
      },
    };
  }
}

export const evidenceExtractionService = new EvidenceExtractionService();
export { EvidenceExtractionService, buildExtractionPrompt, parseExtractionResponse, deduplicateCards };
