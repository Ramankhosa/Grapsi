export const DEFAULT_GRANT_PREP_GEMINI_MODEL = 'gemini-3.1-pro-preview';

export function getGrantPrepGeminiModel() {
  return process.env.GRANT_PREP_GEMINI_MODEL?.trim() || DEFAULT_GRANT_PREP_GEMINI_MODEL;
}
