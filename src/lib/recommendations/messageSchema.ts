import { z } from 'zod'

import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RESULT_LIMIT_MAX,
  FILTER_DATE_MAX_LENGTH,
  FILTER_LIST_MAX_ITEMS,
  FILTER_VALUE_MAX_LENGTH,
  MAX_SELECTED_RESEARCH_AREAS,
  PAPER_ABSTRACT_MAX_LENGTH,
  PAPER_KEYWORD_MAX_LENGTH,
  PAPER_KEYWORDS_MAX,
  PAPER_TITLE_MAX_LENGTH,
  RESEARCH_AREA_MAX_LENGTH,
} from './constants'
import type { RecommendationSearchFilters } from './types'

const filterList = z.array(z.string().max(FILTER_VALUE_MAX_LENGTH)).max(FILTER_LIST_MAX_ITEMS)
const filterAmount = z.number().finite().nullable().optional()

export const conversationMessageFilterSchema: z.ZodType<RecommendationSearchFilters> = z.object({
  geographyScope: filterList.optional(),
  eligibleCountries: filterList.optional(),
  eligibleRegions: filterList.optional(),
  hostCountries: filterList.optional(),
  funderCountries: filterList.optional(),
  fundingKinds: filterList.optional(),
  institutionTypes: filterList.optional(),
  careerStages: filterList.optional(),
  citizenshipRequirements: filterList.optional(),
  residencyRequirements: filterList.optional(),
  applicationLanguages: filterList.optional(),
  sponsorTypes: filterList.optional(),
  taxonomyAreaIds: filterList.optional(),
  deadlineFrom: z.string().max(FILTER_DATE_MAX_LENGTH).optional(),
  deadlineTo: z.string().max(FILTER_DATE_MAX_LENGTH).optional(),
  rollingOnly: z.boolean().optional(),
  amountMin: filterAmount,
  amountMax: filterAmount,
  includeExpired: z.boolean().optional(),
  limit: z.number().int().min(1).max(CHAT_RESULT_LIMIT_MAX).optional(),
  sort: z.enum(['best_match', 'deadline_soonest']).optional(),
})

/**
 * Query patch accepted from the client (attached research area / publications
 * from the composer, or an edited pending patch). Bounded so a single request
 * cannot plant an oversized topic that is then replayed into every later prompt.
 * Unknown keys are stripped.
 */
export const conversationQueryPatchSchema = z.object({
  researchArea: z.string().max(RESEARCH_AREA_MAX_LENGTH).optional(),
  title: z.string().max(PAPER_TITLE_MAX_LENGTH).optional(),
  abstract: z.string().max(PAPER_ABSTRACT_MAX_LENGTH).optional(),
  keywords: z.array(z.string().max(PAPER_KEYWORD_MAX_LENGTH)).max(PAPER_KEYWORDS_MAX).optional(),
})

export type ConversationQueryPatchInput = z.infer<typeof conversationQueryPatchSchema>

/** Request body accepted by both the classic and the SSE streaming chat routes. */
export const conversationMessageRequestSchema = z.object({
  message: z.string().max(CHAT_MESSAGE_MAX_LENGTH).optional(),
  clientTurnId: z.string().max(120).optional(),
  inputMode: z.enum(['research_area', 'paper_metadata']).optional(),
  manualQueryPatch: conversationQueryPatchSchema.optional(),
  manualFilterPatch: conversationMessageFilterSchema.optional(),
  replaceManualFilters: z.boolean().optional(),
  filterMode: z.enum(['manual', 'auto']).optional(),
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
  selectedResearchAreaIds: z.array(z.string().max(120)).max(MAX_SELECTED_RESEARCH_AREAS).optional(),
})

export type ConversationMessageRequestInput = z.infer<typeof conversationMessageRequestSchema>

/** Shared preference/context flags accepted by the filter-manipulation routes. */
export const conversationContextFlagsSchema = z.object({
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
  selectedResearchAreaIds: z.array(z.string().max(120)).max(MAX_SELECTED_RESEARCH_AREAS).optional(),
})
