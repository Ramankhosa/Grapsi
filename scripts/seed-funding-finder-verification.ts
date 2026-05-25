import crypto from 'crypto';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config({ path: '.env', override: false });
dotenv.config({ path: '.env.local', override: true });

type SeedFundingCallInput = {
  agency_name: string;
  scheme_title: string;
  description: string;
  geography_scope: string;
  eligible_countries: string[];
  eligible_regions: string[];
  host_countries: string[];
  funder_country: string;
  funding_kinds: string[];
  institution_types: string[];
  career_stages: string[];
  disciplines: string[];
  sponsor_type: string;
  application_languages: string[];
  citizenship_requirements: string[];
  residency_requirements: string[];
  amount_min: number | null;
  amount_max: number | null;
  currency: string;
  close_date: Date | null;
  expiration_date: Date | null;
  is_rolling: boolean;
  eligibility_text: string;
  expected_deliverables_text: string;
  project_duration_min_months: number | null;
  project_duration_max_months: number | null;
  project_duration_text: string;
  official_urls: string[];
  contact_info: string;
  templateComplexity: 'simple' | 'complex';
  budgetProfile: 'simple' | 'multi_year' | 'capped' | 'milestone';
};

type SeedProfileInput = {
  email: string;
  name: string;
  countryOfResidence: string;
  citizenshipCountries: string[];
  institutionName: string;
  institutionType: string;
  department: string;
  careerStage: string;
  yearsOfExperience: number;
  researchSummary: string;
  researchAreas: string[];
  keywords: string[];
  savedArea: {
    label: string;
    researchArea: string;
    keywords: string[];
    disciplines: string[];
  };
  publication: {
    title: string;
    year: number;
    venue: string;
    doi: string;
    abstract: string;
    tags: string[];
  };
};

export const FINDER_VERIFICATION_TENANT_ATI = 'finder-verification-tenant';
export const FINDER_VERIFICATION_USER_EMAIL = 'finder.verification@grapsi.local';
export const FINDER_VERIFICATION_USER_NAME = 'Finder Verification User';
export const FINDER_VERIFICATION_SOURCE = 'grantmentor-finder-verification-seed';
export const FINDER_EXPECTED_PRIMARY_TITLE = 'AI For Clinical Imaging Fellowship';
export const FINDER_EXPECTED_HIDDEN_TITLE = 'Hidden Internal Review Call';
export const FINDER_PROFILE_EMAILS = [
  FINDER_VERIFICATION_USER_EMAIL,
  'finder.climate@grapsi.local',
  'finder.quantum@grapsi.local',
  'finder.publichealth@grapsi.local',
  'finder.policy@grapsi.local',
];

const EMBEDDING_DIMENSIONS = 768;

const commonDefaults = {
  application_languages: ['English'],
  citizenship_requirements: [],
  residency_requirements: [],
  currency: 'USD',
  is_rolling: false,
  templateComplexity: 'simple' as const,
  budgetProfile: 'simple' as const,
};

function makeCall(input: Partial<SeedFundingCallInput> & Pick<SeedFundingCallInput, 'agency_name' | 'scheme_title' | 'description' | 'disciplines'>): SeedFundingCallInput {
  return {
    geography_scope: 'International',
    eligible_countries: ['India', 'United States', 'United Kingdom'],
    eligible_regions: ['Asia', 'North America', 'Europe'],
    host_countries: ['India', 'United States', 'United Kingdom'],
    funder_country: 'United States',
    funding_kinds: ['Research Grant'],
    institution_types: ['University', 'Research Institute'],
    career_stages: ['Early Career Researcher', 'Principal Investigator'],
    sponsor_type: 'Foundation',
    amount_min: 25000,
    amount_max: 150000,
    close_date: new Date('2026-11-30'),
    expiration_date: new Date('2026-11-30'),
    eligibility_text: 'Open to eligible researchers with institutional endorsement.',
    expected_deliverables_text: 'Final report, open dissemination output, and impact summary.',
    project_duration_min_months: 12,
    project_duration_max_months: 24,
    project_duration_text: '12 to 24 months',
    official_urls: [`https://example.org/${slugify(input.scheme_title || 'funding-call')}`],
    contact_info: 'funding@example.org',
    ...commonDefaults,
    ...input,
  };
}

const sampleFundingCalls: SeedFundingCallInput[] = [
  makeCall({
    agency_name: 'Global Health Innovation Trust',
    scheme_title: FINDER_EXPECTED_PRIMARY_TITLE,
    description:
      'Supports early-career researchers developing explainable artificial intelligence tools for medical imaging, diagnostics, and radiology decision support.',
    eligible_countries: ['India', 'United Kingdom', 'Germany', 'United States'],
    eligible_regions: ['Europe', 'Asia', 'North America'],
    host_countries: ['United Kingdom', 'Germany', 'India'],
    funder_country: 'United Kingdom',
    funding_kinds: ['Fellowship'],
    institution_types: ['University', 'Hospital', 'Research Institute'],
    career_stages: ['Postdoctoral', 'Early Career Researcher', 'Early Career Faculty'],
    disciplines: ['Artificial Intelligence', 'Medical Imaging', 'Healthcare'],
    sponsor_type: 'Foundation',
    amount_min: 50000,
    amount_max: 120000,
    currency: 'GBP',
    close_date: new Date('2026-09-30'),
    expiration_date: new Date('2026-09-30'),
    eligibility_text: 'Open to early-career researchers affiliated with universities, hospitals, or research institutes.',
    expected_deliverables_text: 'Prototype model card, validation report, responsible AI plan, and clinical translation brief.',
    project_duration_min_months: 18,
    project_duration_max_months: 24,
    project_duration_text: '18 to 24 months',
    contact_info: 'imaging@example.org',
    templateComplexity: 'complex',
    budgetProfile: 'multi_year',
  }),
  makeCall({
    agency_name: 'South Asia Climate Fund',
    scheme_title: 'Climate Resilient Agriculture Research Grant',
    description:
      'Supports interdisciplinary agricultural research on climate adaptation, resilient farming systems, food security, and water-efficient cultivation.',
    geography_scope: 'Regional',
    eligible_countries: ['India', 'Bangladesh', 'Nepal', 'Sri Lanka'],
    eligible_regions: ['South Asia'],
    host_countries: ['India'],
    funder_country: 'India',
    funding_kinds: ['Research Grant', 'Seed Grant'],
    institution_types: ['University', 'Research Institute', 'NGO'],
    career_stages: ['Early Career Researcher', 'Mid Career Researcher', 'Principal Investigator'],
    disciplines: ['Agriculture', 'Climate Change', 'Sustainability', 'Food Systems'],
    sponsor_type: 'Government',
    close_date: new Date('2026-11-15'),
    expiration_date: new Date('2026-11-15'),
    eligibility_text: 'Open to universities, research institutes, and NGOs based in South Asia.',
    expected_deliverables_text: 'Field trial protocol, farmer engagement plan, adaptation indicators, and policy brief.',
    templateComplexity: 'complex',
    budgetProfile: 'capped',
  }),
  makeCall({
    agency_name: 'European Academic Mobility Network',
    scheme_title: 'Conference And Travel Grant For Early Researchers',
    description:
      'Funds travel, conference attendance, and short academic visits for doctoral candidates and early-career researchers.',
    eligible_countries: ['India', 'Germany', 'France', 'Italy', 'Spain'],
    eligible_regions: ['Europe', 'Asia'],
    host_countries: ['Germany', 'France', 'Italy', 'Spain'],
    funder_country: 'Germany',
    funding_kinds: ['Travel Grant', 'Mobility Grant', 'Conference Grant'],
    career_stages: ['PhD', 'Postdoctoral', 'Early Career Researcher'],
    disciplines: ['Artificial Intelligence', 'Climate Change', 'Materials Science', 'Public Health'],
    sponsor_type: 'University',
    amount_min: 1000,
    amount_max: 8000,
    currency: 'EUR',
    close_date: new Date('2026-12-20'),
    expiration_date: new Date('2026-12-20'),
    eligibility_text: 'Open to PhD scholars, postdocs, and early-career researchers with institutional support.',
    expected_deliverables_text: 'Conference acceptance proof, travel plan, and post-visit knowledge sharing note.',
  }),
  makeCall({
    agency_name: 'Digital Research Infrastructure Mission',
    scheme_title: 'University AI Infrastructure Grant',
    description:
      'Supports universities and research institutes building AI-focused shared infrastructure, including compute clusters and shared data environments.',
    geography_scope: 'National',
    eligible_countries: ['India'],
    eligible_regions: ['Asia'],
    host_countries: ['India'],
    funder_country: 'India',
    funding_kinds: ['Infrastructure', 'Equipment Grant'],
    career_stages: ['Principal Investigator', 'Senior Researcher'],
    disciplines: ['Artificial Intelligence', 'Data Science', 'Computer Science'],
    sponsor_type: 'Government',
    amount_min: 200000,
    amount_max: 750000,
    close_date: new Date('2027-01-31'),
    expiration_date: new Date('2027-01-31'),
    eligibility_text: 'Open to Indian universities and research institutes proposing shared AI research infrastructure.',
    expected_deliverables_text: 'Shared facility plan, governance model, training schedule, and utilization metrics.',
    project_duration_min_months: 24,
    project_duration_max_months: 36,
    project_duration_text: '24 to 36 months',
    templateComplexity: 'complex',
    budgetProfile: 'capped',
  }),
  makeCall({
    agency_name: 'Global Public Health Foundation',
    scheme_title: 'Public Health Innovation Seed Grant',
    description:
      'Seed grants for public health innovation, implementation research, and digital health pilots with measurable community impact.',
    geography_scope: 'Global',
    eligible_countries: ['India', 'Kenya', 'South Africa', 'Brazil', 'United States'],
    eligible_regions: ['Africa', 'Asia', 'South America', 'North America'],
    host_countries: ['India', 'Kenya', 'South Africa', 'Brazil'],
    funder_country: 'United States',
    funding_kinds: ['Seed Grant', 'Research Grant'],
    institution_types: ['University', 'NGO', 'Non-Profit', 'Hospital'],
    career_stages: ['Early Career Researcher', 'Mid Career Researcher', 'Principal Investigator'],
    disciplines: ['Public Health', 'Healthcare', 'Artificial Intelligence', 'Implementation Research'],
    sponsor_type: 'Foundation',
    amount_min: 20000,
    amount_max: 100000,
    close_date: new Date('2026-10-10'),
    expiration_date: new Date('2026-10-10'),
    eligibility_text: 'Open to universities, hospitals, NGOs, and non-profits working on public health innovation.',
    expected_deliverables_text: 'Pilot implementation report, equity indicators, and scale-up recommendation.',
    templateComplexity: 'complex',
    budgetProfile: 'milestone',
  }),
  makeCall({
    agency_name: 'Open Science Mobility Council',
    scheme_title: 'Rolling Research Collaboration Mobility Grant',
    description:
      'Rolling grant support for research collaboration visits, workshops, and short-term cross-institutional exchanges.',
    eligible_countries: ['India', 'Germany', 'Singapore', 'Australia', 'Canada'],
    eligible_regions: ['Asia', 'Europe', 'Oceania', 'North America'],
    host_countries: ['Germany', 'Singapore', 'Australia', 'Canada'],
    funder_country: 'Canada',
    funding_kinds: ['Mobility Grant', 'Travel Grant'],
    institution_types: ['University', 'Research Institute', 'Consortium'],
    career_stages: ['Early Career Faculty', 'Mid Career Researcher', 'Senior Researcher', 'Principal Investigator'],
    disciplines: ['Artificial Intelligence', 'Climate Change', 'Public Health', 'Materials Science'],
    sponsor_type: 'Multilateral',
    amount_min: 5000,
    amount_max: 25000,
    close_date: null,
    expiration_date: null,
    is_rolling: true,
    eligibility_text: 'Open to collaborative academic teams and consortia planning short-term mobility or workshops.',
    expected_deliverables_text: 'Mobility agenda, collaboration output, and workshop summary.',
  }),
  makeCall({
    agency_name: 'Frontier Materials Council',
    scheme_title: 'Quantum Materials Equipment Grant',
    description:
      'Equipment support for labs developing quantum materials, cryogenic characterization, nanoscale fabrication, and advanced spectroscopy.',
    eligible_countries: ['Germany', 'India', 'United States', 'Japan'],
    host_countries: ['Germany', 'Japan', 'United States'],
    funder_country: 'Germany',
    funding_kinds: ['Equipment Grant', 'Infrastructure'],
    institution_types: ['University', 'Research Institute'],
    career_stages: ['Postdoctoral', 'Principal Investigator', 'Senior Researcher'],
    disciplines: ['Materials Science', 'Physics', 'Quantum Technology'],
    sponsor_type: 'Government',
    amount_min: 100000,
    amount_max: 600000,
    currency: 'EUR',
    close_date: new Date('2026-08-15'),
    expiration_date: new Date('2026-08-15'),
    eligibility_text: 'Requires a host laboratory with technical staff and equipment maintenance capacity.',
    expected_deliverables_text: 'Equipment commissioning report, access policy, and first-year user metrics.',
    project_duration_min_months: 24,
    project_duration_max_months: 36,
    project_duration_text: '24 to 36 months',
    templateComplexity: 'complex',
    budgetProfile: 'capped',
  }),
  makeCall({
    agency_name: 'Learning Futures Foundation',
    scheme_title: 'Rural Education Technology Pilot Grant',
    description:
      'Supports school and university partnerships testing education technology, adaptive learning, and teacher support in rural communities.',
    geography_scope: 'Global',
    eligible_countries: ['India', 'Kenya', 'Ghana', 'Philippines'],
    eligible_regions: ['Asia', 'Africa'],
    host_countries: ['India', 'Kenya', 'Ghana', 'Philippines'],
    funding_kinds: ['Pilot Grant', 'Seed Grant'],
    institution_types: ['University', 'NGO', 'School', 'Non-Profit'],
    career_stages: ['Early Career Researcher', 'Mid Career Researcher', 'Principal Investigator'],
    disciplines: ['Education', 'Digital Learning', 'Social Innovation'],
    sponsor_type: 'Foundation',
    amount_min: 15000,
    amount_max: 75000,
    close_date: new Date('2026-07-30'),
    expiration_date: new Date('2026-07-30'),
    eligibility_text: 'Requires a rural implementation partner and safeguarding plan.',
    expected_deliverables_text: 'Pilot design, teacher training plan, learning outcomes dashboard, and community feedback report.',
    templateComplexity: 'complex',
    budgetProfile: 'milestone',
  }),
  makeCall({
    agency_name: 'Clean Energy Demonstrators Agency',
    scheme_title: 'Clean Energy Storage Demonstrator',
    description:
      'Funds applied research teams validating clean energy storage prototypes, grid integration methods, and lifecycle assessment.',
    eligible_countries: ['India', 'United States', 'Germany', 'Australia'],
    host_countries: ['India', 'United States', 'Australia'],
    funder_country: 'Australia',
    funding_kinds: ['Demonstrator Grant', 'Research Grant'],
    institution_types: ['University', 'Research Institute', 'Company', 'Consortium'],
    career_stages: ['Principal Investigator', 'Senior Researcher'],
    disciplines: ['Clean Energy', 'Engineering', 'Sustainability'],
    sponsor_type: 'Government',
    amount_min: 250000,
    amount_max: 1000000,
    close_date: new Date('2027-02-15'),
    expiration_date: new Date('2027-02-15'),
    eligibility_text: 'Consortium applications must include a test site and safety management plan.',
    expected_deliverables_text: 'Prototype validation data, safety report, lifecycle assessment, and deployment roadmap.',
    project_duration_min_months: 24,
    project_duration_max_months: 48,
    project_duration_text: '24 to 48 months',
    templateComplexity: 'complex',
    budgetProfile: 'multi_year',
  }),
  makeCall({
    agency_name: 'Women In STEM Advancement Fund',
    scheme_title: 'Women In STEM Leadership Fellowship',
    description:
      'Fellowship supporting women researchers building independent programs, mentorship networks, and translational STEM leadership.',
    eligible_countries: ['India', 'United States', 'Canada', 'United Kingdom'],
    host_countries: ['India', 'United States', 'Canada', 'United Kingdom'],
    funding_kinds: ['Fellowship'],
    institution_types: ['University', 'Research Institute'],
    career_stages: ['Early Career Faculty', 'Mid Career Researcher'],
    disciplines: ['Engineering', 'Artificial Intelligence', 'Life Sciences', 'Materials Science'],
    sponsor_type: 'Foundation',
    amount_min: 60000,
    amount_max: 180000,
    close_date: new Date('2026-09-05'),
    expiration_date: new Date('2026-09-05'),
    eligibility_text: 'Applicants must identify as women and hold an eligible STEM research appointment.',
    expected_deliverables_text: 'Research plan, mentoring plan, leadership activities, and annual progress report.',
  }),
  makeCall({
    agency_name: 'Global Biodiversity Data Initiative',
    scheme_title: 'Biodiversity Genomics Fieldwork Grant',
    description:
      'Supports biodiversity genomics, field sampling, conservation informatics, and equitable data sharing for threatened ecosystems.',
    geography_scope: 'Regional',
    eligible_countries: ['India', 'Brazil', 'South Africa', 'Indonesia'],
    eligible_regions: ['Asia', 'Africa', 'South America'],
    host_countries: ['India', 'Brazil', 'South Africa', 'Indonesia'],
    funder_country: 'Brazil',
    funding_kinds: ['Fieldwork Grant', 'Research Grant'],
    institution_types: ['University', 'Research Institute', 'NGO'],
    career_stages: ['PhD', 'Postdoctoral', 'Principal Investigator'],
    disciplines: ['Biodiversity', 'Genomics', 'Conservation Science'],
    sponsor_type: 'Multilateral',
    amount_min: 30000,
    amount_max: 160000,
    close_date: new Date('2026-12-01'),
    expiration_date: new Date('2026-12-01'),
    eligibility_text: 'Requires permits, local partner engagement, and benefit-sharing commitments.',
    expected_deliverables_text: 'Sampling plan, genomic dataset, conservation metadata, and local capacity-building report.',
    templateComplexity: 'complex',
    budgetProfile: 'capped',
  }),
  makeCall({
    agency_name: 'Responsible Technology Policy Lab',
    scheme_title: 'Responsible AI Policy Small Grant',
    description:
      'Small grants for responsible AI policy, governance, safety evaluation, privacy, and public-interest technology research.',
    eligible_countries: ['India', 'United States', 'United Kingdom', 'Singapore'],
    host_countries: ['India', 'United States', 'United Kingdom', 'Singapore'],
    funding_kinds: ['Small Grant', 'Policy Grant'],
    institution_types: ['University', 'Think Tank', 'NGO', 'Research Institute'],
    career_stages: ['PhD', 'Early Career Researcher', 'Mid Career Researcher'],
    disciplines: ['Artificial Intelligence', 'Public Policy', 'Law', 'Ethics'],
    sponsor_type: 'Foundation',
    amount_min: 10000,
    amount_max: 50000,
    close_date: new Date('2026-10-25'),
    expiration_date: new Date('2026-10-25'),
    eligibility_text: 'Open to researchers and policy organizations with a public-interest dissemination plan.',
    expected_deliverables_text: 'Policy memo, stakeholder workshop, and public summary.',
  }),
  makeCall({
    agency_name: 'Advanced Manufacturing Translation Board',
    scheme_title: 'Advanced Manufacturing Translational Award',
    description:
      'Translational funding for manufacturing automation, robotics, process optimization, and industry-linked validation.',
    geography_scope: 'National',
    eligible_countries: ['India'],
    eligible_regions: ['Asia'],
    host_countries: ['India'],
    funder_country: 'India',
    funding_kinds: ['Translational Grant', 'Industry Partnership'],
    institution_types: ['University', 'Research Institute', 'Company', 'Consortium'],
    career_stages: ['Principal Investigator', 'Senior Researcher'],
    disciplines: ['Manufacturing', 'Robotics', 'Engineering'],
    sponsor_type: 'Government',
    amount_min: 150000,
    amount_max: 500000,
    close_date: new Date('2027-03-01'),
    expiration_date: new Date('2027-03-01'),
    eligibility_text: 'Requires an industry partner letter and technology readiness baseline.',
    expected_deliverables_text: 'Prototype, validation metrics, partner adoption plan, and IP management note.',
    templateComplexity: 'complex',
    budgetProfile: 'milestone',
  }),
  makeCall({
    agency_name: 'Open Neuroscience Data Challenge',
    scheme_title: 'Neuroscience Data Reuse Challenge',
    description:
      'Challenge grants for computational neuroscience, reproducible analysis, and reuse of open neural or behavioral datasets.',
    eligible_countries: ['India', 'United States', 'Germany', 'Canada'],
    host_countries: ['India', 'United States', 'Germany', 'Canada'],
    funding_kinds: ['Challenge Grant', 'Research Grant'],
    institution_types: ['University', 'Research Institute'],
    career_stages: ['PhD', 'Postdoctoral', 'Early Career Researcher'],
    disciplines: ['Neuroscience', 'Data Science', 'Artificial Intelligence'],
    sponsor_type: 'Foundation',
    amount_min: 20000,
    amount_max: 90000,
    close_date: new Date('2026-08-28'),
    expiration_date: new Date('2026-08-28'),
    eligibility_text: 'Applicants must use at least one open dataset and publish reproducible workflows.',
    expected_deliverables_text: 'Reusable code repository, data citation statement, and analysis report.',
  }),
  makeCall({
    agency_name: 'Social Innovation Budget Lab',
    scheme_title: 'Social Innovation Budget Challenge Grant',
    description:
      'Supports teams testing costed social innovation models with rigorous budget justification, community implementation, and sustainability planning.',
    geography_scope: 'Global',
    eligible_countries: ['India', 'Kenya', 'United States', 'Brazil'],
    eligible_regions: ['Asia', 'Africa', 'North America', 'South America'],
    host_countries: ['India', 'Kenya', 'Brazil'],
    funding_kinds: ['Challenge Grant', 'Pilot Grant'],
    institution_types: ['University', 'NGO', 'Non-Profit', 'Consortium'],
    career_stages: ['Early Career Researcher', 'Mid Career Researcher', 'Principal Investigator'],
    disciplines: ['Social Innovation', 'Public Policy', 'Public Health', 'Education'],
    sponsor_type: 'Foundation',
    amount_min: 50000,
    amount_max: 250000,
    close_date: new Date('2027-01-10'),
    expiration_date: new Date('2027-01-10'),
    eligibility_text: 'Requires community partner governance, co-funding explanation, and beneficiary protection plan.',
    expected_deliverables_text: 'Costed implementation model, budget variance tracker, impact evaluation, and scale-up plan.',
    templateComplexity: 'complex',
    budgetProfile: 'multi_year',
  }),
];

const profileSeeds: SeedProfileInput[] = [
  {
    email: FINDER_VERIFICATION_USER_EMAIL,
    name: FINDER_VERIFICATION_USER_NAME,
    countryOfResidence: 'India',
    citizenshipCountries: ['India'],
    institutionName: 'Verification University',
    institutionType: 'University',
    department: 'Biomedical AI',
    careerStage: 'Early Career Researcher',
    yearsOfExperience: 4,
    researchSummary: 'Working on explainable AI, medical imaging, public health, and translational diagnostics.',
    researchAreas: ['Artificial Intelligence', 'Medical Imaging', 'Public Health'],
    keywords: ['AI', 'medical imaging', 'radiology', 'diagnostics'],
    savedArea: {
      label: 'Medical Imaging AI',
      researchArea: 'Artificial intelligence for medical imaging and radiology',
      keywords: ['AI', 'medical imaging', 'radiology', 'diagnostics'],
      disciplines: ['Artificial Intelligence', 'Medical Imaging', 'Healthcare'],
    },
    publication: {
      title: 'Federated learning for medical imaging diagnosis',
      year: 2024,
      venue: 'Journal of AI Health',
      doi: '10.1000/grapsi-medical-imaging',
      abstract: 'Privacy-preserving radiology diagnostics using federated learning and explainable medical imaging models.',
      tags: ['my-publication', 'medical imaging', 'federated learning'],
    },
  },
  {
    email: 'finder.climate@grapsi.local',
    name: 'Climate Profile User',
    countryOfResidence: 'India',
    citizenshipCountries: ['India'],
    institutionName: 'South Asia Agritech Institute',
    institutionType: 'Research Institute',
    department: 'Climate Adaptation',
    careerStage: 'Principal Investigator',
    yearsOfExperience: 12,
    researchSummary: 'Climate-resilient agriculture, water-efficient farming, and food systems policy.',
    researchAreas: ['Climate Change', 'Agriculture', 'Food Systems'],
    keywords: ['climate adaptation', 'resilient farming', 'water efficiency'],
    savedArea: {
      label: 'Climate Resilient Agriculture',
      researchArea: 'Climate adaptation and resilient farming systems for food security',
      keywords: ['climate adaptation', 'agriculture', 'food security'],
      disciplines: ['Agriculture', 'Climate Change', 'Sustainability'],
    },
    publication: {
      title: 'Water efficient cultivation under climate stress',
      year: 2023,
      venue: 'Agricultural Systems',
      doi: '10.1000/grapsi-climate-agri',
      abstract: 'Field evidence on resilient farming systems, irrigation efficiency, and climate adaptation.',
      tags: ['my-publication', 'climate adaptation', 'agriculture'],
    },
  },
  {
    email: 'finder.quantum@grapsi.local',
    name: 'Quantum Profile User',
    countryOfResidence: 'Germany',
    citizenshipCountries: ['India'],
    institutionName: 'European Materials Institute',
    institutionType: 'Research Institute',
    department: 'Quantum Materials',
    careerStage: 'Postdoctoral',
    yearsOfExperience: 3,
    researchSummary: 'Quantum materials, cryogenic spectroscopy, and nanoscale fabrication.',
    researchAreas: ['Materials Science', 'Physics', 'Quantum Technology'],
    keywords: ['quantum materials', 'spectroscopy', 'cryogenic'],
    savedArea: {
      label: 'Quantum Materials',
      researchArea: 'Equipment-enabled research on quantum materials and nanoscale characterization',
      keywords: ['quantum materials', 'spectroscopy', 'nanofabrication'],
      disciplines: ['Materials Science', 'Physics', 'Quantum Technology'],
    },
    publication: {
      title: 'Cryogenic spectroscopy of two dimensional quantum materials',
      year: 2025,
      venue: 'Advanced Quantum Materials',
      doi: '10.1000/grapsi-quantum-materials',
      abstract: 'Nanoscale characterization and cryogenic spectroscopy methods for quantum material systems.',
      tags: ['my-publication', 'quantum materials', 'spectroscopy'],
    },
  },
  {
    email: 'finder.publichealth@grapsi.local',
    name: 'Public Health Profile User',
    countryOfResidence: 'Kenya',
    citizenshipCountries: ['Kenya'],
    institutionName: 'Community Health Implementation Network',
    institutionType: 'NGO',
    department: 'Digital Health',
    careerStage: 'Mid Career Researcher',
    yearsOfExperience: 8,
    researchSummary: 'Digital health pilots, implementation research, and equitable public health delivery.',
    researchAreas: ['Public Health', 'Implementation Research', 'Healthcare'],
    keywords: ['digital health', 'implementation', 'community health'],
    savedArea: {
      label: 'Public Health Implementation',
      researchArea: 'Implementation research for digital health and community health pilots',
      keywords: ['public health', 'digital health', 'implementation research'],
      disciplines: ['Public Health', 'Healthcare', 'Implementation Research'],
    },
    publication: {
      title: 'Community digital health implementation in primary care',
      year: 2024,
      venue: 'Global Implementation Science',
      doi: '10.1000/grapsi-public-health',
      abstract: 'Digital health pilot methods for community public health implementation and equity metrics.',
      tags: ['my-publication', 'public health', 'digital health'],
    },
  },
  {
    email: 'finder.policy@grapsi.local',
    name: 'Policy Profile User',
    countryOfResidence: 'United States',
    citizenshipCountries: ['United States'],
    institutionName: 'Public Interest Technology Lab',
    institutionType: 'Think Tank',
    department: 'AI Governance',
    careerStage: 'PhD',
    yearsOfExperience: 2,
    researchSummary: 'Responsible AI policy, privacy, public-interest technology, and governance.',
    researchAreas: ['Artificial Intelligence', 'Public Policy', 'Ethics'],
    keywords: ['responsible AI', 'privacy', 'AI governance'],
    savedArea: {
      label: 'Responsible AI Policy',
      researchArea: 'Responsible AI governance, safety evaluation, and public-interest technology policy',
      keywords: ['responsible AI', 'AI policy', 'governance'],
      disciplines: ['Artificial Intelligence', 'Public Policy', 'Ethics'],
    },
    publication: {
      title: 'Public interest evaluation of responsible AI governance',
      year: 2025,
      venue: 'Technology Policy Review',
      doi: '10.1000/grapsi-policy-ai',
      abstract: 'Responsible AI governance methods for privacy, policy evaluation, and public-interest safeguards.',
      tags: ['my-publication', 'responsible AI', 'policy'],
    },
  },
];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function stableHash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildDummyEmbedding(seed: string, dimensions = EMBEDDING_DIMENSIONS) {
  const values: number[] = [];
  let counter = 0;
  while (values.length < dimensions) {
    const bytes = crypto.createHash('sha256').update(`${seed}:${counter}`).digest();
    for (const byte of bytes) {
      values.push(byte / 127.5 - 1);
      if (values.length === dimensions) break;
    }
    counter += 1;
  }

  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => Number((value / magnitude).toFixed(6)));
}

function buildFundingDocument(call: SeedFundingCallInput) {
  return [
    `title: ${call.scheme_title}`,
    `agency: ${call.agency_name}`,
    `description: ${call.description}`,
    `disciplines: ${call.disciplines.join(', ')}`,
    `funding types: ${call.funding_kinds.join(', ')}`,
    `institution types: ${call.institution_types.join(', ')}`,
    `career stages: ${call.career_stages.join(', ')}`,
    `eligible countries: ${call.eligible_countries.join(', ')}`,
    `eligible regions: ${call.eligible_regions.join(', ')}`,
    `host countries: ${call.host_countries.join(', ')}`,
    `geography scope: ${call.geography_scope}`,
    `funder country: ${call.funder_country}`,
    `eligibility: ${call.eligibility_text}`,
    `duration: ${call.project_duration_text}`,
    `deliverables: ${call.expected_deliverables_text}`,
    `budget: ${call.currency} ${call.amount_min ?? 'open'} to ${call.amount_max ?? 'open'}`,
  ].join('\n');
}

function anchor(assetId: string, section: string, quote: string) {
  return [{ asset_id: assetId, section, quote, confidence: 0.92 }];
}

function guidelineAnchor(fieldKey: string, quote: string) {
  return [{ sourceType: 'field', fieldKey, quote, confidence: 0.92 }];
}

function templateItem(assetId: string, key: string, label: string, templateIntent: string, guidance: string, wordLimit = 500) {
  return {
    key,
    label,
    type: 'section',
    workflowMode: 'app_draft',
    required: true,
    repeatable: false,
    wordLimit,
    guidance,
    guidanceText: guidance,
    templateIntent,
    templateIntentConfidence: 0.9,
    requiredFacts: ['Applicant fit', 'Specific method', 'Measurable output'],
    reviewerGoal: `Assess whether the proposal gives a credible ${label.toLowerCase()}.`,
    forbiddenMoves: ['Do not use generic claims without call-specific evidence.'],
    draftingVsSubmission: 'both',
    supportLevel: 'full',
    confidence: 0.9,
    sourceAnchors: anchor(assetId, label, guidance),
  };
}

function buildGrantTemplate(call: SeedFundingCallInput, assetId: string) {
  const baseSections = [
    templateItem(assetId, 'project_summary', 'Project Summary', 'summary', `Summarize the proposed work and fit to ${call.scheme_title}.`, 350),
    templateItem(assetId, 'objectives', 'Objectives', 'objectives', 'List clear objectives, milestones, and measurable success criteria.', 450),
    templateItem(assetId, 'methodology', 'Methodology and Work Plan', 'methodology', 'Describe methods, work packages, risks, and validation plan.', 900),
    templateItem(assetId, 'impact', 'Expected Impact and Deliverables', 'impact_outcomes', call.expected_deliverables_text, 650),
  ];

  const complexSections = call.templateComplexity === 'complex'
    ? [
        templateItem(assetId, 'team_capacity', 'Team Capacity and Governance', 'team', 'Explain roles, partner governance, and institutional capacity.', 500),
        templateItem(assetId, 'ethics_safeguards', 'Ethics, Risk, and Safeguards', 'risk', 'Address ethics, risk controls, safeguarding, data management, and responsible dissemination.', 550),
      ]
    : [];

  const budgetCategories = {
    simple: [
      { key: 'personnel', label: 'Personnel', cap: null, notes: 'Named staff or effort-based costs only.', sourceAnchors: anchor(assetId, 'Budget', 'Personnel') },
      { key: 'travel', label: 'Travel', cap: 'Reasonable economy travel only', notes: 'Conference, field visit, or collaboration travel.', sourceAnchors: anchor(assetId, 'Budget', 'Travel') },
      { key: 'consumables', label: 'Consumables', cap: null, notes: 'Project-specific consumables.', sourceAnchors: anchor(assetId, 'Budget', 'Consumables') },
    ],
    multi_year: [
      { key: 'personnel', label: 'Personnel by year', cap: 'Up to 55% of total request', notes: 'Split by year and role.', sourceAnchors: anchor(assetId, 'Budget', 'Personnel by year') },
      { key: 'equipment', label: 'Equipment and compute', cap: 'Up to 30% unless justified', notes: 'Include procurement and maintenance.', sourceAnchors: anchor(assetId, 'Budget', 'Equipment and compute') },
      { key: 'participant_partner_costs', label: 'Participant and partner costs', cap: 'Up to 20%', notes: 'Community, clinical, or partner implementation costs.', sourceAnchors: anchor(assetId, 'Budget', 'Participant and partner costs') },
      { key: 'indirect_costs', label: 'Indirect costs', cap: 'Maximum 10%', notes: 'Calculate after excluding equipment over the sponsor threshold.', sourceAnchors: anchor(assetId, 'Budget', 'Indirect costs') },
    ],
    capped: [
      { key: 'equipment', label: 'Equipment', cap: 'Up to 40% of direct costs', notes: 'No general-purpose laptops without justification.', sourceAnchors: anchor(assetId, 'Budget', 'Equipment') },
      { key: 'fieldwork', label: 'Fieldwork or facility access', cap: 'Up to 25%', notes: 'Must be tied to milestones.', sourceAnchors: anchor(assetId, 'Budget', 'Fieldwork') },
      { key: 'personnel', label: 'Personnel', cap: 'Up to 45%', notes: 'Use role, effort, and duration.', sourceAnchors: anchor(assetId, 'Budget', 'Personnel') },
      { key: 'indirect_costs', label: 'Indirect costs', cap: 'Not above 8%', notes: 'Explain institutional basis.', sourceAnchors: anchor(assetId, 'Budget', 'Indirect costs') },
    ],
    milestone: [
      { key: 'milestone_1', label: 'Milestone 1 release', cap: '30% at kickoff', notes: 'Discovery, setup, baseline, ethics.', sourceAnchors: anchor(assetId, 'Budget', 'Milestone 1') },
      { key: 'milestone_2', label: 'Milestone 2 release', cap: '40% after pilot evidence', notes: 'Implementation or validation midpoint.', sourceAnchors: anchor(assetId, 'Budget', 'Milestone 2') },
      { key: 'milestone_3', label: 'Milestone 3 release', cap: '30% after final reporting', notes: 'Final deliverables and dissemination.', sourceAnchors: anchor(assetId, 'Budget', 'Milestone 3') },
    ],
  }[call.budgetProfile];

  return {
    questions: [
      {
        key: 'applicant_eligibility',
        label: 'Applicant Eligibility',
        type: 'field',
        workflowMode: 'team_manual',
        required: true,
        repeatable: false,
        guidance: call.eligibility_text,
        templateIntent: 'eligibility',
        supportLevel: 'manual',
        confidence: 0.94,
        sourceAnchors: anchor(assetId, 'Eligibility', call.eligibility_text),
      },
    ],
    sections: [...baseSections, ...complexSections],
    budget: {
      required: true,
      yearWise: call.budgetProfile === 'multi_year' || call.templateComplexity === 'complex',
      workflowMode: 'app_support',
      columns: [
        { key: 'budget_head', label: 'Budget Head', kind: 'category', required: true, sourceAnchors: anchor(assetId, 'Budget', 'Budget Head') },
        { key: 'year_1_amount', label: 'Year 1 Amount', kind: 'currency', required: call.templateComplexity === 'complex', sourceAnchors: anchor(assetId, 'Budget', 'Year 1 Amount') },
        { key: 'year_2_amount', label: 'Year 2 Amount', kind: 'currency', required: call.budgetProfile === 'multi_year', sourceAnchors: anchor(assetId, 'Budget', 'Year 2 Amount') },
        { key: 'justification', label: 'Justification', kind: 'text', required: true, sourceAnchors: anchor(assetId, 'Budget', 'Justification') },
      ],
      categories: budgetCategories,
      caps: {
        totalRequest: call.amount_max,
        currency: call.currency,
        indirectCosts: call.budgetProfile === 'simple' ? 'Use funder default' : 'Must not exceed stated cap',
      },
      justificationNotes:
        call.budgetProfile === 'simple'
          ? 'Provide one paragraph per budget head and tie every cost to an activity.'
          : 'Provide year-wise or milestone-wise justification, cap compliance, co-funding assumptions, and variance control.',
      supportLevel: call.templateComplexity === 'complex' ? 'full' : 'partial',
      confidence: 0.9,
      sourceAnchors: anchor(assetId, 'Budget', `${call.currency} ${call.amount_max ?? 'open'} maximum`),
    },
    attachments: [
      {
        key: 'institutional_endorsement',
        label: 'Institutional Endorsement Letter',
        type: 'attachment',
        workflowMode: 'team_manual',
        required: true,
        repeatable: false,
        guidance: 'Upload a signed letter confirming institutional support and submission authority.',
        templateIntent: 'attachments',
        supportLevel: 'manual',
        confidence: 0.86,
        sourceAnchors: anchor(assetId, 'Attachments', 'Institutional Endorsement Letter'),
      },
    ],
    evaluationCriteria: [
      {
        key: 'fit_and_feasibility',
        label: 'Fit and Feasibility',
        type: 'rubric',
        workflowMode: 'app_support',
        required: true,
        repeatable: false,
        guidance: 'Reviewers score fit to priorities, methodological feasibility, team capacity, and measurable impact.',
        templateIntent: 'evaluation',
        supportLevel: 'full',
        confidence: 0.88,
        sourceAnchors: anchor(assetId, 'Evaluation', 'fit to priorities, feasibility, team capacity, measurable impact'),
      },
    ],
    submissionRules: {
      notes: 'All sections must comply with word limits and budget caps before submission.',
      items: [
        {
          key: 'final_checks',
          label: 'Final Submission Checks',
          type: 'checklist',
          workflowMode: 'team_manual',
          required: true,
          repeatable: false,
          guidance: 'Confirm eligibility, budget cap, required attachments, and deadline.',
          templateIntent: 'submission',
          supportLevel: 'manual',
          confidence: 0.86,
          sourceAnchors: anchor(assetId, 'Submission', 'Confirm eligibility, budget cap, required attachments, and deadline'),
        },
      ],
      sourceAnchors: anchor(assetId, 'Submission', 'deadline and required attachments'),
    },
    sourceAnchors: anchor(assetId, 'Call', call.scheme_title),
    mergeConflicts: [],
  };
}

function rule(key: string, text: string, sourceBlock: string, fieldKey: string, quote: string, importance: 'high' | 'medium' | 'low' = 'high') {
  return {
    key,
    text,
    importance,
    ruleClass: sourceBlock === 'budgetRules' ? 'budget' : sourceBlock === 'durationRules' ? 'duration' : sourceBlock === 'avoid' ? 'avoid' : 'must_address',
    enforcementLevel: importance === 'high' ? 'hard' : 'soft',
    appliesTo: ['proposal', 'budget', 'eligibility'],
    draftingStage: ['prep', 'draft', 'review'],
    draftingVsSubmission: 'both',
    detectorHints: [quote],
    sourceBlock,
    rationale: 'Seeded guideline used to verify grounded recommendation and compliance behavior.',
    confidence: 0.91,
    sourceAnchors: guidelineAnchor(fieldKey, quote),
  };
}

function buildGuidelinePack(call: SeedFundingCallInput) {
  return {
    priorities: [
      rule('priority_fit', `Align the proposal explicitly with ${call.scheme_title} priorities and sponsor mission.`, 'priorities', 'scheme_title', call.scheme_title),
      rule('priority_disciplines', `Show a clear connection to ${call.disciplines.slice(0, 3).join(', ')}.`, 'priorities', 'disciplines', call.disciplines.join(', '), 'medium'),
    ],
    mustAddress: [
      rule('eligibility_fit', call.eligibility_text, 'mustAddress', 'eligibility_text', call.eligibility_text),
      rule('deliverables', call.expected_deliverables_text, 'mustAddress', 'expected_deliverables_text', call.expected_deliverables_text),
    ],
    avoid: [
      rule('avoid_generic_budget', 'Avoid generic budget lines that are not tied to work packages or milestones.', 'avoid', 'budget', 'generic budget lines'),
    ],
    evaluationCriteria: [
      rule('evaluation_feasibility', 'Reviewers will look for feasibility, evidence of team capacity, and measurable impact.', 'evaluationCriteria', 'evaluation', 'feasibility, team capacity, measurable impact'),
    ],
    budgetRules: [
      rule('budget_total_cap', `Do not exceed ${call.currency} ${call.amount_max ?? 'the stated funder cap'}.`, 'budgetRules', 'amount_max', `${call.amount_max ?? 'open'}`),
      rule('budget_justification', call.budgetProfile === 'simple'
        ? 'Every budget head must include a concise justification.'
        : 'Budget must show cap compliance, year-wise or milestone-wise phasing, and assumptions for indirect costs.',
      'budgetRules', 'budget', call.budgetProfile),
    ],
    durationRules: [
      rule('duration_window', `Project duration should fit ${call.project_duration_text}.`, 'durationRules', 'project_duration_text', call.project_duration_text),
    ],
    formatRules: [
      rule('format_word_limits', 'Respect section-level word limits and keep reviewer-facing claims evidence-backed.', 'formatRules', 'template', 'word limits', 'medium'),
    ],
    submissionRules: [
      rule('submission_deadline', call.is_rolling ? 'Rolling submissions are accepted, but applicants should verify the current intake window.' : `Submit before ${call.close_date?.toISOString().slice(0, 10)}.`, 'submissionRules', 'close_date', call.close_date?.toISOString() || 'rolling'),
    ],
    deliverableRules: [
      rule('deliverable_specificity', 'Deliverables must be named, measurable, and linked to the work plan.', 'deliverableRules', 'expected_deliverables_text', call.expected_deliverables_text),
    ],
    reviewerSignals: [
      rule('reviewer_signal_profile', 'Strong applications make eligibility, research fit, budget realism, and implementation readiness easy to verify.', 'reviewerSignals', 'reviewer', 'eligibility, research fit, budget realism'),
    ],
    sourceAnchors: guidelineAnchor('scheme_title', call.scheme_title),
  };
}

function buildTemplateSourceText(call: SeedFundingCallInput) {
  return [
    `Template source for ${call.scheme_title}`,
    `Complexity: ${call.templateComplexity}`,
    `Budget profile: ${call.budgetProfile}`,
    `Eligibility: ${call.eligibility_text}`,
    `Duration: ${call.project_duration_text}`,
    `Deliverables: ${call.expected_deliverables_text}`,
  ].join('\n');
}

async function ensureVerificationTenant(prisma: any) {
  return prisma.tenant.upsert({
    where: { atiId: FINDER_VERIFICATION_TENANT_ATI },
    update: {
      name: 'Finder Verification Tenant',
      type: 'ENTERPRISE',
      status: 'ACTIVE',
    },
    create: {
      name: 'Finder Verification Tenant',
      atiId: FINDER_VERIFICATION_TENANT_ATI,
      type: 'ENTERPRISE',
      status: 'ACTIVE',
    },
  });
}

async function ensureSeedUser(prisma: any, tenantId: string, profile: Pick<SeedProfileInput, 'email' | 'name'>) {
  return prisma.user.upsert({
    where: { email: profile.email },
    update: {
      tenantId,
      name: profile.name,
      roles: ['ANALYST'],
      status: 'ACTIVE',
      emailVerified: true,
      oauthProvider: 'GOOGLE',
      oauthProviderId: `finder-verification-${slugify(profile.email)}`,
    },
    create: {
      tenantId,
      email: profile.email,
      name: profile.name,
      roles: ['ANALYST'],
      status: 'ACTIVE',
      emailVerified: true,
      oauthProvider: 'GOOGLE',
      oauthProviderId: `finder-verification-${slugify(profile.email)}`,
    },
  });
}

async function upsertFundingCall(prisma: any, userId: string, call: SeedFundingCallInput) {
  const existing = await prisma.fundingCall.findFirst({
    where: {
      agency_name: call.agency_name,
      scheme_title: call.scheme_title,
      source: FINDER_VERIFICATION_SOURCE,
    },
    select: { id: true },
  });

  const fundingDocument = buildFundingDocument(call);
  const metadata = {
    seeded: true,
    seed_source: FINDER_VERIFICATION_SOURCE,
    embedding_status: 'dummy_generated',
    embedding_model: 'deterministic-test-vector',
    embedding_dimensions: EMBEDDING_DIMENSIONS,
    rag_document_hash: stableHash(fundingDocument),
    template_complexity: call.templateComplexity,
    budget_profile: call.budgetProfile,
    published_by: FINDER_VERIFICATION_USER_EMAIL,
    published_at: new Date().toISOString(),
    verification_seed: 'finder',
  };

  const data = {
    tenantId: null,
    visibility: 'GLOBAL_PUBLISHED',
    status: 'PUBLISHED',
    title: call.scheme_title,
    agencyName: call.agency_name,
    sourceUrl: call.official_urls[0] || null,
    sourceFingerprint: stableHash(call.official_urls[0] || call.scheme_title),
    sourceDomain: 'example.org',
    summary: call.description,
    sourceType: 'MANUAL',
    deadlineAt: call.close_date,
    publishedAt: new Date(),
    extractedFacts: {
      budgetProfile: call.budgetProfile,
      templateComplexity: call.templateComplexity,
      deliverables: call.expected_deliverables_text,
    },
    normalizedMetadata: {
      disciplines: call.disciplines,
      fundingKinds: call.funding_kinds,
      eligibility: call.eligibility_text,
      seed_source: FINDER_VERIFICATION_SOURCE,
    },
    input_type: null,
    catalog_status: 'PUBLISHED',
    template_status: 'approved',
    guideline_status: 'approved',
    eligible_countries: call.eligible_countries,
    eligible_regions: call.eligible_regions,
    host_countries: call.host_countries,
    funding_kinds: call.funding_kinds,
    institution_types: call.institution_types,
    career_stages: call.career_stages,
    citizenship_requirements: call.citizenship_requirements,
    residency_requirements: call.residency_requirements,
    application_languages: call.application_languages,
    disciplines: call.disciplines,
    agency_name: call.agency_name,
    scheme_title: call.scheme_title,
    description: call.description,
    open_date: null,
    close_date: call.close_date,
    is_rolling: call.is_rolling,
    geography_scope: call.geography_scope,
    funder_country: call.funder_country,
    amount_min: call.amount_min,
    amount_max: call.amount_max,
    currency: call.currency,
    project_duration_min_months: call.project_duration_min_months,
    project_duration_max_months: call.project_duration_max_months,
    project_duration_text: call.project_duration_text,
    eligibility_text: call.eligibility_text,
    expected_deliverables_text: call.expected_deliverables_text,
    official_urls: call.official_urls,
    contact_info: call.contact_info,
    sponsor_type: call.sponsor_type,
    source: FINDER_VERIFICATION_SOURCE,
    source_url: call.official_urls[0] || null,
    source_text_hash: stableHash(fundingDocument),
    raw_text: fundingDocument,
    normalized_text: fundingDocument,
    extracted_json: {
      agency_name: call.agency_name,
      scheme_title: call.scheme_title,
      description: call.description,
      budgetProfile: call.budgetProfile,
      templateComplexity: call.templateComplexity,
    },
    extraction_confidence_json: { source: 'seed', confidence: 1 },
    expiration_date: call.expiration_date,
    is_active: true,
    version: 1,
    metadata,
    createdByUserId: userId,
    updatedByUserId: userId,
  };

  if (existing) {
    return prisma.fundingCall.update({
      where: { id: existing.id },
      data,
      select: { id: true, scheme_title: true },
    });
  }

  return prisma.fundingCall.create({
    data,
    select: { id: true, scheme_title: true },
  });
}

async function upsertHiddenCall(prisma: any, userId: string) {
  const existing = await prisma.fundingCall.findFirst({
    where: {
      scheme_title: FINDER_EXPECTED_HIDDEN_TITLE,
      source: FINDER_VERIFICATION_SOURCE,
    },
    select: { id: true },
  });

  const data = {
    tenantId: null,
    visibility: 'GLOBAL_PUBLISHED',
    status: 'PUBLISHED',
    title: FINDER_EXPECTED_HIDDEN_TITLE,
    agencyName: 'Internal Sandbox Agency',
    sourceUrl: 'https://example.org/internal-hidden-review-call',
    sourceFingerprint: stableHash('internal-hidden-review-call'),
    sourceDomain: 'example.org',
    summary: 'A hidden archived call used to verify directory exclusion.',
    sourceType: 'MANUAL',
    publishedAt: new Date(),
    input_type: null,
    catalog_status: 'ARCHIVED',
    template_status: 'approved',
    guideline_status: 'approved',
    eligible_countries: ['India'],
    eligible_regions: ['Asia'],
    host_countries: ['India'],
    funding_kinds: ['Research Grant'],
    institution_types: ['University'],
    career_stages: ['Principal Investigator'],
    citizenship_requirements: [],
    residency_requirements: [],
    application_languages: ['English'],
    disciplines: ['Artificial Intelligence'],
    agency_name: 'Internal Sandbox Agency',
    scheme_title: FINDER_EXPECTED_HIDDEN_TITLE,
    description: 'A hidden archived call used to verify directory exclusion.',
    open_date: null,
    close_date: new Date('2026-12-01'),
    is_rolling: false,
    geography_scope: 'National',
    funder_country: 'India',
    amount_min: 10000,
    amount_max: 20000,
    currency: 'USD',
    eligibility_text: 'Internal verification only.',
    expected_deliverables_text: 'Internal verification only.',
    official_urls: ['https://example.org/internal-hidden-review-call'],
    contact_info: 'hidden@example.org',
    sponsor_type: 'Government',
    source: FINDER_VERIFICATION_SOURCE,
    source_url: 'https://example.org/internal-hidden-review-call',
    source_text_hash: stableHash('Hidden archived verification call'),
    raw_text: 'Hidden archived verification call',
    normalized_text: 'Hidden archived verification call',
    extracted_json: { hidden: true },
    extraction_confidence_json: { source: 'seed', confidence: 1 },
    expiration_date: new Date('2026-12-01'),
    is_active: false,
    version: 1,
    metadata: {
      seeded: true,
      seed_source: FINDER_VERIFICATION_SOURCE,
      embedding_status: 'dummy_generated',
      verification_seed: 'finder-hidden',
    },
    createdByUserId: userId,
    updatedByUserId: userId,
  };

  if (existing) {
    return prisma.fundingCall.update({
      where: { id: existing.id },
      data,
      select: { id: true, scheme_title: true },
    });
  }

  return prisma.fundingCall.create({
    data,
    select: { id: true, scheme_title: true },
  });
}

async function refreshSearchColumns(prisma: any, PrismaNamespace: any, fundingCallId: string) {
  await prisma.$executeRaw(
    PrismaNamespace.sql`
      UPDATE funding_calls
      SET ts_document = to_tsvector(
        'english',
        concat_ws(
          ' ',
          COALESCE(agency_name, ''),
          COALESCE(scheme_title, ''),
          COALESCE(description, ''),
          array_to_string(COALESCE(disciplines, ARRAY[]::text[]), ' '),
          array_to_string(COALESCE(funding_kinds, ARRAY[]::text[]), ' '),
          COALESCE(eligibility_text, ''),
          COALESCE(expected_deliverables_text, ''),
          COALESCE(project_duration_text, '')
        )
      )
      WHERE id = ${fundingCallId}
    `
  );
}

async function storeEmbedding(
  prisma: any,
  PrismaNamespace: any,
  tableName: 'funding_calls' | 'researcher_saved_research_areas',
  id: string,
  embedding: number[]
) {
  await prisma.$executeRaw(
    PrismaNamespace.sql`
      UPDATE ${PrismaNamespace.raw(tableName)}
      SET embedding = ${PrismaNamespace.raw(`'[${embedding.join(',')}]'::vector`)}
      WHERE id = ${id}
    `
  );
}

async function upsertTemplateAndGuidelines(prisma: any, userId: string, fundingCallId: string, call: SeedFundingCallInput) {
  await prisma.fundingCallTemplateAsset.deleteMany({ where: { funding_call_id: fundingCallId } });
  const asset = await prisma.fundingCallTemplateAsset.create({
    data: {
      funding_call_id: fundingCallId,
      sequence_no: 1,
      source_type: 'text',
      raw_text: buildTemplateSourceText(call),
      normalized_text: buildTemplateSourceText(call),
      source_metadata_json: {
        seed_source: FINDER_VERIFICATION_SOURCE,
        templateComplexity: call.templateComplexity,
        budgetProfile: call.budgetProfile,
      },
      checksum: stableHash(buildTemplateSourceText(call)),
      uploaded_by: userId,
    },
  });

  const grantTemplate = buildGrantTemplate(call, asset.id);
  const compatibility = {
    supportCounts: { full: call.templateComplexity === 'complex' ? 8 : 5, partial: call.templateComplexity === 'complex' ? 0 : 1, manual: 2, unsupported: 0 },
    blockCounts: {
      questions: grantTemplate.questions.length,
      sections: grantTemplate.sections.length,
      attachments: grantTemplate.attachments.length,
      evaluationCriteria: grantTemplate.evaluationCriteria.length,
      budget: grantTemplate.budget ? 1 : 0,
    },
    conflicts: [],
    warnings: call.templateComplexity === 'complex' ? ['Complex seeded template includes cap and year-wise budget rules.'] : [],
    updatedAt: new Date().toISOString(),
    lastRunId: null,
  };

  const template = await prisma.fundingCallTemplate.upsert({
    where: { fundingCallId },
    update: {
      status: 'approved',
      grant_template_json: grantTemplate,
      compatibility_json: compatibility,
      compiledGrantTemplateJson: grantTemplate,
      compiled_papsi_json: { source: 'seed', grantTemplate },
      current_revision_no: 1,
      last_edited_by: userId,
      last_edited_at: new Date(),
      approved_by: userId,
      approved_at: new Date(),
    },
    create: {
      fundingCallId,
      status: 'approved',
      grant_template_json: grantTemplate,
      compatibility_json: compatibility,
      compiledGrantTemplateJson: grantTemplate,
      compiled_papsi_json: { source: 'seed', grantTemplate },
      current_revision_no: 1,
      last_edited_by: userId,
      last_edited_at: new Date(),
      approved_by: userId,
      approved_at: new Date(),
    },
  });

  await prisma.fundingCallTemplateRun.deleteMany({ where: { template_id: template.id } });
  const templateRun = await prisma.fundingCallTemplateRun.create({
    data: {
      funding_call_id: fundingCallId,
      template_id: template.id,
      status: 'applied',
      asset_set_hash: stableHash(`${fundingCallId}:${asset.id}:template`),
      extractor_model: 'seed-template-extractor-v1',
      prompt_version: 'dummy-template-seed-v1',
      raw_output_json: grantTemplate,
      normalized_template_json: grantTemplate,
      compatibility_json: compatibility,
      warnings_json: compatibility.warnings,
    },
  });

  await prisma.fundingCallTemplateRevision.deleteMany({ where: { templateId: template.id } });
  await prisma.fundingCallTemplateRevision.create({
    data: {
      templateId: template.id,
      version: 1,
      status: 'APPROVED',
      extractedPayload: grantTemplate,
      summaryJson: compatibility,
      compiledGrantTemplateJson: grantTemplate,
      createdByUserId: userId,
      approvedByUserId: userId,
      approvedAt: new Date(),
      template_id: template.id,
      revision_no: 1,
      revision_type: 'extraction_import',
      grant_template_json: grantTemplate,
      compatibility_json: { ...compatibility, lastRunId: templateRun.id },
      compiled_papsi_json: { source: 'seed', grantTemplate },
      diff_summary: 'Seeded approved grant template extraction.',
      editor_user_id: userId,
      approved_state: 'approved',
      change_notes: 'Seeded dummy data for funding finder verification.',
    },
  });

  const guidelinePack = buildGuidelinePack(call);
  const guideline = await prisma.fundingCallGuideline.upsert({
    where: { fundingCallId },
    update: {
      status: 'approved',
      guideline_pack_json: guidelinePack,
      current_revision_no: 1,
      last_edited_by: userId,
      last_edited_at: new Date(),
      approved_by: userId,
      approved_at: new Date(),
    },
    create: {
      fundingCallId,
      status: 'approved',
      guideline_pack_json: guidelinePack,
      current_revision_no: 1,
      last_edited_by: userId,
      last_edited_at: new Date(),
      approved_by: userId,
      approved_at: new Date(),
    },
  });

  await prisma.fundingCallGuidelineRun.deleteMany({ where: { guideline_id: guideline.id } });
  const guidelineRun = await prisma.fundingCallGuidelineRun.create({
    data: {
      funding_call_id: fundingCallId,
      guideline_id: guideline.id,
      status: 'applied',
      extractor_model: 'seed-guideline-extractor-v1',
      prompt_version: 'dummy-guideline-seed-v1',
      raw_output_json: guidelinePack,
      guideline_pack_json: guidelinePack,
      warnings_json: call.templateComplexity === 'complex' ? ['Complex budget and duration rules included.'] : [],
    },
  });

  await prisma.fundingCallGuidelineRevision.deleteMany({ where: { guidelineId: guideline.id } });
  await prisma.fundingCallGuidelineRevision.create({
    data: {
      guidelineId: guideline.id,
      version: 1,
      status: 'APPROVED',
      extractedPayload: guidelinePack,
      summaryJson: {
        totalRules: Object.values(guidelinePack).filter(Array.isArray).reduce((sum: number, items: any) => sum + items.length, 0),
        runId: guidelineRun.id,
      },
      createdByUserId: userId,
      approvedByUserId: userId,
      approvedAt: new Date(),
      guideline_id: guideline.id,
      revision_no: 1,
      revision_type: 'auto_extract',
      guideline_pack_json: guidelinePack,
      diff_summary: 'Seeded approved guideline extraction.',
      editor_user_id: userId,
      approved_state: 'approved',
      change_notes: 'Seeded dummy data for funding finder verification.',
    },
  });

  await prisma.fundingCall.update({
    where: { id: fundingCallId },
    data: {
      active_template_id: template.id,
      active_guideline_id: guideline.id,
      template_status: 'approved',
      guideline_status: 'approved',
    },
  });

  return { templateId: template.id, guidelineId: guideline.id };
}

async function upsertPublication(prisma: any, userId: string, publication: SeedProfileInput['publication']) {
  const existing = await prisma.referenceLibrary.findFirst({
    where: { userId, doi: publication.doi },
    select: { id: true },
  });

  const data = {
    userId,
    title: publication.title,
    authors: ['Seed Researcher', 'Verification Collaborator'],
    year: publication.year,
    venue: publication.venue,
    doi: publication.doi,
    abstract: publication.abstract,
    tags: publication.tags,
    sourceType: 'JOURNAL_ARTICLE',
    importSource: 'MANUAL',
    isActive: true,
  };

  if (existing) {
    return prisma.referenceLibrary.update({ where: { id: existing.id }, data });
  }

  return prisma.referenceLibrary.create({ data });
}

async function upsertProfileSeed(prisma: any, PrismaNamespace: any, researcherProfileService: any, tenantId: string, profileSeed: SeedProfileInput) {
  const user = await ensureSeedUser(prisma, tenantId, profileSeed);

  await researcherProfileService.updateProfile(user.id, {
    profile: {
      displayName: profileSeed.name,
      birthYear: null,
      countryOfResidence: profileSeed.countryOfResidence,
      citizenshipCountries: profileSeed.citizenshipCountries,
      institutionName: profileSeed.institutionName,
      institutionType: profileSeed.institutionType,
      department: profileSeed.department,
      careerStage: profileSeed.careerStage,
      yearsOfExperience: profileSeed.yearsOfExperience,
      applicationLanguages: ['English'],
      researchSummary: profileSeed.researchSummary,
      researchAreas: profileSeed.researchAreas,
      keywords: profileSeed.keywords,
      linkedinUrl: '',
      googleScholarUrl: '',
      scopusUrl: '',
      orcidUrl: '',
    },
    notificationPreferences: {
      inAppEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      emailAddress: profileSeed.email,
      whatsappNumber: '',
      whatsappVerified: false,
      notificationFrequency: 'weekly',
      digestEnabled: true,
      quietHoursStart: '',
      quietHoursEnd: '',
      timezone: 'Asia/Calcutta',
      alertKeywords: profileSeed.keywords,
    },
  });

  const existingArea = await prisma.researcherSavedResearchArea.findFirst({
    where: {
      user_id: user.id,
      label: profileSeed.savedArea.label,
    },
    select: { id: true },
  });
  const normalizedText = [
    profileSeed.savedArea.label,
    profileSeed.savedArea.researchArea,
    `keywords: ${profileSeed.savedArea.keywords.join(', ')}`,
    `disciplines: ${profileSeed.savedArea.disciplines.join(', ')}`,
  ].join(' | ');

  await prisma.researcherSavedResearchArea.updateMany({
    where: existingArea
      ? { user_id: user.id, NOT: { id: existingArea.id } }
      : { user_id: user.id },
    data: { is_default: false },
  });

  const savedArea = existingArea
    ? await prisma.researcherSavedResearchArea.update({
        where: { id: existingArea.id },
        data: {
          label: profileSeed.savedArea.label,
          research_area: profileSeed.savedArea.researchArea,
          keywords: profileSeed.savedArea.keywords,
          disciplines: profileSeed.savedArea.disciplines,
          is_default: true,
          use_for_alerts: true,
          normalized_text: normalizedText,
          content_hash: stableHash(normalizedText),
        },
      })
    : await prisma.researcherSavedResearchArea.create({
        data: {
          user_id: user.id,
          label: profileSeed.savedArea.label,
          research_area: profileSeed.savedArea.researchArea,
          keywords: profileSeed.savedArea.keywords,
          disciplines: profileSeed.savedArea.disciplines,
          is_default: true,
          use_for_alerts: true,
          normalized_text: normalizedText,
          content_hash: stableHash(normalizedText),
        },
      });

  await storeEmbedding(
    prisma,
    PrismaNamespace,
    'researcher_saved_research_areas',
    savedArea.id,
    buildDummyEmbedding(`${profileSeed.email}:${profileSeed.savedArea.researchArea}`)
  );
  await prisma.$executeRaw(PrismaNamespace.sql`
    UPDATE researcher_saved_research_areas
    SET embedding_version = 'dummy-research-area-v1'
    WHERE id = ${savedArea.id}
  `);

  await upsertPublication(prisma, user.id, profileSeed.publication);

  return { userId: user.id, email: user.email, savedAreaId: savedArea.id };
}

export async function seedFundingFinderVerificationData() {
  const [{ default: prisma }, { Prisma: PrismaNamespace }, { researcherProfileService }] =
    await Promise.all([
      import('../src/lib/prisma'),
      import('@prisma/client'),
      import('../src/lib/services/researcherProfileService'),
    ]);

  const tenant = await ensureVerificationTenant(prisma);
  const primaryUser = await ensureSeedUser(prisma, tenant.id, {
    email: FINDER_VERIFICATION_USER_EMAIL,
    name: FINDER_VERIFICATION_USER_NAME,
  });

  const seededCalls: Array<{ id: string; scheme_title: string; embedded: boolean; template: boolean; guideline: boolean }> = [];

  for (const call of sampleFundingCalls) {
    const seeded = await upsertFundingCall(prisma, primaryUser.id, call);
    await refreshSearchColumns(prisma, PrismaNamespace, seeded.id);
    await storeEmbedding(prisma, PrismaNamespace, 'funding_calls', seeded.id, buildDummyEmbedding(buildFundingDocument(call)));
    await upsertTemplateAndGuidelines(prisma, primaryUser.id, seeded.id, call);
    seededCalls.push({
      id: seeded.id,
      scheme_title: seeded.scheme_title || call.scheme_title,
      embedded: true,
      template: true,
      guideline: true,
    });
  }

  await upsertHiddenCall(prisma, primaryUser.id);

  const seededProfiles = [];
  for (const profileSeed of profileSeeds) {
    seededProfiles.push(await upsertProfileSeed(prisma, PrismaNamespace, researcherProfileService, tenant.id, profileSeed));
  }

  const publishedActive = await prisma.fundingCall.count({
    where: {
      source: FINDER_VERIFICATION_SOURCE,
      catalog_status: 'PUBLISHED',
      is_active: true,
    },
  });

  const hiddenInactive = await prisma.fundingCall.count({
    where: {
      source: FINDER_VERIFICATION_SOURCE,
      scheme_title: FINDER_EXPECTED_HIDDEN_TITLE,
      is_active: false,
    },
  });

  const approvedTemplates = await prisma.fundingCallTemplate.count({
    where: {
      fundingCall: { source: FINDER_VERIFICATION_SOURCE, catalog_status: 'PUBLISHED', is_active: true },
      status: 'approved',
    },
  });

  const approvedGuidelines = await prisma.fundingCallGuideline.count({
    where: {
      fundingCall: { source: FINDER_VERIFICATION_SOURCE, catalog_status: 'PUBLISHED', is_active: true },
      status: 'approved',
    },
  });

  return {
    tenantId: tenant.id,
    userId: primaryUser.id,
    userEmail: primaryUser.email,
    publishedActive,
    hiddenInactive,
    approvedTemplates,
    approvedGuidelines,
    seededProfiles,
    seededCalls,
  };
}

async function main() {
  const result = await seedFundingFinderVerificationData();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
