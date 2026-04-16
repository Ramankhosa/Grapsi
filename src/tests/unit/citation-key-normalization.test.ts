import { describe, expect, it } from 'vitest';
import {
  buildCitationKeyLookup,
  looksLikeCitationKey,
  normalizeCitationKey,
  resolveCitationKeyFromLookup,
  splitCitationKeyList
} from '@/lib/utils/citation-key-normalization';

describe('citation key normalization', () => {
  it('normalizes key wrappers and trailing punctuation', () => {
    expect(normalizeCitationKey(' "Mitić2024;" ')).toBe('Mitić2024');
  });

  it('splits multi-key markers with mixed separators', () => {
    expect(splitCitationKeyList('Mitić2024; Smith2023 and Lee2022')).toEqual([
      'Mitić2024',
      'Smith2023',
      'Lee2022'
    ]);
  });

  it('resolves folded diacritic variants to canonical key', () => {
    const lookup = buildCitationKeyLookup(['Mitić2024']);
    expect(resolveCitationKeyFromLookup('Mitic2024', lookup)).toBe('Mitić2024');
    expect(resolveCitationKeyFromLookup('Mitić2024', lookup)).toBe('Mitić2024');
  });

  it('resolves common mojibake key variants to canonical key', () => {
    const lookup = buildCitationKeyLookup(['Mitić2024']);
    expect(resolveCitationKeyFromLookup('MitiÄ‡2024', lookup)).toBe('Mitić2024');
  });

  it('accepts unicode citation keys and rejects non-citation bracket tokens', () => {
    expect(looksLikeCitationKey('Mitić2024')).toBe(true);
    expect(looksLikeCitationKey('Figure12')).toBe(false);
    expect(looksLikeCitationKey('1234')).toBe(false);
  });
});

