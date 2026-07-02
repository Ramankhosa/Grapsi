// @ts-nocheck
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import type { IntakeOperator } from '@/lib/fundingIntake/types';
import { EmbeddingService } from '@/lib/services/embeddingService';
import { parseFundingDocument } from './parser';
import { sectionizeFundingDocument } from './sectionizer';
import { chunkFundingDocumentSections } from './chunker';
import { runFundingDocumentQualityChecks } from './qualityChecks';
import type { FundingDocumentUploadInput } from './types';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const embeddingService = new EmbeddingService();

function getUploadRoot() {
  return process.env.FUNDING_DOCUMENTS_UPLOAD_PATH
    ? path.resolve(process.env.FUNDING_DOCUMENTS_UPLOAD_PATH)
    : path.join(process.cwd(), 'public', 'uploads', 'funding-documents');
}

function getMaxBytes() {
  const configured = Number(process.env.FUNDING_DOC_MAX_BYTES || DEFAULT_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

function asJson(value: unknown) {
  return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function sanitizeFileName(name: string) {
  return String(name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

function inferMimeType(fileName: string, explicitMime?: string | null) {
  const lowerName = fileName.toLowerCase();
  const mime = String(explicitMime || '').toLowerCase();
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lowerName.endsWith('.doc')) {
    throw new Error('Legacy .doc files are not supported. Please convert the file to PDF or DOCX and upload again.');
  }
  throw new Error('Only PDF and DOCX funding documents are supported');
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function computeFileSha256(filePath: string) {
  return sha256(await fs.readFile(filePath));
}

async function ensureFundingCall(fundingCallId: string) {
  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      tenantId: true,
      intake_job_id: true,
      open_date: true,
      close_date: true,
      is_rolling: true,
      amount_min: true,
      amount_max: true,
      is_active: true,
    },
  });

  if (!call) {
    throw new Error('Funding call not found');
  }

  return call;
}

async function ensureUploadDir(fundingCallId: string) {
  const directory = path.join(getUploadRoot(), fundingCallId);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function getDocumentEmbeddingHealth() {
  return embeddingService.getHealth({ taskType: 'RETRIEVAL_DOCUMENT' });
}

function getDocumentEmbeddingColumn() {
  const health = getDocumentEmbeddingHealth();
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding';
}

function embeddingColumnSql() {
  return Prisma.raw(getDocumentEmbeddingColumn());
}

function vectorLiteralSql(embedding: number[]) {
  return Prisma.raw(`'[${embedding.join(',')}]'::vector`);
}

function serializeDocument(document: any, chunkStats: any[] = []) {
  const chunkCounts = chunkStats.reduce((acc, row) => {
    acc[row.embedding_status] = Number(row._count?._all || row.count || 0);
    return acc;
  }, {} as Record<string, number>);

  return {
    ...document,
    counts: {
      pages: document._count?.pages || 0,
      sections: document._count?.sections || 0,
      chunks: document._count?.chunks || 0,
      events: document._count?.events || 0,
      chunkEmbeddings: chunkCounts,
    },
  };
}

export class FundingDocumentService {
  getEmbeddingHealth() {
    return {
      document: getDocumentEmbeddingHealth(),
      chunkColumn: getDocumentEmbeddingColumn(),
    };
  }

  async uploadDocument(input: FundingDocumentUploadInput) {
    const call = await ensureFundingCall(input.fundingCallId);
    const fileName = input.file.name || 'funding-call-document';
    const mimeType = inferMimeType(fileName, input.file.type);
    const byteSize = input.file.size;

    if (byteSize > getMaxBytes()) {
      throw new Error('Funding document file is too large');
    }

    const bytes = Buffer.from(await input.file.arrayBuffer());
    const checksum = sha256(bytes);
    const existing = await prisma.fundingCallDocument.findFirst({
      where: {
        funding_call_id: input.fundingCallId,
        checksum,
      },
    });

    if (existing) {
      return {
        document: existing,
        duplicate: true,
        message: 'This document has already been uploaded for this funding call.',
      };
    }

    const uploadDir = await ensureUploadDir(input.fundingCallId);
    const destinationPath = path.join(uploadDir, `${Date.now()}_${sanitizeFileName(fileName)}`);
    await fs.writeFile(destinationPath, bytes);

    const document = await prisma.$transaction(async (tx) => {
      const aggregate = await tx.fundingCallDocument.aggregate({
        where: { funding_call_id: input.fundingCallId },
        _max: { version: true },
      });
      const version = (aggregate._max.version || 0) + 1;
      const previousActive = await tx.fundingCallDocument.findFirst({
        where: { funding_call_id: input.fundingCallId, is_active: true },
        select: { id: true },
      });

      await tx.fundingCallDocument.updateMany({
        where: { funding_call_id: input.fundingCallId, is_active: true },
        data: { is_active: false },
      });

      const created = await tx.fundingCallDocument.create({
        data: {
          funding_call_id: input.fundingCallId,
          version,
          is_active: true,
          original_filename: fileName,
          mime_type: mimeType,
          byte_size: byteSize,
          storage_path: destinationPath,
          source_url: input.sourceUrl || null,
          checksum,
          uploaded_by: input.operator.email || input.operator.userId,
          document_kind: 'call_document',
          parsing_status: 'pending',
          embedding_status: 'not_generated',
        },
      });

      await tx.fundingCallDocumentEvent.create({
        data: {
          document_id: created.id,
          funding_call_id: input.fundingCallId,
          event_type: 'uploaded',
          actor_user_id: input.operator.userId,
          payload: asJson({ originalFilename: fileName, checksum, version }),
        },
      });

      if (previousActive) {
        await tx.fundingCallDocumentEvent.create({
          data: {
            document_id: previousActive.id,
            funding_call_id: input.fundingCallId,
            event_type: 'superseded',
            actor_user_id: input.operator.userId,
            payload: asJson({ supersededByDocumentId: created.id, supersededByVersion: version }),
          },
        });
      }

      return created;
    });

    void this.processDocument(document.id, input.operator).catch((error) => {
      console.error('[FundingDocuments] background document processing failed:', error);
    });

    return {
      document,
      duplicate: false,
      message: 'Funding document uploaded and queued for processing.',
      call,
    };
  }

  async listDocuments(fundingCallId: string) {
    await ensureFundingCall(fundingCallId);
    const documents = await prisma.fundingCallDocument.findMany({
      where: { funding_call_id: fundingCallId },
      orderBy: [{ version: 'desc' }, { created_at: 'desc' }],
      include: {
        _count: {
          select: {
            pages: true,
            sections: true,
            chunks: true,
            events: true,
          },
        },
      },
    });

    const stats = await Promise.all(
      documents.map((document) =>
        prisma.fundingCallDocumentChunk.groupBy({
          by: ['embedding_status'],
          where: { document_id: document.id },
          _count: { _all: true },
        })
      )
    );

    return {
      documents: documents.map((document, index) => serializeDocument(document, stats[index] || [])),
      embeddingHealth: this.getEmbeddingHealth(),
    };
  }

  async getDocumentDetail(fundingCallId: string, documentId: string) {
    await ensureFundingCall(fundingCallId);
    const document = await prisma.fundingCallDocument.findFirst({
      where: { id: documentId, funding_call_id: fundingCallId },
      include: {
        sections: {
          orderBy: { order_index: 'asc' },
        },
        events: {
          orderBy: { created_at: 'desc' },
          take: 50,
        },
        _count: {
          select: {
            pages: true,
            sections: true,
            chunks: true,
            events: true,
          },
        },
      },
    });

    if (!document) {
      throw new Error('Funding document not found');
    }

    const chunkStats = await prisma.fundingCallDocumentChunk.groupBy({
      by: ['embedding_status'],
      where: { document_id: documentId },
      _count: { _all: true },
    });

    return {
      document: serializeDocument(document, chunkStats),
      embeddingHealth: this.getEmbeddingHealth(),
    };
  }

  async processDocument(documentId: string, operator?: Pick<IntakeOperator, 'userId' | 'email' | 'tenantId'> | null) {
    const document = await prisma.fundingCallDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new Error('Funding document not found');
    }

    const call = await ensureFundingCall(document.funding_call_id);

    try {
      await prisma.fundingCallDocument.update({
        where: { id: documentId },
        data: {
          parsing_status: 'processing',
          parsing_error: null,
          embedding_status: 'not_generated',
          quality_flags: Prisma.JsonNull,
          needs_manual_review: false,
        },
      });

      const parsed = await parseFundingDocument(document.storage_path, document.mime_type, {
        tenantId: operator?.tenantId || call.tenantId || null,
        userId: operator?.userId || document.uploaded_by || null,
        documentId,
        fundingCallId: document.funding_call_id,
      });
      const sections = await sectionizeFundingDocument(parsed.pages, {
        tenantId: operator?.tenantId || call.tenantId || null,
        userId: operator?.userId || document.uploaded_by || null,
        documentId,
        fundingCallId: document.funding_call_id,
      });
      const chunks = chunkFundingDocumentSections(sections);
      const quality = runFundingDocumentQualityChecks(call as any, sections);

      await prisma.$transaction(async (tx) => {
        await tx.fundingCallDocumentChunk.deleteMany({ where: { document_id: documentId } });
        await tx.fundingCallDocumentSection.deleteMany({ where: { document_id: documentId } });
        await tx.fundingCallDocumentPage.deleteMany({ where: { document_id: documentId } });

        if (parsed.pages.length > 0) {
          await tx.fundingCallDocumentPage.createMany({
            data: parsed.pages.map((page) => ({
              document_id: documentId,
              funding_call_id: document.funding_call_id,
              page_number: page.pageNumber,
              raw_text: page.rawText,
              cleaned_text: page.cleanedText,
              extraction_confidence: page.extractionConfidence,
            })),
          });
        }

        const sectionByOrder = new Map<number, any>();
        for (const section of sections) {
          const created = await tx.fundingCallDocumentSection.create({
            data: {
              document_id: documentId,
              funding_call_id: document.funding_call_id,
              section_type: section.sectionType,
              section_title: section.sectionTitle,
              section_text: section.sectionText,
              start_page: section.startPage,
              end_page: section.endPage,
              order_index: section.orderIndex,
              confidence: section.confidence,
              classification_method: section.classificationMethod,
            },
          });
          sectionByOrder.set(section.orderIndex, created);
        }

        if (chunks.length > 0) {
          await tx.fundingCallDocumentChunk.createMany({
            data: chunks.map((chunk) => ({
              document_id: documentId,
              funding_call_id: document.funding_call_id,
              section_id: sectionByOrder.get(chunk.sourceSectionOrderIndex)?.id || null,
              section_type: chunk.sectionType,
              chunk_index: chunk.chunkIndex,
              chunk_text: chunk.chunkText,
              page_start: chunk.pageStart,
              page_end: chunk.pageEnd,
              token_count: chunk.tokenCount,
              embedding_status: 'pending',
            })),
          });
        }

        await tx.fundingCallDocument.update({
          where: { id: documentId },
          data: {
            parsing_status: 'completed',
            parsing_error: null,
            parsing_stats: asJson({
              ...parsed.stats,
              sectionCount: sections.length,
              chunkCount: chunks.length,
            }),
            quality_flags: asJson(quality),
            needs_manual_review: quality.needsManualReview,
            embedding_status: chunks.length > 0 ? 'not_generated' : 'generated',
          },
        });

        if (quality.needsManualReview) {
          await tx.fundingCallDocumentEvent.create({
            data: {
              document_id: documentId,
              funding_call_id: document.funding_call_id,
              event_type: 'quality_flagged',
              actor_user_id: operator?.userId || null,
              payload: asJson(quality),
            },
          });
        }
      });

      if (chunks.length > 0) {
        await this.embedDocumentChunks(documentId);
      }
    } catch (error) {
      await prisma.fundingCallDocument.update({
        where: { id: documentId },
        data: {
          parsing_status: 'failed',
          parsing_error: error instanceof Error ? error.message : String(error),
          embedding_status: 'failed',
        },
      });
      throw error;
    }
  }

  async reprocessDocument(fundingCallId: string, documentId: string, operator: IntakeOperator) {
    const document = await prisma.fundingCallDocument.findFirst({
      where: { id: documentId, funding_call_id: fundingCallId },
    });
    if (!document) {
      throw new Error('Funding document not found');
    }

    await prisma.fundingCallDocumentEvent.create({
      data: {
        document_id: documentId,
        funding_call_id: fundingCallId,
        event_type: 'reprocessed',
        actor_user_id: operator.userId,
        payload: asJson({ requestedAt: new Date().toISOString() }),
      },
    });

    void this.processDocument(documentId, operator).catch((error) => {
      console.error('[FundingDocuments] background reprocess failed:', error);
    });

    return this.getDocumentDetail(fundingCallId, documentId);
  }

  async reembedDocument(fundingCallId: string, documentId: string, operator: IntakeOperator) {
    const document = await prisma.fundingCallDocument.findFirst({
      where: { id: documentId, funding_call_id: fundingCallId },
    });
    if (!document) {
      throw new Error('Funding document not found');
    }

    await prisma.fundingCallDocumentEvent.create({
      data: {
        document_id: documentId,
        funding_call_id: fundingCallId,
        event_type: 're_embedded',
        actor_user_id: operator.userId,
        payload: asJson({ requestedAt: new Date().toISOString(), force: true }),
      },
    });

    void this.embedDocumentChunks(documentId, { force: true }).catch((error) => {
      console.error('[FundingDocuments] background re-embed failed:', error);
    });

    return this.getDocumentDetail(fundingCallId, documentId);
  }

  async activateDocument(fundingCallId: string, documentId: string, operator: IntakeOperator) {
    const document = await prisma.fundingCallDocument.findFirst({
      where: { id: documentId, funding_call_id: fundingCallId },
    });
    if (!document) {
      throw new Error('Funding document not found');
    }

    await prisma.$transaction(async (tx) => {
      await tx.fundingCallDocument.updateMany({
        where: { funding_call_id: fundingCallId, is_active: true },
        data: { is_active: false },
      });
      await tx.fundingCallDocument.update({
        where: { id: documentId },
        data: { is_active: true },
      });
      await tx.fundingCallDocumentEvent.create({
        data: {
          document_id: documentId,
          funding_call_id: fundingCallId,
          event_type: 'uploaded',
          actor_user_id: operator.userId,
          payload: asJson({ activatedVersion: document.version }),
        },
      });
    });

    return this.getDocumentDetail(fundingCallId, documentId);
  }

  async embedDocumentChunks(documentId: string, options: { force?: boolean; limit?: number } = {}) {
    const document = await prisma.fundingCallDocument.findUnique({
      where: { id: documentId },
      include: {
        funding_call: {
          select: { tenantId: true },
        },
      },
    });
    if (!document) {
      throw new Error('Funding document not found');
    }

    const health = getDocumentEmbeddingHealth();
    const staleFilter = options.force
      ? {}
      : {
          OR: [
            { embedding_status: { in: ['pending', 'failed'] } },
            { embedding_provider: { not: health.provider } },
            { embedding_model: { not: health.modelName } },
            { embedding_dimension: { not: health.outputDimensionality } },
            { embedding_provider: null },
            { embedding_model: null },
            { embedding_dimension: null },
          ],
        };

    const chunks = await prisma.fundingCallDocumentChunk.findMany({
      where: {
        document_id: documentId,
        ...staleFilter,
      },
      orderBy: { chunk_index: 'asc' },
      take: options.limit ? Math.max(1, options.limit) : undefined,
    });

    if (chunks.length === 0) {
      await prisma.fundingCallDocument.update({
        where: { id: documentId },
        data: { embedding_status: 'generated' },
      });
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    await prisma.fundingCallDocument.update({
      where: { id: documentId },
      data: { embedding_status: 'processing' },
    });

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const chunk of chunks) {
      const result = await embeddingService.generateEmbedding(
        chunk.chunk_text,
        document.funding_call?.tenantId
          ? {
              tenantId: document.funding_call.tenantId,
              userId: document.uploaded_by || undefined,
              taskCode: 'FUNDING_CHAT',
              stageCode: 'FUNDING_DOCUMENT_CHUNK_EMBEDDING',
              operation: 'funding_document_chunk_embedding',
              metadata: {
                documentId,
                chunkId: chunk.id,
              },
            }
          : undefined,
        {
          taskType: 'RETRIEVAL_DOCUMENT',
          inputType: 'document',
          title: `${document.original_filename} chunk ${chunk.chunk_index}`,
        }
      );

      if (result.error || result.embedding.length === 0) {
        failed += 1;
        const message = result.error || 'Embedding provider returned an empty vector';
        errors.push({ id: chunk.id, error: message });
        await prisma.fundingCallDocumentChunk.update({
          where: { id: chunk.id },
          data: {
            embedding_status: 'failed',
            embedding_error: message,
            embedding_provider: result.provider || health.provider,
            embedding_model: result.modelName || health.modelName,
            embedding_dimension: result.outputDimensionality || health.outputDimensionality,
          },
        });
        continue;
      }

      succeeded += 1;
      await prisma.$executeRaw(Prisma.sql`
        UPDATE funding_call_document_chunks
        SET
          ${embeddingColumnSql()} = ${vectorLiteralSql(result.embedding)},
          embedding_status = 'generated'::"FundingCallDocumentChunkEmbeddingStatus",
          embedding_error = NULL,
          embedding_provider = ${result.provider || health.provider},
          embedding_model = ${result.modelName || health.modelName},
          embedding_dimension = ${result.outputDimensionality || health.outputDimensionality}
        WHERE id = ${chunk.id}
      `);
    }

    const allStats = await prisma.fundingCallDocumentChunk.groupBy({
      by: ['embedding_status'],
      where: { document_id: documentId },
      _count: { _all: true },
    });
    const total = allStats.reduce((sum, row) => sum + row._count._all, 0);
    const generated = allStats.find((row) => row.embedding_status === 'generated')?._count._all || 0;
    const totalFailed = allStats.find((row) => row.embedding_status === 'failed')?._count._all || 0;

    await prisma.fundingCallDocument.update({
      where: { id: documentId },
      data: {
        embedding_status:
          total === 0 || generated === total
            ? 'generated'
            : generated > 0
              ? 'partial'
              : totalFailed > 0
                ? 'failed'
                : 'not_generated',
      },
    });

    return {
      processed: chunks.length,
      succeeded,
      failed,
      errors,
    };
  }

  async backfillDocumentEmbeddings(limit = 25) {
    const health = getDocumentEmbeddingHealth();
    const cappedLimit = Math.max(1, Math.min(Number(limit || 25), 100));
    const chunks = await prisma.fundingCallDocumentChunk.findMany({
      where: {
        document: {
          parsing_status: 'completed',
        },
        OR: [
          { embedding_status: { in: ['pending', 'failed'] } },
          { embedding_provider: { not: health.provider } },
          { embedding_model: { not: health.modelName } },
          { embedding_dimension: { not: health.outputDimensionality } },
          { embedding_provider: null },
          { embedding_model: null },
          { embedding_dimension: null },
        ],
      },
      distinct: ['document_id'],
      orderBy: { created_at: 'asc' },
      take: cappedLimit,
      select: { document_id: true },
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of chunks) {
      try {
        const result = await this.embedDocumentChunks(row.document_id, { limit: cappedLimit - processed });
        processed += result.processed;
        succeeded += result.succeeded;
        failed += result.failed;
        errors.push(...result.errors);
        if (processed >= cappedLimit) {
          break;
        }
      } catch (error) {
        failed += 1;
        errors.push({ id: row.document_id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      processed,
      succeeded,
      failed,
      errors,
      embeddingHealth: this.getEmbeddingHealth(),
    };
  }

  async syncFromIntake(fundingCallId: string, operator: IntakeOperator) {
    const call = await ensureFundingCall(fundingCallId);
    if (!call.intake_job_id) {
      throw new Error('This funding call does not have an intake source to sync');
    }

    const intakeJob = await prisma.fundingIntakeJob.findUnique({
      where: { id: call.intake_job_id },
      select: {
        id: true,
        input_type: true,
        source_file_path: true,
        source_url: true,
        source_text_hash: true,
      },
    });

    if (!intakeJob || intakeJob.input_type !== 'pdf' || !intakeJob.source_file_path) {
      throw new Error('The linked intake source is not a reusable PDF');
    }

    const storagePath = intakeJob.source_file_path;
    if (!fsSync.existsSync(path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath))) {
      throw new Error('The linked intake PDF file could not be found');
    }

    const checksum = intakeJob.source_text_hash || await computeFileSha256(storagePath);
    const existing = await prisma.fundingCallDocument.findFirst({
      where: { funding_call_id: fundingCallId, checksum },
    });
    if (existing) {
      return {
        document: existing,
        duplicate: true,
        message: 'The intake PDF is already registered as a funding document.',
      };
    }

    const byteSize = (await fs.stat(storagePath)).size;
    const document = await prisma.$transaction(async (tx) => {
      const aggregate = await tx.fundingCallDocument.aggregate({
        where: { funding_call_id: fundingCallId },
        _max: { version: true },
      });
      const version = (aggregate._max.version || 0) + 1;
      await tx.fundingCallDocument.updateMany({
        where: { funding_call_id: fundingCallId, is_active: true },
        data: { is_active: false },
      });
      const created = await tx.fundingCallDocument.create({
        data: {
          funding_call_id: fundingCallId,
          version,
          is_active: true,
          original_filename: path.basename(storagePath),
          mime_type: 'application/pdf',
          byte_size: byteSize,
          storage_path: storagePath,
          source_url: intakeJob.source_url || null,
          checksum,
          uploaded_by: operator.email || operator.userId,
          document_kind: 'call_document',
          parsing_status: 'pending',
          embedding_status: 'not_generated',
        },
      });
      await tx.fundingCallDocumentEvent.create({
        data: {
          document_id: created.id,
          funding_call_id: fundingCallId,
          event_type: 'uploaded',
          actor_user_id: operator.userId,
          payload: asJson({ source: 'funding_intake', intakeJobId: intakeJob.id, version }),
        },
      });
      return created;
    });

    void this.processDocument(document.id, operator).catch((error) => {
      console.error('[FundingDocuments] background intake sync processing failed:', error);
    });

    return {
      document,
      duplicate: false,
      message: 'Intake PDF registered and queued for processing.',
    };
  }
}

export const fundingDocumentService = new FundingDocumentService();
