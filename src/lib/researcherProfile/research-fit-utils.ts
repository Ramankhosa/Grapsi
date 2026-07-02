import type {
  ResearchAreaTaxonomyAreaRecord,
  ResearcherSavedResearchAreaRecord,
} from '@/lib/researcherProfile/types';
import type { FundingPublicationRecord } from '@/lib/researcherProfile/funding-publications';

export type ResearchAreaFitForm = {
  id?: string;
  taxonomyLevel1Code: string;
  taxonomyAreaId: string;
  label: string;
  researchArea: string;
  keywords: string;
  disciplines: string;
  isDefault: boolean;
  useForAlerts: boolean;
};

export type FundingPublicationForm = {
  id?: string;
  title: string;
  abstract: string;
  year: string;
  venue: string;
  doi: string;
};

export function parseDelimitedList(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinDelimitedList(values: string[]) {
  return values.join(', ');
}

export function emptyResearchAreaForm(): ResearchAreaFitForm {
  return {
    taxonomyLevel1Code: '',
    taxonomyAreaId: '',
    label: '',
    researchArea: '',
    keywords: '',
    disciplines: '',
    isDefault: false,
    useForAlerts: true,
  };
}

export function researchAreaToForm(area?: ResearcherSavedResearchAreaRecord | null): ResearchAreaFitForm {
  if (!area) {
    return emptyResearchAreaForm();
  }

  return {
    id: area.id,
    taxonomyLevel1Code: area.taxonomy?.level1Code || '',
    taxonomyAreaId: area.taxonomy?.areaId || '',
    label: area.label || '',
    researchArea: area.researchArea || '',
    keywords: joinDelimitedList(area.keywords || []),
    disciplines: joinDelimitedList(area.disciplines || []),
    isDefault: Boolean(area.isDefault),
    useForAlerts: area.useForAlerts !== false,
  };
}

export function buildResearchAreaPayload(
  form: ResearchAreaFitForm,
  selectedTaxonomyArea: ResearchAreaTaxonomyAreaRecord | null | undefined
): {
  taxonomyAreaId?: string | null;
  label: string;
  researchArea: string;
  keywords: string[];
  disciplines: string[];
  isDefault: boolean;
  useForAlerts: boolean;
} {
  return {
    ...((selectedTaxonomyArea || !form.id) ? { taxonomyAreaId: form.taxonomyAreaId || null } : {}),
    label: form.label.trim(),
    researchArea: form.researchArea.trim(),
    keywords: parseDelimitedList(form.keywords),
    disciplines: parseDelimitedList(form.disciplines),
    isDefault: form.isDefault,
    useForAlerts: form.useForAlerts,
  };
}

export function validateResearchAreaForm(form: ResearchAreaFitForm, hasActiveTaxonomy: boolean) {
  if (!form.label.trim()) {
    return 'Add a short topic title.';
  }
  if (hasActiveTaxonomy && !form.taxonomyAreaId && !form.id) {
    return 'Choose a research classification.';
  }
  if (!form.researchArea.trim()) {
    return 'Describe the research focus.';
  }
  return null;
}

export function emptyPublicationForm(): FundingPublicationForm {
  return {
    title: '',
    abstract: '',
    year: '',
    venue: '',
    doi: '',
  };
}

export function publicationToForm(publication?: FundingPublicationRecord | null): FundingPublicationForm {
  if (!publication) {
    return emptyPublicationForm();
  }

  return {
    id: publication.id,
    title: publication.title,
    abstract: publication.abstract,
    year: publication.year ? String(publication.year) : '',
    venue: publication.venue || '',
    doi: publication.doi || '',
  };
}

export function buildFundingPublicationPayload(form: FundingPublicationForm) {
  return {
    title: form.title.trim(),
    abstract: form.abstract.trim(),
    year: form.year.trim() ? Number(form.year.trim()) : null,
    venue: form.venue.trim() || null,
    doi: form.doi.trim() || null,
  };
}

export function validateFundingPublicationForm(form: FundingPublicationForm) {
  if (!form.title.trim()) {
    return 'Add the publication title.';
  }
  if (!form.abstract.trim()) {
    return 'Paste the publication abstract.';
  }
  if (form.year.trim()) {
    const year = Number(form.year.trim());
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear() + 1) {
      return 'Enter a valid publication year.';
    }
  }
  return null;
}
