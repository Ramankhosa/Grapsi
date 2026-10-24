-- AlterTable
ALTER TABLE "funding_calls" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "funding_intake_batches" ADD COLUMN     "handoff_key" TEXT;

-- AlterTable
ALTER TABLE "monitored_sources" ADD COLUMN     "check_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cursor" JSONB,
ADD COLUMN     "discovery_evidence" JSONB,
ADD COLUMN     "discovery_score" DOUBLE PRECISION,
ADD COLUMN     "etag" TEXT,
ADD COLUMN     "exclude_keywords" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fetch_mode" TEXT NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PAGE',
ADD COLUMN     "last_complete_check_at" TIMESTAMP(3),
ADD COLUMN     "last_modified" TEXT,
ADD COLUMN     "next_check_at" TIMESTAMP(3),
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "readiness_selector" TEXT,
ADD COLUMN     "site_id" TEXT;

-- AlterTable
ALTER TABLE "monitored_ignore_rules" ADD COLUMN     "example_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'LINE';

-- CreateTable
CREATE TABLE "monitor_sites" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "display_name" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "related_hosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachment_hosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language_profile" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "fragment_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "session_params" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_delay_ms" INTEGER NOT NULL DEFAULT 3000,
    "tls_exception" JSONB,
    "daily_budget_micros" BIGINT,
    "storage_quota_bytes" BIGINT,
    "consecutive_fetch_failures" INTEGER NOT NULL DEFAULT 0,
    "last_fetch_error" TEXT,
    "last_fetch_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT,

    CONSTRAINT "monitor_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_site_funders" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "funder_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_site_funders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_host_pacing" (
    "host" TEXT NOT NULL,
    "next_allowed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldown_until" TIMESTAMP(3),
    "cooldown_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_host_pacing_pkey" PRIMARY KEY ("host")
);

-- CreateTable
CREATE TABLE "monitor_robots" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "http_status" INTEGER,
    "body" TEXT,
    "crawl_delay_ms" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_good_at" TIMESTAMP(3),
    "last_good_body" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "monitor_robots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_check_runs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "site_id" TEXT,
    "check_generation" INTEGER NOT NULL,
    "task_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "pages_visited" INTEGER NOT NULL DEFAULT 0,
    "items_observed" INTEGER NOT NULL DEFAULT 0,
    "new_resources" INTEGER NOT NULL DEFAULT 0,
    "fetch_mode_used" TEXT,
    "http_status" INTEGER,
    "error_class" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "monitor_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_resources" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAGE',
    "role" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "raw_url" TEXT,
    "final_url" TEXT,
    "canonical_url" TEXT,
    "dedup_key" TEXT NOT NULL,
    "synthetic_key" TEXT,
    "title" TEXT,
    "mime_type" TEXT,
    "current_version_id" TEXT,
    "last_validated_at" TIMESTAMP(3),
    "last_validation_status" TEXT,
    "etag" TEXT,
    "last_modified" TEXT,
    "revisit_policy" TEXT NOT NULL DEFAULT 'NONE',
    "next_revisit_at" TIMESTAMP(3),
    "revisit_generation" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_resource_aliases" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "raw_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "monitor_resource_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_resource_versions" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "raw_hash" TEXT NOT NULL,
    "meaningful_hash" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "http_status" INTEGER,
    "final_url" TEXT,
    "mime_type" TEXT,
    "byte_length" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "file_path" TEXT,
    "page_count" INTEGER,
    "page_statuses" JSONB,
    "parser_version" TEXT,
    "tls_exception_used" BOOLEAN NOT NULL DEFAULT false,
    "pin_refcount" INTEGER NOT NULL DEFAULT 0,
    "retain_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_resource_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_observations" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "anchor_text" TEXT,
    "context_text" TEXT,
    "context_hash" TEXT NOT NULL,
    "date_hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_check_generation" INTEGER NOT NULL DEFAULT 0,
    "missing_since" TIMESTAMP(3),

    CONSTRAINT "monitor_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_opportunities" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "primary_resource_id" TEXT,
    "scheme_key" TEXT,
    "round_key" TEXT,
    "match_confidence" TEXT,
    "match_type" TEXT,
    "title" TEXT,
    "funder_id" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "processing_state" TEXT NOT NULL DEFAULT 'OBSERVED',
    "review_state" TEXT NOT NULL DEFAULT 'NONE',
    "review_revision" INTEGER NOT NULL DEFAULT 0,
    "snoozed_until" TIMESTAMP(3),
    "relevance_outcome" TEXT,
    "relevance_score" DOUBLE PRECISION,
    "triage_verdict" TEXT,
    "triage_confidence" DOUBLE PRECISION,
    "triage_reason" TEXT,
    "opportunity_type" TEXT,
    "decision_versions" JSONB,
    "funding_call_id" TEXT,
    "field_evidence" JSONB,
    "conflicts" JSONB,
    "evidence_manifest_version" INTEGER NOT NULL DEFAULT 0,
    "drafted_from_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stale_evidence" BOOLEAN NOT NULL DEFAULT false,
    "bootstrap" BOOLEAN NOT NULL DEFAULT false,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_opportunity_evidence" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "anchors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_opportunity_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_handoffs" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "handoff_key" TEXT NOT NULL,
    "review_revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "intake_batch_id" TEXT,
    "intake_job_id" TEXT,
    "funding_call_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_call_url_keys" (
    "id" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "funding_call_id" TEXT,
    "intake_job_id" TEXT,
    "handoff_id" TEXT,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_call_url_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_audit_samples" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "resource_id" TEXT,
    "stage" TEXT NOT NULL,
    "sampled_outcome" TEXT NOT NULL,
    "sampling_weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "label" TEXT,
    "labeled_by_user_id" TEXT,
    "labeled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_audit_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_verified_announcements" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "announced_on" DATE,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_opportunity_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "monitor_verified_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_tasks" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "site_id" TEXT,
    "source_id" TEXT,
    "resource_id" TEXT,
    "opportunity_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_generation" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_until" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "terminal_reason" TEXT,
    "last_error" TEXT,
    "result" JSONB,
    "replay_of" TEXT,
    "replay_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_operation_tombstones" (
    "operation_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "task_id" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_operation_tombstones_pkey" PRIMARY KEY ("operation_key")
);

-- CreateTable
CREATE TABLE "monitor_crawl_frontier" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discovered_from" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "next_visit_at" TIMESTAMP(3),
    "visited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_crawl_frontier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_budget_ledger" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "limit_micros" BIGINT NOT NULL,
    "reserved_micros" BIGINT NOT NULL DEFAULT 0,
    "settled_micros" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_budget_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_llm_attempts" (
    "id" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "provider_account" TEXT,
    "request_id" TEXT,
    "price_snapshot" JSONB,
    "reserved_max_micros" BIGINT NOT NULL,
    "ledger_day" DATE NOT NULL,
    "ledger_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "usage" JSONB,
    "actual_cost_micros" BIGINT,
    "settled_at" TIMESTAMP(3),
    "task_id" TEXT,
    "lease_generation" INTEGER,
    "error_class" TEXT,
    "error_message" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_llm_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_stage_cache" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "model_used" TEXT,
    "routing_policy_version" TEXT,
    "cost_micros" BIGINT,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_stage_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_provider_health" (
    "id" TEXT NOT NULL,
    "provider_account" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CLOSED',
    "reason" TEXT,
    "opened_at" TIMESTAMP(3),
    "next_probe_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_provider_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "hostname" TEXT,
    "pid" INTEGER,
    "version" TEXT,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "current_task_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_beat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

-- CreateTable
CREATE TABLE "monitor_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_notification_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "monitor_notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_sync_cursors" (
    "name" TEXT NOT NULL,
    "cursor" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_sync_cursors_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitor_sites_host_key" ON "monitor_sites"("host");

-- CreateIndex
CREATE INDEX "monitor_sites_status_idx" ON "monitor_sites"("status");

-- CreateIndex
CREATE INDEX "monitor_site_funders_funder_id_idx" ON "monitor_site_funders"("funder_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_site_funders_site_id_funder_id_key" ON "monitor_site_funders"("site_id", "funder_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_robots_origin_user_agent_key" ON "monitor_robots"("origin", "user_agent");

-- CreateIndex
CREATE INDEX "monitor_check_runs_source_id_started_at_idx" ON "monitor_check_runs"("source_id", "started_at");

-- CreateIndex
CREATE INDEX "monitor_check_runs_started_at_idx" ON "monitor_check_runs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_check_runs_source_id_check_generation_key" ON "monitor_check_runs"("source_id", "check_generation");

-- CreateIndex
CREATE INDEX "monitor_resources_revisit_policy_next_revisit_at_idx" ON "monitor_resources"("revisit_policy", "next_revisit_at");

-- CreateIndex
CREATE INDEX "monitor_resources_site_id_first_seen_at_idx" ON "monitor_resources"("site_id", "first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_resources_site_id_dedup_key_key" ON "monitor_resources"("site_id", "dedup_key");

-- CreateIndex
CREATE INDEX "monitor_resource_aliases_resource_id_idx" ON "monitor_resource_aliases"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_resource_aliases_site_id_dedup_key_key" ON "monitor_resource_aliases"("site_id", "dedup_key");

-- CreateIndex
CREATE INDEX "monitor_resource_versions_resource_id_fetched_at_idx" ON "monitor_resource_versions"("resource_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_resource_versions_resource_id_raw_hash_key" ON "monitor_resource_versions"("resource_id", "raw_hash");

-- CreateIndex
CREATE INDEX "monitor_observations_resource_id_idx" ON "monitor_observations"("resource_id");

-- CreateIndex
CREATE INDEX "monitor_observations_site_id_first_seen_at_idx" ON "monitor_observations"("site_id", "first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_observations_source_id_resource_id_key" ON "monitor_observations"("source_id", "resource_id");

-- CreateIndex
CREATE INDEX "monitor_opportunities_review_state_updated_at_idx" ON "monitor_opportunities"("review_state", "updated_at");

-- CreateIndex
CREATE INDEX "monitor_opportunities_processing_state_idx" ON "monitor_opportunities"("processing_state");

-- CreateIndex
CREATE INDEX "monitor_opportunities_site_id_idx" ON "monitor_opportunities"("site_id");

-- CreateIndex
CREATE INDEX "monitor_opportunities_funding_call_id_idx" ON "monitor_opportunities"("funding_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_opportunity_evidence_opportunity_id_version_id_role_key" ON "monitor_opportunity_evidence"("opportunity_id", "version_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_handoffs_handoff_key_key" ON "monitor_handoffs"("handoff_key");

-- CreateIndex
CREATE INDEX "monitor_handoffs_opportunity_id_idx" ON "monitor_handoffs"("opportunity_id");

-- CreateIndex
CREATE INDEX "funding_call_url_keys_dedup_key_idx" ON "funding_call_url_keys"("dedup_key");

-- CreateIndex
CREATE INDEX "funding_call_url_keys_funding_call_id_idx" ON "funding_call_url_keys"("funding_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_call_url_keys_dedup_key_owner_key_key" ON "funding_call_url_keys"("dedup_key", "owner_key");

-- CreateIndex
CREATE INDEX "monitor_audit_samples_stage_created_at_idx" ON "monitor_audit_samples"("stage", "created_at");

-- CreateIndex
CREATE INDEX "monitor_verified_announcements_cohort_idx" ON "monitor_verified_announcements"("cohort");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_tasks_operation_key_key" ON "monitor_tasks"("operation_key");

-- CreateIndex
CREATE INDEX "idx_monitor_tasks_claim" ON "monitor_tasks"("status", "available_at", "priority");

-- CreateIndex
CREATE INDEX "monitor_tasks_site_id_status_idx" ON "monitor_tasks"("site_id", "status");

-- CreateIndex
CREATE INDEX "monitor_tasks_kind_status_idx" ON "monitor_tasks"("kind", "status");

-- CreateIndex
CREATE INDEX "monitor_operation_tombstones_completed_at_idx" ON "monitor_operation_tombstones"("completed_at");

-- CreateIndex
CREATE INDEX "monitor_crawl_frontier_site_id_state_next_visit_at_idx" ON "monitor_crawl_frontier"("site_id", "state", "next_visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_crawl_frontier_site_id_dedup_key_key" ON "monitor_crawl_frontier"("site_id", "dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_budget_ledger_day_scope_key" ON "monitor_budget_ledger"("day", "scope");

-- CreateIndex
CREATE INDEX "monitor_llm_attempts_status_created_at_idx" ON "monitor_llm_attempts"("status", "created_at");

-- CreateIndex
CREATE INDEX "monitor_llm_attempts_ledger_day_idx" ON "monitor_llm_attempts"("ledger_day");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_llm_attempts_operation_key_attempt_no_key" ON "monitor_llm_attempts"("operation_key", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_stage_cache_cache_key_key" ON "monitor_stage_cache"("cache_key");

-- CreateIndex
CREATE INDEX "monitor_stage_cache_stage_created_at_idx" ON "monitor_stage_cache"("stage", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_provider_health_provider_account_key" ON "monitor_provider_health"("provider_account");

-- CreateIndex
CREATE INDEX "monitor_worker_heartbeats_last_beat_at_idx" ON "monitor_worker_heartbeats"("last_beat_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_events_event_key_key" ON "monitor_events"("event_key");

-- CreateIndex
CREATE INDEX "monitor_events_dispatched_at_idx" ON "monitor_events"("dispatched_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_notification_deliveries_event_id_recipient_user_id__key" ON "monitor_notification_deliveries"("event_id", "recipient_user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "funding_intake_batches_handoff_key_key" ON "funding_intake_batches"("handoff_key");

-- CreateIndex
CREATE INDEX "idx_monitored_sources_next_check" ON "monitored_sources"("status", "next_check_at");

-- CreateIndex
CREATE INDEX "idx_monitored_sources_site" ON "monitored_sources"("site_id");

-- AddForeignKey
ALTER TABLE "monitored_sources" ADD CONSTRAINT "monitored_sources_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_site_funders" ADD CONSTRAINT "monitor_site_funders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_site_funders" ADD CONSTRAINT "monitor_site_funders_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_check_runs" ADD CONSTRAINT "monitor_check_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_resources" ADD CONSTRAINT "monitor_resources_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_resource_aliases" ADD CONSTRAINT "monitor_resource_aliases_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "monitor_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_resource_versions" ADD CONSTRAINT "monitor_resource_versions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "monitor_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_observations" ADD CONSTRAINT "monitor_observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_observations" ADD CONSTRAINT "monitor_observations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "monitor_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunities" ADD CONSTRAINT "monitor_opportunities_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunities" ADD CONSTRAINT "monitor_opportunities_primary_resource_id_fkey" FOREIGN KEY ("primary_resource_id") REFERENCES "monitor_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunities" ADD CONSTRAINT "monitor_opportunities_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunities" ADD CONSTRAINT "monitor_opportunities_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunity_evidence" ADD CONSTRAINT "monitor_opportunity_evidence_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "monitor_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunity_evidence" ADD CONSTRAINT "monitor_opportunity_evidence_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "monitor_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_opportunity_evidence" ADD CONSTRAINT "monitor_opportunity_evidence_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "monitor_resource_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_handoffs" ADD CONSTRAINT "monitor_handoffs_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "monitor_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_url_keys" ADD CONSTRAINT "funding_call_url_keys_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_call_url_keys" ADD CONSTRAINT "funding_call_url_keys_intake_job_id_fkey" FOREIGN KEY ("intake_job_id") REFERENCES "funding_intake_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_verified_announcements" ADD CONSTRAINT "monitor_verified_announcements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_crawl_frontier" ADD CONSTRAINT "monitor_crawl_frontier_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "monitor_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_notification_deliveries" ADD CONSTRAINT "monitor_notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "monitor_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL Prisma cannot express. Keep these out of future `migrate diff`
-- output: Prisma does not model triggers or partial indexes, so a diff from a
-- live database will propose dropping them.
-- ---------------------------------------------------------------------------

-- Compare-and-set token for funding calls. Every UPDATE increments it, whatever
-- the update set it to, so no write path can skip or forge a revision.
CREATE OR REPLACE FUNCTION "monitor_bump_funding_call_revision"() RETURNS trigger AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "funding_calls_bump_revision"
  BEFORE UPDATE ON "funding_calls"
  FOR EACH ROW EXECUTE FUNCTION "monitor_bump_funding_call_revision"();

-- One open EXACT claim per scheme round: two discoveries of the same round can
-- never both become drafts. Ambiguous matches are not constrained; they wait
-- for a reviewer.
CREATE UNIQUE INDEX "monitor_opportunities_exact_round_claim"
  ON "monitor_opportunities" ("scheme_key", "round_key")
  WHERE "match_confidence" = 'EXACT'
    AND "review_state" NOT IN ('REJECTED', 'MERGED')
    AND "scheme_key" IS NOT NULL
    AND "round_key" IS NOT NULL;

-- At most one RUNNING task per site, enforced by the database rather than by a
-- check two concurrent claimers could both pass. A claim that collides is
-- simply "site busy" and moves on to other work.
CREATE UNIQUE INDEX "monitor_tasks_one_running_per_site"
  ON "monitor_tasks" ("site_id")
  WHERE "status" = 'RUNNING' AND "site_id" IS NOT NULL;

-- Backfill: every existing source becomes a watch point of the site for its
-- host. Re-runnable (ON CONFLICT / IS NULL guards). Timestamps are written as
-- UTC wall-clock, the way Prisma stores DateTime, whatever the server's zone.
INSERT INTO "monitor_sites" ("id", "host", "status", "origin", "created_at", "updated_at")
SELECT 'site_' || md5(h."host"), h."host",
       CASE WHEN h."any_active" THEN 'ACTIVE' ELSE 'PAUSED' END,
       'BACKFILL', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
FROM (
  SELECT lower(substring("url" from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)')) AS "host",
         bool_or("status" = 'ACTIVE') AS "any_active"
  FROM "monitored_sources"
  GROUP BY 1
) h
WHERE h."host" IS NOT NULL
ON CONFLICT ("host") DO NOTHING;

UPDATE "monitored_sources" s
SET "site_id" = m."id",
    "next_check_at" = CASE WHEN s."status" = 'ACTIVE' THEN (now() AT TIME ZONE 'UTC') ELSE NULL END
FROM "monitor_sites" m
WHERE s."site_id" IS NULL
  AND m."host" = lower(substring(s."url" from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)'));
