import { Prisma } from '@prisma/client';
import type { GrantPrepSession } from '@prisma/client';
import { prisma } from '../prisma';
import type { FundingCallContext, ProjectFundingContextBinding } from '../fundingContext';
import { fundingGuidelineService } from '../fundingGuidelines/service';
import { fundingTemplateService } from '../fundingTemplates/service';
import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { resolveProjectFundingContext } from '../fundingContext';
import {
  buildGrantPrepEntryUrl,
  buildGrantProjectOpenUrl,
  buildGrantWorkspaceUrl,
} from '../grants/workspaceNavigation';
import {
  GRANT_PREP_STAGE_BY_KEY,
  getFirstEnabledPickableStageKey,
  getNextEnabledPickableStageKey,
  sortGrantPrepStageKeys,
} from './stageLibrary';
import { getCanonicalGrantPrepStageKey } from './stageModel';
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
  determineGrantPrepMode,
  collectGlobalKeywords,
  computeOverallReadiness,
  applyGrantPrepPointRolesFromMapping,
  recomputeStageState,
  pointHasCapturedContent,
  stageHasCapturedContent,
} from './sessionState';
import { buildGrantPrepStageMapping, normalizeGrantPrepStageMapping } from './templateMapper';
import {
  deriveGrantPrepPriorityAreaOptions,
  normalizeGrantPrepPriorityAreaSelection,
} from './priorityAreas';
import type {
  GrantPrepEngagementMode,
  GrantPrepIdeationContext,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageMapping,
  GrantPrepStageStates,
} from './types';
import { normalizeGrantPrepEngagementMode } from './types';
import { markGrantPrepStageMemoryStale } from './stageMemory';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string | null | undefined, maxLength: number) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function emptyGrantPrepIdeationContext(): GrantPrepIdeationContext {
  return {
    hasUsableContext: false,
    sourceSummary: [],
    profile: null,
    savedResearchAreas: [],
    publications: [],
  };
}

export async function resolveGrantPrepIdeationContext(userId: string): Promise<GrantPrepIdeationContext> {
  if (!userId) {
    return emptyGrantPrepIdeationContext();
  }

  try {
    const client = prisma as any;
    if (!client.researcherProfile || !client.researcherSavedResearchArea || !client.referenceLibrary) {
      return emptyGrantPrepIdeationContext();
    }

    const [profile, savedResearchAreas, publications] = await Promise.all([
      client.researcherProfile.findUnique({
        where: { user_id: userId },
        select: {
          research_summary: true,
          research_areas: true,
          keywords: true,
          institution_name: true,
          institution_type: true,
          career_stage: true,
        },
      }),
      client.researcherSavedResearchArea.findMany({
        where: {
          user_id: userId,
        },
        select: {
          label: true,
          research_area: true,
          keywords: true,
          disciplines: true,
          taxonomy_level1_name: true,
          taxonomy_level2_name: true,
          is_default: true,
          updated_at: true,
        },
        orderBy: [
          { is_default: 'desc' },
          { updated_at: 'desc' },
        ],
        take: 5,
      }),
      client.referenceLibrary.findMany({
        where: {
          userId,
          isActive: true,
          tags: { has: 'my-publication' },
        },
        select: {
          title: true,
          year: true,
          venue: true,
          doi: true,
          abstract: true,
          updatedAt: true,
        },
        orderBy: [
          { year: 'desc' },
          { updatedAt: 'desc' },
        ],
        take: 5,
      }),
    ]);

    const normalizedProfile = profile
      ? {
          researchSummary: truncateText(profile.research_summary, 900),
          researchAreas: asStringArray(profile.research_areas).slice(0, 8),
          keywords: asStringArray(profile.keywords).slice(0, 12),
          institutionName: normalizeText(profile.institution_name) || null,
          institutionType: normalizeText(profile.institution_type) || null,
          careerStage: normalizeText(profile.career_stage) || null,
        }
      : null;

    const normalizedSavedAreas = (savedResearchAreas || [])
      .map((area: any) => {
        const taxonomyPath = [area.taxonomy_level1_name, area.taxonomy_level2_name]
          .map(normalizeText)
          .filter(Boolean)
          .join(' / ');
        return {
          label: normalizeText(area.label),
          researchArea: truncateText(area.research_area, 500) || '',
          keywords: asStringArray(area.keywords).slice(0, 8),
          disciplines: asStringArray(area.disciplines).slice(0, 6),
          taxonomyPath: taxonomyPath || null,
        };
      })
      .filter((area: GrantPrepIdeationContext['savedResearchAreas'][number]) => area.label || area.researchArea);

    const normalizedPublications = (publications || [])
      .map((publication: any) => ({
        title: normalizeText(publication.title),
        year: typeof publication.year === 'number' ? publication.year : null,
        venue: normalizeText(publication.venue) || null,
        doi: normalizeText(publication.doi) || null,
        abstractSnippet: truncateText(publication.abstract, 900),
      }))
      .filter((publication: GrantPrepIdeationContext['publications'][number]) => publication.title);

    const sourceSummary = [
      normalizedProfile?.researchSummary ? 'profile summary' : null,
      normalizedProfile?.researchAreas.length ? 'profile research areas' : null,
      normalizedProfile?.keywords.length ? 'profile keywords' : null,
      normalizedSavedAreas.length ? 'saved research areas' : null,
      normalizedPublications.length ? 'tagged publications' : null,
    ].filter((item): item is string => Boolean(item));

    return {
      hasUsableContext: sourceSummary.length > 0,
      sourceSummary,
      profile: normalizedProfile,
      savedResearchAreas: normalizedSavedAreas,
      publications: normalizedPublications,
    };
  } catch (error) {
    console.warn('[Grant Prep] Failed to load ideation context:', error);
    return emptyGrantPrepIdeationContext();
  }
}

function asStageKeyArray(value: unknown): GrantPrepStageKey[] {
  return sortGrantPrepStageKeys(
    (asStringArray(value) as GrantPrepStageKey[]).map(getCanonicalGrantPrepStageKey)
  );
}

function getConfigurableStageKeys(stageKeys: GrantPrepStageKey[] = []) {
  return sortStageKeys(stageKeys).filter((stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey]?.pickable);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    if (!currentStage) {
      acc[typedStageKey] = nextStage;
      return acc;
    }
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
      .filter((point) => !nextPointKeys.has(point.key) && pointHasCapturedContent(point))
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
      memory: currentStage.memory || nextStage.memory || null,
      decision: typedStageKey === 'ideation' ? currentStage.decision || nextStage.decision || null : null,
    };

    if (staleCapturedPoints.length > 0) {
      refreshedStage.steeringEvents.push({
        id: `refresh_${typedStageKey}_${Date.now()}`,
        level: 'gentle_redirect',
        message: 'Some earlier captures no longer map cleanly to the current template and need review.',
        pointKey: null,
        createdAt: new Date().toISOString(),
      });
      refreshedStage.memory = markGrantPrepStageMemoryStale(
        refreshedStage.memory,
        'Some earlier captures no longer map cleanly to the current template and need review.'
      );
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
  const activeStageKey = getCanonicalGrantPrepStageKey(context.activeStageKey);
  const currentStage = context.stageStates[activeStageKey];
  const nextActiveStageKey = currentStage?.enabled && currentStage.pickable
    ? activeStageKey
    : (
        getNextEnabledPickableStageKey(context.stageStates, activeStageKey) ||
        getFirstEnabledPickableStageKey(context.stageStates) ||
        'ideation'
      );

  return {
    ...context,
    activeStageKey: nextActiveStageKey,
    autoEnabledStageKeys: sortGrantPrepStageKeys(context.autoEnabledStageKeys),
    manualEnabledStageKeys: sortGrantPrepStageKeys(context.manualEnabledStageKeys),
    manualDisabledStageKeys: sortGrantPrepStageKeys(context.manualDisabledStageKeys),
    enabledStageKeys: sortGrantPrepStageKeys(context.enabledStageKeys),
    disabledStageKeys: sortGrantPrepStageKeys(context.disabledStageKeys),
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

export async function loadGrantPrepProject(
  projectId: string,
  tenantId?: string | null,
  binding?: ProjectFundingContextBinding
) {
  const grantSessionWhere = binding?.grantSessionId
    ? { id: binding.grantSessionId }
    : binding?.fundingCallId
      ? { fundingCallId: binding.fundingCallId }
      : {};

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
        where: grantSessionWhere,
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
  user: { id: string; email?: string | null; tenantId?: string | null },
  binding?: ProjectFundingContextBinding
) {
  const project = await loadGrantPrepProject(projectId, user.tenantId, binding);
  if (!project) {
    throw new Error('Project not found');
  }

  const fundingContext = await resolveProjectFundingContext(projectId, user, binding);
  const linkedFundingCallId = fundingContext.id || project.grantSessions[0]?.fundingCallId || null;
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
> & { messages?: Array<unknown> }, options?: { warning?: string | null }) {
  const stageMapping = normalizeGrantPrepStageMapping(
    ((session.stage_mapping_json || {}) as unknown) as Partial<GrantPrepStageMapping>
  );
  const stageStates = normalizeGrantPrepStageStates(
    ((session.stage_states_json || {}) as unknown) as GrantPrepStageStates,
    stageMapping
  );
  const roleAlignedStageStates = applyGrantPrepPointRolesFromMapping(stageStates, stageMapping);
  const storedGlobalKeywords = asStringArray(session.global_keywords_json);
  const globalKeywords = storedGlobalKeywords.length > 0
    ? storedGlobalKeywords
    : collectGlobalKeywords(roleAlignedStageStates);
  const storedEnabledStageKeys = asStageKeyArray(session.enabled_stage_keys);
  const storedDisabledStageKeys = asStageKeyArray(session.disabled_stage_keys);
  const enabledStageKeys = storedEnabledStageKeys.length > 0
    ? storedEnabledStageKeys
    : sortGrantPrepStageKeys(
        Object.values(roleAlignedStageStates)
          .filter((stage) => stage.enabled)
          .map((stage) => stage.stageKey)
      );
  const disabledStageKeys = storedDisabledStageKeys.length > 0
    ? storedDisabledStageKeys
    : sortGrantPrepStageKeys(
        Object.values(roleAlignedStageStates)
          .filter((stage) => !stage.enabled)
          .map((stage) => stage.stageKey)
      );
  const storedActiveStageKey = getCanonicalGrantPrepStageKey(session.active_stage_key as GrantPrepStageKey);
  const hasLoadedEmptyMessageList = Array.isArray(session.messages) && session.messages.length === 0;
  const canStartAtIdeation = Boolean(roleAlignedStageStates.ideation?.enabled && roleAlignedStageStates.ideation?.pickable);
  const activeStageKey = hasLoadedEmptyMessageList && canStartAtIdeation
    ? 'ideation'
    : roleAlignedStageStates[storedActiveStageKey]?.enabled && roleAlignedStageStates[storedActiveStageKey]?.pickable
      ? storedActiveStageKey
      : (
          getNextEnabledPickableStageKey(roleAlignedStageStates, storedActiveStageKey) ||
          getFirstEnabledPickableStageKey(roleAlignedStageStates) ||
          'ideation'
        );

  return {
    mode: session.mode as GrantPrepSessionContext['mode'],
    engagementMode: normalizeGrantPrepEngagementMode(session.engagement_mode),
    stageSelectionVersion: (session.stage_selection_version as GrantPrepSessionContext['stageSelectionVersion']) || 'v1',
    activeStageKey,
    selectedThrustAreaRuleKeys: session.selected_thrust_area_rule_keys || [],
    autoEnabledStageKeys: asStageKeyArray(session.auto_enabled_stage_keys),
    manualEnabledStageKeys: asStageKeyArray(session.manual_enabled_stage_keys),
    manualDisabledStageKeys: asStageKeyArray(session.manual_disabled_stage_keys),
    enabledStageKeys,
    disabledStageKeys,
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
  const enabledStageKeys = sortGrantPrepStageKeys(
    Object.values(stageStates)
      .filter((stage) => stage.enabled)
      .map((stage) => stage.stageKey)
  );
  const disabledStageKeys = sortGrantPrepStageKeys(
    Object.values(stageStates)
      .filter((stage) => !stage.enabled)
      .map((stage) => stage.stageKey)
  );
  const requestedActiveStageKey = getCanonicalGrantPrepStageKey(context.activeStageKey);
  const activeStageKey = stageStates[requestedActiveStageKey]?.enabled && stageStates[requestedActiveStageKey]?.pickable
    ? requestedActiveStageKey
    : (
        getNextEnabledPickableStageKey(stageStates, requestedActiveStageKey) ||
        getFirstEnabledPickableStageKey(stageStates) ||
        'ideation'
      );

  return {
    mode: context.mode,
    engagement_mode: normalizeGrantPrepEngagementMode(context.engagementMode),
    stage_selection_version: context.stageSelectionVersion,
    auto_enabled_stage_keys: sortGrantPrepStageKeys(context.autoEnabledStageKeys),
    manual_enabled_stage_keys: sortGrantPrepStageKeys(context.manualEnabledStageKeys),
    manual_disabled_stage_keys: sortGrantPrepStageKeys(context.manualDisabledStageKeys),
    active_stage_key: activeStageKey,
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

function buildGrantPrepTemplateFallbackOperator(input: {
  user: { id: string; email?: string | null };
  tenantId?: string | null;
}) {
  return {
    userId: input.user.id,
    email: input.user.email || input.user.id,
    role: 'USER' as const,
    tenantId: input.tenantId || null,
  };
}

async function ensureGrantSessionAnchor(input: {
  projectId: string;
  tenantId: string;
  userId: string;
  fundingCallId: string;
}) {
  const existingForCall = await prisma.grantSession.findFirst({
    where: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (existingForCall) {
    const shouldResetToPrep = existingForCall.status === 'SETUP' || existingForCall.status === 'PREP_OPTIONAL';
    return prisma.grantSession.update({
      where: { id: existingForCall.id },
      data: {
        ...(shouldResetToPrep ? { status: 'PREP_OPTIONAL' } : {}),
        updatedByUserId: input.userId,
      },
    });
  }

  const reusablePrepSession = await prisma.grantSession.findFirst({
    where: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      status: {
        in: ['SETUP', 'PREP_OPTIONAL'],
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (reusablePrepSession) {
    return prisma.grantSession.update({
      where: { id: reusablePrepSession.id },
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
  let linkedGrantSession = input.fundingCallId
    ? await ensureGrantSessionAnchor({
      projectId: input.projectId,
      tenantId: input.tenantId,
      userId: input.user.id,
      fundingCallId: input.fundingCallId,
    })
    : null;

  // A grant that has not launched yet opens on Draft Zero, not the GrantMentor
  // chat: buildGrantProjectOpenUrl already resolves the pre-launch stage to the
  // Draft Zero entry when the flag is on, and falls through to the workspace URL
  // for launched grants. Callers (funder finder, project grants) push this value
  // directly, so returning the workspace URL here is what used to strand users
  // in the chat instead of the fast path.
  const resolveWorkspaceLaunchUrl = (
    grantSessionId: string | null,
    prepStatus?: string | null,
    grantStatus?: string | null
  ) =>
    buildGrantProjectOpenUrl({
      projectId: input.projectId,
      prepSession: { status: prepStatus, grant_session_id: grantSessionId },
      grantSession: grantSessionId ? { id: grantSessionId, status: grantStatus } : null,
    })
    || buildGrantWorkspaceUrl({
      projectId: input.projectId,
      grantSessionId,
      prepStatus,
      grantStatus,
    });
  // Draft Zero is the default preparation entry (Grant Prep chat stays
  // reachable from its UI); falls back to /prep when Draft Zero is disabled.
  const resolvePrepUrl = (grantSessionId: string | null, sessionId: string) =>
    buildGrantPrepEntryUrl({
      projectId: input.projectId,
      grantOrPrepSessionId: grantSessionId || sessionId,
    });
  const existingSessionWhere = {
    project_id: input.projectId,
    user_id: input.user.id,
    tenantId: input.tenantId,
    status: {
      not: 'archived' as const,
    },
    ...(linkedGrantSession
      ? {
          OR: [
            { grant_session_id: linkedGrantSession.id },
            { funding_call_id: linkedGrantSession.fundingCallId },
          ],
        }
      : input.fundingCallId
        ? { funding_call_id: input.fundingCallId }
        : {}),
  };
  const existingSession = await prisma.grantPrepSession.findFirst({
    where: existingSessionWhere,
    orderBy: {
      updated_at: 'desc',
    },
  });

  const contextBinding = {
    grantSessionId: linkedGrantSession?.id || (!input.restart ? existingSession?.grant_session_id || null : null),
    fundingCallId: input.fundingCallId || (!input.restart ? existingSession?.funding_call_id || null : null),
  };
  let context = await resolveGrantPrepContext(input.projectId, input.user, contextBinding);
  const effectiveFundingCallId = input.fundingCallId || context.fundingCallId || existingSession?.funding_call_id || null;

  if (effectiveFundingCallId && !context.draftingContext?.approvedTemplate) {
    await fundingTemplateService.ensureStandardFallbackTemplate(
      effectiveFundingCallId,
      buildGrantPrepTemplateFallbackOperator({
        user: input.user,
        tenantId: input.tenantId,
      })
    );
    context = await resolveGrantPrepContext(input.projectId, input.user, {
      ...contextBinding,
      fundingCallId: effectiveFundingCallId,
    });
  }

  if (!linkedGrantSession && effectiveFundingCallId) {
    linkedGrantSession = await ensureGrantSessionAnchor({
      projectId: input.projectId,
      tenantId: input.tenantId,
      userId: input.user.id,
      fundingCallId: effectiveFundingCallId,
    });
  }

  const priorityAreaOptions = deriveGrantPrepPriorityAreaOptions(context.fundingContext);
  const prioritySelectionInputProvided = Array.isArray(input.selectedThrustAreaRuleKeys);
  const prioritySelectionResult = normalizeGrantPrepPriorityAreaSelection({
    selectedPriorityAreas: input.selectedThrustAreaRuleKeys || [],
    availablePriorityAreas: priorityAreaOptions,
    autoSelectSingle: true,
  });
  if (prioritySelectionResult.invalidPriorityAreas.length > 0) {
    throw new Error(
      `Selected target priority areas are not available for this funding call: ${prioritySelectionResult.invalidPriorityAreas.join(', ')}`
    );
  }

  if (existingSession && !input.restart) {
    const effectiveGrantSessionId = linkedGrantSession?.id || existingSession.grant_session_id || null;
    const launchUrl = resolveWorkspaceLaunchUrl(
      effectiveGrantSessionId,
      existingSession.status,
      linkedGrantSession?.status
    );
    const warning = buildGrantPrepModeWarning(context.mode, context.fundingContext.warning);
    const existingPrepContext = inflateGrantPrepSessionContext(existingSession, { warning });
    const shouldUpdatePriorityAreas =
      prioritySelectionInputProvided ||
      (
        prioritySelectionResult.selectedPriorityAreas.length === 1 &&
        existingPrepContext.selectedThrustAreaRuleKeys.length === 0
      );
    const priorityAlignedPrepContext = shouldUpdatePriorityAreas
      ? {
          ...existingPrepContext,
          selectedThrustAreaRuleKeys: prioritySelectionResult.selectedPriorityAreas,
        }
      : existingPrepContext;
    const prioritySelectionChanged = !sameStringArray(
      existingPrepContext.selectedThrustAreaRuleKeys,
      priorityAlignedPrepContext.selectedThrustAreaRuleKeys
    );
    const needsContextRefresh = (
      existingSession.mode !== context.mode ||
      existingSession.engagement_mode !== normalizedEngagementMode ||
      existingSession.template_revision_id !== context.templateRevisionId ||
      existingSession.guideline_revision_id !== context.guidelineRevisionId
    );
    const refreshedPersistence = needsContextRefresh || prioritySelectionChanged
      ? normalizeGrantPrepForPersistence(
          needsContextRefresh
            ? refreshGrantPrepSessionContext({
                sessionContext: priorityAlignedPrepContext,
                templateJson: context.draftingContext?.approvedTemplate?.grant_template_json || null,
                guidelinePack:
                  ((context.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as unknown) as GuidelinePackDocument | null) ||
                  null,
                fundingContext: context.fundingContext,
                warning,
              })
            : priorityAlignedPrepContext
        )
      : null;
    let hydrated = null;

    if (
      (effectiveGrantSessionId && existingSession.grant_session_id !== effectiveGrantSessionId) ||
      existingSession.papsi_launch_url !== launchUrl ||
      needsContextRefresh ||
      prioritySelectionChanged
    ) {
      hydrated = await prisma.grantPrepSession.update({
        where: { id: existingSession.id },
        data: {
          engagement_mode: normalizedEngagementMode,
          grant_session_id: effectiveGrantSessionId,
          papsi_launch_url: launchUrl,
          ...(effectiveFundingCallId ? { funding_call_id: effectiveFundingCallId } : {}),
          ...(refreshedPersistence || {}),
          ...(needsContextRefresh
            ? {
                template_revision_id: context.templateRevisionId,
                guideline_revision_id: context.guidelineRevisionId,
              }
            : {}),
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
    selectedThrustAreaRuleKeys: prioritySelectionResult.selectedPriorityAreas,
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
      funding_call_id: effectiveFundingCallId,
      grant_session_id: linkedGrantSession?.id || null,
      template_revision_id: context.templateRevisionId,
      guideline_revision_id: context.guidelineRevisionId,
      papsi_launch_url: resolveWorkspaceLaunchUrl(linkedGrantSession?.id || null, 'active', linkedGrantSession?.status),
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
    launchUrl: resolveWorkspaceLaunchUrl(linkedGrantSession?.id || null, 'active', linkedGrantSession?.status),
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
