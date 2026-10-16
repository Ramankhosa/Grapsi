-- External catalogue import, part 3 of 3: new columns on funding_calls and
-- tenants.
--
-- Every column is nullable or a list defaulting to empty. On PostgreSQL 11+
-- adding a column with no default or a constant default is a catalogue-only
-- change: no existing row is rewritten, and every pre-existing column keeps
-- its value. Readers treat a null *_scope as "not evaluated yet" and fall back
-- to the legacy name columns.

-- Fail fast instead of queueing behind a long transaction (e.g. a census
-- run) and stalling every query on funding_calls; just re-run deploy.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "funding_calls" ADD COLUMN     "additional_benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "amount_max_usd_est" DOUBLE PRECISION,
ADD COLUMN     "amount_min_usd_est" DOUBLE PRECISION,
ADD COLUMN     "amount_recipient_basis" TEXT,
ADD COLUMN     "amount_text" TEXT,
ADD COLUMN     "amount_time_basis" TEXT,
ADD COLUMN     "applicant_country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applicant_excluded_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applicant_region_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "applicant_scope" TEXT,
ADD COLUMN     "challenge_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "citizenship_country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "citizenship_excluded_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "citizenship_region_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "citizenship_scope" TEXT,
ADD COLUMN     "content_language" TEXT,
ADD COLUMN     "currency_code" VARCHAR(3),
ADD COLUMN     "deadline_timezone" TEXT,
ADD COLUMN     "description_source" TEXT,
ADD COLUMN     "eligibility_scope_hint" TEXT,
ADD COLUMN     "enrichment_level" TEXT,
ADD COLUMN     "entry_closes_at" DATE,
ADD COLUMN     "field_provenance" JSONB,
ADD COLUMN     "final_deadline_at" DATE,
ADD COLUMN     "funder_country_code" VARCHAR(2),
ADD COLUMN     "funder_id" TEXT,
ADD COLUMN     "fx_as_of" DATE,
ADD COLUMN     "fx_rate_used" DOUBLE PRECISION,
ADD COLUMN     "host_country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "host_excluded_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "host_region_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "host_scope" TEXT,
ADD COLUMN     "import_run_id" TEXT,
ADD COLUMN     "indirect_cost_note" TEXT,
ADD COLUMN     "indirect_cost_policy" TEXT,
ADD COLUMN     "lifecycle_needs_check" BOOLEAN,
ADD COLUMN     "membership_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "next_deadline_at" DATE,
ADD COLUMN     "nomination_note" TEXT,
ADD COLUMN     "notification_policy" TEXT,
ADD COLUMN     "notification_policy_reason" TEXT,
ADD COLUMN     "opportunity_status" TEXT,
ADD COLUMN     "programme_framework" TEXT,
ADD COLUMN     "regions_version" TEXT,
ADD COLUMN     "required_qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requires_nomination" BOOLEAN,
ADD COLUMN     "residence_country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "residence_excluded_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "residence_region_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "residence_scope" TEXT,
ADD COLUMN     "review_status" TEXT,
ADD COLUMN     "sdg_goals" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "series_key" TEXT,
ADD COLUMN     "source_closed_at" TIMESTAMP(3),
ADD COLUMN     "source_disciplines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status_computed_at" TIMESTAMP(3),
ADD COLUMN     "target_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title_native" TEXT,
ADD COLUMN     "work_rights_required" BOOLEAN;

ALTER TABLE "tenants" ADD COLUMN     "country_code" VARCHAR(2);

CREATE INDEX "funding_calls_funder_id_idx" ON "funding_calls"("funder_id");

CREATE INDEX "funding_calls_import_run_id_idx" ON "funding_calls"("import_run_id");

CREATE INDEX "funding_calls_review_status_idx" ON "funding_calls"("review_status");

CREATE INDEX "funding_calls_series_key_idx" ON "funding_calls"("series_key");

ALTER TABLE "funding_calls" ADD CONSTRAINT "funding_calls_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
