import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeWhitespace } from '@/lib/recommendations/utils';
import { EmbeddingService, areStoredEmbeddingJobsEnabled } from '@/lib/services/embeddingService';

export const FUNDING_PUBLICATION_TAG = 'my-publication';
export const MAX_FUNDING_PUBLICATIONS = 5;
const FUNDING_PUBLICATION_EMBEDDING_TASK_TYPE = 'RETRIEVAL_DOCUMENT' as const;
const FUNDING_PUBLICATION_EMBEDDING_VERSION_PREFIX = 'funding-publication-v1';

const embeddingService = new EmbeddingService();

export interface FundingPublicationInput {
  title: string;
  abstract: string;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
}

export interface FundingPublicationRecord {
  id: string;
  title: string;
  abstract: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  updatedAt: string;
}

type FundingPublicationRow = {
  id: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  updatedAt: Date;
  tags: string[];
};

type FundingPublicationEmbeddingRow = FundingPublicationRow & {
  userId: string;
  authors: string[];
  fundingMatchText: string | null;
  fundingMatchHash: string | null;
  fundingEmbeddingVersion: string | null;
};

export interface FundingPublicationEmbeddingCoverage {
  total: number;
  current: number;
  missing: number;
  stale: number;
  embeddingVersion: string;
}

export interface FundingPublicationEmbeddingBackfillResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export function normalizeFundingPublicationInput(input: FundingPublicationInput): FundingPublicationInput {
  return {
    title: normalizeWhitespace(input.title),
    abstract: normalizeWhitespace(input.abstract),
    year: typeof input.year === 'number' ? input.year : null,
    venue: normalizeWhitespace(input.venue || '') || null,
    doi: normalizeDoi(input.doi || '') || null,
  };
}

export function buildFundingPublicationTags(tags: string[] | null | undefined) {
  const nextTags = new Map<string, string>();
  (tags || []).forEach((tag) => {
    const normalized = normalizeWhitespace(tag);
    if (normalized) {
      nextTags.set(normalized.toLowerCase(), normalized);
    }
  });
  nextTags.set(FUNDING_PUBLICATION_TAG, FUNDING_PUBLICATION_TAG);
  return Array.from(nextTags.values());
}

export function removeFundingPublicationTag(tags: string[] | null | undefined) {
  return (tags || [])
    .map((tag) => normalizeWhitespace(tag))
    .filter((tag) => tag && tag.toLowerCase() !== FUNDING_PUBLICATION_TAG);
}

function normalizeDoi(value: string) {
  const normalized = normalizeWhitespace(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
  return normalized || null;
}

function buildContentHash(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function getFundingPublicationEmbeddingHealth() {
  return embeddingService.getHealth({ taskType: FUNDING_PUBLICATION_EMBEDDING_TASK_TYPE });
}

function getFundingPublicationEmbeddingVersion() {
  const health = getFundingPublicationEmbeddingHealth();
  return `${FUNDING_PUBLICATION_EMBEDDING_VERSION_PREFIX}:${health.provider}:${health.modelName}:${FUNDING_PUBLICATION_EMBEDDING_TASK_TYPE.toLowerCase()}:${health.outputDimensionality}`;
}

function getFundingPublicationEmbeddingColumn() {
  const health = getFundingPublicationEmbeddingHealth();
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'funding_embedding_voyage_1024'
    : 'funding_embedding';
}

function fundingPublicationEmbeddingColumnSql() {
  return Prisma.raw(getFundingPublicationEmbeddingColumn());
}

export function buildFundingPublicationMatchText(input: {
  title: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  authors?: string[] | null;
}) {
  return normalizeWhitespace([
    input.title ? `title: ${input.title}` : '',
    input.abstract ? `abstract: ${input.abstract}` : '',
    input.venue ? `venue: ${input.venue}` : '',
    input.year ? `year: ${input.year}` : '',
    input.authors?.length ? `authors: ${input.authors.join(', ')}` : '',
    input.doi ? `doi: ${input.doi}` : '',
  ].filter(Boolean).join(' | '));
}

function serializeFundingPublication(row: FundingPublicationRow): FundingPublicationRecord {
  return {
    id: row.id,
    title: normalizeWhitespace(row.title),
    abstract: normalizeWhitespace(row.abstract || ''),
    year: row.year || null,
    venue: normalizeWhitespace(row.venue || '') || null,
    doi: normalizeWhitespace(row.doi || '') || null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function indexFundingPublicationForMatching(row: {
  id: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  authors?: string[] | null;
}) {
  const matchText = buildFundingPublicationMatchText(row);
  const contentHash = buildContentHash(matchText);
  const embeddingVersion = getFundingPublicationEmbeddingVersion();

  if (!matchText) {
    await prisma.$executeRaw`
      UPDATE reference_library
      SET funding_match_text = NULL,
          funding_match_hash = NULL,
          ${fundingPublicationEmbeddingColumnSql()} = NULL,
          funding_embedding_version = NULL
      WHERE id = ${row.id}
    `;
    return;
  }

  if (!await areStoredEmbeddingJobsEnabled()) {
    return;
  }

  const { embedding, error } = await embeddingService.generateEmbedding(matchText, undefined, {
    taskType: FUNDING_PUBLICATION_EMBEDDING_TASK_TYPE,
    title: row.title,
  });

  if (error || embedding.length === 0) {
    console.warn('Funding publication embedding skipped:', error || 'empty embedding');
    await prisma.$executeRaw`
      UPDATE reference_library
      SET funding_match_text = ${matchText},
          funding_match_hash = ${contentHash},
          ${fundingPublicationEmbeddingColumnSql()} = NULL,
          funding_embedding_version = NULL
      WHERE id = ${row.id}
    `;
    return;
  }

  await prisma.$executeRaw`
    UPDATE reference_library
    SET funding_match_text = ${matchText},
        funding_match_hash = ${contentHash},
        ${fundingPublicationEmbeddingColumnSql()} = ${Prisma.raw(`'[${embedding.join(',')}]'::vector`)},
        funding_embedding_version = ${embeddingVersion}
    WHERE id = ${row.id}
  `;
}

async function clearFundingPublicationEmbedding(publicationId: string) {
  await prisma.$executeRaw`
    UPDATE reference_library
    SET funding_match_text = NULL,
        funding_match_hash = NULL,
        funding_embedding = NULL,
        funding_embedding_voyage_1024 = NULL,
        funding_embedding_version = NULL
    WHERE id = ${publicationId}
  `;
}

async function countFundingPublications(userId: string, excludeId?: string) {
  return prisma.referenceLibrary.count({
    where: {
      userId,
      isActive: true,
      tags: { has: FUNDING_PUBLICATION_TAG },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

function assertPublicationPayload(input: FundingPublicationInput) {
  if (!input.title) {
    throw new Error('Publication title is required');
  }
  if (!input.abstract) {
    throw new Error('Publication abstract is required');
  }
}

export class FundingPublicationService {
  async list(userId: string): Promise<FundingPublicationRecord[]> {
    const rows = await prisma.referenceLibrary.findMany({
      where: {
        userId,
        isActive: true,
        tags: { has: FUNDING_PUBLICATION_TAG },
      },
      select: {
        id: true,
        title: true,
        abstract: true,
        year: true,
        venue: true,
        doi: true,
        updatedAt: true,
        tags: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: MAX_FUNDING_PUBLICATIONS,
    });

    return rows.map(serializeFundingPublication);
  }

  async create(userId: string, rawInput: FundingPublicationInput): Promise<FundingPublicationRecord> {
    const input = normalizeFundingPublicationInput(rawInput);
    assertPublicationPayload(input);

    const existingByDoi = input.doi
      ? await prisma.referenceLibrary.findFirst({
          where: {
            userId,
            isActive: true,
            doi: { equals: input.doi, mode: 'insensitive' },
          },
          select: {
            id: true,
            title: true,
            abstract: true,
            year: true,
            venue: true,
            doi: true,
            updatedAt: true,
            tags: true,
          },
        })
      : null;

    const existingAlreadyFocused = existingByDoi?.tags.some(
      (tag) => tag.toLowerCase() === FUNDING_PUBLICATION_TAG
    );
    const currentCount = await countFundingPublications(userId, existingByDoi?.id);
    if (!existingAlreadyFocused && currentCount >= MAX_FUNDING_PUBLICATIONS) {
      throw new Error(`You can mark at most ${MAX_FUNDING_PUBLICATIONS} publications for funding matching`);
    }

    const data = {
      title: input.title,
      abstract: input.abstract,
      year: input.year,
      venue: input.venue,
      doi: input.doi,
      sourceType: 'JOURNAL_ARTICLE' as const,
      importSource: 'MANUAL' as const,
      tags: buildFundingPublicationTags(existingByDoi?.tags),
      updatedAt: new Date(),
    };

    const row = existingByDoi
      ? await prisma.referenceLibrary.update({
          where: { id: existingByDoi.id },
          data,
          select: {
            id: true,
            title: true,
            abstract: true,
            year: true,
            venue: true,
            doi: true,
            updatedAt: true,
            tags: true,
          },
        })
      : await prisma.referenceLibrary.create({
          data: {
            userId,
            authors: [],
            isFavorite: false,
            isRead: false,
            ...data,
          },
          select: {
            id: true,
            title: true,
            abstract: true,
            year: true,
            venue: true,
            doi: true,
            updatedAt: true,
            tags: true,
          },
        });

    await indexFundingPublicationForMatching(row).catch((error) => {
      console.warn('Failed to index funding publication embedding:', error instanceof Error ? error.message : String(error));
    });

    return serializeFundingPublication(row);
  }

  async update(
    userId: string,
    publicationId: string,
    rawInput: FundingPublicationInput
  ): Promise<FundingPublicationRecord> {
    const input = normalizeFundingPublicationInput(rawInput);
    assertPublicationPayload(input);

    const existing = await prisma.referenceLibrary.findFirst({
      where: { id: publicationId, userId, isActive: true },
      select: { id: true, tags: true },
    });

    if (!existing) {
      throw new Error('Funding publication not found');
    }

    const count = await countFundingPublications(userId, publicationId);
    if (count >= MAX_FUNDING_PUBLICATIONS && !existing.tags.some((tag) => tag.toLowerCase() === FUNDING_PUBLICATION_TAG)) {
      throw new Error(`You can mark at most ${MAX_FUNDING_PUBLICATIONS} publications for funding matching`);
    }

    const row = await prisma.referenceLibrary.update({
      where: { id: publicationId },
      data: {
        title: input.title,
        abstract: input.abstract,
        year: input.year,
        venue: input.venue,
        doi: input.doi,
        tags: buildFundingPublicationTags(existing.tags),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        abstract: true,
        year: true,
        venue: true,
        doi: true,
        updatedAt: true,
        tags: true,
      },
    });

    await indexFundingPublicationForMatching(row).catch((error) => {
      console.warn('Failed to index funding publication embedding:', error instanceof Error ? error.message : String(error));
    });

    return serializeFundingPublication(row);
  }

  async remove(userId: string, publicationId: string): Promise<void> {
    const existing = await prisma.referenceLibrary.findFirst({
      where: { id: publicationId, userId, isActive: true },
      select: { id: true, tags: true },
    });

    if (!existing) {
      throw new Error('Funding publication not found');
    }

    await prisma.referenceLibrary.update({
      where: { id: publicationId },
      data: {
        tags: removeFundingPublicationTag(existing.tags),
        updatedAt: new Date(),
      },
    });

    await clearFundingPublicationEmbedding(publicationId).catch((error) => {
      console.warn('Failed to clear funding publication embedding:', error instanceof Error ? error.message : String(error));
    });
  }

  async getEmbeddingCoverage(): Promise<FundingPublicationEmbeddingCoverage> {
    const embeddingVersion = getFundingPublicationEmbeddingVersion();
    const rows = await prisma.$queryRaw<
      Array<{
        total: bigint | number;
        current: bigint | number;
        missing: bigint | number;
        stale: bigint | number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE ${fundingPublicationEmbeddingColumnSql()} IS NOT NULL
            AND funding_embedding_version = ${embeddingVersion}
        ) AS current,
        COUNT(*) FILTER (WHERE ${fundingPublicationEmbeddingColumnSql()} IS NULL) AS missing,
        COUNT(*) FILTER (
          WHERE ${fundingPublicationEmbeddingColumnSql()} IS NULL
             OR funding_embedding_version IS NULL
             OR funding_embedding_version <> ${embeddingVersion}
        ) AS stale
      FROM reference_library
      WHERE "isActive" = true
        AND ${FUNDING_PUBLICATION_TAG} = ANY(tags)
    `);

    const row = rows[0];
    return {
      total: Number(row?.total || 0),
      current: Number(row?.current || 0),
      missing: Number(row?.missing || 0),
      stale: Number(row?.stale || 0),
      embeddingVersion,
    };
  }

  async backfillEmbeddings(limit = 25): Promise<FundingPublicationEmbeddingBackfillResult> {
    if (!await areStoredEmbeddingJobsEnabled()) {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
      };
    }

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const embeddingVersion = getFundingPublicationEmbeddingVersion();
    const candidates = await prisma.$queryRaw<FundingPublicationEmbeddingRow[]>(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        title,
        abstract,
        year,
        venue,
        doi,
        authors,
        "updatedAt",
        tags,
        funding_match_text AS "fundingMatchText",
        funding_match_hash AS "fundingMatchHash",
        funding_embedding_version AS "fundingEmbeddingVersion"
      FROM reference_library
      WHERE "isActive" = true
        AND ${FUNDING_PUBLICATION_TAG} = ANY(tags)
        AND (
          ${fundingPublicationEmbeddingColumnSql()} IS NULL
          OR funding_embedding_version IS NULL
          OR funding_embedding_version <> ${embeddingVersion}
        )
      ORDER BY "updatedAt" DESC
      LIMIT ${safeLimit}
    `);

    const result: FundingPublicationEmbeddingBackfillResult = {
      processed: candidates.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const candidate of candidates) {
      try {
        await indexFundingPublicationForMatching(candidate);
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          id: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}

export const fundingPublicationService = new FundingPublicationService();
