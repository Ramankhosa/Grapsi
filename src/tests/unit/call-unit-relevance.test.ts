import { describe, expect, it } from 'vitest';

import {
  EMPTY_PROFILE,
  relevantCallWhereSql,
  tierForCall,
  type CallMappingRow,
  type UnitAreaProfile,
} from '@/lib/funding/callUnitRelevance';

const PHARMACEUTICS: CallMappingRow = {
  taxonomy_area_id: 'area_pharmaceutics',
  taxonomy_level1_code: 'PHA',
  taxonomy_level1_name: 'Pharmaceutical Sciences',
  taxonomy_level2_name: 'Pharmaceutics & Drug Delivery',
};

const PHARMACOLOGY: CallMappingRow = {
  taxonomy_area_id: 'area_pharmacology',
  taxonomy_level1_code: 'PHA',
  taxonomy_level1_name: 'Pharmaceutical Sciences',
  taxonomy_level2_name: 'Pharmacology & Toxicology',
};

const MANAGEMENT: CallMappingRow = {
  taxonomy_area_id: 'area_management',
  taxonomy_level1_code: 'MGT',
  taxonomy_level1_name: 'Management Business & Economics',
  taxonomy_level2_name: 'Management & Entrepreneurship',
};

/** A school that works on pharmaceutics specifically. */
const pharmacySets = {
  areaIds: new Set(['area_pharmaceutics']),
  level1Codes: new Set(['PHA']),
};

function profile(overrides: Partial<UnitAreaProfile> = {}): UnitAreaProfile {
  return {
    unitIds: ['unit_1'],
    areaIds: ['area_pharmaceutics'],
    level1Codes: ['PHA'],
    keywords: [],
    isUnmapped: false,
    ...overrides,
  };
}

describe('relevance tiering', () => {
  it('reports a direct match with the specific area as the reason', () => {
    const result = tierForCall([PHARMACEUTICS], pharmacySets);

    expect(result.tier).toBe('direct');
    expect(result.reason).toBe('Pharmaceutical Sciences → Pharmaceutics & Drug Delivery');
  });

  it('reports a broad match when only the level-1 group agrees', () => {
    const result = tierForCall([PHARMACOLOGY], pharmacySets);

    expect(result.tier).toBe('broad');
    expect(result.reason).toContain('related area');
  });

  it('returns none when nothing matches', () => {
    expect(tierForCall([MANAGEMENT], pharmacySets).tier).toBe('none');
  });

  it('keeps the strongest tier when a call carries several areas', () => {
    const result = tierForCall([MANAGEMENT, PHARMACOLOGY, PHARMACEUTICS], pharmacySets);

    expect(result.tier).toBe('direct');
    expect(result.reason).toContain('Pharmaceutics');
  });

  it('surfaces an unclassified call rather than scoring it none', () => {
    // This is the safety rule: a call nobody has classified must reach every
    // school, because hiding it costs a missed deadline.
    const result = tierForCall([], pharmacySets);

    expect(result.tier).toBe('unclassified');
    expect(result.reason).toContain('every school');
  });

  it('uses a keyword hit when the taxonomy says nothing', () => {
    const result = tierForCall([MANAGEMENT], pharmacySets, 'tribal livelihoods');

    expect(result.tier).toBe('keyword');
    expect(result.reason).toContain('tribal livelihoods');
  });

  it('prefers a taxonomy match over a keyword hit', () => {
    const result = tierForCall([PHARMACEUTICS], pharmacySets, 'tribal livelihoods');

    expect(result.tier).toBe('direct');
  });
});

describe('relevance predicate', () => {
  const sqlOf = (fragment: { strings: readonly string[] }) => fragment.strings.join('?');

  it('is a no-op for an unmapped school', () => {
    // Filtering on an empty profile would hide the whole catalog — worse than
    // showing too much, so the predicate must degrade to TRUE.
    expect(sqlOf(relevantCallWhereSql(EMPTY_PROFILE))).toContain('TRUE');
    expect(sqlOf(relevantCallWhereSql(profile({ isUnmapped: true })))).toContain('TRUE');
  });

  it('matches on area, level-1 group and unclassified by default', () => {
    const sql = sqlOf(relevantCallWhereSql(profile()));

    expect(sql).toContain('taxonomy_area_id');
    expect(sql).toContain('taxonomy_level1_code');
    expect(sql).toContain('NOT EXISTS');
  });

  it('can exclude the broad tier and unclassified calls', () => {
    const sql = sqlOf(
      relevantCallWhereSql(profile(), 'fc', {
        includeBroad: false,
        includeUnclassified: false,
      })
    );

    expect(sql).toContain('taxonomy_area_id');
    expect(sql).not.toContain('taxonomy_level1_code');
    expect(sql).not.toContain('NOT EXISTS');
  });

  it('includes a keyword clause only when the school has keywords', () => {
    expect(sqlOf(relevantCallWhereSql(profile()))).not.toContain('unnest');
    expect(
      sqlOf(relevantCallWhereSql(profile({ keywords: ['tribal livelihoods'] })))
    ).toContain('unnest');
  });

  it('honours the table alias it is given', () => {
    const sql = sqlOf(relevantCallWhereSql(profile({ keywords: ['millets'] }), 'call'));

    expect(sql).toContain('call.id');
    expect(sql).toContain('call.disciplines');
  });
});
