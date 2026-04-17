DO $$ BEGIN
  CREATE TYPE "GrantPrepMode" AS ENUM ('template_driven', 'guided_fallback', 'template_only', 'lightweight', 'standalone');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrantPrepEngagementMode" AS ENUM ('guided', 'hybrid', 'express');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrantPrepStatus" AS ENUM ('active', 'ready', 'handoff_failed', 'handed_off', 'launched', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrantPrepMarkerStatus" AS ENUM ('valid', 'repaired', 'invalid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "grant_prep_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "funding_call_id" TEXT,
  "template_revision_id" TEXT,
  "guideline_revision_id" TEXT,
  "selected_thrust_area_rule_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mode" "GrantPrepMode" NOT NULL,
  "engagement_mode" "GrantPrepEngagementMode" NOT NULL DEFAULT 'guided',
  "stage_selection_version" TEXT NOT NULL DEFAULT 'v1',
  "auto_enabled_stage_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "manual_enabled_stage_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "manual_disabled_stage_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active_stage_key" TEXT NOT NULL,
  "enabled_stage_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "disabled_stage_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stage_mapping_json" JSONB NOT NULL,
  "stage_states_json" JSONB NOT NULL,
  "global_keywords_json" JSONB NOT NULL,
  "overall_readiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "GrantPrepStatus" NOT NULL DEFAULT 'active',
  "frozen_payload_json" JSONB,
  "frozen_payload_version" TEXT,
  "frozen_payload_hash" TEXT,
  "frozen_at" TIMESTAMP(3),
  "papsi_session_id" TEXT,
  "papsi_launch_url" TEXT,
  "last_handoff_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grant_prep_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grant_prep_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_prep_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_prep_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "grant_prep_sessions_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "grant_prep_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "stage_key" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "client_message_id" TEXT,
  "marker_version" TEXT,
  "marker_status" "GrantPrepMarkerStatus",
  "readiness_snapshot" DOUBLE PRECISION,
  "points_covered_snapshot" JSONB,
  "current_point" TEXT,
  "captured_content_json" JSONB,
  "steering_events_json" JSONB,
  "suggested_follow_ups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggested_answers" JSONB,
  "quality_assessment" TEXT,
  "is_critique" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grant_prep_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grant_prep_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "grant_prep_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "grant_prep_messages_session_client_message_unique"
  ON "grant_prep_messages"("session_id", "client_message_id");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_sessions_tenant_id"
  ON "grant_prep_sessions"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_sessions_project_id"
  ON "grant_prep_sessions"("project_id");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_sessions_user_id"
  ON "grant_prep_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_sessions_funding_call_id"
  ON "grant_prep_sessions"("funding_call_id");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_sessions_status"
  ON "grant_prep_sessions"("status");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_messages_session_created_at"
  ON "grant_prep_messages"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_grant_prep_messages_stage_key"
  ON "grant_prep_messages"("stage_key");
