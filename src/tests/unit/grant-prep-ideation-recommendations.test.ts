import { describe, expect, it } from 'vitest';

import {
  buildGrantPrepPublicationRecommendationMessage,
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
});
