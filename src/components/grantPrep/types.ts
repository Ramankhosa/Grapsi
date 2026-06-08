import type {
  GrantPrepEngagementMode,
  GrantPrepMappedPoint,
  GrantPrepPointCapture,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepSteeringEvent,
  GrantPrepSuggestedAnswer,
} from '../../lib/grantPrep/types';
import type { GuidelinePackDocument, FundingGuidelineRuleItem } from '../../lib/fundingGuidelines/types';
import type { CompiledGrantTemplateSectionType, GrantWorkflowMode } from '../../types/grant';

export type PrepMessage = {
  id: string;
  role: string;
  content: string;
  stage_key?: GrantPrepStageKey;
  marker_status?: string | null;
  captured_content_json?: Array<{
    pointKey: string;
    keywords: string[];
    thrustLinkage?: string[];
  }> | null;
  steering_events_json?: GrantPrepSteeringEvent[] | null;
  suggested_follow_ups?: string[] | null;
  suggested_answers?: GrantPrepSuggestedAnswer[] | null;
  quality_assessment?: string | null;
  is_critique?: boolean;
  current_point?: string | null;
  created_at?: string;
};

export type PrepSession = {
  id: string;
  status: string;
  papsi_launch_url: string | null;
  overall_readiness: number;
  last_handoff_error?: string | null;
  project: {
    id: string;
    project_title: string;
    project_description: string | null;
  };
  messages: PrepMessage[];
};

export type PrepPostLaunchImpact = {
  hasLaunchedWorkspace: boolean;
  hasBlueprint: boolean;
  blueprintStatus: string | null;
  hasDraftContent: boolean;
  draftedSectionCount: number;
  appDraftContentCount: number;
  manualDraftContentCount: number;
};

export type PrepFundingContext = {
  title: string;
  agencyName: string;
  deadline: string;
  funding: string;
  projectDuration: string;
  focusAreas: string[];
  disciplines?: string[];
  fundingKinds?: string[];
};

export type PrepDraftingContext = {
  approvedGuidelineRevision: {
    id: string;
    revision_no?: number | null;
    guideline_pack_json?: GuidelinePackDocument | null;
    created_at?: string | null;
  } | null;
  approvedTemplate: {
    id: string;
    current_revision_no?: number | null;
  } | null;
};

export type PrepHandoffPreview = {
  blockers: Array<{ stageKey: string; pointKey: string; message: string }>;
  overallReadiness?: number;
  generationReady?: boolean;
  generationReadinessThreshold?: number;
  generationBlockedMessage?: string | null;
  sectionPreview?: Array<{
    sectionKey: string;
    label: string;
    sectionType: CompiledGrantTemplateSectionType;
    workflowMode: GrantWorkflowMode;
    required: boolean;
  }>;
  canLaunch?: boolean;
};

export type PrepRuleGroup = {
  key: string;
  label: string;
  primary: FundingGuidelineRuleItem[];
  secondary: FundingGuidelineRuleItem[];
};

export type PointAction =
  | { stageKey: GrantPrepStageKey; pointKey: string; action: 'reopen' }
  | { stageKey: GrantPrepStageKey; pointKey: string; action: 'replace_keywords'; keywords: string[] }
  | { stageKey: GrantPrepStageKey; pointKey: string; action: 'skip' }
  | { stageKey: GrantPrepStageKey; pointKey: string; action: 'unskip' };

export type GrantPrepLayoutMode = 'desktop' | 'tablet' | 'mobile';

export type PointLookup = Record<string, GrantPrepMappedPoint & { stageKey: GrantPrepStageKey }>;

export type PrepContext = GrantPrepSessionContext;
export type PrepPointCapture = GrantPrepPointCapture;
export type PrepEngagementMode = GrantPrepEngagementMode;
