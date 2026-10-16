-- External catalogue import, part 1 of 3: new tables only.
--
-- Strictly additive. Creates the funder entity, source provenance, import run
-- / change log / review item tables, per-stage deadlines and static FX rates.
-- Nothing here touches an existing row. Foreign keys that point at
-- funding_calls live on the NEW tables, so existing calls are unaffected; the
-- review items cascade away if a call they mention is deleted.

-- Fail fast instead of queueing behind a long transaction (e.g. a census
-- run) and stalling every query on funding_calls; just re-run deploy.
SET LOCAL lock_timeout = '5s';

CREATE TABLE "funders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "acronym" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country_code" VARCHAR(2),
    "funder_type" TEXT,
    "website_url" TEXT,
    "description" TEXT,
    "parent_funder_id" TEXT,
    "ror_id" TEXT,
    "crossref_funder_id" TEXT,
    "metadata" JSONB,
    "import_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_source_records" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_slug" TEXT,
    "source_url" TEXT,
    "funding_call_id" TEXT,
    "funder_id" TEXT,
    "link_role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "raw_payload" JSONB NOT NULL,
    "imported_values" JSONB,
    "content_hash" TEXT NOT NULL,
    "importer_version" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "source_published_at" TIMESTAMP(3),
    "source_modified_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_import_run_id" TEXT,
    "last_import_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_source_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_import_runs" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "snapshot_path" TEXT,
    "snapshot_manifest" JSONB,
    "is_full_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "importer_version" TEXT NOT NULL,
    "crosswalk_versions" JSONB,
    "checkpoint" TEXT,
    "counts" JSONB,
    "report" JSONB,
    "error" TEXT,
    "operator_email" TEXT,
    "target_database" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "funding_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_import_changes" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "entity_table" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "field" TEXT,
    "before_value" JSONB,
    "after_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_import_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_import_candidates" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "subject_call_id" TEXT,
    "candidate_call_id" TEXT,
    "subject_funder_id" TEXT,
    "candidate_funder_id" TEXT,
    "score" DOUBLE PRECISION,
    "signals" JSONB,
    "blocks_release" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT NOT NULL DEFAULT 'pending',
    "resolution_note" TEXT,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_import_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "funding_source_registry" (
    "source_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "attribution_text" TEXT,
    "homepage_url" TEXT,
    "republication_basis" TEXT,
    "display_policy" TEXT NOT NULL DEFAULT 'FULL_TEXT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_source_registry_pkey" PRIMARY KEY ("source_key")
);

CREATE TABLE "funding_call_deadlines" (
    "id" TEXT NOT NULL,
    "funding_call_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "due_date" DATE NOT NULL,
    "due_timezone" TEXT,
    "due_timezone_basis" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "stage_required" BOOLEAN,
    "source" TEXT NOT NULL,
    "import_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_call_deadlines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "currency_rates" (
    "id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "usd_per_unit" DOUBLE PRECISION NOT NULL,
    "as_of" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "funders_normalized_name_idx" ON "funders"("normalized_name");

CREATE INDEX "funders_country_code_idx" ON "funders"("country_code");

CREATE INDEX "funders_import_run_id_idx" ON "funders"("import_run_id");

CREATE INDEX "external_source_records_funding_call_id_idx" ON "external_source_records"("funding_call_id");

CREATE INDEX "external_source_records_funder_id_idx" ON "external_source_records"("funder_id");

CREATE UNIQUE INDEX "external_source_records_identity_key" ON "external_source_records"("source_key", "entity_type", "external_id");

CREATE INDEX "funding_import_runs_source_key_started_at_idx" ON "funding_import_runs"("source_key", "started_at");

CREATE INDEX "funding_import_changes_run_id_entity_table_idx" ON "funding_import_changes"("run_id", "entity_table");

CREATE INDEX "funding_import_changes_entity_table_entity_id_idx" ON "funding_import_changes"("entity_table", "entity_id");

CREATE UNIQUE INDEX "funding_import_candidates_dedupe_key_key" ON "funding_import_candidates"("dedupe_key");

CREATE INDEX "funding_import_candidates_resolution_reason_tier_idx" ON "funding_import_candidates"("resolution", "reason", "tier");

CREATE INDEX "funding_import_candidates_subject_call_id_idx" ON "funding_import_candidates"("subject_call_id");

CREATE INDEX "funding_import_candidates_candidate_call_id_idx" ON "funding_import_candidates"("candidate_call_id");

CREATE INDEX "funding_call_deadlines_due_date_idx" ON "funding_call_deadlines"("due_date");

CREATE UNIQUE INDEX "funding_call_deadlines_call_kind_date_key" ON "funding_call_deadlines"("funding_call_id", "kind", "due_date");

CREATE UNIQUE INDEX "currency_rates_currency_as_of_key" ON "currency_rates"("currency", "as_of");

ALTER TABLE "funders" ADD CONSTRAINT "funders_parent_funder_id_fkey" FOREIGN KEY ("parent_funder_id") REFERENCES "funders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "external_source_records" ADD CONSTRAINT "external_source_records_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "external_source_records" ADD CONSTRAINT "external_source_records_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "funding_import_changes" ADD CONSTRAINT "funding_import_changes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "funding_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funding_import_candidates" ADD CONSTRAINT "funding_import_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "funding_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funding_import_candidates" ADD CONSTRAINT "funding_import_candidates_subject_call_id_fkey" FOREIGN KEY ("subject_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funding_import_candidates" ADD CONSTRAINT "funding_import_candidates_candidate_call_id_fkey" FOREIGN KEY ("candidate_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funding_call_deadlines" ADD CONSTRAINT "funding_call_deadlines_funding_call_id_fkey" FOREIGN KEY ("funding_call_id") REFERENCES "funding_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
