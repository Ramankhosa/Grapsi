import type { FundingCall as PrismaFundingCall, FundingCallStatus, Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';
import prisma from '../prisma';
import { DRAFT_MINIMUM_FIELDS } from '../fundingIntake/constants';
import type { FundingDraftValues, IntakeOperator } from '../fundingIntake/types';
import { normalizeDraftInput } from '../fundingIntake/utils';
import type { EmbeddingServiceHealth } from './embeddingService';
import { EmbeddingService } from './embeddingService';

type CatalogMetadata = Record<string, any>;

export interface FundingCatalogSummary {
  id: string;
  agency_name: string;
  scheme_title: string;
  status: FundingCallStatus;
  is_active: boolean;
  source_url: string | null;
  intake_job_id: string | null;
  close_date: Date | null;
  is_rolling: boolean;
  created_at: Date | null;
  updated_at: Date | null;
  published_at: string | null;
  published_by: string | null;
  embedding_status: 'not_generated' | 'generated' | 'failed';
}

export interface PublishReadiness {
  ready: boolean;
  missingFields: string[];
}

export interface FundingEmbeddingCoverageSummary {
  publishedActiveTotal: number;
  publishedActiveEmbedded: number;
  publishedActiveMissingEmbedding: number;
  publishedActiveFailedEmbedding: number;
}

export interface FundingEmbeddingBackfillResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

const embeddingService = new EmbeddingService();

const SEARCHABLE_DRAFT_KEYS: Array<keyof FundingDraftValues> = [
  'agency_name',
  'scheme_title',
  'description',
  'eligible_countries',
  'eligible_regions',
  'host_countries',
  'funder_country',
  'funding_kinds',
  'institution_types',
  'career_stages',
  'citizenship_requirements',
  'residency_requirements',
  'application_languages',
  'disciplines',
  'eligibility_text',
  'sponsor_type',
];

function asMetadata(metadata: Prisma.JsonValue | null | undefined): CatalogMetadata {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as CatalogMetadata) }
    : {};
}

function buildDraftValuesFromCall(call: PrismaFundingCall): FundingDraftValues {
  return normalizeDraftInput({
    agency_name: call.agency_name || '',
    scheme_title: call.scheme_title || '',
    description: call.description || '',
    open_date: call.open_date ? call.open_date.toISOString().slice(0, 10) : '',
    close_date: call.close_date ? call.close_date.toISOString().slice(0, 10) : '',
    is_rolling: Boolean(call.is_rolling),
    geography_scope: call.geography_scope || '',
    eligible_countries: call.eligible_countries || [],
    eligible_regions: call.eligible_regions || [],
    host_countries: call.host_countries || [],
    funder_country: call.funder_country || '',
    funding_kinds: call.funding_kinds || [],
    institution_types: call.institution_types || [],
    career_stages: call.career_stages || [],
    citizenship_requirements: call.citizenship_requirements || [],
    residency_requirements: call.residency_requirements || [],
    application_languages: call.application_languages || [],
    disciplines: call.disciplines || [],
    amount_min: call.amount_min ?? null,
    amount_max: call.amount_max ?? null,
    currency: call.currency || '',
    project_duration_min_months: call.project_duration_min_months ?? null,
    project_duration_max_months: call.project_duration_max_months ?? null,
    project_duration_text: call.project_duration_text || '',
    eligibility_text: call.eligibility_text || '',
    expected_deliverables_text: call.expected_deliverables_text || '',
    official_urls: call.official_urls || [],
    contact_info: call.contact_info || '',
    sponsor_type: call.sponsor_type || '',
  });
}

function buildPublishReadiness(values: FundingDraftValues): PublishReadiness {
  const missingFields = Array.from(DRAFT_MINIMUM_FIELDS as readonly string[]).filter(
    (key) => !String(((values as unknown) as Record<string, unknown>)[key] || '').trim()
  );

  if (!values.description.trim()) {
    missingFields.push('description');
  }

  if (values.funding_kinds.length === 0) {
    missingFields.push('funding_kinds');
  }

  if (values.disciplines.length === 0) {
    missingFields.push('disciplines_or_research_areas');
  }

  if (!values.close_date && !values.is_rolling) {
    missingFields.push('close_date_or_is_rolling');
  }

  return {
    ready: missingFields.length === 0,
    missingFields,
  };
}

function buildCatalogMetadata(
  currentMetadata: Prisma.JsonValue | null | undefined,
  patch: CatalogMetadata
): CatalogMetadata {
  const existing = asMetadata(currentMetadata);
  return {
    ...existing,
    ...patch,
    international_facets: {
      ...(existing.international_facets || {}),
      ...(patch.international_facets || {}),
    },
  };
}

function hasDraftValuesChanged(current: FundingDraftValues, next: FundingDraftValues) {
  return JSON.stringify(current) !== JSON.stringify(next);
}

function toCount(value: bigint | number | null | undefined) {
  return Number(value || 0);
}

function buildSearchableDocument(values: FundingDraftValues): string {
  return [
    `title: ${values.scheme_title}`,
    `agency: ${values.agency_name}`,
    `description: ${values.description}`,
    `disciplines: ${values.disciplines.join(', ')}`,
    `funding types: ${values.funding_kinds.join(', ')}`,
    `institution types: ${values.institution_types.join(', ')}`,
    `career stages: ${values.career_stages.join(', ')}`,
    `eligible countries: ${values.eligible_countries.join(', ')}`,
    `eligible regions: ${values.eligible_regions.join(', ')}`,
    `host countries: ${values.host_countries.join(', ')}`,
    `citizenship requirements: ${values.citizenship_requirements.join(', ')}`,
    `residency requirements: ${values.residency_requirements.join(', ')}`,
    `application languages: ${values.application_languages.join(', ')}`,
    `geography scope: ${values.geography_scope}`,
    `sponsor type: ${values.sponsor_type}`,
    `funder country: ${values.funder_country}`,
    `eligibility: ${values.eligibility_text}`,
    `duration: ${values.project_duration_text || [values.project_duration_min_months, values.project_duration_max_months].filter((value) => value !== null).join(' - ')}`,
    `deliverables: ${values.expected_deliverables_text}`,
  ]
    .filter((line) => !line.endsWith(': '))
    .join('\n');
}

async function generateEmbedding(values: FundingDraftValues): Promise<number[]> {
  const searchableDocument = buildSearchableDocument(values);
  const { embedding, error } = await embeddingService.generateEmbedding(searchableDocument);

  if (error || embedding.length === 0) {
    throw new Error(error || 'Could not generate embedding for funding call');
  }

  return embedding;
}

async function getEmbeddingPresence(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<Array<{ id: string; hasEmbedding: boolean }>>(
    PrismaNamespace.sql`
      SELECT id::text AS id, embedding IS NOT NULL AS "hasEmbedding"
      FROM funding_calls
      WHERE id IN (${PrismaNamespace.join(ids.map((id) => PrismaNamespace.sql`${id}`))})
    `
  );

  return new Map(rows.map((row) => [row.id, row.hasEmbedding]));
}

function getEmbeddingStatus(call: { metadata: Prisma.JsonValue | null; id: string }, hasEmbedding: boolean) {
  const metadata = asMetadata(call.metadata);
  const storedStatus = metadata.embedding_status;
  if (storedStatus === 'generated' || storedStatus === 'failed' || storedStatus === 'not_generated') {
    return storedStatus;
  }
  return hasEmbedding ? 'generated' : 'not_generated';
}

function buildCallWriteData(
  current: PrismaFundingCall,
  values: FundingDraftValues,
  metadataPatch: CatalogMetadata,
  overrides: Partial<Pick<PrismaFundingCall, 'catalog_status' | 'is_active' | 'expiration_date'>> = {}
) {
  const metadata = buildCatalogMetadata(current.metadata, {
    ...metadataPatch,
    international_facets: {
      eligible_regions: values.eligible_regions,
      host_countries: values.host_countries,
      funder_country: values.funder_country || null,
      citizenship_requirements: values.citizenship_requirements,
      residency_requirements: values.residency_requirements,
      application_languages: values.application_languages,
    },
  });

    return {
      catalog_status: overrides.catalog_status ?? current.catalog_status,
      agency_name: values.agency_name,
    scheme_title: values.scheme_title,
    description: values.description,
    open_date: values.open_date ? new Date(values.open_date) : null,
    close_date: values.close_date ? new Date(values.close_date) : null,
    is_rolling: values.is_rolling,
    geography_scope: values.geography_scope || null,
    eligible_countries: values.eligible_countries,
    eligible_regions: values.eligible_regions,
    host_countries: values.host_countries,
    funder_country: values.funder_country || null,
    funding_kinds: values.funding_kinds,
    institution_types: values.institution_types,
    career_stages: values.career_stages,
    citizenship_requirements: values.citizenship_requirements,
    residency_requirements: values.residency_requirements,
    application_languages: values.application_languages,
    disciplines: values.disciplines,
    amount_min: values.amount_min,
    amount_max: values.amount_max,
    currency: values.currency || null,
    project_duration_min_months: values.project_duration_min_months,
    project_duration_max_months: values.project_duration_max_months,
    project_duration_text: values.project_duration_text || null,
    official_urls: values.official_urls,
    eligibility_text: values.eligibility_text || null,
    expected_deliverables_text: values.expected_deliverables_text || null,
    sponsor_type: values.sponsor_type || null,
    contact_info: values.contact_info || null,
    expiration_date: overrides.expiration_date ?? (values.close_date ? new Date(values.close_date) : current.expiration_date),
    is_active: overrides.is_active ?? current.is_active,
    metadata: metadata as any,
  };
}

async function updateStoredEmbedding(
  tx: Prisma.TransactionClient,
  fundingCallId: string,
  embedding: number[]
) {
  await tx.$executeRaw`
    UPDATE funding_calls
    SET embedding = ${PrismaNamespace.raw(`'[${embedding.join(',')}]'::vector`)}
    WHERE id = ${fundingCallId}
  `;
}

export class FundingCatalogService {
  getEmbeddingServiceHealth(): EmbeddingServiceHealth {
    return embeddingService.getHealth();
  }

  async getEmbeddingCoverageSummary(): Promise<FundingEmbeddingCoverageSummary> {
    const rows = await prisma.$queryRaw<
      Array<{
        publishedActiveTotal: bigint | number;
        publishedActiveEmbedded: bigint | number;
        publishedActiveMissingEmbedding: bigint | number;
        publishedActiveFailedEmbedding: bigint | number;
      }>
    >(PrismaNamespace.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE catalog_status = 'PUBLISHED'
            AND COALESCE(is_active, true) = true
        ) AS "publishedActiveTotal",
        COUNT(*) FILTER (
          WHERE catalog_status = 'PUBLISHED'
            AND COALESCE(is_active, true) = true
            AND embedding IS NOT NULL
        ) AS "publishedActiveEmbedded",
        COUNT(*) FILTER (
          WHERE catalog_status = 'PUBLISHED'
            AND COALESCE(is_active, true) = true
            AND embedding IS NULL
        ) AS "publishedActiveMissingEmbedding",
        COUNT(*) FILTER (
          WHERE catalog_status = 'PUBLISHED'
            AND COALESCE(is_active, true) = true
            AND COALESCE(metadata ->> 'embedding_status', '') = 'failed'
        ) AS "publishedActiveFailedEmbedding"
      FROM funding_calls
    `);

    const row = rows[0];
    return {
      publishedActiveTotal: toCount(row?.publishedActiveTotal),
      publishedActiveEmbedded: toCount(row?.publishedActiveEmbedded),
      publishedActiveMissingEmbedding: toCount(row?.publishedActiveMissingEmbedding),
      publishedActiveFailedEmbedding: toCount(row?.publishedActiveFailedEmbedding),
    };
  }

  async listFundingCalls(status?: FundingCallStatus | null): Promise<FundingCatalogSummary[]> {
    const calls = await prisma.fundingCall.findMany({
      where: status ? { catalog_status: status } : undefined,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        agency_name: true,
        scheme_title: true,
        catalog_status: true,
        is_active: true,
        source_url: true,
        intake_job_id: true,
        close_date: true,
        is_rolling: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    });

    const embeddingMap = await getEmbeddingPresence(calls.map((call) => call.id));

    return calls.map((call) => {
      const metadata = asMetadata(call.metadata);
      return {
        id: call.id,
        agency_name: call.agency_name || '',
        scheme_title: call.scheme_title || '',
        status: call.catalog_status || 'DRAFT',
        is_active: Boolean(call.is_active),
        source_url: call.source_url,
        intake_job_id: call.intake_job_id,
        close_date: call.close_date,
        is_rolling: Boolean(call.is_rolling),
        created_at: call.createdAt,
        updated_at: call.updatedAt,
        published_at: typeof metadata.published_at === 'string' ? metadata.published_at : null,
        published_by: typeof metadata.published_by === 'string' ? metadata.published_by : null,
        embedding_status: getEmbeddingStatus(call, embeddingMap.get(call.id) || false),
      };
    });
  }

  async backfillPublishedEmbeddings(limit = 25): Promise<FundingEmbeddingBackfillResult> {
    const candidates = await prisma.$queryRaw<Array<{ id: string }>>(
      PrismaNamespace.sql`
        SELECT id::text AS id
        FROM funding_calls
        WHERE catalog_status = 'PUBLISHED'
          AND COALESCE(is_active, true) = true
          AND (
            embedding IS NULL
            OR COALESCE(metadata ->> 'embedding_status', '') = 'failed'
          )
        ORDER BY updated_at DESC
        LIMIT ${Math.max(1, Math.min(limit, 100))}
      `
    );

    const result: FundingEmbeddingBackfillResult = {
      processed: candidates.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const candidate of candidates) {
      const current = await prisma.fundingCall.findUnique({
        where: { id: candidate.id },
      });

      if (!current) {
        result.failed += 1;
        result.errors.push({ id: candidate.id, error: 'Funding call not found' });
        continue;
      }

      const draftValues = buildDraftValuesFromCall(current);

      try {
        const embedding = await generateEmbedding(draftValues);
        const now = new Date().toISOString();
        const metadata = buildCatalogMetadata(current.metadata, {
          embedding_status: 'generated',
          embedding_updated_at: now,
          embedding_error: null,
        });

        await prisma.$transaction(async (tx) => {
          await tx.fundingCall.update({
            where: { id: current.id },
            data: {
              metadata: metadata as any,
            },
          });

          await updateStoredEmbedding(tx, current.id, embedding);
        });

        result.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const metadata = buildCatalogMetadata(current.metadata, {
          embedding_status: 'failed',
          embedding_updated_at: new Date().toISOString(),
          embedding_error: message,
        });

        await prisma.fundingCall.update({
          where: { id: current.id },
          data: {
            metadata: metadata as any,
          },
        });

        result.failed += 1;
        result.errors.push({ id: current.id, error: message });
      }
    }

    return result;
  }

  async getFundingCallDetails(fundingCallId: string) {
    const call = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
    });

    if (!call) {
      return null;
    }

    const [embeddingMap, intakeJob] = await Promise.all([
      getEmbeddingPresence([call.id]),
      call.intake_job_id
        ? prisma.fundingIntakeJob.findUnique({
            where: { id: call.intake_job_id },
            select: {
              id: true,
              input_type: true,
              source_url: true,
              created_at: true,
              status: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const metadata = asMetadata(call.metadata);
    const draftValues = buildDraftValuesFromCall(call);
    const publishReadiness = buildPublishReadiness(draftValues);

    return {
      call: {
        ...call,
        is_active: Boolean(call.is_active),
        is_rolling: Boolean(call.is_rolling),
        published_at: typeof metadata.published_at === 'string' ? metadata.published_at : null,
        published_by: typeof metadata.published_by === 'string' ? metadata.published_by : null,
        embedding_status: getEmbeddingStatus(call, embeddingMap.get(call.id) || false),
      },
      draftValues,
      publishReadiness,
      sourceProvenance: intakeJob,
    };
  }

  async updateFundingCall(
    fundingCallId: string,
    input: Partial<FundingDraftValues>,
    operator: IntakeOperator
  ) {
    const current = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
    });

    if (!current) {
      throw new Error('Funding call not found');
    }

    const currentDraftValues = buildDraftValuesFromCall(current);
    const nextDraftValues = normalizeDraftInput({
      ...currentDraftValues,
      ...input,
    });
    const draftValuesChanged = hasDraftValuesChanged(currentDraftValues, nextDraftValues);

    if (!draftValuesChanged) {
      return this.getFundingCallDetails(fundingCallId);
    }

    const searchableFieldsChanged = SEARCHABLE_DRAFT_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(input, key)
    );

    let embedding: number[] | null = null;
    if (current.catalog_status === 'PUBLISHED' && Boolean(current.is_active) && searchableFieldsChanged) {
      try {
        embedding = await generateEmbedding(nextDraftValues);
      } catch (error) {
        const metadata = buildCatalogMetadata(current.metadata, {
          embedding_status: 'failed',
          embedding_updated_at: new Date().toISOString(),
          embedding_error: error instanceof Error ? error.message : String(error),
        });

        await prisma.fundingCall.update({
          where: { id: fundingCallId },
          data: {
            metadata: metadata as any,
          },
        });

        throw error;
      }
    }

    const now = new Date().toISOString();
    const updateData = buildCallWriteData(current, nextDraftValues, {
      last_catalog_update_by: operator.email,
      last_catalog_update_at: now,
      ...(embedding
        ? {
            embedding_status: 'generated',
            embedding_updated_at: now,
            embedding_error: null,
          }
        : {}),
    });

    await prisma.$transaction(async (tx) => {
      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: updateData,
      });

      if (embedding) {
        await updateStoredEmbedding(tx, fundingCallId, embedding);
      }
    });

    return this.getFundingCallDetails(fundingCallId);
  }

  async publishFundingCall(fundingCallId: string, operator: IntakeOperator) {
    const current = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
    });

    if (!current) {
      throw new Error('Funding call not found');
    }

    const draftValues = buildDraftValuesFromCall(current);
    const readiness = buildPublishReadiness(draftValues);
    if (!readiness.ready) {
      return {
        ok: false,
        reason: 'missing_required_fields',
        requiredFieldsRemaining: readiness.missingFields,
      };
    }

    let embedding: number[];
    try {
      embedding = await generateEmbedding(draftValues);
    } catch (error) {
      const metadata = buildCatalogMetadata(current.metadata, {
        embedding_status: 'failed',
        embedding_updated_at: new Date().toISOString(),
        embedding_error: error instanceof Error ? error.message : String(error),
      });

      await prisma.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          metadata: metadata as any,
        },
      });

      throw error;
    }

    const now = new Date().toISOString();
    const updateData = buildCallWriteData(
      current,
      draftValues,
      {
        published_by: operator.email,
        published_at: now,
        embedding_status: 'generated',
        embedding_updated_at: now,
        embedding_error: null,
        last_catalog_update_by: operator.email,
        last_catalog_update_at: now,
      },
      {
        catalog_status: 'PUBLISHED',
        is_active: true,
        expiration_date: draftValues.close_date ? new Date(draftValues.close_date) : current.expiration_date,
      }
    );

    await prisma.$transaction(async (tx) => {
      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: updateData,
      });

      await updateStoredEmbedding(tx, fundingCallId, embedding);
    });

    return {
      ok: true,
      fundingCallId,
    };
  }

  async archiveFundingCall(fundingCallId: string, operator: IntakeOperator) {
    const current = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
    });

    if (!current) {
      throw new Error('Funding call not found');
    }

    const draftValues = buildDraftValuesFromCall(current);
    const now = new Date().toISOString();

    await prisma.fundingCall.update({
      where: { id: fundingCallId },
      data: buildCallWriteData(
        current,
        draftValues,
        {
          archived_by: operator.email,
          archived_at: now,
          last_catalog_update_by: operator.email,
          last_catalog_update_at: now,
        },
        {
          catalog_status: 'ARCHIVED',
          is_active: false,
        }
      ),
    });
  }

  async rejectFundingCall(fundingCallId: string, operator: IntakeOperator) {
    const current = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
    });

    if (!current) {
      throw new Error('Funding call not found');
    }

    const draftValues = buildDraftValuesFromCall(current);
    const now = new Date().toISOString();

    await prisma.fundingCall.update({
      where: { id: fundingCallId },
      data: buildCallWriteData(
        current,
        draftValues,
        {
          rejected_by: operator.email,
          rejected_at: now,
          last_catalog_update_by: operator.email,
          last_catalog_update_at: now,
        },
        {
          catalog_status: 'REJECTED',
          is_active: false,
        }
      ),
    });
  }

  async archiveExpiredPublishedCalls(): Promise<number> {
    const result = await prisma.$executeRaw`
      UPDATE funding_calls
      SET
        catalog_status = 'ARCHIVED',
        is_active = false,
        updated_at = CURRENT_TIMESTAMP,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'archived_by', 'expiry-job',
          'archived_at', NOW()::text,
          'archive_reason', 'expired'
        )
      WHERE catalog_status = 'PUBLISHED'
        AND COALESCE(is_active, true) = true
        AND COALESCE(is_rolling, false) = false
        AND COALESCE(close_date, expiration_date) IS NOT NULL
        AND COALESCE(close_date, expiration_date) < CURRENT_DATE
    `;

    return Number(result);
  }
}

export const fundingCatalogService = new FundingCatalogService();
