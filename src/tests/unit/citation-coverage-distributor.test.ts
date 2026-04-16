import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    draftingSession: {
      findUnique: vi.fn()
    },
    citation: {
      findMany: vi.fn()
    }
  }
}));

import { prisma } from '../../lib/prisma';
import {
  CitationCoverageDistributor,
  type CoveragePlan
} from '../../lib/services/citation-coverage-distributor';

type PrismaMock = {
  draftingSession: {
    findUnique: Mock;
  };
  citation: {
    findMany: Mock;
  };
};

function makeCitation(
  citationKey: string,
  aiMeta: unknown = {},
  title?: string
) {
  return {
    citationKey,
    title: title || `Title ${citationKey}`,
    aiMeta
  };
}

function flattenAssigned(plan: CoveragePlan): Array<{ sectionKey: string; citationKey: string }> {
  const rows: Array<{ sectionKey: string; citationKey: string }> = [];
  for (const [sectionKey, assignments] of plan.bySection.entries()) {
    for (const assignment of assignments) {
      rows.push({ sectionKey, citationKey: assignment.citationKey });
    }
  }
  return rows;
}

function countBySection(plan: CoveragePlan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [sectionKey, assignments] of plan.bySection.entries()) {
    counts.set(sectionKey, assignments.length);
  }
  return counts;
}

describe('CitationCoverageDistributor', () => {
  let service: CitationCoverageDistributor;
  let prismaMock: PrismaMock;

  beforeEach(() => {
    service = new CitationCoverageDistributor();
    vi.clearAllMocks();
    prismaMock = prisma as unknown as PrismaMock;
    prismaMock.draftingSession.findUnique.mockResolvedValue({
      paperType: {
        sectionOrder: ['introduction', 'literature_review', 'methodology', 'results', 'discussion', 'conclusion']
      }
    });
  });

  it('should assign citation with usage.introduction=true to introduction section', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('Smith2023', { usage: { introduction: true }, relevanceScore: 88 })
    ]);

    const plan = await service.buildCoveragePlan('session-intro');
    const intro = plan.bySection.get('introduction') || [];

    expect(intro.some(row => row.citationKey === 'Smith2023')).toBe(true);
    expect(plan.unassigned).toEqual([]);
  });

  it('should assign citation with claimTypesSupported=METHOD to methodology section', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('Doe2022', { claimTypesSupported: ['METHOD'], relevanceScore: 74 })
    ]);

    const plan = await service.buildCoveragePlan('session-method');
    const methodology = plan.bySection.get('methodology') || [];

    expect(methodology.some(row => row.citationKey === 'Doe2022')).toBe(true);
    expect(plan.unassigned).toEqual([]);
  });

  it('should not assign same citation to a section more than 2 times', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('RepeatKey2024', { usage: { introduction: true }, relevanceScore: 90 }),
      makeCitation('RepeatKey2024', { usage: { introduction: true }, relevanceScore: 89 }),
      makeCitation('RepeatKey2024', { usage: { introduction: true }, relevanceScore: 88 })
    ]);

    const plan = await service.buildCoveragePlan('session-repeat-cap');
    const flattened = flattenAssigned(plan);

    const keySectionCounts = new Map<string, number>();
    for (const row of flattened) {
      const key = `${row.citationKey}::${row.sectionKey}`;
      keySectionCounts.set(key, (keySectionCounts.get(key) || 0) + 1);
    }

    for (const count of keySectionCounts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('should assign every citation to at least one section (catch-all guarantee)', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('A2021', {}),
      makeCitation('B2021', {}),
      makeCitation('C2021', {}),
      makeCitation('D2021', {})
    ]);

    const plan = await service.buildCoveragePlan('session-catch-all');
    const assigned = new Set(flattenAssigned(plan).map(row => row.citationKey));

    expect(assigned.has('A2021')).toBe(true);
    expect(assigned.has('B2021')).toBe(true);
    expect(assigned.has('C2021')).toBe(true);
    expect(assigned.has('D2021')).toBe(true);
  });

  it('should handle citations with no aiMeta gracefully', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('NoMeta2020', null),
      makeCitation('NoMeta2021', undefined)
    ]);

    const plan = await service.buildCoveragePlan('session-no-meta');
    const assigned = flattenAssigned(plan).map(row => row.citationKey);

    expect(assigned).toContain('NoMeta2020');
    expect(assigned).toContain('NoMeta2021');
    expect(plan.unassigned).toEqual([]);
  });

  it('should respect SECTION_MAX_ASSIGN cap and redistribute overflow', async () => {
    const heavyIntroRows = Array.from({ length: 40 }, (_, i) =>
      makeCitation(`IntroHeavy${String(i + 1).padStart(2, '0')}`, {
        usage: { introduction: true },
        relevanceScore: 95 - i
      })
    );
    prismaMock.citation.findMany.mockResolvedValue(heavyIntroRows);
    prismaMock.draftingSession.findUnique.mockResolvedValue({
      paperType: {
        sectionOrder: ['introduction', 'methodology', 'discussion']
      }
    });

    const plan = await service.buildCoveragePlan('session-cap-redistribute');
    const counts = countBySection(plan);
    const introCount = counts.get('introduction') || 0;
    const totalAssigned = flattenAssigned(plan).length;
    const nonIntroAssigned = totalAssigned - introCount;

    expect(introCount).toBeLessThanOrEqual(15);
    expect(totalAssigned).toBe(40);
    expect(nonIntroAssigned).toBeGreaterThan(0);
  });

  it('should return unassigned=[] when all citations are placed', async () => {
    prismaMock.citation.findMany.mockResolvedValue([
      makeCitation('PlacedA', { usage: { introduction: true } }),
      makeCitation('PlacedB', { claimTypesSupported: ['METHOD'] }),
      makeCitation('PlacedC', { positionalRelation: { relation: 'CONTRADICTS' } }),
      makeCitation('PlacedD', {})
    ]);

    const plan = await service.buildCoveragePlan('session-all-placed');

    expect(plan.unassigned).toEqual([]);
  });
});
