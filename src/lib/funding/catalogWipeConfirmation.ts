/**
 * Shared arming phrase for the funding-catalog wipe. Kept dependency-free so
 * the admin UI (client bundle) and unit tests can import it without pulling in
 * Prisma; the delete-all API validates with the same functions, so the wipe can
 * only run when this exact phrase was typed.
 */
export const DELETE_ALL_CALLS_CONFIRMATION_PHRASE = 'delete all calls';

export function isDeleteAllCallsConfirmation(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().replace(/\s+/g, ' ').toLowerCase() === DELETE_ALL_CALLS_CONFIRMATION_PHRASE
  );
}
