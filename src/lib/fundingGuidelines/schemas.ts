import { z } from 'zod';
import {
  FUNDING_GUIDELINE_BLOCK_KEYS,
  FUNDING_GUIDELINE_RULE_IMPORTANCE,
  FUNDING_GUIDELINE_SOURCE_TYPES,
} from './types';

export const guidelineSourceAnchorSchema = z.object({
  sourceType: z.enum(FUNDING_GUIDELINE_SOURCE_TYPES),
  fieldKey: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const guidelineRuleSchema = z.object({
  key: z.string().trim().min(1),
  text: z.string().trim().min(1),
  importance: z.enum(FUNDING_GUIDELINE_RULE_IMPORTANCE).optional().default('medium'),
  ruleClass: z.string().optional(),
  enforcementLevel: z.string().optional(),
  appliesTo: z.array(z.string()).optional().default([]),
  draftingStage: z.array(z.string()).optional().default([]),
  draftingVsSubmission: z.string().optional(),
  detectorHints: z.array(z.string()).optional().default([]),
  rationale: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional().default(1),
  sourceAnchors: z.array(guidelineSourceAnchorSchema).optional().default([]),
}).passthrough();

export const guidelinePackSchema = z.object({
  priorities: z.array(guidelineRuleSchema).optional().default([]),
  mustAddress: z.array(guidelineRuleSchema).optional().default([]),
  avoid: z.array(guidelineRuleSchema).optional().default([]),
  evaluationCriteria: z.array(guidelineRuleSchema).optional().default([]),
  budgetRules: z.array(guidelineRuleSchema).optional().default([]),
  durationRules: z.array(guidelineRuleSchema).optional().default([]),
  formatRules: z.array(guidelineRuleSchema).optional().default([]),
  submissionRules: z.array(guidelineRuleSchema).optional().default([]),
  deliverableRules: z.array(guidelineRuleSchema).optional().default([]),
  reviewerSignals: z.array(guidelineRuleSchema).optional().default([]),
  sourceAnchors: z.array(guidelineSourceAnchorSchema).optional().default([]),
});

export const guidelineUpdateSchema = z.object({
  guideline_pack_json: guidelinePackSchema,
  changeNotes: z.string().max(5000).optional(),
});

export const guidelineRevertSchema = z.object({
  revisionNo: z.number().int().positive(),
  changeNotes: z.string().max(5000).optional(),
});

export const guidelineBlockKeySchema = z.enum(FUNDING_GUIDELINE_BLOCK_KEYS);

export const guidelineExtractRequestSchema = z.discriminatedUnion('sourceMode', [
  z.object({
    sourceMode: z.literal('intake'),
  }),
  z.object({
    sourceMode: z.literal('url'),
    sourceUrl: z.string().trim().url(),
  }),
  z.object({
    sourceMode: z.literal('text'),
    sourceText: z.string().trim().min(20),
  }),
]).default({ sourceMode: 'intake' });
