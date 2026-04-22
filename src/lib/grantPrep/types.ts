import type { GrantPrepEvidenceItem } from '@/types/grant';

export const GRANT_PREP_MODES = [
  'template_driven',
  'guided_fallback',
  'template_only',
  'lightweight',
  'standalone',
] as const;

export const GRANT_PREP_ENGAGEMENT_MODES = ['expert', 'express'] as const;
export const GRANT_PREP_STAGE_SELECTION_VERSIONS = ['v1', 'v2'] as const;

export const GRANT_PREP_STATUSES = [
  'active',
  'ready',
  'handoff_failed',
  'handed_off',
  'launched',
  'archived',
] as const;

export const GRANT_PREP_MARKER_STATUSES = ['valid', 'repaired', 'invalid'] as const;

export type GrantPrepMode = typeof GRANT_PREP_MODES[number];
export type GrantPrepEngagementMode = typeof GRANT_PREP_ENGAGEMENT_MODES[number];
export type GrantPrepStageSelectionVersion = typeof GRANT_PREP_STAGE_SELECTION_VERSIONS[number];
export type GrantPrepStatus = typeof GRANT_PREP_STATUSES[number];
export type GrantPrepMarkerStatus = typeof GRANT_PREP_MARKER_STATUSES[number];

export type PointPriority = 'P1' | 'P2' | 'P3';
export type SteeringLevel = 'hard_block' | 'gentle_redirect' | 'awareness_nudge';
export type CaptureBasis = 'from_pitch' | 'inferred_from_call' | 'generic_placeholder' | 'user_confirmed';
export type GrantPrepStageSelectionSource = 'template' | 'fallback' | 'guideline' | 'dependency' | 'manual';

export type GrantPrepStageKey =
  | 'problem_definition'
  | 'root_cause'
  | 'beneficiaries'
  | 'fit_and_scope'
  | 'thrust_alignment'
  | 'methodology'
  | 'workplan'
  | 'team_and_partnerships'
  | 'innovation'
  | 'evaluation'
  | 'outcomes'
  | 'risk_and_ethics'
  | 'budget_strategy'
  | 'sustainability_and_scale'
  | 'final_pitch'
  | 'handoff_ready'
  | 'handoff_complete';

export interface GrantPrepDiscussionPointDefinition {
  key: string;
  label: string;
  priority: PointPriority;
  helpText: string;
  templateKeywords: string[];
}

export function isGrantPrepEngagementMode(value: unknown): value is GrantPrepEngagementMode {
  return value === 'expert' || value === 'express';
}

export function normalizeGrantPrepEngagementMode(value: unknown): GrantPrepEngagementMode {
  if (value === 'express') {
    return 'express';
  }

  if (value === 'expert' || value === 'guided' || value === 'hybrid') {
    return 'expert';
  }

  return 'expert';
}

export interface GrantPrepReviewerRubric {
  strong: string;
  adequate: string;
  weak: string;
}

export interface GrantPrepStageDefinition {
  key: GrantPrepStageKey;
  title: string;
  category: 'framing' | 'alignment' | 'design' | 'delivery' | 'terminal';
  description: string;
  askStyle: string;
  defaultEnabled: boolean;
  pickable: boolean;
  guidelineBlocks: string[];
  steeringRule: string;
  dependencies: GrantPrepStageKey[];
  defaultPoints: GrantPrepDiscussionPointDefinition[];
  reviewerRubric?: GrantPrepReviewerRubric;
}

export interface GrantPrepMappedPoint {
  key: string;
  label: string;
  priority: PointPriority;
  sourceTemplatePointer: string | null;
  origin: 'template' | 'default';
  helpText: string;
}

export interface GrantPrepStageMappingEntry {
  stageKey: GrantPrepStageKey;
  stageTitle: string;
  discussionPoints: GrantPrepMappedPoint[];
  templatePointers: string[];
  secondaryPointers: string[];
}

export type GrantPrepStageMapping = Record<GrantPrepStageKey, GrantPrepStageMappingEntry>;

export interface GrantPrepPointCapture {
  keywords: string[];
  thrustLinkage: string[];
  factBullets?: string[];
  ruleNotes?: string[];
  confidence?: number;
  ruleCompliance: {
    status: 'ok' | 'warning' | 'needs_review';
    reason?: string | null;
    rescopeNeeded?: boolean;
  };
  captureBasis: CaptureBasis[];
  sourceTemplatePointer: string | null;
  updatedAt: string;
}

export interface GrantPrepPointState {
  key: string;
  label: string;
  priority: PointPriority;
  status: 'pending' | 'covered' | 'skipped' | 'needs_review';
  sourceTemplatePointer: string | null;
  capture: GrantPrepPointCapture | null;
}

export interface GrantPrepStageState {
  stageKey: GrantPrepStageKey;
  title: string;
  enabled: boolean;
  pickable: boolean;
  selectionSource?: GrantPrepStageSelectionSource | null;
  readiness: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'needs_review' | 'disabled';
  steeringEvents: GrantPrepSteeringEvent[];
  points: GrantPrepPointState[];
  lastUpdatedAt: string | null;
}

export type GrantPrepStageStates = Record<GrantPrepStageKey, GrantPrepStageState>;

export interface GrantPrepSteeringEvent {
  id: string;
  level: SteeringLevel;
  message: string;
  pointKey: string | null;
  createdAt: string;
}

export interface GrantPrepMarkerPoint {
  pointKey: string;
  keywords: string[];
  thrustLinkage?: string[];
  factBullets?: string[];
  ruleNotes?: string[];
  confidence?: number;
  captureBasis?: CaptureBasis[];
  ruleCompliance?: {
    status?: 'ok' | 'warning' | 'needs_review';
    reason?: string | null;
    rescopeNeeded?: boolean;
  };
}

export interface GrantPrepSuggestedAnswer {
  label: string;
  text: string;
  rationale?: string | null;
}

export interface GrantPrepMarkerPayload {
  version: 'brainstorm_marker_v1';
  stageKey: GrantPrepStageKey;
  readinessDelta?: number;
  pointsCovered?: GrantPrepMarkerPoint[];
  currentPoint?: string | null;
  suggestedFollowUps?: string[] | null;
  suggestedAnswers?: GrantPrepSuggestedAnswer[] | null;
  qualityAssessment?: 'strong' | 'adequate' | 'weak' | null;
  steeringEvents?: Array<{
    level: SteeringLevel;
    message: string;
    pointKey?: string | null;
  }>;
  compactUserFacingSummary?: string | null;
}

export interface GrantPrepResponseEnvelope {
  assistantMessage: string;
  markerStatus: GrantPrepMarkerStatus;
  marker: GrantPrepMarkerPayload | null;
  warning: string | null;
}

export interface GrantPrepSessionContext {
  mode: GrantPrepMode;
  engagementMode: GrantPrepEngagementMode;
  stageSelectionVersion: GrantPrepStageSelectionVersion;
  activeStageKey: GrantPrepStageKey;
  selectedThrustAreaRuleKeys: string[];
  autoEnabledStageKeys: GrantPrepStageKey[];
  manualEnabledStageKeys: GrantPrepStageKey[];
  manualDisabledStageKeys: GrantPrepStageKey[];
  enabledStageKeys: GrantPrepStageKey[];
  disabledStageKeys: GrantPrepStageKey[];
  stageMapping: GrantPrepStageMapping;
  stageStates: GrantPrepStageStates;
  globalKeywords: string[];
  warning: string | null;
}

export interface GrantPrepFreezePayload {
  version: 'grant_handoff_v1';
  frozenAt: string;
  project: {
    id: string;
    title: string;
    description: string | null;
  };
  fundingCall: {
    id: string | null;
    title: string;
    agencyName: string;
    deadline: string;
    funding: string;
    projectDuration: string;
    eligibility: string;
    deliverables: string;
    focusAreas: string[];
    officialUrls: string[];
    warning: string | null;
  };
  guidance: {
    mode: GrantPrepMode;
    engagementMode: GrantPrepEngagementMode;
    guidelineRevisionId: string | null;
    templateRevisionId: string | null;
    selectedThrustAreaRuleKeys: string[];
  };
  stageMapping: GrantPrepStageMapping;
  stageStates: GrantPrepStageStates;
  globalKeywords: string[];
  globalCaptureSummary: string[];
  prepEvidence: GrantPrepEvidenceItem[];
  prepEvidenceBySection: Record<string, GrantPrepEvidenceItem[]>;
  blockers: Array<{
    stageKey: GrantPrepStageKey;
    pointKey: string;
    message: string;
  }>;
}
