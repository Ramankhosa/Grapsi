import { z } from 'zod';

export const REFERENCE_ARCHETYPES = [
  'SYSTEM_ALGO_EVALUATION',
  'CONTROLLED_EXPERIMENTAL_STUDY',
  'EMPIRICAL_OBSERVATIONAL_STUDY',
  'MIXED_METHODS_APPLIED_STUDY',
  'SYNTHESIS_REVIEW',
  'POSITION_CONCEPTUAL',
] as const;

export type ReferenceArchetype = (typeof REFERENCE_ARCHETYPES)[number];

export const DEEP_ANALYSIS_LABELS = [
  'DEEP_ANCHOR',
  'DEEP_SUPPORT',
  'DEEP_STRESS_TEST',
  'LIT_ONLY',
] as const;

export type DeepAnalysisLabel = (typeof DEEP_ANALYSIS_LABELS)[number];

export const EVIDENCE_CLAIM_TYPES = [
  'FINDING',
  'METHOD',
  'DEFINITION',
  'FRAMEWORK',
  'LIMITATION',
  'GAP',
] as const;

export type EvidenceClaimType = (typeof EVIDENCE_CLAIM_TYPES)[number];

export const EVIDENCE_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

export type EvidenceConfidenceLevel = (typeof EVIDENCE_CONFIDENCE_LEVELS)[number];

export const EVIDENCE_MAPPING_USE_AS = ['SUPPORT', 'CONTRAST', 'CONTEXT', 'DEFINITION'] as const;

export type EvidenceMappingUseAs = (typeof EVIDENCE_MAPPING_USE_AS)[number];

export const NOT_EXTRACTED_FROM_SOURCE = 'Not extracted from source.' as const;

export interface PreparedPaperSection {
  heading: string;
  text: string;
}

export interface PreparedPaperText {
  fullText: string;
  sections?: PreparedPaperSection[];
  source: 'PDFJS' | 'GROBID' | 'REGEX_FALLBACK';
  estimatedTokens: number;
  rawFullText?: string;
}

export interface ExtractedEvidenceCard {
  claim: string;
  claimType: EvidenceClaimType;
  quantitativeDetail: string | null;
  conditions: string | null;
  comparableMetrics: Record<string, string | number | boolean | null> | null;
  doesNotSupport: string | null;
  scopeCondition: string | null;
  boundaryNote?: string | null;
  tradeOff?: string | null;
  competingExplanation?: string | null;
  studyDesign: string | null;
  rigorIndicators: string | null;
  sourceFragment: string;
  pageHint: string | null;
  confidence: EvidenceConfidenceLevel;
  sourceSection: string;
}

export interface VerifiedEvidenceCard extends ExtractedEvidenceCard {
  quoteVerified: boolean;
  quoteVerificationMethod?: string | null;
  quoteVerificationScore?: number | null;
}

export interface ExtractedCardWithIdentity extends VerifiedEvidenceCard {
  cardId: string;
  citationId: string;
  citationKey: string;
  referenceArchetype: ReferenceArchetype;
  deepAnalysisLabel: DeepAnalysisLabel;
}

export const extractionCardSchema = z.object({
  claim: z.string().min(10).max(600),
  claimType: z.enum(EVIDENCE_CLAIM_TYPES),
  quantitativeDetail: z.string().nullable().default(null),
  conditions: z.string().nullable().default(null),
  comparableMetrics: z.union([
    z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    z.string().transform(v => v.trim() ? { value: v.trim() } : null),
    z.array(z.any()).transform(arr => {
      const obj: Record<string, string> = {};
      arr.forEach((item: unknown, i: number) => {
        if (typeof item === 'string') obj[`metric_${i}`] = item;
        else if (item && typeof item === 'object') Object.assign(obj, item);
      });
      return Object.keys(obj).length > 0 ? obj : null;
    }),
  ]).nullable().default(null),
  doesNotSupport: z.string().nullable().default(null),
  scopeCondition: z.string().nullable().default(null),
  boundaryNote: z.string().default(NOT_EXTRACTED_FROM_SOURCE),
  tradeOff: z.string().default(NOT_EXTRACTED_FROM_SOURCE),
  competingExplanation: z.string().default(NOT_EXTRACTED_FROM_SOURCE),
  studyDesign: z.string().nullable().default(null),
  rigorIndicators: z.string().nullable().default(null),
  sourceFragment: z.string().min(20).max(1200),
  pageHint: z.string().nullable().default(null),
  confidence: z.enum(EVIDENCE_CONFIDENCE_LEVELS),
  sourceSection: z.string().default('unknown'),
});

export const extractionResponseSchema = z.array(extractionCardSchema).min(1).max(20);

export const mappingResponseSchema = z.array(
  z.object({
    cardId: z.string().min(1),
    mappings: z.array(
      z.object({
        sectionKey: z.string().min(1),
        dimension: z.string().min(3),
        useAs: z.enum(EVIDENCE_MAPPING_USE_AS),
        mappingConfidence: z.enum(EVIDENCE_CONFIDENCE_LEVELS),
      })
    ).min(1),
  })
);

export const DEFAULT_CARD_TARGETS: Record<Exclude<DeepAnalysisLabel, 'LIT_ONLY'>, { min: number; max: number }> = {
  DEEP_ANCHOR: { min: 8, max: 15 },
  DEEP_SUPPORT: { min: 3, max: 6 },
  DEEP_STRESS_TEST: { min: 4, max: 8 },
};

export const MAX_DEEP_ANALYSIS_CONCURRENCY = 50;

export const DEFAULT_EXTRACTION_CONCURRENCY = Number.parseInt(
  process.env.DEEP_ANALYSIS_CONCURRENCY || String(MAX_DEEP_ANALYSIS_CONCURRENCY),
  10
);

export const BATCH_MAPPING_CHUNK_SIZE = 50;

export const MAX_CARD_PAGE_SIZE = 200;
