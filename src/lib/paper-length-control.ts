const DEFAULT_LENGTH_CONTROL_PERCENT = 100;
const EXCLUDED_SECTION_KEYS = new Set(['abstract', 'conclusion', 'conclusions']);

function normalizeSectionKey(sectionKey: string): string {
  return String(sectionKey || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizePositiveWordBudget(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return undefined;
  return rounded;
}

export function getLengthControlPercent(): number {
  // Both spellings are accepted. A present-but-malformed value must not mask a
  // valid one further down the list, so each candidate is validated in turn
  // rather than taking the first that is merely defined.
  // (On Windows process.env is case-insensitive, so these can be one variable.)
  for (const raw of [process.env.Length_Control, process.env.LENGTH_CONTROL]) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    return Math.max(1, Math.min(100, Math.floor(parsed)));
  }

  return DEFAULT_LENGTH_CONTROL_PERCENT;
}

export function shouldApplyLengthControl(sectionKey: string): boolean {
  return !EXCLUDED_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

export function applyLengthControlToWordBudget(
  sectionKey: string,
  requestedWordBudget: unknown
): number | undefined {
  const baseBudget = normalizePositiveWordBudget(requestedWordBudget);
  if (!baseBudget) {
    return undefined;
  }

  if (!shouldApplyLengthControl(sectionKey)) {
    return baseBudget;
  }

  const percent = getLengthControlPercent();
  if (percent >= 100) {
    return baseBudget;
  }

  return Math.max(1, Math.floor(baseBudget * (percent / 100)));
}
