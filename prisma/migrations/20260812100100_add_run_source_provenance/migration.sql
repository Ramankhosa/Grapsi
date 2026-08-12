-- Record which document sections fed each guideline/template extraction run,
-- and index per-kind active-document lookups.
ALTER TABLE "funding_call_guideline_runs" ADD COLUMN "source_json" JSONB;
ALTER TABLE "funding_call_template_runs" ADD COLUMN "source_json" JSONB;

CREATE INDEX "funding_call_documents_funding_call_id_document_kind_is_ac_idx"
  ON "funding_call_documents" ("funding_call_id", "document_kind", "is_active");
