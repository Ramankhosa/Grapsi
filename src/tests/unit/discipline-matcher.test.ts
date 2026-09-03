import { describe, expect, it } from 'vitest';

import { ACCEPT_THRESHOLD, matchAreas, type MatchableArea } from '@/lib/funding/disciplineMatcher';

const AI: MatchableArea = {
  id: 'area_ai',
  level1Code: 'CIS',
  level1Name: 'Computer & Information Sciences',
  level2Code: 'CIS.01',
  level2Name: 'Artificial Intelligence & Machine Learning',
  aliases: ['artificial intelligence', 'AI', 'machine learning', 'deep learning'],
};

const PHARMACEUTICS: MatchableArea = {
  id: 'area_pharmaceutics',
  level1Code: 'PHA',
  level1Name: 'Pharmaceutical Sciences',
  level2Code: 'PHA.01',
  level2Name: 'Pharmaceutics & Drug Delivery',
  aliases: ['pharmaceutics', 'drug delivery', 'formulation', 'nanomedicine'],
};

const ECOLOGY: MatchableArea = {
  id: 'area_ecology',
  level1Code: 'LIF',
  level1Name: 'Life & Biological Sciences',
  level2Code: 'LIF.04',
  level2Name: 'Ecology Biodiversity & Environmental Science',
  aliases: ['ecology', 'biodiversity', 'sustainability', 'conservation'],
};

const AREAS = [AI, PHARMACEUTICS, ECOLOGY];

describe('discipline matcher', () => {
  it('matches a curated tag strongly enough to classify on its own', () => {
    const matches = matchAreas({ tags: ['Drug Delivery'], title: 'Seed Grant' }, AREAS);

    expect(matches).toHaveLength(1);
    expect(matches[0].areaId).toBe('area_pharmaceutics');
    expect(matches[0].score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
    expect(matches[0].matchedTerms).toContain('drug delivery');
  });

  it('does not classify on body prose alone', () => {
    // A guideline document that merely mentions the word in passing must not
    // pin the call to that discipline — the failure this threshold exists for.
    const matches = matchAreas(
      { title: 'General Research Excellence Award', body: 'Proposals may touch on ecology.' },
      AREAS
    );

    expect(matches).toHaveLength(0);
  });

  it('accumulates weak body evidence with a title hit', () => {
    const matches = matchAreas(
      {
        title: 'Biodiversity Fieldwork Grant',
        body: 'Supports conservation and ecology fieldwork.',
      },
      AREAS
    );

    expect(matches[0].areaId).toBe('area_ecology');
    expect(matches[0].score).toBeGreaterThan(ACCEPT_THRESHOLD);
  });

  it('matches short aliases in tags but never inside prose', () => {
    const fromTag = matchAreas({ tags: ['AI'] }, AREAS);
    expect(fromTag.map((match) => match.areaId)).toContain('area_ai');

    // "AI" loose in a long document is noise, so a two-letter alias is excluded
    // from body text however often it appears.
    const fromBody = matchAreas({ title: 'Open Call', body: 'ai ai ai ai ai' }, AREAS);
    expect(fromBody).toHaveLength(0);
  });

  it('respects word boundaries so short aliases do not match inside words', () => {
    // "AI" must not fire on "Sustainability", "Chennai" or "said".
    const matches = matchAreas({ tags: ['Sustainability'], title: 'Chennai Regional Award' }, AREAS);

    expect(matches.map((match) => match.areaId)).toEqual(['area_ecology']);
  });

  it('does not match a term inside a longer word', () => {
    const matches = matchAreas({ tags: ['formulations of policy'], title: 'Policy Grant' }, AREAS);

    // "formulation" is a substring of "formulations" but not a whole word.
    expect(matches).toHaveLength(0);
  });

  it('ranks the strongest evidence first and reports the specific term', () => {
    const matches = matchAreas(
      {
        tags: ['Machine Learning', 'Artificial Intelligence'],
        title: 'AI for Drug Delivery',
        body: 'Applies deep learning to formulation design.',
      },
      AREAS
    );

    expect(matches[0].areaId).toBe('area_ai');
    expect(matches.map((match) => match.areaId)).toContain('area_pharmaceutics');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].confidence).toBeLessThanOrEqual(1);
  });

  it('returns nothing for a discipline-agnostic call, leaving it to the LLM', () => {
    const matches = matchAreas(
      {
        title: 'Conference and Travel Grant',
        body: 'Funds travel and conference attendance for early-career researchers.',
      },
      AREAS
    );

    expect(matches).toHaveLength(0);
  });

  it('returns nothing when there is no text at all', () => {
    expect(matchAreas({}, AREAS)).toHaveLength(0);
    expect(matchAreas({ tags: [], title: '', body: '' }, AREAS)).toHaveLength(0);
  });

  it('caps the number of areas per call', () => {
    const many: MatchableArea[] = Array.from({ length: 10 }, (_, index) => ({
      id: `area_${index}`,
      level1Code: 'X',
      level1Name: 'Group',
      level2Code: `X.0${index}`,
      level2Name: `Area ${index}`,
      aliases: ['shared alias'],
    }));

    const matches = matchAreas({ tags: ['shared alias'] }, many);
    expect(matches.length).toBeLessThanOrEqual(4);
  });
});
