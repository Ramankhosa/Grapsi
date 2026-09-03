import { describe, expect, it } from 'vitest';

import { isGroupArea, matchAreas, type MatchableArea } from '@/lib/funding/disciplineMatcher';

/** A catalog row with no level-2 code stands for the whole discipline group. */
const ENG_GROUP: MatchableArea = {
  id: 'eng_group',
  level1Code: 'ENG',
  level1Name: 'Engineering & Technology',
  level2Code: '',
  level2Name: '',
  aliases: ['engineering', 'technology'],
};

const ENG_MECH: MatchableArea = {
  id: 'eng_mech',
  level1Code: 'ENG',
  level1Name: 'Engineering & Technology',
  level2Code: 'ENG.01',
  level2Name: 'Mechanical & Manufacturing Engineering',
  aliases: ['mechanical engineering', 'mechanical'],
};

const PHY_GROUP: MatchableArea = {
  id: 'phy_group',
  level1Code: 'PHY',
  level1Name: 'Physical Sciences',
  level2Code: '',
  level2Name: '',
  aliases: ['physical sciences'],
};

const PHY_PHYSICS: MatchableArea = {
  id: 'phy_physics',
  level1Code: 'PHY',
  level1Name: 'Physical Sciences',
  level2Code: 'PHY.01',
  level2Name: 'Physics',
  aliases: ['physics'],
};

const PHY_MATHS: MatchableArea = {
  id: 'phy_maths',
  level1Code: 'PHY',
  level1Name: 'Physical Sciences',
  level2Code: 'PHY.03',
  level2Name: 'Mathematics & Statistics',
  aliases: ['mathematics'],
};

const AREAS = [ENG_GROUP, ENG_MECH, PHY_GROUP, PHY_PHYSICS, PHY_MATHS];

describe('discipline group rows', () => {
  it('identifies a group row by its missing level-2 code', () => {
    expect(isGroupArea(ENG_GROUP)).toBe(true);
    expect(isGroupArea(ENG_MECH)).toBe(false);
  });

  it('answers a broad phrase once, not once per area beneath it', () => {
    // The regression this exists for: "physical sciences" used to match every
    // level-2 row through its group name, so one phrase pulled Physics, Maths
    // and Astronomy as if each had been named.
    const matches = matchAreas({ title: 'School of Physical Sciences' }, AREAS);

    expect(matches).toHaveLength(1);
    expect(matches[0].areaId).toBe('phy_group');
    expect(matches[0].breadth).toBe('broad');
  });

  it('still names the specific area when the text names it', () => {
    const matches = matchAreas({ title: 'Department of Physics' }, AREAS);

    expect(matches.map((match) => match.areaId)).toEqual(['phy_physics']);
    expect(matches[0].breadth).toBe('specific');
  });

  it('lets a specific term shadow its own group, so the group stays quiet', () => {
    // "School of Mechanical Engineering" contains both "mechanical engineering"
    // and "engineering". The longer term wins the span, so the group row does
    // not also fire — naming the group adds nothing once the speciality is known.
    const matches = matchAreas({ title: 'School of Mechanical Engineering' }, AREAS);

    expect(matches).toHaveLength(1);
    expect(matches[0].areaId).toBe('eng_mech');
    expect(matches[0].breadth).toBe('specific');
  });

  it('does not let the generic half of a compound term fire a second area', () => {
    // The regression that pulled a School of Engineering into Humanities: a
    // researcher's keyword "low-resource languages" fired the bare alias
    // "languages". A longer occurring term must suppress the shorter one.
    const areas: MatchableArea[] = [
      ...AREAS,
      {
        id: 'hum_lang',
        level1Code: 'HUM',
        level1Name: 'Humanities & Arts',
        level2Code: 'HUM.01',
        level2Name: 'Languages Literature & Linguistics',
        aliases: ['languages'],
      },
      {
        id: 'cis_ai',
        level1Code: 'CIS',
        level1Name: 'Computer & Information Sciences',
        level2Code: 'CIS.01',
        level2Name: 'Artificial Intelligence & Machine Learning',
        aliases: ['natural language processing', 'low-resource languages'],
      },
    ];

    const matches = matchAreas({ tags: ['low-resource languages'] }, areas);

    expect(matches.map((match) => match.areaId)).toEqual(['cis_ai']);
  });

  it('gives a coarse but correct answer for a name that says only the field', () => {
    // A house-branded faculty naming no speciality. Broad is the honest answer
    // and is worth far more than nothing: relevance matches the whole group.
    const matches = matchAreas({ title: 'Lovely Faculty of Technology and Sciences' }, AREAS);

    expect(matches).toHaveLength(1);
    expect(matches[0].areaId).toBe('eng_group');
    expect(matches[0].breadth).toBe('broad');
  });

  it('does not let a group name leak onto its level-2 rows', () => {
    const matches = matchAreas({ tags: ['Engineering & Technology'] }, AREAS);

    expect(matches.map((match) => match.areaId)).not.toContain('eng_mech');
  });
});
