import {
  APPLICATION_LANGUAGE_OPTIONS,
  ELIGIBLE_REGION_OPTIONS,
  FUNDING_KIND_OPTIONS,
  GEOGRAPHY_SCOPE_OPTIONS,
  SPONSOR_TYPE_OPTIONS,
} from '../fundingIntake/constants';

export const RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS = [...GEOGRAPHY_SCOPE_OPTIONS] as const;
export const RECOMMENDATION_FUNDING_KIND_OPTIONS = [...FUNDING_KIND_OPTIONS] as const;
export const RECOMMENDATION_REGION_OPTIONS = [...ELIGIBLE_REGION_OPTIONS] as const;
export const RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS = [...APPLICATION_LANGUAGE_OPTIONS] as const;
export const RECOMMENDATION_SPONSOR_TYPE_OPTIONS = [...SPONSOR_TYPE_OPTIONS] as const;

export const RECOMMENDATION_INSTITUTION_TYPE_OPTIONS = [
  'University',
  'Research Institute',
  'Hospital',
  'Government Agency',
  'NGO',
  'Non-Profit',
  'Corporate',
  'Startup',
  'Individual',
  'Consortium',
] as const;

export const RECOMMENDATION_CAREER_STAGE_OPTIONS = [
  'Undergraduate',
  'Masters',
  'PhD',
  'Postdoctoral',
  'Early Career Researcher',
  'Early Career Faculty',
  'Mid Career Researcher',
  'Senior Researcher',
  'Principal Investigator',
] as const;

export const RECOMMENDATION_SORT_OPTIONS = ['best_match', 'deadline_soonest'] as const;

export const RESEARCH_AREA_EXPANSIONS: Record<string, string[]> = {
  ai: ['artificial intelligence', 'machine learning'],
  'artificial intelligence': ['machine learning', 'data science'],
  'machine learning': ['artificial intelligence', 'data science'],
  agriculture: ['farming', 'food systems', 'agri-tech'],
  farming: ['agriculture', 'food systems'],
  climate: ['climate change', 'sustainability', 'environmental science'],
  health: ['healthcare', 'public health', 'medicine'],
  healthcare: ['health', 'medicine', 'public health'],
  medicine: ['healthcare', 'public health'],
  education: ['learning', 'teaching', 'skills development'],
  energy: ['renewable energy', 'sustainability'],
  renewable: ['renewable energy', 'energy transition'],
  quantum: ['quantum computing', 'physics'],
  cybersecurity: ['cyber security', 'information security', 'computer security'],
  materials: ['materials science', 'advanced materials'],
  biotechnology: ['bioscience', 'life sciences'],
};

export const GEOGRAPHY_SCOPE_ALIASES: Record<string, string> = {
  national: 'National',
  domestic: 'National',
  regional: 'Regional',
  international: 'International',
  global: 'Global',
  worldwide: 'Global',
};

export const REGION_ALIASES: Record<string, string> = {
  eu: 'European Union',
  'european union': 'European Union',
  asean: 'ASEAN',
  'south asia': 'South Asia',
  'sub saharan africa': 'Sub-Saharan Africa',
  'sub-saharan africa': 'Sub-Saharan Africa',
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  'north america': 'North America',
  'south america': 'South America',
  oceania: 'Oceania',
};

export const FUNDING_KIND_ALIASES: Record<string, string> = {
  fellowship: 'Fellowship',
  grant: 'Research Grant',
  'research grant': 'Research Grant',
  research: 'Research Grant',
  travel: 'Travel Grant',
  'travel grant': 'Travel Grant',
  infrastructure: 'Infrastructure',
  infrastructuregrant: 'Infrastructure',
  equipment: 'Equipment Grant',
  'equipment grant': 'Equipment Grant',
  seed: 'Seed Grant',
  'seed grant': 'Seed Grant',
  training: 'Training Grant',
  'training grant': 'Training Grant',
  mobility: 'Mobility Grant',
  'mobility grant': 'Mobility Grant',
  conference: 'Conference Grant',
  'conference grant': 'Conference Grant',
  scholarship: 'Scholarship',
};

export const INSTITUTION_TYPE_ALIASES: Record<string, string> = {
  university: 'University',
  college: 'University',
  academic: 'University',
  academia: 'University',
  'research institute': 'Research Institute',
  'research institution': 'Research Institute',
  institute: 'Research Institute',
  hospital: 'Hospital',
  clinic: 'Hospital',
  ngo: 'NGO',
  nonprofit: 'Non-Profit',
  'non profit': 'Non-Profit',
  'non-profit': 'Non-Profit',
  corporate: 'Corporate',
  company: 'Corporate',
  startup: 'Startup',
  'start up': 'Startup',
  individual: 'Individual',
  consortium: 'Consortium',
  government: 'Government Agency',
  'government agency': 'Government Agency',
};

export const CAREER_STAGE_ALIASES: Record<string, string> = {
  undergraduate: 'Undergraduate',
  bachelor: 'Undergraduate',
  bachelors: 'Undergraduate',
  masters: 'Masters',
  master: 'Masters',
  phd: 'PhD',
  doctoral: 'PhD',
  doctorate: 'PhD',
  postdoc: 'Postdoctoral',
  postdoctoral: 'Postdoctoral',
  'early career': 'Early Career Researcher',
  'early career researcher': 'Early Career Researcher',
  'early career faculty': 'Early Career Faculty',
  'mid career': 'Mid Career Researcher',
  'mid career researcher': 'Mid Career Researcher',
  senior: 'Senior Researcher',
  'senior researcher': 'Senior Researcher',
  pi: 'Principal Investigator',
  'principal investigator': 'Principal Investigator',
};

export const SPONSOR_TYPE_ALIASES: Record<string, string> = {
  government: 'Government',
  gov: 'Government',
  foundation: 'Foundation',
  corporate: 'Corporate',
  company: 'Corporate',
  multilateral: 'Multilateral',
  university: 'University',
  ngo: 'NGO',
  philanthropic: 'Philanthropic',
  philanthropy: 'Philanthropic',
};

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 20;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
export const CHAT_RATE_LIMIT_MAX_REQUESTS = 30;
export const CHAT_MESSAGE_MAX_LENGTH = 2_000;
export const CHAT_INLINE_RESULT_LIMIT = 5;
export const CHAT_ORCHESTRATOR_MODEL = 'gemini-2.5-flash';
export const CHAT_NARRATIVE_MODEL = 'gemini-2.0-flash-lite';
export const CHAT_ORCHESTRATOR_HISTORY_LIMIT = 8;
export const CHAT_ORCHESTRATOR_RESULTS_LIMIT = 5;
