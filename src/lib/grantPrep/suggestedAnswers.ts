import type { GrantPrepSuggestedAnswer } from './types';

const INLINE_OPTION_LABEL_PATTERN =
  /(^|[\s\r\n])(?:[-*]\s*)?\*{0,2}(?:option\s+)?([A-C])(?:[.):]|\s*[-\u2013\u2014])\*{0,2}\s+/gi;
const APPROVAL_BUNDLE_PREFIX_PATTERN = new RegExp(`\\bI approve this ${'bundle'}:\\s*`, 'gi');

function normalizeLabel(value: string | null | undefined, index: number) {
  const fallback = String.fromCharCode(65 + index);
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const match = trimmed.match(/^(?:option\s+)?([A-Z])(?:[.):]|[-\u2013\u2014])?$/i);
  return match ? match[1].toUpperCase() : trimmed;
}

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .replace(/\s+<grant_prep_marker>[\s\S]*$/i, '')
    .replace(/\s+<\/grant_prep_marker>[\s\S]*$/i, '')
    .replace(APPROVAL_BUNDLE_PREFIX_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function removeGrantPrepApprovalBundlePrefix(content: string) {
  return (content || '').replace(APPROVAL_BUNDLE_PREFIX_PATTERN, '');
}

export function extractGrantPrepInlineSuggestedAnswers(content: string, limit = 3): GrantPrepSuggestedAnswer[] {
  const assistantProse = (content || '').split('<grant_prep_marker>')[0] || '';
  const matches: Array<{ label: string; start: number; contentStart: number }> = [];
  const options: GrantPrepSuggestedAnswer[] = [];

  INLINE_OPTION_LABEL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_OPTION_LABEL_PATTERN.exec(assistantProse))) {
    const prefix = match[1] || '';
    const label = normalizeLabel(match[2], matches.length);
    const start = match.index + prefix.length;
    if (matches.some((item) => item.label === label)) {
      continue;
    }
    matches.push({
      label,
      start,
      contentStart: match.index + match[0].length,
    });
  }

  for (let index = 0; index < matches.length && options.length < limit; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const text = normalizeText(assistantProse.slice(current.contentStart, next?.start ?? assistantProse.length));
    if (!text) {
      continue;
    }

    options.push({
      label: current.label,
      text,
      rationale: null,
    });
  }

  return options;
}

export function mergeGrantPrepSuggestedAnswersWithInline(
  structuredAnswers: GrantPrepSuggestedAnswer[] | null | undefined,
  content: string,
  limit = 3
): GrantPrepSuggestedAnswer[] {
  const merged: GrantPrepSuggestedAnswer[] = [];
  const labels = new Set<string>();
  const addAnswer = (answer: GrantPrepSuggestedAnswer | null | undefined, index: number) => {
    if (!answer) {
      return;
    }

    const text = normalizeText(answer.text);
    if (!text) {
      return;
    }

    const label = normalizeLabel(answer?.label, index);
    const labelKey = label.toUpperCase();
    if (labels.has(labelKey) || merged.length >= limit) {
      return;
    }

    labels.add(labelKey);
    merged.push({
      ...answer,
      label,
      text,
      rationale: answer?.rationale ?? null,
    });
  };

  (Array.isArray(structuredAnswers) ? structuredAnswers : []).forEach(addAnswer);
  extractGrantPrepInlineSuggestedAnswers(content, limit).forEach((answer, index) => addAnswer(answer, index));

  return merged;
}
