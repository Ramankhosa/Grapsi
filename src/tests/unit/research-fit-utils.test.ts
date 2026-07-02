import { describe, expect, it } from 'vitest';

import {
  buildFundingPublicationPayload,
  buildResearchAreaPayload,
  emptyResearchAreaForm,
  validateFundingPublicationForm,
  validateResearchAreaForm,
} from '@/lib/researcherProfile/research-fit-utils';
import type { ResearchAreaTaxonomyAreaRecord } from '@/lib/researcherProfile/types';

const taxonomyArea: ResearchAreaTaxonomyAreaRecord = {
  id: 'tax-1',
  uploadId: 'upload-1',
  level1Code: '2',
  level1Name: 'Engineering and Technology',
  level2Code: '2.2',
  level2Name: 'Medical Engineering',
  description: '',
  aliases: [],
  sortOrder: null,
  isActive: true,
};

describe('research fit form utilities', () => {
  it('builds a compact research-area payload from the simplified form', () => {
    const form = {
      ...emptyResearchAreaForm(),
      taxonomyAreaId: 'tax-1',
      label: ' AI diagnostics ',
      researchArea: ' Machine learning for medical imaging ',
      keywords: 'AI, imaging; diagnostics',
      disciplines: 'Computer Science\nHealthcare',
      isDefault: true,
      useForAlerts: true,
    };

    expect(buildResearchAreaPayload(form, taxonomyArea)).toEqual({
      taxonomyAreaId: 'tax-1',
      label: 'AI diagnostics',
      researchArea: 'Machine learning for medical imaging',
      keywords: ['AI', 'imaging', 'diagnostics'],
      disciplines: ['Computer Science', 'Healthcare'],
      isDefault: true,
      useForAlerts: true,
    });
  });

  it('requires only visible core fields before saving a research area', () => {
    expect(validateResearchAreaForm(emptyResearchAreaForm(), true)).toBe('Add a short topic title.');
    expect(
      validateResearchAreaForm(
        {
          ...emptyResearchAreaForm(),
          label: 'AI diagnostics',
          researchArea: 'Medical imaging AI',
        },
        true
      )
    ).toBe('Choose a research classification.');
    expect(
      validateResearchAreaForm(
        {
          ...emptyResearchAreaForm(),
          label: 'AI diagnostics',
          taxonomyAreaId: 'tax-1',
          researchArea: 'Medical imaging AI',
        },
        true
      )
    ).toBeNull();
  });

  it('builds and validates funding publication payloads', () => {
    const form = {
      title: ' Federated learning for medical imaging ',
      abstract: ' Privacy-preserving radiology diagnostics. ',
      year: '2024',
      venue: 'Journal of AI Health',
      doi: 'https://doi.org/10.1000/example',
    };

    expect(validateFundingPublicationForm(form)).toBeNull();
    expect(buildFundingPublicationPayload(form)).toEqual({
      title: 'Federated learning for medical imaging',
      abstract: 'Privacy-preserving radiology diagnostics.',
      year: 2024,
      venue: 'Journal of AI Health',
      doi: 'https://doi.org/10.1000/example',
    });
  });
});
