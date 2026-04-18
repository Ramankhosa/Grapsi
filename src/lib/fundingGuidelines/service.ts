// @ts-nocheck
import { Prisma } from '@prisma/client';
import type {
  FundingCallGuideline,
  FundingCallGuidelineStatus,
  FundingGuidelineLifecycleStatus,
  FundingRevisionStatus,
} from '@prisma/client';
import prisma from '../prisma';
import type { IntakeOperator } from '../fundingIntake/types';
import { extractCanonicalTextFromPdf } from '../fundingIntake/extractor';
import {
  assertSafePublicHttpsUrl,
  fetchReadableUrlContent,
  normalizeMultilineText,
} from '../fundingIntake/utils';
import { extractFundingGuidelines } from './extractor';
import { buildGuidelineSummary, createEmptyGuidelinePack, generateGuidelineDiffSummary, normalizeGuidelinePack } from './utils';

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function canonicalRevisionStatusFromGuidelineStatus(
  status: FundingCallGuidelineStatus
): FundingRevisionStatus {
  return status === 'approved' ? 'APPROVED' : 'DRAFT';
}

function serializeGuidelineRevision(revision: any) {
  if (!revision) {
    return revision;
  }

  return {
    ...revision,
    guideline_id: revision.guideline_id ?? revision.guidelineId,
    revision_no: revision.revision_no ?? revision.version,
    approved_state:
      revision.approved_state ??
      (revision.status === 'APPROVED' ? 'approved' : 'draft'),
    guideline_pack_json: revision.guideline_pack_json ?? revision.extractedPayload,
    summary_json: revision.summary_json ?? revision.summaryJson ?? null,
    editor_user_id: revision.editor_user_id ?? revision.createdByUserId ?? null,
    created_at: revision.created_at ?? revision.createdAt ?? null,
  };
}

async function findGuidelineRevisionByVersion(guidelineId: string, revisionNo: number) {
  return prisma.fundingCallGuidelineRevision.findFirst({
    where: {
      OR: [
        {
          guidelineId,
          version: revisionNo,
        },
        {
          guideline_id: guidelineId,
          revision_no: revisionNo,
        },
      ],
    },
  });
}

function extractGuidelineSummary(guideline: FundingCallGuideline | null) {
  if (!guideline) {
    return null;
  }

  return {
    id: guideline.id,
    status: guideline.status,
    current_revision_no: guideline.current_revision_no,
    guideline_pack_json: guideline.guideline_pack_json,
    summary_json: buildGuidelineSummary(normalizeGuidelinePack(guideline.guideline_pack_json)),
    last_edited_by: guideline.last_edited_by,
    last_edited_at: guideline.last_edited_at,
    approved_by: guideline.approved_by,
    approved_at: guideline.approved_at,
    created_at: guideline.created_at,
    updated_at: guideline.updated_at,
  };
}

async function ensureFundingCall(fundingCallId: string) {
  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      agency_name: true,
      scheme_title: true,
      description: true,
      open_date: true,
      close_date: true,
      is_rolling: true,
      geography_scope: true,
      eligible_countries: true,
      eligible_regions: true,
      host_countries: true,
      funder_country: true,
      funding_kinds: true,
      institution_types: true,
      career_stages: true,
      citizenship_requirements: true,
      residency_requirements: true,
      application_languages: true,
      disciplines: true,
      amount_min: true,
      amount_max: true,
      currency: true,
      project_duration_min_months: true,
      project_duration_max_months: true,
      project_duration_text: true,
      eligibility_text: true,
      expected_deliverables_text: true,
      official_urls: true,
      contact_info: true,
      sponsor_type: true,
      raw_text: true,
      normalized_text: true,
      extracted_json: true,
      intake_job_id: true,
      guideline_status: true,
      active_guideline_id: true,
      template_status: true,
      active_template_id: true,
    },
  });

  if (!call) {
    throw new Error('Funding call not found');
  }

  return call;
}

async function ensureGuidelineRecord(fundingCallId: string, operator: IntakeOperator) {
  const call = await ensureFundingCall(fundingCallId);

  let guideline = await prisma.fundingCallGuideline.findUnique({
    where: { fundingCallId: fundingCallId },
  });

  if (guideline) {
    return { call, guideline };
  }

  const emptyPack = createEmptyGuidelinePack();

  guideline = await prisma.$transaction(async (tx) => {
    const created = await tx.fundingCallGuideline.create({
      data: {
        fundingCallId: fundingCallId,
        status: 'draft',
        guideline_pack_json: asJson(emptyPack),
        current_revision_no: 1,
        last_edited_by: operator.email,
        last_edited_at: new Date(),
      },
    });

    await tx.fundingCallGuidelineRevision.create({
      data: {
        guidelineId: created.id,
        version: 1,
        status: 'DRAFT',
        extractedPayload: asJson(emptyPack),
        summaryJson: asJson(buildGuidelineSummary(emptyPack)),
        createdByUserId: operator.userId,
        revision_no: 1,
        revision_type: 'manual_edit',
        guideline_pack_json: asJson(emptyPack),
        diff_summary: generateGuidelineDiffSummary(null, emptyPack),
        editor_user_id: operator.userId,
        approved_state: 'draft',
        change_notes: 'Blank guideline pack created',
      },
    });

    await tx.fundingCall.update({
      where: { id: fundingCallId },
      data: {
        guideline_status: 'draft',
        active_guideline_id: created.id,
      },
    });

    return created;
  });

  return { call, guideline };
}

async function createRevision(
  tx: Prisma.TransactionClient,
  guideline: FundingCallGuideline,
  options: {
    revisionType: 'auto_extract' | 'manual_edit' | 'approval' | 'revert';
    guidelinePack: unknown;
    editorUserId: string;
    approvedState: FundingCallGuidelineStatus;
    changeNotes?: string | null;
    diffSummary: string;
  }
) {
  const revisionNo = guideline.current_revision_no + 1;

  await tx.fundingCallGuidelineRevision.create({
      data: {
        guidelineId: guideline.id,
        version: revisionNo,
        status: canonicalRevisionStatusFromGuidelineStatus(options.approvedState),
        extractedPayload: asJson(options.guidelinePack),
        summaryJson: asJson(buildGuidelineSummary(normalizeGuidelinePack(options.guidelinePack))),
        createdByUserId: options.editorUserId,
        revision_no: revisionNo,
        revision_type: options.revisionType,
        guideline_pack_json: asJson(options.guidelinePack),
      diff_summary: options.diffSummary,
      editor_user_id: options.editorUserId,
      approved_state: options.approvedState,
      change_notes: options.changeNotes || null,
    },
  });

  return revisionNo;
}

function nextLifecycleStatusForManualEdit(currentLifecycle: FundingGuidelineLifecycleStatus) {
  if (currentLifecycle === 'none' || currentLifecycle === 'draft') {
    return 'draft' as FundingGuidelineLifecycleStatus;
  }

  return 'needs_review' as FundingGuidelineLifecycleStatus;
}

type GuidelineExtractionSourceInput =
  | {
      sourceMode?: 'intake';
    }
  | {
      sourceMode: 'url';
      sourceUrl: string;
    }
  | {
      sourceMode: 'text';
      sourceText: string;
    }
  | {
      sourceMode: 'pdf';
      sourceFilePath: string;
      sourceLabel?: string | null;
    };

async function resolveGuidelineSource(
  call: Awaited<ReturnType<typeof ensureFundingCall>>,
  sourceInput?: GuidelineExtractionSourceInput
) {
  if (!sourceInput || sourceInput.sourceMode === 'intake') {
    return {
      rawText: call.raw_text || null,
      normalizedText: call.normalized_text || null,
      warnings: [] as string[],
      changeNote: 'Auto-extracted from funding call facts and the intake source text',
    };
  }

  if (sourceInput.sourceMode === 'url') {
    const safeUrl = await assertSafePublicHttpsUrl(sourceInput.sourceUrl);
    const fetched = await fetchReadableUrlContent(safeUrl.toString());
    return {
      rawText: fetched.rawText,
      normalizedText: fetched.normalizedText,
      warnings: [`Guideline extraction used separate URL source: ${safeUrl.toString()}`],
      changeNote: `Auto-extracted from funding call facts and separate URL source ${safeUrl.toString()}`,
    };
  }

  if (sourceInput.sourceMode === 'text') {
    const normalizedText = normalizeMultilineText(sourceInput.sourceText || '');
    if (!normalizedText) {
      throw new Error('Guideline source text is required');
    }

    return {
      rawText: sourceInput.sourceText,
      normalizedText,
      warnings: ['Guideline extraction used separate text supplied from the intake workspace.'],
      changeNote: 'Auto-extracted from funding call facts and separate text source',
    };
  }

  const extracted = await extractCanonicalTextFromPdf(sourceInput.sourceFilePath);
  return {
    rawText: extracted.rawText,
    normalizedText: extracted.normalizedText,
    warnings: [
      `Guideline extraction used separate PDF source${sourceInput.sourceLabel ? `: ${sourceInput.sourceLabel}` : ''}`,
    ],
    changeNote: `Auto-extracted from funding call facts and separate PDF source${sourceInput.sourceLabel ? ` ${sourceInput.sourceLabel}` : ''}`,
  };
}

export class FundingGuidelineService {
  async getGuidelineBundle(fundingCallId: string) {
    const call = await ensureFundingCall(fundingCallId);

    const [guideline, runs, revisions] = await Promise.all([
      prisma.fundingCallGuideline.findUnique({
        where: { fundingCallId: fundingCallId },
      }),
      prisma.fundingCallGuidelineRun.findMany({
        where: { funding_call_id: fundingCallId },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.fundingCallGuideline.findUnique({
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
      guideline: extractGuidelineSummary(guideline),
      runs,
      revisions: (revisions?.revisions || []).map(serializeGuidelineRevision),
    };
  }

  async createBlankGuideline(fundingCallId: string, operator: IntakeOperator) {
    await ensureGuidelineRecord(fundingCallId, operator);
    return this.getGuidelineBundle(fundingCallId);
  }

  async updateGuideline(
    fundingCallId: string,
    guidelinePackJson: unknown,
    operator: IntakeOperator,
    changeNotes?: string
  ) {
    const { call, guideline } = await ensureGuidelineRecord(fundingCallId, operator);
    const previousPack = normalizeGuidelinePack(guideline.guideline_pack_json);
    const nextPack = normalizeGuidelinePack(guidelinePackJson);
    const nextGuidelineStatus: FundingCallGuidelineStatus = guideline.status === 'approved' ? 'draft' : guideline.status;
    const lifecycleStatus = nextLifecycleStatusForManualEdit(call.guideline_status);

    await prisma.$transaction(async (tx) => {
      const revisionNo = await createRevision(tx, guideline, {
        revisionType: 'manual_edit',
        guidelinePack: nextPack,
        editorUserId: operator.userId,
        approvedState: nextGuidelineStatus,
        changeNotes,
        diffSummary: generateGuidelineDiffSummary(previousPack, nextPack),
      });

      await tx.fundingCallGuideline.update({
        where: { id: guideline.id },
        data: {
          guideline_pack_json: asJson(nextPack),
          current_revision_no: revisionNo,
          status: nextGuidelineStatus,
          last_edited_by: operator.email,
          last_edited_at: new Date(),
          approved_by: null,
          approved_at: null,
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          guideline_status: lifecycleStatus,
          active_guideline_id: guideline.id,
        },
      });
    });

    return this.getGuidelineBundle(fundingCallId);
  }

  async approveGuideline(fundingCallId: string, operator: IntakeOperator) {
    const { guideline } = await ensureGuidelineRecord(fundingCallId, operator);
    const currentPack = normalizeGuidelinePack(guideline.guideline_pack_json);

    await prisma.$transaction(async (tx) => {
      const revisionNo = await createRevision(tx, guideline, {
        revisionType: 'approval',
        guidelinePack: currentPack,
        editorUserId: operator.userId,
        approvedState: 'approved',
        changeNotes: 'Guideline pack approved',
        diffSummary: 'Approved guideline revision',
      });

      await tx.fundingCallGuideline.update({
        where: { id: guideline.id },
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
          guideline_status: 'approved',
          active_guideline_id: guideline.id,
        },
      });
    });

    return this.getGuidelineBundle(fundingCallId);
  }

  async revertGuideline(fundingCallId: string, revisionNo: number, operator: IntakeOperator, changeNotes?: string) {
    const { guideline } = await ensureGuidelineRecord(fundingCallId, operator);
    const targetRevision = await findGuidelineRevisionByVersion(guideline.id, revisionNo);

    if (!targetRevision) {
      throw new Error('Guideline revision not found');
    }

    const revertedPack = normalizeGuidelinePack(targetRevision.guideline_pack_json);
    const previousPack = normalizeGuidelinePack(guideline.guideline_pack_json);

    await prisma.$transaction(async (tx) => {
      const nextRevisionNo = await createRevision(tx, guideline, {
        revisionType: 'revert',
        guidelinePack: revertedPack,
        editorUserId: operator.userId,
        approvedState: targetRevision.approved_state,
        changeNotes: changeNotes || `Reverted to revision ${revisionNo}`,
        diffSummary: `Reverted to revision ${revisionNo}: ${generateGuidelineDiffSummary(previousPack, revertedPack)}`,
      });

      await tx.fundingCallGuideline.update({
        where: { id: guideline.id },
        data: {
          guideline_pack_json: asJson(revertedPack),
          current_revision_no: nextRevisionNo,
          status: targetRevision.approved_state,
          last_edited_by: operator.email,
          last_edited_at: new Date(),
          approved_by: targetRevision.approved_state === 'approved' ? operator.email : null,
          approved_at: targetRevision.approved_state === 'approved' ? new Date() : null,
        },
      });

      await tx.fundingCall.update({
        where: { id: fundingCallId },
        data: {
          guideline_status: targetRevision.approved_state === 'approved' ? 'approved' : 'draft',
          active_guideline_id: guideline.id,
        },
      });
    });

    return this.getGuidelineBundle(fundingCallId);
  }

  async createExtractionRunFromFundingCall(
    fundingCallId: string,
    operator: IntakeOperator,
    sourceInput?: GuidelineExtractionSourceInput
  ) {
    const { call, guideline } = await ensureGuidelineRecord(fundingCallId, operator);
    const guidelineSource = await resolveGuidelineSource(call, sourceInput);

    const run = await prisma.fundingCallGuidelineRun.create({
      data: {
        funding_call_id: fundingCallId,
        guideline_id: guideline.id,
        status: 'extracting',
      },
    });

    try {
      const extraction = await extractFundingGuidelines({
        fundingCallId: call.id,
        agencyName: call.agency_name,
        schemeTitle: call.scheme_title,
        description: call.description,
        openDate: call.open_date ? call.open_date.toISOString().slice(0, 10) : null,
        closeDate: call.close_date ? call.close_date.toISOString().slice(0, 10) : null,
        isRolling: Boolean(call.is_rolling),
        geographyScope: call.geography_scope || null,
        eligibleCountries: call.eligible_countries || [],
        eligibleRegions: call.eligible_regions || [],
        hostCountries: call.host_countries || [],
        funderCountry: call.funder_country || null,
        fundingKinds: call.funding_kinds || [],
        institutionTypes: call.institution_types || [],
        careerStages: call.career_stages || [],
        citizenshipRequirements: call.citizenship_requirements || [],
        residencyRequirements: call.residency_requirements || [],
        applicationLanguages: call.application_languages || [],
        disciplines: call.disciplines || [],
        amountMin: call.amount_min ?? null,
        amountMax: call.amount_max ?? null,
        currency: call.currency || null,
        projectDurationMinMonths: call.project_duration_min_months ?? null,
        projectDurationMaxMonths: call.project_duration_max_months ?? null,
        projectDurationText: call.project_duration_text || null,
        eligibilityText: call.eligibility_text || null,
        expectedDeliverablesText: call.expected_deliverables_text || null,
        officialUrls: call.official_urls || [],
        contactInfo: call.contact_info || null,
        sponsorType: call.sponsor_type || null,
        rawText: guidelineSource.rawText,
        normalizedText: guidelineSource.normalizedText,
        extractedJson: call.extracted_json,
      });

      const previousPack = normalizeGuidelinePack(guideline.guideline_pack_json);
      const nextPack = normalizeGuidelinePack(extraction.guidelinePack);

      await prisma.$transaction(async (tx) => {
        const revisionNo = await createRevision(tx, guideline, {
          revisionType: 'auto_extract',
          guidelinePack: nextPack,
          editorUserId: operator.userId,
          approvedState: 'draft',
          changeNotes: guidelineSource.changeNote,
          diffSummary: generateGuidelineDiffSummary(previousPack, nextPack),
        });

        await tx.fundingCallGuideline.update({
          where: { id: guideline.id },
          data: {
            guideline_pack_json: asJson(nextPack),
            status: 'draft',
            current_revision_no: revisionNo,
            last_edited_by: operator.email,
            last_edited_at: new Date(),
            approved_by: null,
            approved_at: null,
          },
        });

        await tx.fundingCallGuidelineRun.update({
          where: { id: run.id },
          data: {
            status: 'needs_review',
            extractor_model: extraction.extractorModel,
            prompt_version: extraction.promptVersion,
            raw_output_json: asJson(extraction.rawOutput),
            guideline_pack_json: asJson(nextPack),
            warnings_json: guidelineSource.warnings.length > 0 ? asJson(guidelineSource.warnings) : Prisma.JsonNull,
          },
        });

        await tx.fundingCall.update({
          where: { id: fundingCallId },
          data: {
            guideline_status: 'needs_review',
            active_guideline_id: guideline.id,
          },
        });
      });
    } catch (error) {
      await prisma.fundingCallGuidelineRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error_code: 'guideline_extraction_failed',
          error_message: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }

    return this.getRun(fundingCallId, run.id);
  }

  async listRuns(fundingCallId: string, limit = 20) {
    await ensureFundingCall(fundingCallId);
    return prisma.fundingCallGuidelineRun.findMany({
      where: { funding_call_id: fundingCallId },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
  }

  async getRun(fundingCallId: string, runId: string) {
    await ensureFundingCall(fundingCallId);
    return prisma.fundingCallGuidelineRun.findFirst({
      where: {
        id: runId,
        funding_call_id: fundingCallId,
      },
    });
  }

  async listRevisions(fundingCallId: string, limit = 20) {
    await ensureFundingCall(fundingCallId);
    const guideline = await prisma.fundingCallGuideline.findUnique({
      where: { fundingCallId: fundingCallId },
      select: { id: true },
    });

    if (!guideline) {
      return [];
    }

    const revisions = await prisma.fundingCallGuidelineRevision.findMany({
      where: {
        OR: [{ guidelineId: guideline.id }, { guideline_id: guideline.id }],
      },
      orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
      take: Math.min(Math.max(limit, 1), 50),
    });

    return revisions.map(serializeGuidelineRevision);
  }

  async getRevision(fundingCallId: string, revisionNo: number) {
    await ensureFundingCall(fundingCallId);
    const guideline = await prisma.fundingCallGuideline.findUnique({
      where: { fundingCallId: fundingCallId },
      select: { id: true },
    });

    if (!guideline) {
      return null;
    }

    return serializeGuidelineRevision(await findGuidelineRevisionByVersion(guideline.id, revisionNo));
  }

  async resolvePinnedApprovedRevisionForFundingCall(fundingCallId: string) {
    const guideline = await prisma.fundingCallGuideline.findUnique({
      where: { fundingCallId: fundingCallId },
      select: {
        id: true,
        current_revision_no: true,
      },
    });

    if (!guideline) {
      return null;
    }

    if (guideline.current_revision_no > 0) {
      const pinnedRevision = await prisma.fundingCallGuidelineRevision.findUnique({
        where: {
          guidelineId_version: {
            guidelineId: guideline.id,
            version: guideline.current_revision_no,
          },
        },
      });

      if (
        pinnedRevision &&
        (pinnedRevision.status === 'APPROVED' || pinnedRevision.approved_state === 'approved')
      ) {
        return pinnedRevision;
      }
    }

    // Repair-mode fallback for records where the guideline is approved but the
    // current revision pointer still references a draft revision.
    return prisma.fundingCallGuidelineRevision.findFirst({
      where: {
        OR: [
          { guidelineId: guideline.id, status: 'APPROVED' },
          { guidelineId: guideline.id, approved_state: 'approved' },
          { guideline_id: guideline.id, status: 'APPROVED' },
          { guideline_id: guideline.id, approved_state: 'approved' },
        ],
      },
      orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
    });
  }

  async resolveApprovedTemplateForFundingCall(fundingCallId: string) {
    const template = await prisma.fundingCallTemplate.findUnique({
      where: { fundingCallId: fundingCallId },
      select: {
        id: true,
        status: true,
        current_revision_no: true,
        grant_template_json: true,
        compatibility_json: true,
      },
    });

    if (!template) {
      return null;
    }

    if (template.status === 'approved') {
      return template;
    }

    const approvedRevision = await prisma.fundingCallTemplateRevision.findFirst({
      where: {
        OR: [
          { templateId: template.id, status: 'APPROVED' },
          { templateId: template.id, approved_state: 'approved' },
          { template_id: template.id, status: 'APPROVED' },
          { template_id: template.id, approved_state: 'approved' },
        ],
      },
      orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
      select: {
        version: true,
        revision_no: true,
        grant_template_json: true,
        extractedPayload: true,
        compatibility_json: true,
        summaryJson: true,
      },
    });

    if (!approvedRevision) {
      return null;
    }

    return {
      id: template.id,
      status: 'approved' as const,
      current_revision_no:
        approvedRevision.version ||
        approvedRevision.revision_no ||
        template.current_revision_no,
      grant_template_json:
        approvedRevision.grant_template_json ?? approvedRevision.extractedPayload,
      compatibility_json:
        approvedRevision.compatibility_json ?? approvedRevision.summaryJson ?? null,
    };
  }

  async getDraftingContext(fundingCallId: string) {
    const call = await ensureFundingCall(fundingCallId);
    const [guidelineRevision, template] = await Promise.all([
      this.resolvePinnedApprovedRevisionForFundingCall(fundingCallId),
      this.resolveApprovedTemplateForFundingCall(fundingCallId),
    ]);

    return {
      fundingCall: call,
      approvedGuidelineRevision: guidelineRevision,
      approvedTemplate: template,
    };
  }
}

export const fundingGuidelineService = new FundingGuidelineService();
