CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "recommendation_conversations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "title" TEXT NOT NULL DEFAULT 'New Funding Chat',
  "current_input_mode" TEXT NOT NULL DEFAULT 'research_area',
  "current_query_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "current_filters_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "pending_filter_patch_json" JSONB,
  "pending_filter_patch_turn_index" INTEGER,
  "last_run_id" TEXT,
  "last_turn_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendation_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recommendation_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "recommendation_conversation_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "turn_index" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "message_type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "intent_json" JSONB,
  "proposed_filter_patch_json" JSONB,
  "applied_filter_snapshot_json" JSONB,
  "citations_json" JSONB,
  "client_turn_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendation_conversation_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "recommendation_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recommendation_conversation_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "recommendation_conversation_runs" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "trigger_message_id" TEXT,
  "turn_index" INTEGER NOT NULL,
  "run_index" INTEGER NOT NULL,
  "normalized_request_json" JSONB NOT NULL,
  "result_snapshot_json" JSONB NOT NULL,
  "result_ids_json" JSONB NOT NULL,
  "degraded_mode" TEXT,
  "low_confidence" BOOLEAN NOT NULL DEFAULT false,
  "no_results_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendation_conversation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_conversation_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "recommendation_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recommendation_conversation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "recommendation_query_enrichment_cache" (
  "id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "input_mode" TEXT NOT NULL,
  "raw_query" TEXT NOT NULL,
  "normalized_query" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "enrichment_version" TEXT NOT NULL,
  "rewritten_research_area" TEXT,
  "related_terms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "response_json" JSONB,
  "hit_count" INTEGER NOT NULL DEFAULT 1,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendation_query_enrichment_cache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "researcher_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "display_name" TEXT,
  "birth_year" INTEGER,
  "country_of_residence" TEXT,
  "citizenship_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "institution_name" TEXT,
  "institution_type" TEXT,
  "department" TEXT,
  "career_stage" TEXT,
  "years_of_experience" INTEGER,
  "application_languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "research_summary" TEXT,
  "research_areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "linkedin_url" TEXT,
  "google_scholar_url" TEXT,
  "scopus_url" TEXT,
  "orcid_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "researcher_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "researcher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "researcher_notification_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
  "email_address" TEXT,
  "whatsapp_number" TEXT,
  "whatsapp_verified" BOOLEAN NOT NULL DEFAULT false,
  "notification_frequency" TEXT NOT NULL DEFAULT 'weekly',
  "digest_enabled" BOOLEAN NOT NULL DEFAULT true,
  "quiet_hours_start" TEXT,
  "quiet_hours_end" TEXT,
  "timezone" TEXT,
  "alert_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "researcher_notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "researcher_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "researcher_saved_research_areas" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "research_area" TEXT NOT NULL,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "disciplines" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "use_for_alerts" BOOLEAN NOT NULL DEFAULT true,
  "normalized_text" TEXT,
  "content_hash" TEXT,
  "embedding" vector(768),
  "embedding_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "researcher_saved_research_areas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "researcher_saved_research_areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "recommendation_conversations"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "recommendation_conversation_messages"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "recommendation_conversation_runs"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

ALTER TABLE "funding_calls"
  ADD COLUMN IF NOT EXISTS "embedding" vector(768),
  ADD COLUMN IF NOT EXISTS "ts_document" tsvector;

ALTER TABLE "funding_call_templates"
  ADD COLUMN IF NOT EXISTS "compiled_grant_template_json" JSONB;

UPDATE "recommendation_conversations" rc
SET "tenant_id" = u."tenantId"
FROM "users" u
WHERE rc."user_id" = u."id"
  AND rc."tenant_id" IS NULL
  AND u."tenantId" IS NOT NULL;

UPDATE "recommendation_conversation_messages" m
SET "tenant_id" = c."tenant_id"
FROM "recommendation_conversations" c
WHERE m."conversation_id" = c."id"
  AND m."tenant_id" IS NULL
  AND c."tenant_id" IS NOT NULL;

UPDATE "recommendation_conversation_runs" r
SET "tenant_id" = c."tenant_id"
FROM "recommendation_conversations" c
WHERE r."conversation_id" = c."id"
  AND r."tenant_id" IS NULL
  AND c."tenant_id" IS NOT NULL;

UPDATE "funding_call_templates"
SET "compiled_grant_template_json" = "compiled_papsi_json"
WHERE "compiled_grant_template_json" IS NULL
  AND "compiled_papsi_json" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "recommendation_conversation_runs_run_index_unique"
  ON "recommendation_conversation_runs"("conversation_id", "run_index");
CREATE UNIQUE INDEX IF NOT EXISTS "rec_query_enrichment_req_model_ver_key"
  ON "recommendation_query_enrichment_cache"("request_hash", "model", "enrichment_version");
CREATE UNIQUE INDEX IF NOT EXISTS "researcher_profiles_user_id_key"
  ON "researcher_profiles"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "researcher_notification_preferences_user_id_key"
  ON "researcher_notification_preferences"("user_id");

CREATE INDEX IF NOT EXISTS "idx_recommendation_conversations_user_id"
  ON "recommendation_conversations"("user_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversations_tenant_id"
  ON "recommendation_conversations"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversations_tenant_updated_at"
  ON "recommendation_conversations"("tenant_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversations_updated_at"
  ON "recommendation_conversations"("updated_at");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversations_last_run_id"
  ON "recommendation_conversations"("last_run_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_messages_conversation_id"
  ON "recommendation_conversation_messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_messages_tenant_id"
  ON "recommendation_conversation_messages"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_messages_tenant_created_at"
  ON "recommendation_conversation_messages"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_messages_turn_index"
  ON "recommendation_conversation_messages"("conversation_id", "turn_index");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_messages_created_at"
  ON "recommendation_conversation_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_runs_conversation_id"
  ON "recommendation_conversation_runs"("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_runs_tenant_id"
  ON "recommendation_conversation_runs"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_runs_tenant_created_at"
  ON "recommendation_conversation_runs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_recommendation_conversation_runs_turn_index"
  ON "recommendation_conversation_runs"("conversation_id", "turn_index");
CREATE INDEX IF NOT EXISTS "idx_recommendation_query_enrichment_cache_normalized_query"
  ON "recommendation_query_enrichment_cache"("normalized_query");
CREATE INDEX IF NOT EXISTS "idx_recommendation_query_enrichment_cache_last_used_at"
  ON "recommendation_query_enrichment_cache"("last_used_at");
CREATE INDEX IF NOT EXISTS "idx_researcher_profiles_country"
  ON "researcher_profiles"("country_of_residence");
CREATE INDEX IF NOT EXISTS "idx_researcher_profiles_institution_type"
  ON "researcher_profiles"("institution_type");
CREATE INDEX IF NOT EXISTS "idx_researcher_profiles_career_stage"
  ON "researcher_profiles"("career_stage");
CREATE INDEX IF NOT EXISTS "idx_researcher_saved_research_areas_user_id"
  ON "researcher_saved_research_areas"("user_id");
CREATE INDEX IF NOT EXISTS "idx_researcher_saved_research_areas_default"
  ON "researcher_saved_research_areas"("user_id", "is_default");

CREATE OR REPLACE FUNCTION update_funding_call_ts_document()
RETURNS TRIGGER AS $$
BEGIN
  NEW."ts_document" :=
    setweight(to_tsvector('english', coalesce(NEW."scheme_title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."disciplines", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."funding_kinds", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."institution_types", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."career_stages", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."eligible_countries", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."eligible_regions", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."host_countries", ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."sponsor_type", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."funder_country", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."eligibility_text", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."expected_deliverables_text", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."contact_info", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."agency_name", '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_funding_call_ts_document_trigger ON "funding_calls";
CREATE TRIGGER update_funding_call_ts_document_trigger
BEFORE INSERT OR UPDATE ON "funding_calls"
FOR EACH ROW
EXECUTE FUNCTION update_funding_call_ts_document();

UPDATE "funding_calls"
SET "ts_document" =
  setweight(to_tsvector('english', coalesce("scheme_title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('english', coalesce(array_to_string("disciplines", ' '), '')), 'B') ||
  setweight(to_tsvector('english', coalesce(array_to_string("funding_kinds", ' '), '')), 'B') ||
  setweight(to_tsvector('english', coalesce(array_to_string("institution_types", ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string("career_stages", ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string("eligible_countries", ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string("eligible_regions", ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string("host_countries", ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce("sponsor_type", '')), 'C') ||
  setweight(to_tsvector('english', coalesce("funder_country", '')), 'C') ||
  setweight(to_tsvector('english', coalesce("eligibility_text", '')), 'C') ||
  setweight(to_tsvector('english', coalesce("expected_deliverables_text", '')), 'C') ||
  setweight(to_tsvector('english', coalesce("contact_info", '')), 'C') ||
  setweight(to_tsvector('english', coalesce("agency_name", '')), 'D');

CREATE INDEX IF NOT EXISTS "funding_calls_embedding_idx"
  ON "funding_calls" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS "funding_calls_ts_idx"
  ON "funding_calls" USING GIN ("ts_document");
CREATE INDEX IF NOT EXISTS "researcher_saved_research_areas_embedding_idx"
  ON "researcher_saved_research_areas" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
