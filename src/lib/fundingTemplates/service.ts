// @ts-nocheck
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  FundingCallTemplate,
  FundingCallTemplateStatus,
  FundingTemplateLifecycleStatus,
  FundingRevisionStatus,
} from '@prisma/client';
import prisma from '../prisma';
import { startExtractionHeartbeat } from '../funding/extractionRunLifecycle';
import type { IntakeOperator } from '../fundingIntake/types';
import {
  assertSafePublicHttpsUrl,
  fetchReadableUrlContent,
  hashText,
  normalizeMultilineText,
} from '../fundingIntake/utils';
import { extractGrantTemplateFromAssets } from './extractor';
import {
  buildAssetSequenceMap,
  buildCompatibilitySummary,
  createEmptyGrantTemplate,
  generateDiffSummary,
  mergeGrantTemplates,
  normalizeGrantTemplate,
  sortAndDeduplicateGrantTemplate,
} from './utils';
import {
  buildStandardGrantApplicationTemplate,
  STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
  STANDARD_GRANT_TEMPLATE_VERSION,
} from './standardGrantTemplate';
import { TEMPLATE_UPLOAD_DIR } from './storage';

type TemplateRevisionType =
  | 'manual_create'
  | 'manual_edit'
  | 'extraction_import'
  | 'approval'
  | 'reorder'
  | 'delete_item'
  | 'revert';

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

// Intentionally a no-op: we no longer force-fail in-progress template extraction
// runs based on elapsed time (see failStaleGuidelineRuns for rationale). Call sites
// are kept so signatures are unchanged.
async function failStaleTemplateRuns(_fundingCallId?: string) {
  return;
}

function buildAssetSetHash(assets: Array<{ id: string; sequence_no: number; checksum?: string | null }>) {
  return hashText(assets.map((asset) => `${asset.id}:${asset.sequence_no}:${asset.checksum || ''}`).join('|'));
}

function readRunAssetIds(rawOutput: unknown): string[] {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) return [];
  const assetIds = (rawOutput as Record<string, unknown>).assetIds;
  return Array.isArray(assetIds) ? assetIds.map(String).filter(Boolean) : [];
}

function hasTemplateItems(value: unknown) {
  const template = normalizeGrantTemplate(value);
  return Boolean(
    template.budget
    || template.questions.length
    || template.sections.length
    || template.attachments.length
    || template.evaluationCriteria.length
    || template.submissionRules.items.length
  );
}

function lifecycleFromTemplateStatus(status: FundingCallTemplateStatus): FundingTemplateLifecycleStatus {
  if (status === 'approved') {
    return 'approved';
  }

  return 'draft';
}

function getCompatibilityWarnings(compatibility: Prisma.JsonValue | null | undefined): string[] {
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) {
    return [];
  }

  const warnings = (compatibility as Record<string, unknown>).warnings;
  return Array.isArray(warnings) ? warnings.map((warning) => String(warning)) : [];
}

function readAssetMetadata(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function getEffectiveCompiledTemplateJson(value: {
  compiledGrantTemplateJson?: Prisma.JsonValue | null;
  compiled_papsi_json?: Prisma.JsonValue | null;
}) {
  return value.compiledGrantTemplateJson ?? value.compiled_papsi_json ?? null;
}

function canonicalRevisionStatusFromTemplateStatus(
  status: FundingCallTemplateStatus
): FundingRevisionStatus {
  return status === 'approved' ? 'APPROVED' : 'DRAFT';
}

function serializeTemplateRevision(revision: any) {
  if (!revision) {
    return revision;
  }

  const effectiveCompiledTemplateJson = getEffectiveCompiledTemplateJson(revision);

  return {
    ...revision,
    template_id: revision.template_id ?? revision.templateId,
    revision_no: revision.revision_no ?? revision.version,
    approved_state:
      revision.approved_state ??
      (revision.status === 'APPROVED' ? 'approved' : 'draft'),
    grant_template_json: revision.grant_template_json ?? revision.extractedPayload,
    compatibility_json: revision.compatibility_json ?? revision.summaryJson ?? null,
    compiled_grant_template_json: effectiveCompiledTemplateJson,
    compiledGrantTemplateJson: effectiveCompiledTemplateJson,
    compiled_papsi_json: revision.compiled_papsi_json ?? effectiveCompiledTemplateJson,
    editor_user_id: revision.editor_user_id ?? revision.createdByUserId ?? null,
    created_at: revision.created_at ?? revision.createdAt ?? null,
  };
}

async function findTemplateRevisionByVersion(templateId: string, revisionNo: number) {
  return prisma.fundingCallTemplateRevision.findFirst({
    where: {
      OR: [
        {
          templateId,
          version: revisionNo,
        },
        {
          template_id: templateId,
          revision_no: revisionNo,
        },
      ],
    },
  });
}

async function getNextSequenceNo(
  fundingCallId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const aggregate = await client.fundingCallTemplateAsset.aggregate({
    where: { funding_call_id: fundingCallId },
    _max: { sequence_no: true },
  });

  return (aggregate._max.sequence_no || 0) + 1;
}

function extractTemplateSummary(template: FundingCallTemplate | null) {
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    status: template.status,
    current_revision_no: template.current_revision_no,
    grant_template_json: template.grant_template_json,
    compatibility_json: template.compatibility_json,
    compiled_grant_template_json: getEffectiveCompiledTemplateJson(template),
    compiledGrantTemplateJson: getEffectiveCompiledTemplateJson(template),
    compiled_papsi_json: template.compiled_papsi_json ?? getEffectiveCompiledTemplateJson(template),
    last_edited_by: template.last_edited_by,
    last_edited_at: template.last_edited_at,
    approved_by: template.approved_by,
    approved_at: template.approved_at,
    created_at: template.created_at,
    updated_at: template.updated_at,
  };
}

async function ensureFundingCall(fundingCallId: string) {
  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      agency_name: true,
      scheme_title: true,
      status: true,
      guideline_status: true,
      template_status: true,
      active_template_id: true,
      intake_job_id: true,
      source_url: true,
    },
  });

  if (!call) {
    throw new Error('Funding call not found');
  }

  return call;
}

async function ensureTemplateRecord(fundingCallId: string, operator: IntakeOperator) {
  const call = await ensureFundingCall(fundingCallId);

  let template = await prisma.fundingCallTemplate.findUnique({
    where: { fundingCallId: fundingCallId },
  });

  if (template) {
    return { call, template };
  }

  const grantTemplate = createEmptyGrantTemplate();
  const compatibility = buildCompatibilitySummary(grantTemplate);

  template = await prisma.$transaction(async (tx) => {
    const created = await tx.fundingCallTemplate.create({
      data: {
        fundingCallId: fundingCallId,
        status: 'draft',
        grant_template_json: asJson(grantTemplate),
        compatibility_json: asJson(compatibility),
        compiledGrantTemplateJson: Prisma.DbNull,
        current_revision_no: 1,
        last_edited_by: operator.email,
        last_edited_at: new Date(),
      },
    });

    await tx.fundingCallTemplateRevision.create({
      data: {
        templateId: created.id,
        version: 1,
        status: 'DRAFT',
        extractedPayload: asJson(grantTemplate),
        createdByUserId: operator.userId,
        revision_no: 1,
        revision_type: 'manual_create',
        grant_template_json: asJson(grantTemplate),
        compatibility_json: asJson(compatibility),
        compiledGrantTemplateJson: Prisma.DbNull,
        diff_summary: generateDiffSummary(null, grantTemplate),
        editor_user_id: operator.userId,
        approved_state: 'draft',
        change_notes: 'Blank template created',
      },
    });

    await tx.fundingCall.update({
      where: { id: fundingCallId },
      data: {
        template_status: 'draft',
        active_template_id: created.id,
      },
    });

    return created;
  });

  return { call, template };
}

async function findApprovedTemplateRevision(templateId: string) {
  return prisma.fundingCallTemplateRevision.findFirst({
    where: {
      OR: [
        { templateId, status: 'APPROVED' },
        { templateId, approved_state: 'approved' },
        { template_id: templateId, status: 'APPROVED' },
        { template_id: templateId, approved_state: 'approved' },
      ],
    },
    orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
  });
}

async function createRevision(
  tx: Prisma.TransactionClient,
  template: FundingCallTemplate,
  options: {
    revisionType: TemplateRevisionType;
    grantTemplate: unknown;
    compatibility: unknown;
    editorUserId: string;
    approvedState: FundingCallTemplateStatus;
    changeNotes?: string | null;
    diffSummary: string;
  }
) {
  const revisionNo = template.current_revision_no + 1;

  await tx.fundingCallTemplateRevision.create({
    data: {
      templateId: template.id,
      version: revisionNo,
      status: canonicalRevisionStatusFromTemplateStatus(options.approvedState),
      extractedPayload: asJson(options.grantTemplate),
      createdByUserId: options.editorUserId,
      revision_no: revisionNo,
      revision_type: options.revisionType,
      grant_template_json: asJson(options.grantTemplate),
      compatibility_json: asJson(options.compatibility),
      compiledGrantTemplateJson: Prisma.DbNull,
      diff_summary: options.diffSummary,
      editor_user_id: options.editorUserId,
      approved_state: options.approvedState,
      change_notes: options.changeNotes || null,
    },
  });

  return revisionNo;
}

function nextLifecycleStatusForManualEdit(
  template: FundingCallTemplate,
  currentCallTemplateStatus: FundingTemplateLifecycleStatus
): FundingTemplateLifecycleStatus {
  if (template.status === 'approved') {
    return 'approved';
  }

  if (currentCallTemplateStatus === 'needs_review') {
    return 'needs_review';
  }

  return 'draft';
}

async function ensureUploadDir() {
  await fs.mkdir(TEMPLATE_UPLOAD_DIR, { recursive: true });
}

async function deleteLocalAssetIfPresent(storagePathValue?: string | null) {
  if (!storagePathValue) {
    return;
  }

  const resolvedStoragePath = path.resolve(
    path.isAbsolute(storagePathValue) ? storagePathValue : path.join(process.cwd(), storagePathValue)
  );
  const resolvedUploadDir = path.resolve(TEMPLATE_UPLOAD_DIR);
  const relativePath = path.relative(resolvedUploadDir, resolvedStoragePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return;
  }

  try {
    await fs.unlink(resolvedStoragePath);
  } catch {
    // Best-effort cleanup only.
  }
}

export class FundingTemplateService {
  async ensureStandardFallbackTemplate(fundingCallId: string, operator: IntakeOperator) {
    await ensureFundingCall(fundingCallId);

    const existingTemplate = await prisma.fundingCallTemplate.findUnique({
      where: { fundingCallId: fundingCallId },
    });

    if (existingTemplate?.status === 'approved') {
      return {
        created: false,
        template: existingTemplate,
        reason: 'approved_template_exists' as const,
      };
    }

    if (existingTemplate) {
      const approvedRevision = await findApprovedTemplateRevision(existingTemplate.id);
      if (approvedRevision) {
        return {
          created: false,
          template: existingTemplate,
          reason: 'approved_revision_exists' as const,
        };
      }
    }

    const fallbackTemplate = buildStandardGrantApplicationTemplate();
    const compatibility = buildCompatibilitySummary(fallbackTemplate, [
      STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
      `fallback_template_version:${STANDARD_GRANT_TEMPLATE_VERSION}`,
    ]);
    const now = new Date();
    const operatorEmail = operator.email || operator.userId || 'system';

    const template = await prisma.$transaction(async (tx) => {
      const templateRecord = existingTemplate || await tx.fundingCallTemplate.create({
        data: {
          fundingCallId: fundingCallId,
          status: 'draft',
          grant_template_json: asJson(createEmptyGrantTemplate()),
          compatibility_json: asJson(buildCompatibilitySummary(createEmptyGrantTemplate())),
          compiledGrantTemplateJson: Prisma.DbNull,
          current_revision_no: 0,
          last_edited_by: operatorEmail,
          last_edited_at: now,
        },
      });
      const previousTemplate = existingTemplate
        ? normalizeGrantTemplate(existingTemplate.grant_template_json)
        : null;
      const revisionNo = await createRevision(tx, templateRecord, {
        revisionType: 'manual_create',
        grantTemplate: fallbackTemplate,
        compatibility,
        editorUserId: operator.userId,
        approvedState: 'approved',
        changeNotes: `${STANDARD_GRANT_TEMPLATE_VERSION}: standard fallback grant application template`,
        diffSummary: generateDiffSummary(previousTemplate, fallbackTemplate),
      });

      await tx.fundingCallTemplate.update({
        where: { id: templateRecord.id },
        data: {
          status: 'approved',
          grant_template_json: asJson(fallbackTemplate),
          compatibility_json: asJson(compatibility),
          compiledGrantTemplateJson: Prisma.DbNull,
          current_revision_no: revisionNo,
          last_edited_by: operatorEmail,
          last_edited_at: now,
          approved_by: operatorEmail,
          approved_at: now,
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          template_status: 'approved',
          active_template_id: templateRecord.id,
        },
      });

      return tx.fundingCallTemplate.findUnique({
        where: { id: templateRecord.id },
      });
    });

    return {
      created: true,
      template,
      reason: 'standard_fallback_created' as const,
    };
  }

  async getTemplateBundle(fundingCallId: string) {
    const call = await ensureFundingCall(fundingCallId);
    await failStaleTemplateRuns(fundingCallId);

    const [template, assets, runs, revisions] = await Promise.all([
      prisma.fundingCallTemplate.findUnique({
        where: { fundingCallId: fundingCallId },
      }),
      prisma.fundingCallTemplateAsset.findMany({
        where: { funding_call_id: fundingCallId },
        orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
      }),
      prisma.fundingCallTemplateRun.findMany({
        where: { funding_call_id: fundingCallId },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.fundingCallTemplate.findUnique({
        where: { fundingCallId: fundingCallId },
        select: {
          revisions: {
            orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
            take: 20,
          },
        },
      }),
    ]);

    return {
      fundingCall: call,
      template: extractTemplateSummary(template),
      assets,
      runs,
      revisions: (revisions?.revisions || []).map(serializeTemplateRevision),
    };
  }

  async createBlankTemplate(fundingCallId: string, operator: IntakeOperator) {
    await ensureTemplateRecord(fundingCallId, operator);
    return this.getTemplateBundle(fundingCallId);
  }

  async updateTemplate(
    fundingCallId: string,
    grantTemplateJson: unknown,
    operator: IntakeOperator,
    changeNotes?: string
  ) {
    const { call, template } = await ensureTemplateRecord(fundingCallId, operator);
    const previousTemplate = normalizeGrantTemplate(template.grant_template_json);
    const nextTemplate = sortAndDeduplicateGrantTemplate(normalizeGrantTemplate(grantTemplateJson));
    const compatibility = buildCompatibilitySummary(
      nextTemplate,
      getCompatibilityWarnings(template.compatibility_json)
    );
    const diffSummary = generateDiffSummary(previousTemplate, nextTemplate);
    // Auto-approve on commit: any non-empty template an operator saves/imports is
    // immediately usable — there is no separate "Approve" step anymore. Empty
    // templates keep the previous behavior.
    const autoApprove = hasTemplateItems(nextTemplate);
    const nextApprovedState = autoApprove ? 'approved' : template.status;
    const lifecycleStatus = autoApprove ? 'approved' : nextLifecycleStatusForManualEdit(template, call.template_status);

    await prisma.$transaction(async (tx) => {
      const revisionNo = await createRevision(tx, template, {
        revisionType: autoApprove ? 'approval' : 'manual_edit',
        grantTemplate: nextTemplate,
        compatibility,
        editorUserId: operator.userId,
        approvedState: nextApprovedState,
        changeNotes,
        diffSummary,
      });

      await tx.fundingCallTemplate.update({
        where: { id: template.id },
        data: {
          grant_template_json: asJson(nextTemplate),
          compatibility_json: asJson(compatibility),
          compiledGrantTemplateJson: Prisma.DbNull,
          current_revision_no: revisionNo,
          last_edited_by: operator.email,
          last_edited_at: new Date(),
          status: nextApprovedState,
          approved_by: autoApprove ? operator.email : undefined,
          approved_at: autoApprove ? new Date() : undefined,
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          template_status: lifecycleStatus,
          active_template_id: template.id,
        },
      });
    });

    return this.getTemplateBundle(fundingCallId);
  }

  async approveTemplate(fundingCallId: string, operator: IntakeOperator) {
    const { template } = await ensureTemplateRecord(fundingCallId, operator);
    const currentTemplate = normalizeGrantTemplate(template.grant_template_json);
    const currentCompatibility = template.compatibility_json || buildCompatibilitySummary(currentTemplate);
    const diffSummary = 'Approved template revision';

    await prisma.$transaction(async (tx) => {
      const revisionNo = await createRevision(tx, template, {
        revisionType: 'approval',
        grantTemplate: currentTemplate,
        compatibility: currentCompatibility,
        editorUserId: operator.userId,
        approvedState: 'approved',
        changeNotes: 'Template approved',
        diffSummary,
      });

      await tx.fundingCallTemplate.update({
        where: { id: template.id },
        data: {
          status: 'approved',
          current_revision_no: revisionNo,
          approved_by: operator.email,
          approved_at: new Date(),
          last_edited_by: operator.email,
          last_edited_at: new Date(),
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          template_status: 'approved',
          active_template_id: template.id,
        },
      });
    });

    return this.getTemplateBundle(fundingCallId);
  }

  async revertTemplate(fundingCallId: string, revisionNo: number, operator: IntakeOperator, changeNotes?: string) {
    const { template } = await ensureTemplateRecord(fundingCallId, operator);
    const targetRevision = await findTemplateRevisionByVersion(template.id, revisionNo);

    if (!targetRevision) {
      throw new Error('Template revision not found');
    }

    const revertedTemplate = normalizeGrantTemplate(targetRevision.grant_template_json);
    const compatibility = targetRevision.compatibility_json || buildCompatibilitySummary(revertedTemplate);
    const previousTemplate = normalizeGrantTemplate(template.grant_template_json);
    const nextTemplateStatus = targetRevision.approved_state;

    await prisma.$transaction(async (tx) => {
      const nextRevisionNo = await createRevision(tx, template, {
        revisionType: 'revert',
        grantTemplate: revertedTemplate,
        compatibility,
        editorUserId: operator.userId,
        approvedState: nextTemplateStatus,
        changeNotes: changeNotes || `Reverted to revision ${revisionNo}`,
        diffSummary: `Reverted to revision ${revisionNo}: ${generateDiffSummary(previousTemplate, revertedTemplate)}`,
      });

      await tx.fundingCallTemplate.update({
        where: { id: template.id },
        data: {
          grant_template_json: asJson(revertedTemplate),
          compatibility_json: asJson(compatibility),
          compiledGrantTemplateJson: Prisma.DbNull,
          current_revision_no: nextRevisionNo,
          status: nextTemplateStatus,
          last_edited_by: operator.email,
          last_edited_at: new Date(),
          approved_by: nextTemplateStatus === 'approved' ? operator.email : template.approved_by,
          approved_at: nextTemplateStatus === 'approved' ? new Date() : template.approved_at,
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          template_status: lifecycleFromTemplateStatus(nextTemplateStatus),
          active_template_id: template.id,
        },
      });
    });

    return this.getTemplateBundle(fundingCallId);
  }

  async listRevisions(fundingCallId: string, limit = 20) {
    const template = await prisma.fundingCallTemplate.findUnique({
      where: { fundingCallId: fundingCallId },
      select: { id: true },
    });

    if (!template) {
      return [];
    }

    const revisions = await prisma.fundingCallTemplateRevision.findMany({
      where: {
        OR: [{ templateId: template.id }, { template_id: template.id }],
      },
      orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
      take: Math.max(1, Math.min(limit, 100)),
    });

    return revisions.map(serializeTemplateRevision);
  }

  async getRevision(fundingCallId: string, revisionNo: number) {
    const template = await prisma.fundingCallTemplate.findUnique({
      where: { fundingCallId: fundingCallId },
      select: { id: true },
    });

    if (!template) {
      return null;
    }

    return serializeTemplateRevision(await findTemplateRevisionByVersion(template.id, revisionNo));
  }

  async listAssets(fundingCallId: string) {
    await ensureFundingCall(fundingCallId);
    return prisma.fundingCallTemplateAsset.findMany({
      where: { funding_call_id: fundingCallId },
      orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
    });
  }

  async createUrlAsset(fundingCallId: string, sourceUrl: string, operator: IntakeOperator) {
    await ensureFundingCall(fundingCallId);
    const safeUrl = await assertSafePublicHttpsUrl(sourceUrl);
    const fetched = await fetchReadableUrlContent(safeUrl.toString());
    const sequenceNo = await getNextSequenceNo(fundingCallId);

    const asset = await prisma.fundingCallTemplateAsset.create({
      data: {
        funding_call_id: fundingCallId,
        sequence_no: sequenceNo,
        source_type: 'url',
        source_url: safeUrl.toString(),
        mime: 'text/html',
        raw_text: fetched.rawText,
        normalized_text: fetched.normalizedText,
        source_metadata_json: asJson(fetched.fetchMetadata),
        checksum: hashText(`${safeUrl.toString()}::${fetched.normalizedText}`),
        uploaded_by: operator.email,
      },
    });

    return asset;
  }

  async createTextAsset(fundingCallId: string, sourceText: string, operator: IntakeOperator) {
    await ensureFundingCall(fundingCallId);
    const normalizedText = normalizeMultilineText(sourceText || '');
    if (!normalizedText) {
      throw new Error('Template text is required');
    }
    const sequenceNo = await getNextSequenceNo(fundingCallId);

    return prisma.fundingCallTemplateAsset.create({
      data: {
        funding_call_id: fundingCallId,
        sequence_no: sequenceNo,
        source_type: 'text',
        mime: 'text/plain',
        raw_text: sourceText,
        normalized_text: normalizedText,
        checksum: hashText(normalizedText),
        uploaded_by: operator.email,
      },
    });
  }

  async createUploadedAsset(
    fundingCallId: string,
    file: {
      originalName: string;
      mimeType: string;
      size: number;
      tempFilePath: string;
      checksum: string;
      sourceMetadata?: Record<string, unknown>;
    },
    operator: IntakeOperator
  ) {
    await ensureFundingCall(fundingCallId);
    await ensureUploadDir();
    const sequenceNo = await getNextSequenceNo(fundingCallId);

    const sanitizedFileName = file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = path.join(TEMPLATE_UPLOAD_DIR, `${Date.now()}_${sanitizedFileName}`);
    let copied = false;
    try {
      await fs.copyFile(file.tempFilePath, destinationPath);
      copied = true;
      const copiedBytes = await fs.readFile(destinationPath);
      const copiedChecksum = crypto.createHash('sha256').update(copiedBytes).digest('hex');
      if (copiedChecksum !== file.checksum) {
        throw new Error('Template upload checksum verification failed after storage');
      }

      const sourceType = file.mimeType === 'application/pdf' ? 'pdf' : 'image';
      return await prisma.fundingCallTemplateAsset.create({
        data: {
          funding_call_id: fundingCallId,
          sequence_no: sequenceNo,
          source_type: sourceType,
          storage_path: destinationPath,
          mime: file.mimeType,
          checksum: file.checksum,
          source_metadata_json: asJson({
            original_name: file.originalName,
            bytes: file.size,
            ...(file.sourceMetadata || {}),
          }),
          uploaded_by: operator.email,
        },
      });
    } catch (error) {
      if (copied) await fs.unlink(destinationPath).catch(() => undefined);
      throw error;
    } finally {
      await fs.unlink(file.tempFilePath).catch(() => undefined);
    }
  }

  async upsertAutoManagedAssetFromIntakeSource(
    fundingCallId: string,
    intakeJob: {
      id: string;
      input_type: 'url' | 'text' | 'pdf' | 'json';
      source_url?: string | null;
      source_file_path?: string | null;
      source_text_hash?: string | null;
      raw_text?: string | null;
      normalized_text?: string | null;
      fetch_metadata_json?: Prisma.JsonValue | null;
    },
    operator: IntakeOperator
  ) {
    await ensureFundingCall(fundingCallId);

    const existingAssets = await prisma.fundingCallTemplateAsset.findMany({
      where: { funding_call_id: fundingCallId },
      orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
    });
    const existingAsset = existingAssets.find((asset) => {
      const metadata = readAssetMetadata(asset.source_metadata_json);
      return metadata.auto_managed === true && metadata.intake_job_id === intakeJob.id;
    });

    let rawText = intakeJob.raw_text || null;
    let normalizedText = intakeJob.normalized_text || null;
    let intakeMetadata = readAssetMetadata(intakeJob.fetch_metadata_json);
    if (intakeJob.input_type === 'url' && intakeJob.source_url && !normalizedText) {
      const fetched = await fetchReadableUrlContent(intakeJob.source_url);
      rawText = fetched.rawText;
      normalizedText = fetched.normalizedText;
      intakeMetadata = {
        ...intakeMetadata,
        ...fetched.fetchMetadata,
        prepared_for_template_extraction: true,
      };
      await prisma.$transaction([
        prisma.fundingIntakeJob.update({
          where: { id: intakeJob.id },
          data: {
            raw_text: rawText,
            normalized_text: normalizedText,
            fetch_metadata_json: intakeMetadata as any,
          },
        }),
        prisma.fundingCall.update({
          where: { id: fundingCallId },
          data: {
            raw_text: rawText,
            normalized_text: normalizedText,
          },
        }),
      ]);
    }

    const metadata = {
      ...intakeMetadata,
      auto_managed: true,
      managed_by: 'funding_intake',
      intake_job_id: intakeJob.id,
      intake_input_type: intakeJob.input_type,
      intake_source_url: intakeJob.source_url || null,
    };
    const sourceType = intakeJob.input_type === 'url' ? 'url' : intakeJob.input_type === 'pdf' ? 'pdf' : 'text';
    const checksum = sourceType === 'url'
      ? hashText(`${intakeJob.source_url || ''}::${normalizedText || ''}`)
      : sourceType === 'text'
        ? hashText(normalizedText || rawText || '')
        : String(intakeMetadata.checksum || intakeJob.source_text_hash || hashText(`${intakeJob.source_file_path || ''}`));
    const assetData = {
      source_type: sourceType,
      source_url: sourceType === 'url' ? intakeJob.source_url || null : null,
      storage_path: sourceType === 'pdf' ? intakeJob.source_file_path || null : null,
      mime: sourceType === 'url' ? 'text/html' : sourceType === 'text' ? 'text/plain' : 'application/pdf',
      raw_text: rawText,
      normalized_text: normalizedText,
      source_metadata_json: asJson(metadata),
      checksum,
      uploaded_by: operator.email,
    } as const;

    if (existingAsset) {
      return prisma.fundingCallTemplateAsset.update({
        where: { id: existingAsset.id },
        data: assetData,
      });
    }

    const sequenceNo = await getNextSequenceNo(fundingCallId);
    return prisma.fundingCallTemplateAsset.create({
      data: {
        funding_call_id: fundingCallId,
        sequence_no: sequenceNo,
        ...assetData,
      },
    });
  }

  async syncIntakeSourceAsset(fundingCallId: string, operator: IntakeOperator) {
    const call = await ensureFundingCall(fundingCallId);

    if (!call.intake_job_id) {
      throw new Error('This funding call does not have an intake source to reuse');
    }

    const intakeJob = await prisma.fundingIntakeJob.findUnique({
      where: { id: call.intake_job_id },
      select: {
        id: true,
        input_type: true,
        source_url: true,
        source_file_path: true,
        source_text_hash: true,
        raw_text: true,
        normalized_text: true,
        fetch_metadata_json: true,
      },
    });

    if (!intakeJob) {
      throw new Error('Funding intake source not found for this call');
    }

    return this.upsertAutoManagedAssetFromIntakeSource(fundingCallId, intakeJob, operator);
  }

  async deleteAsset(fundingCallId: string, assetId: string) {
    const asset = await prisma.fundingCallTemplateAsset.findFirst({
      where: {
        id: assetId,
        funding_call_id: fundingCallId,
      },
    });

    if (!asset) {
      throw new Error('Template asset not found');
    }

    await prisma.fundingCallTemplateAsset.delete({
      where: { id: asset.id },
    });
    await deleteLocalAssetIfPresent(asset.storage_path);

    return { ok: true };
  }

  private async resolveTemplateExtractionAssets(fundingCallId: string, operator: IntakeOperator, assetIds?: string[]) {
    const { call, template } = await ensureTemplateRecord(fundingCallId, operator);

    let assets = await prisma.fundingCallTemplateAsset.findMany({
      where: {
        funding_call_id: fundingCallId,
        ...(assetIds && assetIds.length > 0 ? { id: { in: assetIds } } : {}),
      },
      orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
    });

    if (assets.length === 0 && (!assetIds || assetIds.length === 0) && call.intake_job_id) {
      const intakeJob = await prisma.fundingIntakeJob.findUnique({
        where: { id: call.intake_job_id },
        select: {
          id: true,
          input_type: true,
          source_url: true,
          source_file_path: true,
          source_text_hash: true,
          raw_text: true,
          normalized_text: true,
          fetch_metadata_json: true,
        },
      });

      if (intakeJob) {
        const autoAsset = await this.upsertAutoManagedAssetFromIntakeSource(fundingCallId, intakeJob, operator);
        assets = [autoAsset];
      }
    }

    if (assets.length === 0) {
      throw new Error('No template assets are available for extraction');
    }

    return { template, assets };
  }

  private async completeTemplateExtractionRun(
    fundingCallId: string,
    runId: string,
    assets: any[],
    operator: IntakeOperator
  ) {
    let stopHeartbeat: (() => Promise<void>) | null = null;
    try {
      const claimed = await prisma.fundingCallTemplateRun.updateMany({
        where: { id: runId, funding_call_id: fundingCallId, status: 'queued' },
        data: { status: 'extracting' },
      });
      if (claimed.count !== 1) return;

      stopHeartbeat = startExtractionHeartbeat(() => prisma.fundingCallTemplateRun.updateMany({
        where: { id: runId, status: 'extracting' },
        data: { status: 'extracting' },
      }));

      const extraction = await extractGrantTemplateFromAssets(assets, {
        tenantId: operator.tenantId || null,
        userId: operator.userId,
      });
      if (!hasTemplateItems(extraction.template)) {
        throw new Error('Template extraction produced no usable items');
      }

      await stopHeartbeat();
      stopHeartbeat = null;

      const template = await prisma.fundingCallTemplate.findUnique({
        where: { fundingCallId: fundingCallId },
        select: { id: true },
      });

      await prisma.$transaction(async (tx) => {
        const completed = await tx.fundingCallTemplateRun.updateMany({
          where: { id: runId, funding_call_id: fundingCallId, status: 'extracting' },
          data: {
            status: 'needs_review',
            extractor_model: extraction.extractorModel,
            prompt_version: extraction.promptVersion,
            raw_output_json: asJson({
              ...(extraction.rawOutput && typeof extraction.rawOutput === 'object' && !Array.isArray(extraction.rawOutput)
                ? extraction.rawOutput as Record<string, unknown>
                : { output: extraction.rawOutput }),
              assetIds: assets.map((asset) => asset.id),
            }),
            normalized_template_json: asJson(extraction.template),
            compatibility_json: asJson(extraction.compatibility),
            warnings_json: asJson(extraction.warnings),
          },
        });

        if (completed.count !== 1) return;

        await tx.fundingCall.update({
          where: { id: fundingCallId },
          data: {
            template_status: 'needs_review',
            ...(template?.id ? { active_template_id: template.id } : {}),
          },
        });
      });
    } catch (error) {
      await prisma.fundingCallTemplateRun.updateMany({
        where: { id: runId, status: { in: ['queued', 'extracting'] } },
        data: {
          status: 'failed',
          error_code: 'template_extraction_failed',
          error_message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      await stopHeartbeat?.();
    }
  }

  async startExtractionRun(fundingCallId: string, operator: IntakeOperator, assetIds?: string[]) {
    await failStaleTemplateRuns(fundingCallId);
    const { template, assets } = await this.resolveTemplateExtractionAssets(fundingCallId, operator, assetIds);
    const assetSetHash = buildAssetSetHash(assets);

    const run = await prisma.fundingCallTemplateRun.create({
      data: {
        funding_call_id: fundingCallId,
        template_id: template.id,
        status: 'queued',
        asset_set_hash: assetSetHash,
      },
    });

    void this.completeTemplateExtractionRun(fundingCallId, run.id, assets, operator).catch((error) => {
      console.error('[Funding Template] background extraction failed:', error);
    });

    return this.getRun(fundingCallId, run.id);
  }

  async createExtractionRun(fundingCallId: string, operator: IntakeOperator, assetIds?: string[]) {
    await failStaleTemplateRuns(fundingCallId);
    const { template, assets } = await this.resolveTemplateExtractionAssets(fundingCallId, operator, assetIds);
    const assetSetHash = buildAssetSetHash(assets);

    const run = await prisma.fundingCallTemplateRun.create({
      data: {
        funding_call_id: fundingCallId,
        template_id: template.id,
        status: 'queued',
        asset_set_hash: assetSetHash,
      },
    });

    await this.completeTemplateExtractionRun(fundingCallId, run.id, assets, operator);
    return this.getRun(fundingCallId, run.id);
  }

  async listRuns(fundingCallId: string, limit = 20) {
    await ensureFundingCall(fundingCallId);
    await failStaleTemplateRuns(fundingCallId);
    return prisma.fundingCallTemplateRun.findMany({
      where: { funding_call_id: fundingCallId },
      orderBy: { created_at: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async getRun(fundingCallId: string, runId: string) {
    await ensureFundingCall(fundingCallId);
    await failStaleTemplateRuns(fundingCallId);
    return prisma.fundingCallTemplateRun.findFirst({
      where: {
        id: runId,
        funding_call_id: fundingCallId,
      },
    });
  }

  async applyRun(
    fundingCallId: string,
    runId: string,
    operator: IntakeOperator,
    options?: { mode?: 'replace' | 'merge'; approve?: boolean }
  ) {
    const { template } = await ensureTemplateRecord(fundingCallId, operator);
    const run = await this.getRun(fundingCallId, runId);

    if (!run) {
      throw new Error('Template extraction run not found');
    }

    if (run.status !== 'needs_review') {
      throw new Error('Only extraction runs that need review can be applied');
    }

    if (!run.normalized_template_json || !hasTemplateItems(run.normalized_template_json)) {
      throw new Error('Cannot apply an empty template extraction result');
    }

    const currentTemplate = normalizeGrantTemplate(template.grant_template_json);
    const incomingTemplate = normalizeGrantTemplate(run.normalized_template_json);
    const runAssetIds = readRunAssetIds(run.raw_output_json);
    const assets = await prisma.fundingCallTemplateAsset.findMany({
      where: {
        funding_call_id: fundingCallId,
        ...(runAssetIds.length > 0 ? { id: { in: runAssetIds } } : {}),
      },
      select: { id: true, sequence_no: true, checksum: true },
      orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
    });
    if (buildAssetSetHash(assets) !== run.asset_set_hash) {
      throw new Error('Template assets changed after extraction. Start a new extraction run before applying.');
    }
    const assetSequenceById = buildAssetSequenceMap(assets);
    const mode = options?.mode === 'merge' ? 'merge' : 'replace';
    const nextTemplate = mode === 'merge'
      ? mergeGrantTemplates(currentTemplate, incomingTemplate, run.id, {
          assetSequenceById,
        }).mergedTemplate
      : sortAndDeduplicateGrantTemplate(incomingTemplate, {
          assetSequenceById,
          runId: run.id,
        });
    const compatibilityWarnings = mode === 'merge'
      ? Array.from(
          new Set([
            ...getCompatibilityWarnings(template.compatibility_json),
            ...getCompatibilityWarnings(run.compatibility_json),
          ])
        )
      : getCompatibilityWarnings(run.compatibility_json);
    const compatibility = buildCompatibilitySummary(nextTemplate, compatibilityWarnings, {
      lastRunId: run.id,
    });
    const diffSummary = mode === 'merge'
      ? `Merged extraction run ${run.id}: ${generateDiffSummary(currentTemplate, nextTemplate)}`
      : `Applied extraction run ${run.id} as current template: ${generateDiffSummary(currentTemplate, nextTemplate)}`;

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.fundingCallTemplateRun.updateMany({
        where: { id: run.id, funding_call_id: fundingCallId, status: 'needs_review' },
        data: { status: 'applied' },
      });
      if (claimed.count !== 1) {
        throw new Error('Template extraction run was already applied or changed');
      }

      const revisionNo = await createRevision(tx, template, {
        revisionType: 'extraction_import',
        grantTemplate: nextTemplate,
        compatibility,
        editorUserId: operator.userId,
        approvedState: 'draft',
        changeNotes:
          mode === 'merge'
            ? `Merged extraction run ${run.id}`
            : `Applied extraction run ${run.id} as current template`,
        diffSummary,
      });

      const finalRevisionNo = options?.approve
        ? await createRevision(tx, { ...template, current_revision_no: revisionNo }, {
            revisionType: 'approval',
            grantTemplate: nextTemplate,
            compatibility,
            editorUserId: operator.userId,
            approvedState: 'approved',
            changeNotes: `Accepted and approved extraction run ${run.id}`,
            diffSummary: 'Approved template revision',
          })
        : revisionNo;

      const updatedTemplate = await tx.fundingCallTemplate.updateMany({
        where: { id: template.id, current_revision_no: template.current_revision_no },
        data: {
          grant_template_json: asJson(nextTemplate),
          compatibility_json: asJson(compatibility),
          compiledGrantTemplateJson: Prisma.DbNull,
          current_revision_no: finalRevisionNo,
          status: options?.approve ? 'approved' : 'draft',
          last_edited_by: operator.email,
          last_edited_at: new Date(),
          approved_by: options?.approve ? operator.email : null,
          approved_at: options?.approve ? new Date() : null,
        },
      });
      if (updatedTemplate.count !== 1) {
        throw new Error('Template changed while this extraction run was being applied');
      }

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          template_status: options?.approve ? 'approved' : 'needs_review',
          active_template_id: template.id,
        },
      });
    });

    return this.getTemplateBundle(fundingCallId);
  }

  async acceptRun(fundingCallId: string, runId: string, operator: IntakeOperator) {
    return this.applyRun(fundingCallId, runId, operator, { mode: 'replace', approve: true });
  }
}

export const fundingTemplateService = new FundingTemplateService();

export function startTemplateExtractionRun(fundingCallId: string, operator: IntakeOperator, assetIds?: string[]) {
  return fundingTemplateService.startExtractionRun(fundingCallId, operator, assetIds);
}
