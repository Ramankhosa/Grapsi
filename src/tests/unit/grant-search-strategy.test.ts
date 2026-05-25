import { describe, expect, it } from 'vitest';

import {
  buildGrantBackedSearchStrategy,
  GRANT_SEARCH_RESULT_LIMIT,
} from '../../lib/grants/searchStrategy';

describe('grant-backed search strategy', () => {
  it('bundles blueprint dimensions into focused and broad queries while preserving full coverage', () => {
    const sectionPlan = Array.from({ length: 5 }, (_, sectionIndex) => ({
      sectionKey: `section_${sectionIndex + 1}`,
      mustCover: [],
      dimensions: Array.from({ length: 4 }, (_, dimensionIndex) => `Dimension ${sectionIndex + 1}.${dimensionIndex + 1}`),
      dimensionTyping: Object.fromEntries(
        Array.from({ length: 4 }, (_, dimensionIndex) => [
          `Dimension ${sectionIndex + 1}.${dimensionIndex + 1}`,
          dimensionIndex % 2 === 0 ? 'empirical' : 'methodological',
        ])
      ),
    }));

    const strategy = buildGrantBackedSearchStrategy({
      researchTopic: {
        title: 'Cyber Centre of Excellence',
        researchQuestion: 'How should a cyber centre of excellence be structured and justified?',
        keywords: ['cybersecurity', 'centre of excellence', 'capacity building'],
      },
      blueprint: {
        paperTypeCode: 'GRANT_TEMPLATE::test-template',
        sectionPlan,
      },
    });

    expect(strategy).toBeTruthy();
    expect(strategy!.queries.length).toBeGreaterThanOrEqual(4);
    expect(strategy!.queries.length).toBeLessThanOrEqual(12);
    expect(strategy!.queries.some((query) => query.searchIntent.startsWith('focused_'))).toBe(true);
    expect(strategy!.queries.some((query) => query.searchIntent.startsWith('broad_discovery_'))).toBe(true);
    expect(strategy!.queries.every((query) => query.resultLimit === GRANT_SEARCH_RESULT_LIMIT)).toBe(true);

    const coveredDimensions = new Set(
      strategy!.queries.flatMap((query) => query.dimensionTargets.map((target) => `${target.sectionKey}::${target.dimension}`))
    );
    const expectedDimensions = new Set(
      sectionPlan.flatMap((section) => section.dimensions.map((dimension) => `${section.sectionKey}::${dimension}`))
    );

    expect(coveredDimensions.size).toBe(expectedDimensions.size);
    expect(strategy!.queries.every((query) => query.dimensionTargets.length >= 1 && query.dimensionTargets.length <= 6)).toBe(true);
  });

  it('returns null for non grant-backed paper types', () => {
    const strategy = buildGrantBackedSearchStrategy({
      researchTopic: {
        title: 'Standard journal paper',
        keywords: ['nlp'],
      },
      blueprint: {
        paperTypeCode: 'JOURNAL_ARTICLE',
        sectionPlan: [],
      },
    });

    expect(strategy).toBeNull();
  });

  it('adds persuasion-aware query terms and recent windows for feasibility-heavy methodology searches', () => {
    const strategy = buildGrantBackedSearchStrategy({
      researchTopic: {
        title: 'Digital Health Delivery Network',
        researchQuestion: 'How should the implementation model be validated and justified?',
        keywords: ['digital health', 'implementation'],
      },
      blueprint: {
        paperTypeCode: 'GRANT_TEMPLATE::test-template',
        sectionPlan: [
          {
            sectionKey: 'methodology',
            grantSemantic: 'methodology',
            mustCover: [],
            dimensions: [
              'Feasibility of community health worker mobile adherence support in comparable settings',
              'Validation evidence for the proposed adherence monitoring workflow',
              'Comparative advantage or precedent for the implementation model',
            ],
            dimensionTyping: {
              'Feasibility of community health worker mobile adherence support in comparable settings': 'empirical',
              'Validation evidence for the proposed adherence monitoring workflow': 'methodological',
              'Comparative advantage or precedent for the implementation model': 'comparative',
            },
          },
        ],
      },
    });

    expect(strategy).toBeTruthy();
    expect(strategy!.queries[0]?.queryText).toMatch(/implementation|feasibility|validation/i);
    expect(strategy!.queries[0]?.searchIntent).toBe('focused_implementation_feasibility');
    expect(strategy!.queries[0]?.suggestedYearFrom).toBeGreaterThanOrEqual(new Date().getUTCFullYear() - 6);
    expect(strategy!.queries.some((query) => query.searchIntent.startsWith('broad_discovery_'))).toBe(true);
    expect(strategy!.queries.every((query) => query.resultLimit === GRANT_SEARCH_RESULT_LIMIT)).toBe(true);
  });
});
