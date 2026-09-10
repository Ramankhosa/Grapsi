// @ts-nocheck
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { EmbeddingService } from '@/lib/services/embeddingService';
import type { FundingDocumentSearchRequest, FundingDocumentSearchResult } from './types';
import type { FundingDocumentSectionType } from './constants';

const embeddingService = new EmbeddingService();

function getDocumentEmbeddingHealth(taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT') {
  return embeddingService.getHealth({ taskType });
}

function getChunkEmbeddingColumn() {
  const health = getDocumentEmbeddingHealth('RETRIEVAL_QUERY');
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding';
}

function chunkEmbeddingColumnSql() {
  return Prisma.raw(getChunkEmbeddingColumn());
}

function aliasedChunkEmbeddingColumnSql() {
  return Prisma.raw(`c.${getChunkEmbeddingColumn()}`);
}

function vectorLiteralSql(embedding: number[]) {
  return Prisma.raw(`'[${embedding.join(',')}]'::vector`);
}

function sqlTextArray(values: string[]) {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`;
}

function buildAccessCondition(access: FundingDocumentSearchRequest['access']) {
  if (access?.isSuperAdmin) {
    return Prisma.sql`TRUE`;
  }

  if (access?.tenantId) {
    return Prisma.sql`(
      fc.visibility = 'GLOBAL_PUBLISHED' OR
      (fc.visibility = 'TENANT_PRIVATE' AND fc."tenantId" = ${access.tenantId})
    )`;
  }

  return Prisma.sql`fc.visibility = 'GLOBAL_PUBLISHED'`;
}

function buildCallStatusCondition(status: FundingDocumentSearchRequest['callStatus'] = 'active') {
  switch (status) {
    case 'any':
      return Prisma.sql`TRUE`;
    case 'upcoming':
      return Prisma.sql`fc.open_date IS NOT NULL AND fc.open_date > CURRENT_DATE`;
    case 'closed':
      return Prisma.sql`COALESCE(fc.is_rolling, false) = false AND COALESCE(fc.close_date, fc.expiration_date) < CURRENT_DATE`;
    case 'active':
    default:
      return Prisma.sql`(
        COALESCE(fc.is_rolling, false) = true OR
        COALESCE(fc.close_date, fc.expiration_date) IS NULL OR
        COALESCE(fc.close_date, fc.expiration_date) >= CURRENT_DATE
      )`;
  }
}

function combineConditions(conditions: Prisma.Sql[]) {
  return conditions.reduce((acc, condition, index) =>
    index === 0 ? condition : Prisma.sql`${acc} AND ${condition}`
  );
}

function mapRow(row: any): FundingDocumentSearchResult {
  return {
    chunkId: row.chunkId,
    documentId: row.documentId,
    fundingCallId: row.fundingCallId,
    sectionId: row.sectionId || null,
    sectionTitle: row.sectionTitle || null,
    sectionType: row.sectionType,
    chunkText: row.chunkText,
    pageStart: Number(row.pageStart || 0),
    pageEnd: Number(row.pageEnd || 0),
    similarity: Number(row.similarity || 0),
    documentVersion: Number(row.documentVersion || 0),
    qualityFlags: row.qualityFlags || null,
  };
}

export class FundingDocumentRetrievalService {
  getEmbeddingHealth() {
    return {
      query: getDocumentEmbeddingHealth('RETRIEVAL_QUERY'),
      document: getDocumentEmbeddingHealth('RETRIEVAL_DOCUMENT'),
      chunkColumn: getChunkEmbeddingColumn(),
    };
  }

  /** True when the call has at least one chunk with a generated embedding, i.e. retrieval can return anything at all. */
  async hasGeneratedChunks(fundingCallId: string): Promise<boolean> {
    const count = await prisma.fundingCallDocumentChunk.count({
      where: { funding_call_id: fundingCallId, embedding_status: 'generated' },
    });
    return count > 0;
  }

  /**
   * Embed a retrieval question once. Callers that search twice (section-routed,
   * then widened) pass the vector back in via `queryEmbedding` instead of paying
   * for a second identical embedding.
   */
  async embedQuery(query: string, llmContext?: FundingDocumentSearchRequest['llmContext']): Promise<number[]> {
    const response = await embeddingService.generateEmbedding(
      query,
      llmContext?.tenantId
        ? {
            tenantId: llmContext.tenantId,
            userId: llmContext.userId || undefined,
            taskCode: 'FUNDING_CHAT',
            stageCode: 'FUNDING_DOCUMENT_RETRIEVAL',
            operation: 'funding_document_query_embedding',
          }
        : undefined,
      {
        taskType: 'RETRIEVAL_QUERY',
        inputType: 'query',
      }
    );

    if (response.error || response.embedding.length === 0) {
      throw new Error(response.error || 'Could not generate document retrieval query embedding');
    }
    return response.embedding;
  }

  async searchChunks(request: FundingDocumentSearchRequest): Promise<FundingDocumentSearchResult[]> {
    const query = String(request.query || '').trim();
    if (!query) {
      return [];
    }

    const topK = Math.max(1, Math.min(Number(request.topK || 8), 25));
    const minSimilarity = Math.max(0, Math.min(Number(request.minSimilarity ?? 0.35), 1));
    const documentHealth = getDocumentEmbeddingHealth('RETRIEVAL_DOCUMENT');
    const queryEmbedding = request.queryEmbedding?.length
      ? request.queryEmbedding
      : await this.embedQuery(query, request.llmContext);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`d.is_active = true`,
      Prisma.sql`d.parsing_status = 'completed'::"FundingDocumentParsingStatus"`,
      Prisma.sql`c.embedding_status = 'generated'::"FundingCallDocumentChunkEmbeddingStatus"`,
      Prisma.sql`c.embedding_provider = ${documentHealth.provider}`,
      Prisma.sql`c.embedding_model = ${documentHealth.modelName}`,
      Prisma.sql`c.embedding_dimension = ${documentHealth.outputDimensionality}`,
      Prisma.sql`${aliasedChunkEmbeddingColumnSql()} IS NOT NULL`,
      Prisma.sql`(fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED' OR ${request.access?.isSuperAdmin ? true : false})`,
      Prisma.sql`COALESCE(fc.is_active, true) = true`,
      buildAccessCondition(request.access),
      buildCallStatusCondition(request.callStatus),
    ];

    if (request.fundingCallId) {
      conditions.push(Prisma.sql`c.funding_call_id = ${request.fundingCallId}`);
    }

    if (request.sectionTypes?.length) {
      conditions.push(Prisma.sql`c.section_type::text = ANY(${sqlTextArray(request.sectionTypes)})`);
    }

    if (request.documentKinds?.length) {
      conditions.push(Prisma.sql`d.document_kind::text = ANY(${sqlTextArray(request.documentKinds)})`);
    }

    const where = combineConditions(conditions);
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scored AS (
        SELECT
          c.id::text AS "chunkId",
          c.document_id::text AS "documentId",
          c.funding_call_id::text AS "fundingCallId",
          c.section_id::text AS "sectionId",
          s.section_title AS "sectionTitle",
          c.section_type::text AS "sectionType",
          c.chunk_text AS "chunkText",
          c.page_start AS "pageStart",
          c.page_end AS "pageEnd",
          d.version AS "documentVersion",
          d.quality_flags AS "qualityFlags",
          (1 - (${aliasedChunkEmbeddingColumnSql()} <=> ${vectorLiteralSql(queryEmbedding)}))::float AS similarity
        FROM funding_call_document_chunks c
        JOIN funding_call_documents d ON d.id = c.document_id
        JOIN funding_calls fc ON fc.id = c.funding_call_id
        LEFT JOIN funding_call_document_sections s ON s.id = c.section_id
        WHERE ${where}
      )
      SELECT *
      FROM scored
      WHERE similarity >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${topK}
    `);

    return rows.map(mapRow);
  }

  async getSectionChunks(
    fundingCallId: string,
    sectionTypes: FundingDocumentSectionType[],
    access?: FundingDocumentSearchRequest['access'],
    limit = 20,
    documentKinds?: string[]
  ): Promise<FundingDocumentSearchResult[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`d.is_active = true`,
      Prisma.sql`d.parsing_status = 'completed'::"FundingDocumentParsingStatus"`,
      Prisma.sql`c.funding_call_id = ${fundingCallId}`,
    ];

    if (access) {
      conditions.push(buildAccessCondition(access));
    }

    if (sectionTypes.length > 0) {
      conditions.push(Prisma.sql`c.section_type::text = ANY(${sqlTextArray(sectionTypes)})`);
    }

    if (documentKinds?.length) {
      conditions.push(Prisma.sql`d.document_kind::text = ANY(${sqlTextArray(documentKinds)})`);
    }

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        c.id::text AS "chunkId",
        c.document_id::text AS "documentId",
        c.funding_call_id::text AS "fundingCallId",
        c.section_id::text AS "sectionId",
        s.section_title AS "sectionTitle",
        c.section_type::text AS "sectionType",
        c.chunk_text AS "chunkText",
        c.page_start AS "pageStart",
        c.page_end AS "pageEnd",
        d.version AS "documentVersion",
        d.quality_flags AS "qualityFlags",
        1::float AS similarity
      FROM funding_call_document_chunks c
      JOIN funding_call_documents d ON d.id = c.document_id
      JOIN funding_calls fc ON fc.id = c.funding_call_id
      LEFT JOIN funding_call_document_sections s ON s.id = c.section_id
      WHERE ${combineConditions(conditions)}
      ORDER BY c.chunk_index ASC
      LIMIT ${Math.max(1, Math.min(limit, 100))}
    `);

    return rows.map(mapRow);
  }
}

export const fundingDocumentRetrievalService = new FundingDocumentRetrievalService();
