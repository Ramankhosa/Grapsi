import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateUserMock = vi.fn();
const getDraftingSessionForUserMock = vi.fn();
const importFromSearchResultsBulkMock = vi.fn();
const formatInTextCitationMock = vi.fn();
const formatBibliographyEntryMock = vi.fn();
const clearMappingsForCitationsMock = vi.fn();
const storeMappingsMock = vi.fn();
const syncCitationsToLibraryAndCollectionMock = vi.fn();

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: authenticateUserMock,
}));

vi.mock('@/lib/grants/shadowSessionAccess', () => ({
  getDraftingSessionForUser: getDraftingSessionForUserMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/services/citation-service', () => ({
  citationService: {
    importFromSearchResultsBulk: importFromSearchResultsBulkMock,
  },
}));

vi.mock('@/lib/services/citation-style-service', () => ({
  citationStyleService: {
    formatInTextCitation: formatInTextCitationMock,
    formatBibliographyEntry: formatBibliographyEntryMock,
  },
}));

vi.mock('@/lib/services/citation-mapping-service', () => ({
  citationMappingService: {
    clearMappingsForCitations: clearMappingsForCitationsMock,
    storeMappings: storeMappingsMock,
  },
}));

vi.mock('@/lib/services/paper-library-service', () => ({
  paperLibraryService: {
    syncCitationsToLibraryAndCollection: syncCitationsToLibraryAndCollectionMock,
  },
}));

function makeRequest(citations: any[]) {
  return new NextRequest('http://localhost/api/papers/session-1/citations/bulk-import', {
    method: 'POST',
    body: JSON.stringify({ citations }),
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
  });
}

function importPayload(overrides: any = {}) {
  return {
    searchResult: {
      id: overrides.id || 'paper-1',
      title: overrides.title || 'Need evidence paper',
      authors: ['Author A'],
      year: 2024,
      doi: overrides.doi || '10.1000/need',
    },
    recommendation: 'IMPORT',
    relevanceScore: 88,
    citationMeta: {
      keyContribution: 'Provides a concrete need baseline.',
      keyFindings: 'Reports a measurable gap relevant to the proposal.',
      methodologicalApproach: 'Observational study',
      relevanceToResearch: 'Supports the grant need case.',
      limitationsOrGaps: 'Limited to one setting.',
      evidenceBoundary: 'Do not generalize beyond the sampled setting.',
      grantUtility: 'PROVES_NEED',
      usage: {
        introduction: true,
        literatureReview: true,
        methodology: false,
        comparison: false,
      },
    },
    dimensionMappings: [
      {
        sectionKey: 'need',
        dimension: 'Need and baseline evidence',
        remark: 'The abstract provides baseline need evidence.',
        confidence: 'HIGH',
      },
    ],
    ...overrides,
  };
}

describe('citation bulk import route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    authenticateUserMock.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
      error: null,
    });
    getDraftingSessionForUserMock.mockResolvedValue({
      id: 'session-1',
      citationStyle: { code: 'APA7' },
    });
    formatInTextCitationMock.mockResolvedValue('(Author, 2024)');
    formatBibliographyEntryMock.mockResolvedValue('Author. (2024). Need evidence paper.');
    clearMappingsForCitationsMock.mockResolvedValue(undefined);
    storeMappingsMock.mockResolvedValue(undefined);
    syncCitationsToLibraryAndCollectionMock.mockResolvedValue(undefined);
  });

  it('imports only IMPORT recommendations and skips MAYBE/SKIP without failing', async () => {
    importFromSearchResultsBulkMock.mockResolvedValue({
      imported: [
        {
          clientRef: '0',
          citation: {
            id: 'citation-1',
            citationKey: 'Author2024',
            title: 'Need evidence paper',
            authors: ['Author A'],
            year: 2024,
          },
        },
      ],
      skipped: [],
    });

    const { POST } = await import('@/app/api/papers/[paperId]/citations/bulk-import/route');
    const response = await POST(makeRequest([
      importPayload(),
      importPayload({ id: 'paper-2', title: 'Maybe paper', recommendation: 'MAYBE' }),
      importPayload({ id: 'paper-3', title: 'Skip paper', recommendation: 'SKIP' }),
    ]), { params: { paperId: 'session-1' } });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.importedCount).toBe(1);
    expect(payload.skippedCount).toBe(2);
    expect(importFromSearchResultsBulkMock).toHaveBeenCalledTimes(1);
    expect(importFromSearchResultsBulkMock.mock.calls[0][1]).toHaveLength(1);
  });

  it('preserves citationMeta and dimension mappings for imported Grant Citations', async () => {
    importFromSearchResultsBulkMock.mockResolvedValue({
      imported: [
        {
          clientRef: '0',
          citation: {
            id: 'citation-1',
            citationKey: 'Author2024',
            title: 'Need evidence paper',
            authors: ['Author A'],
            year: 2024,
          },
        },
      ],
      skipped: [],
    });

    const { POST } = await import('@/app/api/papers/[paperId]/citations/bulk-import/route');
    await POST(makeRequest([importPayload()]), { params: { paperId: 'session-1' } });

    expect(importFromSearchResultsBulkMock.mock.calls[0][1][0].citationMeta).toEqual(
      expect.objectContaining({
        keyContribution: 'Provides a concrete need baseline.',
        grantUtility: 'PROVES_NEED',
      })
    );
    expect(storeMappingsMock).toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([
        expect.objectContaining({
          paperId: 'citation-1',
          sectionKey: 'need',
          dimensionMappings: expect.arrayContaining([
            expect.objectContaining({
              dimension: 'Need and baseline evidence',
              confidence: 'HIGH',
            }),
          ]),
          citationMeta: expect.objectContaining({
            keyContribution: 'Provides a concrete need baseline.',
            grantUtility: 'PROVES_NEED',
          }),
        }),
      ])
    );
  });

  it('returns duplicate skips without failing the import request', async () => {
    importFromSearchResultsBulkMock.mockResolvedValue({
      imported: [],
      skipped: [
        {
          clientRef: '0',
          reason: 'DUPLICATE_EXISTING',
          searchResult: { id: 'paper-1', title: 'Need evidence paper' },
        },
      ],
    });

    const { POST } = await import('@/app/api/papers/[paperId]/citations/bulk-import/route');
    const response = await POST(makeRequest([importPayload()]), { params: { paperId: 'session-1' } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.importedCount).toBe(0);
    expect(payload.skippedCount).toBe(1);
  });
});
