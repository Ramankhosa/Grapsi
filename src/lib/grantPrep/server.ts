import { Prisma } from '@prisma/client';
import type { GrantPrepSession } from '@prisma/client';
import { prisma } from '../prisma';
import type { FundingCallContext } from '../fundingContext';
import { fundingGuidelineService } from '../fundingGuidelines/service';
import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { resolveProjectFundingContext } from '../fundingContext';
import { GRANT_PREP_STAGE_BY_KEY } from './stageLibrary';
import {
  buildFinalEnabledStageKeys,
  buildGrantPrepSelectorResult,
  buildSelectionSources,
  GRANT_PREP_V2_STAGE_SELECTION_VERSION,
  GRANT_PREP_V3_STAGE_SELECTION_VERSION,
  sortStageKeys,
} from './selection';
import {
  buildGrantPrepSessionContext,
  buildInitialStageStates,
  normalizeGrantPrepStageStates,
  normalizeGrantPrepKeywords,
  determineGrantPrepMode,
  collectGlobalKeywords,
  computeOverallReadiness,
  getNextPickableStageKey,
  applyGrantPrepPointRolesFromMapping,
  recomputeStageState,
  stageHasCapturedContent,
} from './sessionState';
import { buildGrantPrepStageMapping } from './templateMapper';
import type {
  GrantPrepEngagementMode,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageMapping,
  GrantPrepStageStates,
} from './types';
import { normalizeGrantPrepEngagementMode } from './types';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function asStageKeyArray(value: unknown): GrantPrepStageKey[] {
  return asStringArray(value) as GrantPrepStageKey[];
}

function getConfigurableStageKeys(stageKeys: GrantPrepStageKey[] = []) {
  return sortStageKeys(stageKeys.filter((stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey]?.pickable));
}

function deriveManualOverridesFromExplicitSelection(input: {
  autoEnabledStageKeys: GrantPrepStageKey[];
  enabledStageKeys?: GrantPrepStageKey[];
  disabledStageKeys?: GrantPrepStageKey[];
}) {
  const autoEnabled = new Set(getConfigurableStageKeys(input.autoEnabledStageKeys));
  const explicitEnabled = input.enabledStageKeys ? new Set(getConfigurableStageKeys(input.enabledStageKeys)) : null;
  const explicitDisabled = new Set(getConfigurableStageKeys(input.disabledStageKeys || []));

  if (!explicitEnabled && explicitDisabled.size === 0) {
    return {
      manualEnabledStageKeys: [] as GrantPrepStageKey[],
      manualDisabledStageKeys: [] as GrantPrepStageKey[],
    };
  }

  const finalEnabled = explicitEnabled ? new Set(explicitEnabled) : new Set(autoEnabled);
  const manualEnabledStageKeys = sortStageKeys(
    Array.from(finalEnabled).filter((stageKey) => !autoEnabled.has(stageKey))
  );

  autoEnabled.forEach((stageKey) => {
    if (!finalEnabled.has(stageKey)) {
      explicitDisabled.add(stageKey);
    }
  });

  return {
    manualEnabledStageKeys,
    manualDisabledStageKeys: sortStageKeys(explicitDisabled),
  };
}

function mergeStageStates(
  currentStageStates: GrantPrepStageStates,
  baseStageStates: GrantPrepStageStates
) {
  return Object.keys(baseStageStates).reduce((acc, stageKey) => {
    const typedStageKey = stageKey as GrantPrepStageKey;
    const currentStage = currentStageStates[typedStageKey];
    const nextStage = baseStageStates[typedStageKey];
    const nextPointKeys = new Set(nextStage.points.map((point) => point.key));
    const preservedPoints = nextStage.points.map((point) => {
      const currentPoint = currentStage.points.find((item) => item.key === point.key);
      if (!currentPoint) {
        return point;
      }

      return {
        ...point,
        status: currentPoint.status,
        sourceTemplatePointer: point.sourceTemplatePointer || currentPoint.sourceTemplatePointer,
        capture: currentPoint.capture
          ? {
              ...currentPoint.capture,
              sourceTemplatePointer: point.sourceTemplatePointer || currentPoint.capture.sourceTemplatePointer,
            }
          : null,
      };
    });

    const staleCapturedPoints = currentStage.points
      .filter((point) => !nextPointKeys.has(point.key) && normalizeGrantPrepKeywords(point.capture?.keywords).length > 0)
      .map((point) => ({
        ...point,
        status: 'needs_review' as const,
      }));

    const refreshedStage = {
      ...nextStage,
      enabled: nextStage.enabled,
      selectionSource: nextStage.enabled ? nextStage.selectionSource || null : null,
      steeringEvents: [...currentStage.steeringEvents],
      points: [...preservedPoints, ...staleCapturedPoints],
      lastUpdatedAt: currentStage.lastUpdatedAt,
    };

    if (staleCapturedPoints.length > 0) {
      refreshedStage.steeringEvents.push({
        id: `refresh_${typedStageKey}_${Date.now()}`,
        level: 'gentle_redirect',
        message: 'Some earlier captures no longer map cleanly to the current template and need review.',
        pointKey: null,
        createdAt: new Date().toISOString(),
      });
    }

    recomputeStageState(refreshedStage);
    if (!refreshedStage.enabled) {
      refreshedStage.status = 'disabled';
    }

    acc[typedStageKey] = refreshedStage;
    return acc;
  }, {} as GrantPrepStageStates);
}

function withResolvedActiveStage(context: GrantPrepSessionContext) {
  const fallbackActiveStageKey = (
    Object.values(context.stageStates).find((stage) => stage.enabled && stage.pickable)?.stageKey ||
    context.activeStageKey
  ) as GrantPrepStageKey;

  const nextActiveStageKey = context.stageStates[context.activeStageKey]?.enabled &&
    context.stageStates[context.activeStageKey]?.pickable
    ? context.activeStageKey
    : getNextPickableStageKey(context.stageStates, fallbackActiveStageKey);

  return {
    ...context,
    activeStageKey: nextActiveStageKey,
  } satisfies GrantPrepSessionContext;
}

function buildV2GrantPrepContext(input: {
  mode: GrantPrepSessionContext['mode'];
  engagementMode: GrantPrepEngagementMode;
  templateJson?: unknown | null;
  guidelinePack?: GuidelinePackDocument | null;
  fundingContext?: Pick<FundingCallContext, 'focusAreas' | 'deliverables' | 'budgetLimits' | 'projectDuration'> | null;
  selectedThrustAreaRuleKeys?: string[];
  warning?: string | null;
  enabledStageKeys?: GrantPrepStageKey[];
  disabledStageKeys?: GrantPrepStageKey[];
}) {
  const selectorResult = buildGrantPrepSelectorResult({
    mode: input.mode,
    templateJson: input.templateJson,
    guidelinePack: input.guidelinePack,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    fundingContext: input.fundingContext || null,
  });

  const manualOverrides = deriveManualOverridesFromExplicitSelection({
    autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
    enabledStageKeys: input.enabledStageKeys,
    disabledStageKeys: input.disabledStageKeys,
  });

  const finalEnabledStageKeys = buildFinalEnabledStageKeys({
    autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
    manualEnabledStageKeys: manualOverrides.manualEnabledStageKeys,
    manualDisabledStageKeys: manualOverrides.manualDisabledStageKeys,
  });
  const selectionSources = buildSelectionSources({
    autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
    manualEnabledStageKeys: manualOverrides.manualEnabledStageKeys,
    baseSources: selectorResult.selectionSources,
  });
  const stageStates = buildInitialStageStates(
    selectorResult.stageMapping,
    finalEnabledStageKeys,
    selectionSources,
    {
      ...selectorResult.selectionLevels,
      ...manualOverrides.manualEnabledStageKeys.reduce((acc, stageKey) => {
        acc[stageKey] = 'recommended';
        return acc;
      }, {} as Partial<Record<GrantPrepStageKey, 'recommended'>>),
      ...manualOverrides.manualDisabledStageKeys.reduce((acc, stageKey) => {
        acc[stageKey] = 'excluded';
        return acc;
      }, {} as Partial<Record<GrantPrepStageKey, 'excluded'>>),
    }
  );

  return buildGrantPrepSessionContext({
    mode: input.mode,
    engagementMode: input.engagementMode,
    stageSelectionVersion: GRANT_PREP_V3_STAGE_SELECTION_VERSION,
    autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
    manualEnabledStageKeys: manualOverrides.manualEnabledStageKeys,
    manualDisabledStageKeys: manualOverrides.manualDisabledStageKeys,
    stageMapping: selectorResult.stageMapping,
    stageStates,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    warning: input.warning || null,
  });
}

export async function loadGrantPrepProject(projectId: string, tenantId?: string | null) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      name: true,
      tenantId: true,
      grantSessions: {
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
        select: {
          id: true,
          fundingCallId: true,
          status: true,
        },
      },
    },
  });
}

export async function resolveGrantPrepContext(
  projectId: string,
  user: { id: string; email?: string | null; tenantId?: string | null }
) {
  const project = await loadGrantPrepProject(projectId, user.tenantId);
  if (!project) {
    throw new Error('Project not found');
  }

  const fundingContext = await resolveProjectFundingContext(projectId, user);
  const linkedFundingCallId = project.grantSessions[0]?.fundingCallId || null;
  const draftingContext = linkedFundingCallId
    ? await fundingGuidelineService.getDraftingContext(linkedFundingCallId)
    : null;

  let templateRevisionId: string | null = null;
  if (draftingContext?.approvedTemplate?.id && draftingContext.approvedTemplate.current_revision_no > 0) {
    const templateRevision = await prisma.fundingCallTemplateRevision.findUnique({
      where: {
        templateId_version: {
          templateId: draftingContext.approvedTemplate.id,
          version: draftingContext.approvedTemplate.current_revision_no,
        },
      },
      select: { id: true },
    });
    templateRevisionId = templateRevision?.id || null;
  }

  const mode = determineGrantPrepMode({
    hasFundingCall: Boolean(linkedFundingCallId),
    hasApprovedTemplate: Boolean(draftingContext?.approvedTemplate),
    hasApprovedGuidelines: Boolean(draftingContext?.approvedGuidelineRevision),
  });

  return {
    project,
    fundingCallId: linkedFundingCallId,
    fundingContext,
    draftingContext,
    templateRevisionId,
    guidelineRevisionId: draftingContext?.approvedGuidelineRevision?.id || null,
    mode,
  };
}

export function buildGrantPrepModeWarning(mode: string, fundingWarning: string | null) {
  const warnings: string[] = [];
  if (fundingWarning) {
    warnings.push(fundingWarning);
  }

  if (mode === 'template_only') {
    warnings.push('Approved guidelines are not attached yet. Template-based prep is available with lighter rule enforcement.');
  } else if (mode === 'guided_fallback') {
    warnings.push('No approved template is attached yet. Grant Prep is using call facts and approved guidelines.');
  } else if (mode === 'lightweight') {
    warnings.push('Grant Prep is using funding call facts only. Template and guideline enrichments are not attached yet.');
  } else if (mode === 'standalone') {
    warnings.push('Grant Prep is running without a linked funding call. Papsi handoff will have less call-specific structure.');
  }

  return warnings.length > 0 ? warnings.join(' ') : null;
}

export function buildDefaultGrantPrepContext(input: {
  mode: GrantPrepSessionContext['mode'];
  engagementMode: GrantPrepEngagementMode;
  templateJson?: unknown | null;
  guidelinePack?: GuidelinePackDocument | null;
  fundingContext?: Pick<FundingCallContext, 'focusAreas' | 'deliverables' | 'budgetLimits' | 'projectDuration'> | null;
  selectedThrustAreaRuleKeys?: string[];
  warning?: string | null;
  enabledStageKeys?: GrantPrepStageKey[];
  disabledStageKeys?: GrantPrepStageKey[];
}) {
  return buildV2GrantPrepContext({
    mode: input.mode,
    engagementMode: input.engagementMode,
    templateJson: input.templateJson,
    guidelinePack: input.guidelinePack,
    fundingContext: input.fundingContext,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    warning: input.warning || null,
    enabledStageKeys: input.enabledStageKeys,
    disabledStageKeys: input.disabledStageKeys,
  });
}

export function ensureGrantPrepV2StageSelectionContext(sessionContext: GrantPrepSessionContext) {
  if (
    sessionContext.stageSelectionVersion === GRANT_PREP_V2_STAGE_SELECTION_VERSION ||
    sessionContext.stageSelectionVersion === GRANT_PREP_V3_STAGE_SELECTION_VERSION
  ) {
    return sessionContext;
  }

  return buildGrantPrepSessionContext({
    mode: sessionContext.mode,
    engagementMode: sessionContext.engagementMode,
    stageSelectionVersion: GRANT_PREP_V3_STAGE_SELECTION_VERSION,
    autoEnabledStageKeys: [],
    manualEnabledStageKeys: getConfigurableStageKeys(sessionContext.enabledStageKeys),
    manualDisabledStageKeys: getConfigurableStageKeys(sessionContext.disabledStageKeys),
    stageMapping: sessionContext.stageMapping,
    stageStates: sessionContext.stageStates,
    selectedThrustAreaRuleKeys: sessionContext.selectedThrustAreaRuleKeys,
    warning: sessionContext.warning,
  });
}

export function applyGrantPrepManualStageSelection(input: {
  sessionContext: GrantPrepSessionContext;
  manualEnabledStageKeys: GrantPrepStageKey[];
  manualDisabledStageKeys: GrantPrepStageKey[];
}) {
  const baseContext = ensureGrantPrepV2StageSelectionContext(input.sessionContext);
  const manualEnabledStageKeys = getConfigurableStageKeys(input.manualEnabledStageKeys);
  const manualDisabledStageKeys = getConfigurableStageKeys(input.manualDisabledStageKeys);
  const finalEnabledStageKeys = buildFinalEnabledStageKeys({
    autoEnabledStageKeys: baseContext.autoEnabledStageKeys,
    manualEnabledStageKeys,
    manualDisabledStageKeys,
  });
  const baseSources = Object.values(baseContext.stageStates).reduce((acc, stage) => {
    if (
      stage.selectionSource &&
      stage.selectionSource !== 'manual' &&
      baseContext.autoEnabledStageKeys.includes(stage.stageKey)
    ) {
      acc[stage.stageKey] = stage.selectionSource;
    }
    return acc;
  }, {} as Record<GrantPrepStageKey, NonNullable<GrantPrepStageStates[GrantPrepStageKey]['selectionSource']>>);
  const selectionSources = buildSelectionSources({
    autoEnabledStageKeys: baseContext.autoEnabledStageKeys,
    manualEnabledStageKeys,
    baseSources,
  });
  const enabledStageKeySet = new Set(finalEnabledStageKeys);
  const manualEnabledSet = new Set(manualEnabledStageKeys);
  const manualDisabledSet = new Set(manualDisabledStageKeys);
  const nextStageStates = Object.keys(baseContext.stageStates).reduce((acc, stageKey) => {
    const typedStageKey = stageKey as GrantPrepStageKey;
    const currentStage = baseContext.stageStates[typedStageKey];
    const isEnabled = enabledStageKeySet.has(typedStageKey);
    const selectionLevel = manualDisabledSet.has(typedStageKey)
      ? 'excluded'
      : manualEnabledSet.has(typedStageKey)
        ? 'recommended'
        : currentStage.selectionLevel || (isEnabled ? 'recommended' : 'optional');
    const nextStage = {
      ...currentStage,
      enabled: isEnabled,
      selectionSource: isEnabled ? selectionSources[typedStageKey] || null : null,
      selectionLevel,
    };

    recomputeStageState(nextStage);
    if (!isEnabled) {
      nextStage.status = 'disabled';
    }

    acc[typedStageKey] = nextStage;
    return acc;
  }, {} as GrantPrepStageStates);

  return withResolvedActiveStage(
    buildGrantPrepSessionContext({
      mode: baseContext.mode,
      engagementMode: baseContext.engagementMode,
      stageSelectionVersion: GRANT_PREP_V3_STAGE_SELECTION_VERSION,
      autoEnabledStageKeys: baseContext.autoEnabledStageKeys,
      manualEnabledStageKeys,
      manualDisabledStageKeys,
      stageMapping: baseContext.stageMapping,
      stageStates: nextStageStates,
      selectedThrustAreaRuleKeys: baseContext.selectedThrustAreaRuleKeys,
      warning: baseContext.warning,
    })
  );
}

export function inflateGrantPrepSessionContext(session: Pick<
  GrantPrepSession,
  | 'mode'
  | 'engagement_mode'
  | 'stage_selection_version'
  | 'auto_enabled_stage_keys'
  | 'manual_enabled_stage_keys'
  | 'manual_disabled_stage_keys'
  | 'active_stage_key'
  | 'selected_thrust_area_rule_keys'
  | 'enabled_stage_keys'
  | 'disabled_stage_keys'
  | 'stage_mapping_json'
  | 'stage_states_json'
  | 'global_keywords_json'
>, options?: { warning?: string | null }) {
  const stageMapping = ((session.stage_mapping_json || {}) as unknown) as GrantPrepStageMapping;
  const stageStates = normalizeGrantPrepStageStates(
    ((session.stage_states_json || {}) as unknown) as GrantPrepStageStates
  );
  const roleAlignedStageStates = applyGrantPrepPointRolesFromMapping(stageStates, stageMapping);
  const storedGlobalKeywords = asStringArray(session.global_keywords_json);
  const globalKeywords = storedGlobalKeywords.length > 0
    ? storedGlobalKeywords
    : collectGlobalKeywords(roleAlignedStageStates);

  return {
    mode: session.mode as GrantPrepSessionContext['mode'],
    engagementMode: normalizeGrantPrepEngagementMode(session.engagement_mode),
    stageSelectionVersion: (session.stage_selection_version as GrantPrepSessionContext['stageSelectionVersion']) || 'v1',
    activeStageKey: session.active_stage_key as GrantPrepStageKey,
    selectedThrustAreaRuleKeys: session.selected_thrust_area_rule_keys || [],
    autoEnabledStageKeys: asStageKeyArray(session.auto_enabled_stage_keys),
    manualEnabledStageKeys: asStageKeyArray(session.manual_enabled_stage_keys),
    manualDisabledStageKeys: asStageKeyArray(session.manual_disabled_stage_keys),
    enabledStageKeys: asStageKeyArray(session.enabled_stage_keys),
    disabledStageKeys: asStageKeyArray(session.disabled_stage_keys),
    stageMapping,
    stageStates: roleAlignedStageStates,
    globalKeywords,
    warning: options?.warning || null,
  } satisfies GrantPrepSessionContext;
}

export function normalizeGrantPrepForPersistence(context: GrantPrepSessionContext) {
  const stageStates = normalizeGrantPrepStageStates(context.stageStates);
  const overallReadiness = computeOverallReadiness(stageStates);
  const globalKeywords = collectGlobalKeywords(stageStates);
  const enabledStageKeys = Object.values(stageStates)
    .filter((stage) => stage.enabled)
    .map((stage) => stage.stageKey);
  const disabledStageKeys = Object.values(stageStates)
    .filter((stage) => !stage.enabled)
    .map((stage) => stage.stageKey);

  return {
    mode: context.mode,
    engagement_mode: normalizeGrantPrepEngagementMode(context.engagementMode),
    stage_selection_version: context.stageSelectionVersion,
    auto_enabled_stage_keys: context.autoEnabledStageKeys,
    manual_enabled_stage_keys: context.manualEnabledStageKeys,
    manual_disabled_stage_keys: context.manualDisabledStageKeys,
    active_stage_key: context.activeStageKey,
    selected_thrust_area_rule_keys: context.selectedThrustAreaRuleKeys,
    enabled_stage_keys: enabledStageKeys,
    disabled_stage_keys: disabledStageKeys,
    stage_mapping_json: context.stageMapping as unknown as Prisma.InputJsonValue,
    stage_states_json: stageStates as unknown as Prisma.InputJsonValue,
    global_keywords_json: globalKeywords as unknown as Prisma.InputJsonValue,
    overall_readiness: overallReadiness,
  };
}

export async function loadGrantPrepSession(input: {
  sessionId: string;
  userId?: string | null;
  tenantId?: string | null;
}) {
  return prisma.grantPrepSession.findFirst({
    where: {
      id: input.sessionId,
      ...(input.userId ? { user_id: input.userId } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    },
    include: {
      messages: {
        orderBy: {
          created_at: 'asc',
        },
      },
      project: {
        select: {
          id: true,
          name: true,
          tenantId: true,
        },
      },
    },
  });
}

async function ensureGrantSessionAnchor(input: {
  projectId: string;
  tenantId: string;
  userId: string;
  fundingCallId: string;
}) {
  const existing = await prisma.grantSession.findFirst({
    where: {
      projectId: input.projectId,
      tenantId: input.tenantId,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (existing) {
    return prisma.grantSession.update({
      where: { id: existing.id },
      data: {
        fundingCallId: input.fundingCallId,
        status: 'PREP_OPTIONAL',
        updatedByUserId: input.userId,
      },
    });
  }

  return prisma.grantSession.create({
    data: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
      status: 'PREP_OPTIONAL',
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    },
  });
}

export async function createOrReuseGrantPrepSession(input: {
  projectId: string;
  tenantId: string;
  user: { id: string; email?: string | null; tenantId?: string | null };
  fundingCallId?: string | null;
  engagementMode: GrantPrepEngagementMode;
  selectedThrustAreaRuleKeys?: string[];
  enabledStageKeys?: GrantPrepStageKey[];
  disabledStageKeys?: GrantPrepStageKey[];
  restart?: boolean;
}) {
  const normalizedEngagementMode = normalizeGrantPrepEngagementMode(input.engagementMode);
  const linkedGrantSession = input.fundingCallId
    ? await ensureGrantSessionAnchor({
      projectId: input.projectId,
      tenantId: input.tenantId,
      userId: input.user.id,
      fundingCallId: input.fundingCallId,
    })
    : null;

  const context = await resolveGrantPrepContext(input.projectId, input.user);
  const resolveWorkspaceLaunchUrl = (grantSessionId: string | null) =>
    grantSessionId ? `/projects/${input.projectId}/grants/${grantSessionId}/workspace?stage=GRANTMENTOR` : null;
  const resolvePrepUrl = (grantSessionId: string | null, sessionId: string) =>
    grantSessionId
      ? `/projects/${input.projectId}/grants/${grantSessionId}/prep`
      : `/projects/${input.projectId}/grants/${sessionId}/prep`;
  const existingSession = await prisma.grantPrepSession.findFirst({
    where: {
      project_id: input.projectId,
      user_id: input.user.id,
      tenantId: input.tenantId,
      status: {
        not: 'archived',
      },
    },
    orderBy: {
      updated_at: 'desc',
    },
  });

  if (existingSession && !input.restart) {
    const effectiveGrantSessionId = linkedGrantSession?.id || existingSession.grant_session_id || null;
    const launchUrl = resolveWorkspaceLaunchUrl(effectiveGrantSessionId);
    let hydrated = null;

    if (
      (effectiveGrantSessionId && existingSession.grant_session_id !== effectiveGrantSessionId) ||
      existingSession.papsi_launch_url !== launchUrl
    ) {
      hydrated = await prisma.grantPrepSession.update({
        where: { id: existingSession.id },
        data: {
          engagement_mode: normalizedEngagementMode,
          grant_session_id: effectiveGrantSessionId,
          papsi_launch_url: launchUrl,
          ...(input.fundingCallId ? { funding_call_id: input.fundingCallId } : {}),
        },
        include: {
          messages: {
            orderBy: {
              created_at: 'asc',
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      });
    } else {
      hydrated = await loadGrantPrepSession({
        sessionId: existingSession.id,
        userId: input.user.id,
        tenantId: input.tenantId,
      });
    }

    return {
      session: hydrated,
      reused: true,
      context,
      grantSessionId: effectiveGrantSessionId,
      launchUrl,
      prepUrl: resolvePrepUrl(effectiveGrantSessionId, existingSession.id),
    };
  }

  if (input.restart) {
    await prisma.grantPrepSession.updateMany({
      where: {
        project_id: input.projectId,
        user_id: input.user.id,
        tenantId: input.tenantId,
        status: {
          not: 'archived',
        },
      },
      data: {
        status: 'archived',
      },
    });
  }

    const warning = buildGrantPrepModeWarning(context.mode, context.fundingContext.warning);
  const grantPrepContext = buildDefaultGrantPrepContext({
    mode: context.mode,
    engagementMode: normalizedEngagementMode,
    templateJson: context.draftingContext?.approvedTemplate?.grant_template_json || null,
    guidelinePack:
      ((context.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as unknown) as GuidelinePackDocument | null) ||
      null,
    fundingContext: context.fundingContext,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    warning,
    enabledStageKeys: input.enabledStageKeys,
    disabledStageKeys: input.disabledStageKeys,
  });

  const persistence = normalizeGrantPrepForPersistence(grantPrepContext);
  const createdSession = await prisma.grantPrepSession.create({
    data: {
      tenantId: input.tenantId,
      project_id: input.projectId,
      user_id: input.user.id,
      funding_call_id: context.fundingCallId,
      grant_session_id: linkedGrantSession?.id || null,
      template_revision_id: context.templateRevisionId,
      guideline_revision_id: context.guidelineRevisionId,
      papsi_launch_url: resolveWorkspaceLaunchUrl(linkedGrantSession?.id || null),
      ...persistence,
      status: 'active',
    },
    include: {
      messages: true,
      project: {
        select: {
          id: true,
          name: true,
          tenantId: true,
        },
      },
    },
  });

  return {
    session: createdSession,
    reused: false,
    context,
    grantSessionId: linkedGrantSession?.id || null,
    launchUrl: resolveWorkspaceLaunchUrl(linkedGrantSession?.id || null),
    prepUrl: resolvePrepUrl(linkedGrantSession?.id || null, createdSession.id),
  };
}

export function refreshGrantPrepSessionContext(input: {
  sessionContext: GrantPrepSessionContext;
  templateJson?: unknown | null;
  guidelinePack?: GuidelinePackDocument | null;
  fundingContext?: Pick<FundingCallContext, 'focusAreas' | 'deliverables' | 'budgetLimits' | 'projectDuration'> | null;
  warning?: string | null;
}) {
  if (
    input.sessionContext.stageSelectionVersion !== GRANT_PREP_V2_STAGE_SELECTION_VERSION &&
    input.sessionContext.stageSelectionVersion !== GRANT_PREP_V3_STAGE_SELECTION_VERSION
  ) {
    const nextStageMapping = buildGrantPrepStageMapping(input.templateJson);
    const previousSources = Object.values(input.sessionContext.stageStates).reduce((acc, stage) => {
      if (stage.enabled && stage.selectionSource) {
        acc[stage.stageKey] = stage.selectionSource;
      }
      return acc;
    }, {} as Record<GrantPrepStageKey, NonNullable<GrantPrepStageStates[GrantPrepStageKey]['selectionSource']>>);
    const baseStageStates = buildInitialStageStates(
      nextStageMapping,
      input.sessionContext.enabledStageKeys,
      previousSources
    );
    const mergedStageStates = mergeStageStates(input.sessionContext.stageStates, baseStageStates);

    return withResolvedActiveStage({
      ...input.sessionContext,
      stageSelectionVersion: GRANT_PREP_V3_STAGE_SELECTION_VERSION,
      stageMapping: nextStageMapping,
      stageStates: mergedStageStates,
      globalKeywords: collectGlobalKeywords(mergedStageStates),
      warning: input.warning || null,
    } satisfies GrantPrepSessionContext);
  }

  const selectorResult = buildGrantPrepSelectorResult({
    mode: input.sessionContext.mode,
    templateJson: input.templateJson,
    guidelinePack: input.guidelinePack,
    selectedThrustAreaRuleKeys: input.sessionContext.selectedThrustAreaRuleKeys,
    fundingContext: input.fundingContext || null,
  });

  let manualEnabledStageKeys = getConfigurableStageKeys(input.sessionContext.manualEnabledStageKeys);
  const manualDisabledStageKeys = getConfigurableStageKeys(input.sessionContext.manualDisabledStageKeys);

  const buildMergedContext = (nextManualEnabledStageKeys: GrantPrepStageKey[]) => {
    const finalEnabledStageKeys = buildFinalEnabledStageKeys({
      autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
      manualEnabledStageKeys: nextManualEnabledStageKeys,
      manualDisabledStageKeys,
    });
    const selectionSources = buildSelectionSources({
      autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
      manualEnabledStageKeys: nextManualEnabledStageKeys,
      baseSources: selectorResult.selectionSources,
    });
    const baseStageStates = buildInitialStageStates(
      selectorResult.stageMapping,
      finalEnabledStageKeys,
      selectionSources,
      {
        ...selectorResult.selectionLevels,
        ...nextManualEnabledStageKeys.reduce((acc, stageKey) => {
          acc[stageKey] = 'recommended';
          return acc;
        }, {} as Partial<Record<GrantPrepStageKey, 'recommended'>>),
        ...manualDisabledStageKeys.reduce((acc, stageKey) => {
          acc[stageKey] = 'excluded';
          return acc;
        }, {} as Partial<Record<GrantPrepStageKey, 'excluded'>>),
      }
    );
    const mergedStageStates = mergeStageStates(input.sessionContext.stageStates, baseStageStates);

    return buildGrantPrepSessionContext({
      mode: input.sessionContext.mode,
      engagementMode: input.sessionContext.engagementMode,
      stageSelectionVersion: GRANT_PREP_V3_STAGE_SELECTION_VERSION,
      autoEnabledStageKeys: selectorResult.autoEnabledStageKeys,
      manualEnabledStageKeys: nextManualEnabledStageKeys,
      manualDisabledStageKeys,
      stageMapping: selectorResult.stageMapping,
      stageStates: mergedStageStates,
      selectedThrustAreaRuleKeys: input.sessionContext.selectedThrustAreaRuleKeys,
      warning: input.warning || null,
    });
  };

  let nextContext = buildMergedContext(manualEnabledStageKeys);
  const promotedStageKeys = sortStageKeys(
    Object.values(input.sessionContext.stageStates)
      .filter(
        (stage) =>
          stage.enabled &&
          stage.pickable &&
          !nextContext.enabledStageKeys.includes(stage.stageKey) &&
          !manualDisabledStageKeys.includes(stage.stageKey) &&
          stageHasCapturedContent(stage)
      )
      .map((stage) => stage.stageKey)
  );

  if (promotedStageKeys.length > 0) {
    manualEnabledStageKeys = sortStageKeys([
      ...manualEnabledStageKeys,
      ...promotedStageKeys,
    ]);
    nextContext = buildMergedContext(manualEnabledStageKeys);
  }

  return withResolvedActiveStage(nextContext);
}
