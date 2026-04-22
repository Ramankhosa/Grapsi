import crypto from 'crypto';
import type { FundingCallContext } from '../../fundingContext';
import type { GrantPrepFreezePayload, GrantPrepSessionContext, GrantPrepStageKey } from '../types';
import type { GrantPrepEvidenceItem } from '@/types/grant';

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
  compiledSections?: Array<{ sectionKey: string; sourceTemplatePointer?: string | null }>;
}) {
  const normalizeStringArray = (value: unknown) => {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const next: string[] = [];
    for (const item of source) {
      const normalized = String(item || '').trim().replace(/\s+/g, ' ');
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(normalized);
    }
    return next;
  };

  const resolveSectionKeysForPointer = (pointer: string | null | undefined) => {
    const normalizedPointer = String(pointer || '').trim();
    if (!normalizedPointer) return [] as string[];
    const suffix = normalizedPointer.includes('.')
      ? normalizedPointer.split('.').pop() || normalizedPointer
      : normalizedPointer;

    if (normalizedPointer === 'budget' || normalizedPointer.startsWith('budget.')) {
      return ['budget'];
    }
    if (normalizedPointer === 'attachments' || normalizedPointer.startsWith('attachments.')) {
      return ['attachments'];
    }

    const matches = (input.compiledSections || [])
      .filter((section) =>
        section.sectionKey === normalizedPointer
        || section.sectionKey === suffix
        || String(section.sourceTemplatePointer || '').trim() === normalizedPointer
        || String(section.sourceTemplatePointer || '').trim() === suffix
      )
      .map((section) => section.sectionKey);

    return normalizeStringArray(matches);
  };

  const prepEvidence: GrantPrepEvidenceItem[] = Object.values(input.session.stageStates).flatMap((stage) =>
    stage.points
      .filter((point) => stage.enabled && point.capture && (point.status === 'covered' || point.status === 'needs_review'))
      .map((point) => {
        const capture = point.capture!;
        const sourceTemplatePointer = capture.sourceTemplatePointer || point.sourceTemplatePointer || null;
        const ruleNotes = normalizeStringArray([
          ...(capture.ruleNotes || []),
          capture.ruleCompliance.status !== 'ok' ? capture.ruleCompliance.reason || '' : '',
        ]);
        return {
          stageKey: stage.stageKey,
          pointKey: point.key,
          label: point.label,
          sourceTemplatePointer,
          sectionKeys: resolveSectionKeysForPointer(sourceTemplatePointer),
          keywords: normalizeStringArray(capture.keywords),
          thrustLinkage: normalizeStringArray(capture.thrustLinkage),
          factBullets: normalizeStringArray(capture.factBullets),
          ruleNotes,
          confidence: Number.isFinite(Number(capture.confidence)) ? Number(capture.confidence) : 0.7,
          captureBasis: normalizeStringArray(capture.captureBasis),
          status: point.status === 'needs_review' ? 'needs_review' : 'covered',
        } satisfies GrantPrepEvidenceItem;
      })
  );

  const prepEvidenceBySection = prepEvidence.reduce((acc, item) => {
    for (const sectionKey of item.sectionKeys || []) {
      acc[sectionKey] = [...(acc[sectionKey] || []), item];
    }
    return acc;
  }, {} as Record<string, GrantPrepEvidenceItem[]>);

  const globalCaptureSummary = prepEvidence
    .slice(0, 12)
    .map((item) => {
      const factLine = item.factBullets.length > 0
        ? item.factBullets.slice(0, 2).join(' ; ')
        : item.keywords.slice(0, 5).join(', ');
      const noteLine = item.ruleNotes.length > 0 ? ` | Rule note: ${item.ruleNotes[0]}` : '';
      return `${item.label}: ${factLine || 'captured in prep'}${noteLine}`;
    });

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
    globalCaptureSummary,
    prepEvidence,
    prepEvidenceBySection,
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
