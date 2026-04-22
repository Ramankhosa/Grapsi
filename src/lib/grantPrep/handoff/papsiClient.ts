import axios from 'axios';
import type { GrantPrepFreezePayload } from '../types';

export interface PapsiGrantSessionResponse {
  grant_session_id: string;
  launch_token: string;
  launch_url: string;
  status: string;
  blueprint_summary?: string | null;
  error_message?: string | null;
}

export async function createPapsiGrantSession(input: {
  externalSessionId: string;
  externalProjectId: string;
  externalUser: { external_user_id: string; email: string | null | undefined; name: string | null | undefined };
  payload: GrantPrepFreezePayload;
  payloadHash: string;
}) {
  const baseUrl = process.env.PAPSI_BASE_URL;
  const secret = process.env.PAPSI_GRANT_INTEGRATION_SECRET;

  if (!baseUrl || !secret) {
    throw new Error('Papsi handoff is not configured.');
  }

  const response = await axios.post<PapsiGrantSessionResponse>(
    `${baseUrl.replace(/\/+$/, '')}/api/integrations/grants/sessions`,
    {
      source_app: 'grantmentor',
      external_session_id: input.externalSessionId,
      external_project_id: input.externalProjectId,
      external_user: input.externalUser,
      payload_version: input.payload.version,
      frozen_at: input.payload.frozenAt,
      frozen_payload_hash: input.payloadHash,
      grant_context: input.payload.fundingCall,
      brainstorming_snapshot: {
        stageMapping: input.payload.stageMapping,
        stageStates: input.payload.stageStates,
        globalKeywords: input.payload.globalKeywords,
      },
      guideline_snapshot: {
        mode: input.payload.guidance.mode,
        guidelineRevisionId: input.payload.guidance.guidelineRevisionId,
        templateRevisionId: input.payload.guidance.templateRevisionId,
        selectedThrustAreaRuleKeys: input.payload.guidance.selectedThrustAreaRuleKeys,
      },
      project: input.payload.project,
      blockers: input.payload.blockers,
    },
    {
      timeout: Number(process.env.PAPSI_HANDOFF_TIMEOUT_MS || 15000),
      headers: {
        Authorization: `Bearer ${secret}`,
        'Idempotency-Key': `grantmentor:${input.externalSessionId}:${input.payloadHash}`,
      },
    }
  );

  return response.data;
}
