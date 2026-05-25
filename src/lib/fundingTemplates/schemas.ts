import { z } from 'zod';
import {
  FUNDING_TEMPLATE_ITEM_TYPES,
  FUNDING_TEMPLATE_SUPPORT_LEVELS,
} from './types';
import { GRANT_TEMPLATE_INTENTS } from '@/types/grant';

const jsonSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ])
);

export const sourceAnchorSchema = z.object({
  asset_id: z.string().trim().min(1),
  page: z.number().int().nullable().optional(),
  section: z.string().nullable().optional(),
  urlFragment: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const templateItemSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(FUNDING_TEMPLATE_ITEM_TYPES),
  workflowMode: z.string().optional().default('team_manual'),
  required: z.boolean().optional().default(false),
  repeatable: z.boolean().optional().default(false),
  visibleWhen: z.string().nullable().optional(),
  wordLimit: z.number().int().nullable().optional(),
  charLimit: z.number().int().nullable().optional(),
  options: z.array(z.string()).optional().default([]),
  schema: jsonSchema.nullable().optional(),
  guidance: z.string().nullable().optional(),
  templateIntent: z.enum(GRANT_TEMPLATE_INTENTS).nullable().optional(),
  templateIntentAlternates: z.array(z.enum(GRANT_TEMPLATE_INTENTS)).optional().default([]),
  templateIntentConfidence: z.number().min(0).max(1).nullable().optional(),
  supportLevel: z.enum(FUNDING_TEMPLATE_SUPPORT_LEVELS).optional().default('full'),
  confidence: z.number().min(0).max(1).optional().default(1),
  sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
}).passthrough();

export const budgetCategorySchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  cap: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
});

export const budgetColumnSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: z.string().trim().nullable().optional(),
  required: z.boolean().optional().default(false),
  sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
});

export const budgetSchema = z.object({
  required: z.boolean().optional().default(false),
  yearWise: z.boolean().optional().default(false),
  workflowMode: z.string().optional().default('app_support'),
  columns: z.array(budgetColumnSchema).optional().default([]),
  categories: z.array(budgetCategorySchema).optional().default([]),
  caps: z.record(jsonSchema).nullable().optional(),
  justificationNotes: z.string().nullable().optional(),
  supportLevel: z.enum(FUNDING_TEMPLATE_SUPPORT_LEVELS).optional().default('partial'),
  confidence: z.number().min(0).max(1).optional().default(1),
  sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
});

export const mergeConflictSchema = z.object({
  block: z.enum(['questions', 'sections', 'attachments', 'evaluationCriteria', 'submissionRules', 'budget']),
  key: z.string().trim().min(1),
  existingItem: jsonSchema,
  incomingItem: jsonSchema,
  runId: z.string().trim().min(1).nullable().optional(),
  createdAt: z.string().optional(),
  message: z.string().trim().min(1),
});

export const grantTemplateSchema = z.object({
  questions: z.array(templateItemSchema).optional().default([]),
  sections: z.array(templateItemSchema).optional().default([]),
  budget: budgetSchema.nullable().optional().default(null),
  attachments: z.array(templateItemSchema).optional().default([]),
  evaluationCriteria: z.array(templateItemSchema).optional().default([]),
  submissionRules: z.object({
    notes: z.string().nullable().optional(),
    items: z.array(templateItemSchema).optional().default([]),
    sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
  }).optional().default({ notes: null, items: [], sourceAnchors: [] }),
  sourceAnchors: z.array(sourceAnchorSchema).optional().default([]),
  mergeConflicts: z.array(mergeConflictSchema).optional().default([]),
});

export const templateUpdateSchema = z.object({
  grant_template_json: grantTemplateSchema,
  changeNotes: z.string().max(5000).optional(),
});

export const templateAssetJsonSchema = z.object({
  sourceType: z.enum(['url', 'text']),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
});

export const templateExtractRequestSchema = z.object({
  assetIds: z.array(z.string().trim().min(1)).optional(),
});

export const templateRevertSchema = z.object({
  revisionNo: z.number().int().positive(),
  changeNotes: z.string().max(5000).optional(),
});
