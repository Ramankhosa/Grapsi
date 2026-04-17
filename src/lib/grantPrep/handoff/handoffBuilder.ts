import crypto from 'crypto';
import type { FundingCallContext } from '../../fundingContext';
import type { GrantPrepFreezePayload, GrantPrepSessionContext, GrantPrepStageKey } from '../types';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function buildGrantPrepFreezePayload(input: {
  project: { id: string; title: string; description: string | null };
  fundingContext: FundingCallContext;
  session: GrantPrepSessionContext;
  guidelineRevisionId: string | null;
  templateRevisionId: string | null;
}) {
  const blockers = Object.values(input.session.stageStates).flatMap((stage) =>
    stage.points
      .filter((point) => point.priority !== 'P3' && point.status !== 'covered' && stage.enabled)
      .map((point) => ({
        stageKey: stage.stageKey,
        pointKey: point.key,
        message: point.status === 'needs_review'
          ? `${stage.title}: ${point.label} needs review before handoff.`
          : `${stage.title}: ${point.label} is still incomplete.`,
      }))
  );

  const payload: GrantPrepFreezePayload = {
    version: 'grant_handoff_v1',
    frozenAt: new Date().toISOString(),
    project: {
      id: input.project.id,
      title: input.project.title,
      description: input.project.description,
    },
    fundingCall: {
      id: input.fundingContext.id,
      title: input.fundingContext.title,
      agencyName: input.fundingContext.agencyName,
      deadline: input.fundingContext.deadline,
      funding: input.fundingContext.funding,
      projectDuration: input.fundingContext.projectDuration,
      eligibility: input.fundingContext.eligibility,
      deliverables: input.fundingContext.deliverables,
      focusAreas: input.fundingContext.focusAreas,
      officialUrls: input.fundingContext.officialUrls,
      warning: input.fundingContext.warning,
    },
    guidance: {
      mode: input.session.mode,
      engagementMode: input.session.engagementMode,
      guidelineRevisionId: input.guidelineRevisionId,
      templateRevisionId: input.templateRevisionId,
      selectedThrustAreaRuleKeys: input.session.selectedThrustAreaRuleKeys,
    },
    stageMapping: input.session.stageMapping,
    stageStates: input.session.stageStates,
    globalKeywords: input.session.globalKeywords,
    blockers,
  };

  const payloadJson = JSON.parse(JSON.stringify(payload));
  const payloadHash = crypto
    .createHash('sha256')
    .update(stableStringify(payloadJson))
    .digest('hex');

  return {
    payload,
    payloadHash,
    blockers,
  };
}

export function getBlockingStageKeys(payload: GrantPrepFreezePayload): GrantPrepStageKey[] {
  return Array.from(new Set(payload.blockers.map((blocker) => blocker.stageKey)));
}
