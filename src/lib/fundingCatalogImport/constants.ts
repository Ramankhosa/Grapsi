/**
 * Shared constants for the external funding-catalogue importer.
 *
 * Bump IMPORTER_VERSION whenever a mapping rule changes: it is part of every
 * record's change hash, so a bump re-processes records even when the source
 * payload itself did not change.
 */
export const IMPORTER_VERSION = 'catalog-import-1.0.0'

export const SCIENTIFY_SOURCE_KEY = 'scientify'

/** `funding_calls.source` for calls an import created. */
export function importSourceLabel(sourceKey: string): string {
  return `catalog-import:${sourceKey}`
}

export const NOTIFICATION_POLICY_SUPPRESSED = 'SUPPRESSED'

export const REVIEW_STATUS = {
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  CLEAR: 'CLEAR',
} as const

export const IMPORT_RUN_MODES = ['DRY_RUN', 'APPLY', 'BACKFILL', 'RELEASE', 'ROLLBACK'] as const
export type ImportRunMode = (typeof IMPORT_RUN_MODES)[number]

export const REVIEW_REASONS = [
  'POSSIBLE_DUPLICATE',
  'EXISTING_DUPLICATE',
  'FUNDER_MATCH_UNCERTAIN',
  'READINESS_FAILED',
  'UNKNOWN_COUNTRY_VALUES',
  'UNPARSED_AMOUNT',
  'SOURCE_UNAVAILABLE',
  'SOURCE_CONFLICT',
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const REVIEW_TIERS = ['LIKELY_DUPLICATE', 'POSSIBLE_DUPLICATE', 'RELATED', 'INFO'] as const
export type ReviewTier = (typeof REVIEW_TIERS)[number]

/** Resolutions, mirroring the intake vocabulary where the meaning is the same. */
export const REVIEW_RESOLUTIONS = [
  'pending',
  /** Not a duplicate (or a different round): the imported call may be released. */
  'create_new_anyway',
  /** Same opportunity as the existing/other call: the imported one is set aside. */
  'merged_to_existing',
  /** Informational item acknowledged; nothing to change. */
  'ignored',
  'deferred',
  /** Existing↔existing pair looked at; report only. */
  'reviewed',
  /** The imported call is set aside (REJECTED) without a surviving twin. */
  'rejected',
] as const
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number]

/** Transaction batch size for writes. Small on purpose: short locks on a live DB. */
export const WRITE_BATCH_SIZE = 200

/** Release batch size; safety checks run after each batch. */
export const RELEASE_BATCH_SIZE = 500
