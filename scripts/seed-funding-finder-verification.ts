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
  official_urls: string[];
  contact_info: string;
};

export const FINDER_VERIFICATION_TENANT_ATI = 'finder-verification-tenant';
export const FINDER_VERIFICATION_USER_EMAIL = 'finder.verification@grapsi.local';
export const FINDER_VERIFICATION_USER_NAME = 'Finder Verification User';
export const FINDER_VERIFICATION_SOURCE = 'grantmentor-finder-verification-seed';
export const FINDER_EXPECTED_PRIMARY_TITLE = 'AI For Clinical Imaging Fellowship';
export const FINDER_EXPECTED_HIDDEN_TITLE = 'Hidden Internal Review Call';

const sampleFundingCalls: SeedFundingCallInput[] = [
  {
    agency_name: 'Global Health Innovation Trust',
    scheme_title: 'AI For Clinical Imaging Fellowship',
    description:
      'This fellowship supports early-career researchers developing explainable artificial intelligence tools for medical imaging, diagnostics, and radiology decision support.',
    geography_scope: 'International',
    eligible_countries: ['India', 'United Kingdom', 'Germany', 'United States'],
    eligible_regions: ['Europe', 'Asia'],
    host_countries: ['United Kingdom', 'Germany'],
    funder_country: 'United Kingdom',
    funding_kinds: ['Fellowship'],
    institution_types: ['University', 'Hospital', 'Research Institute'],
    career_stages: ['Postdoctoral', 'Early Career Researcher', 'Early Career Faculty'],
    disciplines: ['Artificial Intelligence', 'Medical Imaging', 'Healthcare'],
    sponsor_type: 'Foundation',
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 50000,
    amount_max: 120000,
    currency: 'GBP',
    close_date: new Date('2026-09-30'),
    expiration_date: new Date('2026-09-30'),
    is_rolling: false,
    eligibility_text:
      'Open to early-career researchers affiliated with universities, hospitals, or research institutes.',
    official_urls: ['https://example.org/ai-clinical-imaging-fellowship'],
    contact_info: 'funding@example.org',
  },
  {
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
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 30000,
    amount_max: 150000,
    currency: 'USD',
    close_date: new Date('2026-11-15'),
    expiration_date: new Date('2026-11-15'),
    is_rolling: false,
    eligibility_text: 'Open to universities, research institutes, and NGOs based in South Asia.',
    official_urls: ['https://example.org/climate-agriculture-grant'],
    contact_info: 'climatefund@example.org',
  },
  {
    agency_name: 'European Academic Mobility Network',
    scheme_title: 'Conference And Travel Grant For Early Researchers',
    description:
      'Funds travel, conference attendance, and short academic visits for doctoral candidates and early-career researchers.',
    geography_scope: 'International',
    eligible_countries: ['India', 'Germany', 'France', 'Italy', 'Spain'],
    eligible_regions: ['Europe'],
    host_countries: ['Germany', 'France', 'Italy', 'Spain'],
    funder_country: 'Germany',
    funding_kinds: ['Travel Grant', 'Mobility Grant', 'Conference Grant'],
    institution_types: ['University', 'Research Institute'],
    career_stages: ['PhD', 'Postdoctoral', 'Early Career Researcher'],
    disciplines: ['Artificial Intelligence', 'Climate Change', 'Materials Science', 'Public Health'],
    sponsor_type: 'University',
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 1000,
    amount_max: 8000,
    currency: 'EUR',
    close_date: new Date('2026-12-20'),
    expiration_date: new Date('2026-12-20'),
    is_rolling: false,
    eligibility_text:
      'Open to PhD scholars, postdocs, and early-career researchers with institutional support.',
    official_urls: ['https://example.org/travel-grant-early-researchers'],
    contact_info: 'mobility@example.org',
  },
  {
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
    institution_types: ['University', 'Research Institute'],
    career_stages: ['Principal Investigator', 'Senior Researcher'],
    disciplines: ['Artificial Intelligence', 'Data Science', 'Computer Science'],
    sponsor_type: 'Government',
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 200000,
    amount_max: 750000,
    currency: 'USD',
    close_date: new Date('2027-01-31'),
    expiration_date: new Date('2027-01-31'),
    is_rolling: false,
    eligibility_text:
      'Open to Indian universities and research institutes proposing shared AI research infrastructure.',
    official_urls: ['https://example.org/university-ai-infrastructure'],
    contact_info: 'infrastructure@example.org',
  },
  {
    agency_name: 'Global Public Health Foundation',
    scheme_title: 'Public Health Innovation Seed Grant',
    description:
      'Seed grants for public health innovation, implementation research, and digital health pilots with measurable community impact.',
    geography_scope: 'Global',
    eligible_countries: ['India', 'Kenya', 'South Africa', 'Brazil', 'United States'],
    eligible_regions: ['Africa', 'Asia', 'South America'],
    host_countries: ['India', 'Kenya', 'South Africa', 'Brazil'],
    funder_country: 'United States',
    funding_kinds: ['Seed Grant', 'Research Grant'],
    institution_types: ['University', 'NGO', 'Non-Profit', 'Hospital'],
    career_stages: ['Early Career Researcher', 'Mid Career Researcher', 'Principal Investigator'],
    disciplines: ['Public Health', 'Healthcare', 'Artificial Intelligence', 'Implementation Research'],
    sponsor_type: 'Foundation',
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 20000,
    amount_max: 100000,
    currency: 'USD',
    close_date: new Date('2026-10-10'),
    expiration_date: new Date('2026-10-10'),
    is_rolling: false,
    eligibility_text:
      'Open to universities, hospitals, NGOs, and non-profits working on public health innovation.',
    official_urls: ['https://example.org/public-health-innovation-seed'],
    contact_info: 'publichealth@example.org',
  },
  {
    agency_name: 'Open Science Mobility Council',
    scheme_title: 'Rolling Research Collaboration Mobility Grant',
    description:
      'Rolling grant support for research collaboration visits, workshops, and short-term cross-institutional exchanges.',
    geography_scope: 'International',
    eligible_countries: ['India', 'Germany', 'Singapore', 'Australia', 'Canada'],
    eligible_regions: ['Asia', 'Europe', 'Oceania', 'North America'],
    host_countries: ['Germany', 'Singapore', 'Australia', 'Canada'],
    funder_country: 'Canada',
    funding_kinds: ['Mobility Grant', 'Travel Grant'],
    institution_types: ['University', 'Research Institute', 'Consortium'],
    career_stages: ['Early Career Faculty', 'Mid Career Researcher', 'Senior Researcher', 'Principal Investigator'],
    disciplines: ['Artificial Intelligence', 'Climate Change', 'Public Health', 'Materials Science'],
    sponsor_type: 'Multilateral',
    application_languages: ['English'],
    citizenship_requirements: [],
    residency_requirements: [],
    amount_min: 5000,
    amount_max: 25000,
    currency: 'USD',
    close_date: null,
    expiration_date: null,
    is_rolling: true,
    eligibility_text:
      'Open to collaborative academic teams and consortia planning short-term mobility or workshops.',
    official_urls: ['https://example.org/rolling-mobility-grant'],
    contact_info: 'mobilitycouncil@example.org',
  },
];

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
  ].join('\n');
}

async function ensureVerificationUser(prisma: any) {
  const tenant = await prisma.tenant.upsert({
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

  const user = await prisma.user.upsert({
    where: { email: FINDER_VERIFICATION_USER_EMAIL },
    update: {
      tenantId: tenant.id,
      name: FINDER_VERIFICATION_USER_NAME,
      roles: ['ANALYST'],
      status: 'ACTIVE',
      emailVerified: true,
      oauthProvider: 'GOOGLE',
      oauthProviderId: 'finder-verification-google-oauth',
    },
    create: {
      tenantId: tenant.id,
      email: FINDER_VERIFICATION_USER_EMAIL,
      name: FINDER_VERIFICATION_USER_NAME,
      roles: ['ANALYST'],
      status: 'ACTIVE',
      emailVerified: true,
      oauthProvider: 'GOOGLE',
      oauthProviderId: 'finder-verification-google-oauth',
    },
  });

  return { tenant, user };
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

  const metadata = {
    seeded: true,
    seed_source: FINDER_VERIFICATION_SOURCE,
    embedding_status: 'not_generated',
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
    sourceDomain: 'example.org',
    summary: call.description,
    sourceType: 'MANUAL',
    deadlineAt: call.close_date,
    publishedAt: new Date(),
    normalizedMetadata: {
      disciplines: call.disciplines,
      fundingKinds: call.funding_kinds,
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
    eligibility_text: call.eligibility_text,
    official_urls: call.official_urls,
    contact_info: call.contact_info,
    sponsor_type: call.sponsor_type,
    source: FINDER_VERIFICATION_SOURCE,
    source_url: call.official_urls[0] || null,
    raw_text: buildFundingDocument(call),
    normalized_text: buildFundingDocument(call),
    extracted_json: {
      agency_name: call.agency_name,
      scheme_title: call.scheme_title,
      description: call.description,
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
    official_urls: ['https://example.org/internal-hidden-review-call'],
    contact_info: 'hidden@example.org',
    sponsor_type: 'Government',
    source: FINDER_VERIFICATION_SOURCE,
    source_url: 'https://example.org/internal-hidden-review-call',
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
      embedding_status: 'not_generated',
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
          COALESCE(eligibility_text, '')
        )
      )
      WHERE id = ${fundingCallId}
    `
  );
}

async function storeEmbedding(
  prisma: any,
  PrismaNamespace: any,
  fundingCallId: string,
  embedding: number[],
  metadataPatch: Record<string, unknown>
) {
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`
      UPDATE funding_calls
      SET embedding = ${PrismaNamespace.raw(`'[${embedding.join(',')}]'::vector`)}
      WHERE id = ${fundingCallId}
    `;

    const current = await tx.fundingCall.findUnique({
      where: { id: fundingCallId },
      select: { metadata: true },
    });

    await tx.fundingCall.update({
      where: { id: fundingCallId },
      data: {
        metadata: {
          ...((current?.metadata as Record<string, unknown> | null) || {}),
          ...metadataPatch,
        },
      },
    });
  });
}

export async function seedFundingFinderVerificationData() {
  const [{ default: prisma }, { Prisma: PrismaNamespace }, { EmbeddingService }, { researcherProfileService }] =
    await Promise.all([
      import('../src/lib/prisma'),
      import('@prisma/client'),
      import('../src/lib/services/embeddingService'),
      import('../src/lib/services/researcherProfileService'),
    ]);

  const { tenant, user } = await ensureVerificationUser(prisma);
  const embeddingService = new EmbeddingService();

  const seededCalls: Array<{ id: string; scheme_title: string; embedded: boolean }> = [];

  for (const call of sampleFundingCalls) {
    const seeded = await upsertFundingCall(prisma, user.id, call);
    await refreshSearchColumns(prisma, PrismaNamespace, seeded.id);

    let embedded = false;
    const { embedding } = await embeddingService.generateEmbedding(buildFundingDocument(call));
    if (embedding.length > 0) {
      await storeEmbedding(prisma, PrismaNamespace, seeded.id, embedding, {
        embedding_status: 'generated',
        embedding_updated_at: new Date().toISOString(),
        embedding_error: null,
      });
      embedded = true;
    } else {
      await prisma.fundingCall.update({
        where: { id: seeded.id },
        data: {
          metadata: {
            seeded: true,
            seed_source: FINDER_VERIFICATION_SOURCE,
            embedding_status: 'failed',
            embedding_error: 'Embedding generation returned no vector',
          },
        },
      });
    }

    seededCalls.push({ id: seeded.id, scheme_title: seeded.scheme_title || call.scheme_title, embedded });
  }

  await upsertHiddenCall(prisma, user.id);

  await researcherProfileService.updateProfile(user.id, {
    profile: {
      displayName: FINDER_VERIFICATION_USER_NAME,
      birthYear: null,
      countryOfResidence: 'India',
      citizenshipCountries: ['India'],
      institutionName: 'Verification University',
      institutionType: 'University',
      department: 'Biomedical AI',
      careerStage: 'Early Career Researcher',
      yearsOfExperience: 4,
      applicationLanguages: ['English'],
      researchSummary: 'Working on AI, medical imaging, public health, and translational research.',
      researchAreas: ['Artificial Intelligence', 'Medical Imaging', 'Public Health'],
      keywords: ['AI', 'medical imaging', 'public health'],
      linkedinUrl: '',
      googleScholarUrl: '',
      scopusUrl: '',
      orcidUrl: '',
    },
    notificationPreferences: {
      inAppEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      emailAddress: FINDER_VERIFICATION_USER_EMAIL,
      whatsappNumber: '',
      whatsappVerified: false,
      notificationFrequency: 'weekly',
      digestEnabled: true,
      quietHoursStart: '',
      quietHoursEnd: '',
      timezone: 'Asia/Calcutta',
      alertKeywords: ['AI', 'medical imaging', 'public health'],
    },
  });

  await researcherProfileService.saveResearchArea(user.id, {
    label: 'Medical Imaging AI',
    researchArea: 'Artificial intelligence for medical imaging and radiology',
    keywords: ['AI', 'medical imaging', 'radiology', 'diagnostics'],
    disciplines: ['Artificial Intelligence', 'Medical Imaging', 'Healthcare'],
    isDefault: true,
    useForAlerts: true,
  });

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

  return {
    tenantId: tenant.id,
    userId: user.id,
    userEmail: user.email,
    publishedActive,
    hiddenInactive,
    seededCalls,
  };
}

async function main() {
  const result = await seedFundingFinderVerificationData();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
