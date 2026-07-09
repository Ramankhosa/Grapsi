import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  referenceLibraryFindMany: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    referenceLibrary: { findMany: mocks.referenceLibraryFindMany },
  };
  return { default: client, prisma: client };
});

import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';
import {
  buildRecommendationPreferenceSnapshot,
  researcherProfileService,
} from '@/lib/services/researcherProfileService';

function makeFinderContext(): ResearcherFinderContext {
  return {
    profile: {
      displayName: 'Dr. Test',
      countryOfResidence: 'India',
      citizenshipCountries: ['India'],
      institutionType: 'University',
      institutionName: 'Test University',
      careerStage: 'Postdoctoral',
      applicationLanguages: ['English'],
      researchAreas: ['Artificial Intelligence', 'Public Health'],
      keywords: ['machine learning', 'epidemiology'],
    },
    notificationPreferences: null,
    researchAreas: [
      {
        id: 'area-1',
        label: 'AI for Healthcare',
        researchArea: 'Applying deep learning to diagnostic imaging in low-resource settings',
        keywords: ['medical imaging', 'deep learning'],
        disciplines: ['computer science'],
        useForAlerts: true,
        taxonomy: { areaId: 'tax-1', level1Name: 'Engineering', level2Name: 'Computer Science' },
      },
    ],
    profileDefaultContext: null,
  } as unknown as ResearcherFinderContext;
}

describe('buildRecommendationPreferenceSnapshot research signals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.referenceLibraryFindMany.mockReset();
    mocks.referenceLibraryFindMany.mockResolvedValue([]);
  });

  it('includes research areas, keywords, and saved areas when the eligibility profile is enabled', async () => {
    vi.spyOn(researcherProfileService, 'getFinderContext').mockResolvedValue(makeFinderContext());

    const snapshot = await buildRecommendationPreferenceSnapshot('user-1', {
      useEligibilityProfile: true,
      usePublicationContext: false,
    });

    // These feed the chat orchestrator's profile context and the 0.30-weight
    // research-area rank signal in buildProfileMatch — the core of "recommend
    // funding from my research areas".
    expect(snapshot?.researchAreas).toEqual(['Artificial Intelligence', 'Public Health']);
    expect(snapshot?.keywords).toEqual(['machine learning', 'epidemiology']);
    expect(snapshot?.savedResearchAreas).toHaveLength(1);
    expect(snapshot?.savedResearchAreas[0].label).toBe('AI for Healthcare');
    expect(snapshot?.savedResearchAreas[0].taxonomyPath).toBe('Engineering / Computer Science');
    expect(snapshot?.careerStage).toBe('Postdoctoral');
    expect(snapshot?.countryOfResidence).toBe('India');
  });

  it('includes tagged publications when the publication toggle is enabled', async () => {
    vi.spyOn(researcherProfileService, 'getFinderContext').mockResolvedValue(makeFinderContext());
    mocks.referenceLibraryFindMany.mockResolvedValue([
      {
        id: 'pub-1',
        title: 'Federated learning for medical imaging diagnosis',
        year: 2025,
        venue: 'Nature Medicine',
        doi: '10.1000/test',
        abstract: 'We study federated learning approaches for diagnostic imaging.',
        tags: ['my-publication', 'federated-learning'],
        updatedAt: new Date(),
      },
    ]);

    const snapshot = await buildRecommendationPreferenceSnapshot('user-1', {
      useEligibilityProfile: true,
      usePublicationContext: true,
    });

    expect(snapshot?.publications).toHaveLength(1);
    expect(snapshot?.publications[0].title).toBe('Federated learning for medical imaging diagnosis');
    expect(snapshot?.publications[0].tags).toEqual(['federated-learning']);
    expect(snapshot?.researchAreas).toContain('Artificial Intelligence');
  });

  it('keeps publications-only mode free of profile fields (existing contract)', async () => {
    const contextSpy = vi.spyOn(researcherProfileService, 'getFinderContext');
    mocks.referenceLibraryFindMany.mockResolvedValue([
      {
        id: 'pub-1',
        title: 'Federated learning for medical imaging diagnosis',
        year: 2025,
        venue: null,
        doi: null,
        abstract: null,
        tags: ['my-publication'],
        updatedAt: new Date(),
      },
    ]);

    const snapshot = await buildRecommendationPreferenceSnapshot('user-1', {
      useEligibilityProfile: false,
      usePublicationContext: true,
    });

    expect(snapshot?.publications).toHaveLength(1);
    expect(snapshot?.researchAreas).toEqual([]);
    expect(snapshot?.careerStage).toBeNull();
    expect(contextSpy).not.toHaveBeenCalled();
  });

  it('returns null when both toggles are off', async () => {
    const snapshot = await buildRecommendationPreferenceSnapshot('user-1', {
      useEligibilityProfile: false,
      usePublicationContext: false,
    });
    expect(snapshot).toBeNull();
  });
});
