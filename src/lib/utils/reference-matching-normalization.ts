export function stripDiacritics(value: string): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]+/g, '');
}

export function normalizeSearchText(value: unknown): string {
  return stripDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIdentifier(value: unknown): string | null {
  const normalized = normalizeSearchText(value);
  return normalized || null;
}

export function normalizeDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[)\],;]+$/g, '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}
