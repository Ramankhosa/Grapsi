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
  const raw = process.env.Length_Control ?? process.env.LENGTH_CONTROL ?? String(DEFAULT_LENGTH_CONTROL_PERCENT);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LENGTH_CONTROL_PERCENT;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
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
