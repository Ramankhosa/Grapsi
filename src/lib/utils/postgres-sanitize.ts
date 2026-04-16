const NULL_CHAR_REGEX = /\u0000/g;

export function removeNullCharacters(value: string): string {
  if (!value || value.indexOf('\u0000') === -1) {
    return value;
  }
  return value.replace(NULL_CHAR_REGEX, '');
}

export function sanitizeTextForPostgres(value: string | null | undefined): string | null | undefined {
  if (typeof value !== 'string') {
    return value;
  }
  return removeNullCharacters(value);
}

export function sanitizeForPostgres<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return removeNullCharacters(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgres(item)) as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeForPostgres(nested);
    }
    return sanitized as T;
  }

  return value;
}
