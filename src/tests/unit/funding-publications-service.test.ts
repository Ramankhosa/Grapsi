import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    referenceLibrary: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/embeddingService', () => ({
  EmbeddingService: vi.fn(() => ({
    getHealth: vi.fn(() => ({
      provider: 'voyage',
      configured: true,
      circuitOpen: false,
      consecutiveFailures: 0,
      lastError: null,
      lastFailureAt: null,
      nextRetryAt: null,
      modelName: 'voyage-4-large',
      outputDimensionality: 1024,
    })),
    generateEmbedding: vi.fn().mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      modelName: 'voyage-4-large',
      outputDimensionality: 1024,
      provider: 'voyage',
    }),
  })),
}));

import { prisma } from '@/lib/prisma';
import {
  buildFundingPublicationTags,
  fundingPublicationService,
  FUNDING_PUBLICATION_TAG,
  removeFundingPublicationTag,
} from '@/lib/researcherProfile/funding-publications';

function publicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref-1',
    title: 'Federated learning for medical imaging',
    abstract: 'Privacy-preserving radiology diagnostics.',
    year: 2024,
    venue: 'Journal of AI Health',
    doi: '10.1000/example',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    tags: [FUNDING_PUBLICATION_TAG],
    ...overrides,
  };
}

describe('FundingPublicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds the funding publication tag without duplicating existing tags', () => {
    expect(buildFundingPublicationTags(['Machine Learning', 'my-publication'])).toEqual([
      'Machine Learning',
      FUNDING_PUBLICATION_TAG,
    ]);
    expect(removeFundingPublicationTag(['Machine Learning', 'my-publication'])).toEqual(['Machine Learning']);
  });

  it('blocks new publications after the five-item focus limit', async () => {
    (prisma.referenceLibrary.findFirst as any).mockResolvedValue(null);
    (prisma.referenceLibrary.count as any).mockResolvedValue(5);

    await expect(
      fundingPublicationService.create('user-1', {
        title: 'New publication',
        abstract: 'Important abstract',
      })
    ).rejects.toThrow('at most 5 publications');

    expect(prisma.referenceLibrary.create).not.toHaveBeenCalled();
  });

  it('creates a tagged reference for a new funding publication', async () => {
    (prisma.referenceLibrary.findFirst as any).mockResolvedValue(null);
    (prisma.referenceLibrary.count as any).mockResolvedValue(2);
    (prisma.referenceLibrary.create as any).mockResolvedValue(publicationRow());

    const result = await fundingPublicationService.create('user-1', {
      title: ' Federated learning for medical imaging ',
      abstract: ' Privacy-preserving radiology diagnostics. ',
      year: 2024,
      doi: 'https://doi.org/10.1000/example',
    });

    expect(prisma.referenceLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          title: 'Federated learning for medical imaging',
          abstract: 'Privacy-preserving radiology diagnostics.',
          doi: '10.1000/example',
          tags: [FUNDING_PUBLICATION_TAG],
        }),
      })
    );
    expect(result.title).toBe('Federated learning for medical imaging');
  });

  it('reuses an existing DOI reference and adds the funding tag', async () => {
    (prisma.referenceLibrary.findFirst as any).mockResolvedValue(
      publicationRow({
        tags: ['medical-imaging'],
      })
    );
    (prisma.referenceLibrary.count as any).mockResolvedValue(4);
    (prisma.referenceLibrary.update as any).mockResolvedValue(
      publicationRow({
        tags: ['medical-imaging', FUNDING_PUBLICATION_TAG],
      })
    );

    await fundingPublicationService.create('user-1', {
      title: 'Updated title',
      abstract: 'Updated abstract',
      doi: '10.1000/example',
    });

    expect(prisma.referenceLibrary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ref-1' },
        data: expect.objectContaining({
          tags: ['medical-imaging', FUNDING_PUBLICATION_TAG],
        }),
      })
    );
  });
});
