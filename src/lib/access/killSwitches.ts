/**
 * Platform-wide kill switches, applied on top of plan entitlements.
 *
 * Grant Prep (the GRANT_STUDIO drafting flow) is no longer offered as a
 * product, so every UI entry point hides regardless of what a tenant's plan
 * grants. Existing sessions and APIs are untouched — only the ways in are
 * hidden. Set NEXT_PUBLIC_GRANT_PREP_ENABLED=true to bring the buttons back.
 */
export const GRANT_PREP_ENABLED = process.env.NEXT_PUBLIC_GRANT_PREP_ENABLED === 'true'
