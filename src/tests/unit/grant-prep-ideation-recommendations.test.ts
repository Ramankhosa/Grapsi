import { describe, expect, it } from 'vitest';

import {
  buildGrantPrepResearchAreaRecommendationMessage,
  buildGrantPrepPublicationRecommendationMessage,
  buildGrantPrepSavedPublicationRecommendationMessage,
  GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST,
  parseGrantPrepPublicationLines,
} from '@/lib/grantPrep/ideationRecommendations';

describe('grant prep ideation recommendations', () => {
  it('parses numbered publication lines', () => {
    expect(parseGrantPrepPublicationLines([
      '1. AI-assisted screening in rural clinics',
      '2) Community health worker adherence intervention',
      '- Mobile reminders and glycemic control',
      '',
    ].join('\n'))).toEqual([
      'AI-assisted screening in rural clinics',
      'Community health worker adherence intervention',
      'Mobile reminders and glycemic control',
    ]);
  });

  it('uses no more than five publications in the recommendation message', () => {
    const message = buildGrantPrepPublicationRecommendationMessage([
      'Paper 1',
      'Paper 2',
      'Paper 3',
      'Paper 4',
      'Paper 5',
      'Paper 6',
    ]);

    expect(message).toContain('5. Paper 5');
    expect(message).not.toContain('Paper 6');
    expect(message).toContain('Fits this call because');
  });

  it('builds a call-only prompt that does not ask for profile personalization', () => {
    expect(GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST).toContain('funding call');
    expect(GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST).toContain('agency requirements only');
    expect(GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST).toContain('Do not personalize');
  });

  it('builds a targeted research area recommendation message', () => {
    const message = buildGrantPrepResearchAreaRecommendationMessage({
      label: 'Medical imaging AI',
      researchArea: 'Explainable AI for rural radiology triage',
      keywords: ['radiology', 'triage'],
      disciplines: ['Computer science'],
      taxonomyPath: 'Engineering / Medical engineering',
    });

    expect(message).toContain('based on this saved research area');
    expect(message).toContain('Selected research area: Medical imaging AI');
    expect(message).toContain('Focus: Explainable AI for rural radiology triage');
    expect(message).toContain('Classification: Engineering / Medical engineering');
  });

  it('builds a targeted key publication recommendation message', () => {
    const message = buildGrantPrepSavedPublicationRecommendationMessage({
      title: 'Federated learning for medical imaging diagnosis',
      year: 2024,
      venue: 'Journal of Medical AI',
      doi: '10.1000/example',
      abstractSnippet: 'This study evaluates privacy-preserving diagnosis across hospital imaging datasets.',
    });

    expect(message).toContain('based on this key publication');
    expect(message).toContain('Key publication: Federated learning for medical imaging diagnosis');
    expect(message).toContain('Abstract: This study evaluates privacy-preserving diagnosis');
  });
});
