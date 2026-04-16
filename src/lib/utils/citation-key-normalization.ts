const MOJIBAKE_MARKER_REGEX = /[\u00C3\u00C2\u00E2\u00C4\u00C5\u00C6\u00C7\u00D0\u00D1\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE]/;
const MOJIBAKE_MARKER_GLOBAL_REGEX = /[\u00C3\u00C2\u00E2\u00C4\u00C5\u00C6\u00C7\u00D0\u00D1\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE]/g;

const CP1252_UNICODE_TO_BYTE: Record<string, number> = {
  '\u20AC': 0x80,
  '\u201A': 0x82,
  '\u0192': 0x83,
  '\u201E': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02C6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8A,
  '\u2039': 0x8B,
  '\u0152': 0x8C,
  '\u017D': 0x8E,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201C': 0x93,
  '\u201D': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02DC': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9A,
  '\u203A': 0x9B,
  '\u0153': 0x9C,
  '\u017E': 0x9E,
  '\u0178': 0x9F
};

function countMojibakeMarkers(value: string): number {
  const matches = value.match(MOJIBAKE_MARKER_GLOBAL_REGEX);
  return matches ? matches.length : 0;
}

function repairLikelyMojibake(value: string): string {
  const input = String(value || '');
  if (!input || !MOJIBAKE_MARKER_REGEX.test(input)) {
    return input;
  }

  try {
    const byteValues: number[] = [];
    for (const char of Array.from(input)) {
      const codeUnit = char.charCodeAt(0);
      if (codeUnit <= 0xff) {
        byteValues.push(codeUnit);
        continue;
      }
      const mapped = CP1252_UNICODE_TO_BYTE[char];
      if (typeof mapped === 'number') {
        byteValues.push(mapped);
        continue;
      }
      return input;
    }
    const bytes = Uint8Array.from(byteValues);
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (!decoded || decoded.includes('\uFFFD')) {
      return input;
    }
    return countMojibakeMarkers(decoded) < countMojibakeMarkers(input) ? decoded : input;
  } catch {
    return input;
  }
}

function foldDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]+/g, '');
}

export function normalizeCitationKey(rawKey: string): string {
  const repaired = repairLikelyMojibake(String(rawKey || '')).normalize('NFC');
  return repaired
    .trim()
    .replace(/^['"`\s]+|['"`\s]+$/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
    .normalize('NFC');
}

export function citationKeyIdentity(rawKey: string): string {
  return normalizeCitationKey(rawKey).toLocaleLowerCase('en-US');
}

export function citationKeyFoldedIdentity(rawKey: string): string {
  return foldDiacritics(normalizeCitationKey(rawKey)).toLocaleLowerCase('en-US');
}

export function splitCitationKeyList(rawKeys: string): string[] {
  if (!rawKeys) return [];
  const unified = repairLikelyMojibake(String(rawKeys || '')).replace(/\s+(?:and|&)\s+/gi, ',');
  return unified
    .split(/[,;|/]/g)
    .map(part => normalizeCitationKey(part))
    .filter(Boolean);
}

export function buildCitationKeyLookup(keys: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const key of keys) {
    const canonical = normalizeCitationKey(key);
    if (!canonical) continue;
    const exact = citationKeyIdentity(canonical);
    if (!lookup.has(exact)) {
      lookup.set(exact, key);
    }
    const folded = citationKeyFoldedIdentity(canonical);
    if (folded && folded !== exact && !lookup.has(folded)) {
      lookup.set(folded, key);
    }
  }
  return lookup;
}

export function resolveCitationKeyFromLookup(
  rawKey: string,
  lookup: Map<string, string>
): string | undefined {
  const exact = citationKeyIdentity(rawKey);
  if (exact) {
    const found = lookup.get(exact);
    if (found) return found;
  }
  const folded = citationKeyFoldedIdentity(rawKey);
  if (folded) {
    const found = lookup.get(folded);
    if (found) return found;
  }
  return undefined;
}

export function looksLikeCitationKey(rawKey: string): boolean {
  const normalized = normalizeCitationKey(rawKey);
  if (!normalized) return false;
  if (/^\d+(?:[-\u2013]\d+)?$/.test(normalized)) return false;
  if (/^(?:fig(?:ure)?|table|sec(?:tion)?|eq(?:uation)?|appendix)[a-z0-9._:-]*$/i.test(normalized)) {
    return false;
  }

  const chars = Array.from(normalized);
  if (chars.length < 2 || chars.length > 128) {
    return false;
  }

  const isUnicodeLetter = (char: string): boolean => {
    const lower = char.toLocaleLowerCase('en-US');
    const upper = char.toLocaleUpperCase('en-US');
    return lower !== upper;
  };

  const isAsciiDigit = (char: string): boolean => char >= '0' && char <= '9';
  const isAllowedSymbol = (char: string): boolean => char === '.' || char === '_' || char === ':' || char === '-';

  if (!isUnicodeLetter(chars[0])) {
    return false;
  }

  for (let index = 1; index < chars.length; index += 1) {
    const char = chars[index];
    if (isUnicodeLetter(char) || isAsciiDigit(char) || isAllowedSymbol(char)) {
      continue;
    }
    return false;
  }

  return true;
}

