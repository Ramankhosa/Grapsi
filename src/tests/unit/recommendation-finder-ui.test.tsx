import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import FinderChatMessage from '@/components/FinderChatMessage';
import FinderPendingFilterConfirmationBar from '@/components/FinderPendingFilterConfirmationBar';
import FinderPendingTurnMessage from '@/components/FinderPendingTurnMessage';
import FinderPreferencesPanel from '@/components/FinderPreferencesPanel';
import FinderStrictFilterRecoveryNotice from '@/components/FinderStrictFilterRecoveryNotice';
import { createDefaultFilters } from '@/lib/recommendations/conversationUtils';
import {
  buildClearedScalarFilters,
  buildFinderConversationStarters,
  buildRetryWithoutFiltersRequest,
} from '@/lib/recommendations/finderUi';
import type {
  RecommendationConversationMessageRecord,
  RecommendationConversationRunRecord,
} from '@/lib/recommendations/chatTypes';
import type {
  RecommendationRawResultItem,
  RecommendationStrictFilterRecovery,
} from '@/lib/recommendations/types';
import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';

function createResult(overrides: Partial<RecommendationRawResultItem> = {}): RecommendationRawResultItem {
  return {
    id: overrides.id || 'result-1',
    agencyName: overrides.agencyName || 'National Science Foundation',
    schemeTitle: overrides.schemeTitle || 'AI Research Fellowship',
    shortDescription: overrides.shortDescription || 'Supports applied AI research programs.',
    fullDescription: overrides.fullDescription || null,
    description: overrides.description || 'Supports applied AI research programs.',
    closeDate: overrides.closeDate === undefined ? '2026-04-22T00:00:00.000Z' : overrides.closeDate,
    isRolling: overrides.isRolling || false,
    fundingKinds: overrides.fundingKinds || ['Fellowship'],
    disciplines: overrides.disciplines || ['Artificial Intelligence'],
    eligibleCountries: overrides.eligibleCountries || ['India'],
    eligibleRegions: overrides.eligibleRegions || [],
    hostCountries: overrides.hostCountries || ['Germany'],
    institutionTypes: overrides.institutionTypes || ['University'],
    careerStages: overrides.careerStages || ['Postdoctoral'],
    sponsorType: overrides.sponsorType || 'Government',
    officialUrls: overrides.officialUrls || ['https://example.org/call'],
    score: overrides.score || 0.91,
    matchReasons: overrides.matchReasons || ['Strong topical overlap'],
    profileMatch: overrides.profileMatch === undefined ? null : overrides.profileMatch,
    eligibilitySummary:
      overrides.eligibilitySummary === undefined
        ? 'Open to postdoctoral researchers at accredited universities.'
        : overrides.eligibilitySummary,
    amountMin: overrides.amountMin === undefined ? 10000 : overrides.amountMin,
    amountMax: overrides.amountMax === undefined ? 25000 : overrides.amountMax,
    currency: overrides.currency === undefined ? 'USD' : overrides.currency,
    eligibilityText: overrides.eligibilityText === undefined ? 'Applicants must be based at an accredited university.' : overrides.eligibilityText,
    contactInfo: overrides.contactInfo || null,
    geographyScope: overrides.geographyScope || 'International',
    funderCountry: overrides.funderCountry || 'United States',
    citizenshipRequirements: overrides.citizenshipRequirements || [],
    residencyRequirements: overrides.residencyRequirements || [],
    applicationLanguages: overrides.applicationLanguages || ['English'],
    semanticSimilarity: overrides.semanticSimilarity || 0.81,
    textRank: overrides.textRank || 0.42,
  };
}

function createAssistantMessage(resultIds: string[]): RecommendationConversationMessageRecord {
  return {
    id: 'message-1',
    turnIndex: 1,
    role: 'assistant',
    messageType: 'assistant_response',
    content: 'Here are the strongest matches for your request.',
    createdAt: '2026-04-17T09:00:00.000Z',
    citations: { runId: 'run-1', resultIds },
  };
}

function createRun(results: RecommendationRawResultItem[]): RecommendationConversationRunRecord {
  return {
    id: 'run-1',
    turnIndex: 1,
    runIndex: 1,
    createdAt: '2026-04-17T09:00:00.000Z',
    degradedMode: null,
    lowConfidence: false,
    noResultsReason: null,
    searchDiagnostics: null,
    profileDiagnostics: null,
    results,
  };
}

describe('finder trust recovery UI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the strict-filter recovery banner from persisted diagnostics', () => {
    const filters = {
      ...createDefaultFilters(),
      hostCountries: ['Germany'],
      careerStages: ['Postdoctoral'],
    };
    const recovery: RecommendationStrictFilterRecovery = {
      retryFilters: {
        ...filters,
        hostCountries: [],
        careerStages: [],
      },
      relaxedFilterKeys: ['careerStages', 'hostCountries'],
    };

    const markup = renderToStaticMarkup(
      <FinderStrictFilterRecoveryNotice
        filters={filters}
        recovery={recovery}
        onRetry={() => undefined}
      />
    );

    expect(markup).toContain('Retry without these filters');
    expect(markup).toContain('Host countries: Germany');
    expect(markup).toContain('Career stages: Postdoctoral');
    expect(markup).toContain('Retry without these filters to broaden the search');
  });

  it('builds a retry request that preserves explicit filter replacement semantics', () => {
    const retryFilters = {
      ...createDefaultFilters(),
      hostCountries: [],
      careerStages: [],
      fundingKinds: ['Research Grant'],
    };

    expect(
      buildRetryWithoutFiltersRequest({
        retryFilters,
        relaxedFilterKeys: ['careerStages', 'hostCountries'],
      })
    ).toEqual({
      message: 'Retry without the restrictive filters from the last no-results search.',
      manualFilterPatch: retryFilters,
      replaceManualFilters: true,
    });
  });

  it('clears scalar filters without leaving stale deadline or amount values behind', () => {
    const filters = {
      ...createDefaultFilters(),
      deadlineFrom: '2026-05-01',
      deadlineTo: '2026-05-31',
      amountMin: 10000,
      rollingOnly: true,
    };

    const clearedDeadline = buildClearedScalarFilters(filters, 'deadlineFrom');
    const clearedAmount = buildClearedScalarFilters(filters, 'amountMin');
    const clearedRolling = buildClearedScalarFilters(filters, 'rollingOnly');

    expect(clearedDeadline.deadlineFrom).toBe('');
    expect(clearedDeadline.deadlineTo).toBe('2026-05-31');
    expect(clearedAmount.amountMin).toBeNull();
    expect(clearedRolling.rollingOnly).toBe(false);
  });

  it('builds profile-aware starter prompts and keeps a generic fallback', () => {
    const context: ResearcherFinderContext = {
      profile: {
        displayName: 'Dr. Patel',
        birthYear: null,
        countryOfResidence: 'India',
        citizenshipCountries: ['India'],
        institutionName: 'Example University',
        institutionType: 'University',
        department: 'Computer Science',
        careerStage: 'Postdoctoral',
        yearsOfExperience: null,
        applicationLanguages: ['English'],
        researchSummary: '',
        researchAreas: ['AI for Healthcare'],
        keywords: ['machine learning', 'medical imaging'],
        linkedinUrl: '',
        googleScholarUrl: '',
        scopusUrl: '',
        orcidUrl: '',
      },
      notificationPreferences: {
        inAppEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        emailAddress: '',
        whatsappNumber: '',
        whatsappVerified: false,
        notificationFrequency: 'weekly',
        digestEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'Asia/Calcutta',
        alertKeywords: [],
      },
      researchAreas: [
        {
          id: 'area-1',
          taxonomy: null,
          label: 'AI for Healthcare',
          researchArea: 'AI for healthcare diagnostics',
          keywords: ['machine learning'],
          disciplines: ['Artificial Intelligence'],
          isDefault: true,
          useForAlerts: true,
          normalizedText: 'ai for healthcare diagnostics',
          embeddingVersion: null,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      profileDefaultContext: null,
    };

    const prompts = buildFinderConversationStarters(context);

    expect(prompts[0]).toContain('AI for Healthcare');
    expect(prompts.some((prompt) => prompt.includes('India'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('postdoctoral researchers'))).toBe(true);
    expect(prompts).toContain('Find infrastructure funding for an AI and data lab.');
  });

  it('falls back to generic starter prompts for thin profiles', () => {
    const prompts = buildFinderConversationStarters(null);

    expect(prompts[0]).toBe('Find infrastructure funding for an AI and data lab.');
    expect(prompts.length).toBeGreaterThan(1);
  });

  it('renders pending and failed optimistic turn states', () => {
    const failedMarkup = renderToStaticMarkup(
      <FinderPendingTurnMessage
        createdAt="2026-04-17T09:15:00.000Z"
        message="Find travel grants for my conference."
        status="failed"
        error="Network error while sending the request."
        onRetry={() => undefined}
        onEdit={() => undefined}
        onDismiss={() => undefined}
      />
    );

    const pendingMarkup = renderToStaticMarkup(
      <FinderPendingTurnMessage
        createdAt="2026-04-17T09:15:00.000Z"
        message="Find travel grants for my conference."
        status="pending"
      />
    );

    expect(failedMarkup).toContain('Network error while sending the request.');
    expect(failedMarkup).toContain('Retry');
    expect(failedMarkup).toContain('Edit');
    expect(failedMarkup).toContain('Dismiss');
    expect(pendingMarkup).toContain('Searching funding calls...');
  });

  it('renders the sticky confirmation bar controls', () => {
    const markup = renderToStaticMarkup(
      <FinderPendingFilterConfirmationBar
        pendingPatch={{
          baseStateHash: 'hash-1',
          turnIndex: 3,
          requiresConfirmation: true,
          summary: 'Apply Germany and postdoctoral filters before searching.',
          reason: 'Inferred from the latest message.',
          nextInputMode: 'research_area',
          nextQuery: { researchArea: 'AI funding' },
          nextFilters: createDefaultFilters(),
        }}
        onConfirm={() => undefined}
        onReject={() => undefined}
      />
    );

    expect(markup).toContain('Pending Filter Confirmation');
    expect(markup).toContain('Apply Germany and postdoctoral filters before searching.');
    expect(markup).toContain('Confirm');
    expect(markup).toContain('Reject');
  });

  it('renders explicit preference controls for eligibility and publication context', () => {
    const markup = renderToStaticMarkup(
      <FinderPreferencesPanel
        preferences={{ useEligibilityProfile: false, usePublicationContext: false }}
        onChange={() => undefined}
      />
    );

    expect(markup).toContain('My Preferences');
    expect(markup).toContain('Use eligibility profile');
    expect(markup).toContain('Use my publications');
    expect(markup).toContain('my-publication');
  });

  it('renders amount, deadline states, eligibility copy, and inline recovery on chat result cards', () => {
    const results = [
      createResult(),
      createResult({
        id: 'result-2',
        schemeTitle: 'Closed Travel Grant',
        closeDate: '2026-04-10T00:00:00.000Z',
        amountMin: null,
        amountMax: null,
        eligibilitySummary: '',
        eligibilityText: 'This archived scheme required institutional nomination.',
      }),
      createResult({
        id: 'result-3',
        schemeTitle: 'Rolling Collaboration Grant',
        isRolling: true,
        closeDate: null,
      }),
    ];

    const markup = renderToStaticMarkup(
      <FinderChatMessage
        message={createAssistantMessage(results.map((result) => result.id))}
        runs={[createRun(results)]}
        strictRecoveryAction={{
          summary: 'The last search found no matches with these filters: Host countries: Germany.',
          onRetry: () => undefined,
        }}
      />
    );

    expect(markup).toContain('Amount: USD 10,000 - 25,000');
    expect(markup).toContain('Closes in 5 days');
    expect(markup).toContain('Closed');
    expect(markup).toContain('Rolling');
    expect(markup).toContain('This archived scheme required institutional nomination.');
    expect(markup).toContain('Retry without these filters');
  });
});
