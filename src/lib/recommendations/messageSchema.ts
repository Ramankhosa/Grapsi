import { z } from 'zod'

import { CHAT_MESSAGE_MAX_LENGTH, MAX_SELECTED_RESEARCH_AREAS } from './constants'
import type { RecommendationSearchFilters } from './types'

export const conversationMessageFilterSchema: z.ZodType<RecommendationSearchFilters> = z.object({
  geographyScope: z.array(z.string()).optional(),
  eligibleCountries: z.array(z.string()).optional(),
  eligibleRegions: z.array(z.string()).optional(),
  hostCountries: z.array(z.string()).optional(),
  funderCountries: z.array(z.string()).optional(),
  fundingKinds: z.array(z.string()).optional(),
  institutionTypes: z.array(z.string()).optional(),
  careerStages: z.array(z.string()).optional(),
  citizenshipRequirements: z.array(z.string()).optional(),
  residencyRequirements: z.array(z.string()).optional(),
  applicationLanguages: z.array(z.string()).optional(),
  sponsorTypes: z.array(z.string()).optional(),
  taxonomyAreaIds: z.array(z.string()).optional(),
  deadlineFrom: z.string().optional(),
  deadlineTo: z.string().optional(),
  rollingOnly: z.boolean().optional(),
  amountMin: z.number().nullable().optional(),
  amountMax: z.number().nullable().optional(),
  includeExpired: z.boolean().optional(),
  limit: z.number().int().optional(),
  sort: z.enum(['best_match', 'deadline_soonest']).optional(),
})

/** Request body accepted by both the classic and the SSE streaming chat routes. */
export const conversationMessageRequestSchema = z.object({
  message: z.string().max(CHAT_MESSAGE_MAX_LENGTH).optional(),
  clientTurnId: z.string().max(120).optional(),
  inputMode: z.enum(['research_area', 'paper_metadata']).optional(),
  manualQueryPatch: z.record(z.any()).optional(),
  manualFilterPatch: conversationMessageFilterSchema.optional(),
  replaceManualFilters: z.boolean().optional(),
  filterMode: z.enum(['manual', 'auto']).optional(),
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
  selectedResearchAreaIds: z.array(z.string().max(120)).max(MAX_SELECTED_RESEARCH_AREAS).optional(),
})

export type ConversationMessageRequestInput = z.infer<typeof conversationMessageRequestSchema>
