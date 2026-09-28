ALTER TABLE call_assignments
  ADD COLUMN allocation_method TEXT,
  ADD COLUMN allocation_reason TEXT,
  ADD COLUMN allocation_note TEXT,
  ADD CONSTRAINT call_assignments_manual_metadata_check CHECK (
    (allocation_method IS NULL AND allocation_reason IS NULL AND allocation_note IS NULL)
    OR (allocation_method = 'MANUAL' AND allocation_reason IS NOT NULL
      AND allocation_reason IN ('FACULTY_WILLINGNESS','INDIRECT_FIT','DSR_RECOMMENDATION')
      AND (allocation_note IS NULL OR length(allocation_note) <= 2000))
  );

ALTER TABLE dsr_call_school_mappings DROP CONSTRAINT dsr_call_school_mappings_source_check;
ALTER TABLE dsr_call_school_mappings ADD CONSTRAINT dsr_call_school_mappings_source_check
  CHECK (source IN ('ORIGIN','INGESTION_DIRECT','INGESTION_KEYWORD','INGESTION_BROAD','ADDED_BY_HEAD','RECONSTRUCTED_FROM_WORK','MANUAL_ALLOCATION'));

-- Find the tier/source constraint by its expression rather than the implicit
-- numeric name PostgreSQL assigned alongside the ended-reason constraint.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'dsr_call_school_mappings'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tier IS NOT NULL%'
  LOOP EXECUTE format('ALTER TABLE dsr_call_school_mappings DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE dsr_call_school_mappings ADD CONSTRAINT dsr_call_school_mappings_tier_source_check
  CHECK (source IN ('ADDED_BY_HEAD','RECONSTRUCTED_FROM_WORK','ORIGIN','MANUAL_ALLOCATION') OR tier IS NOT NULL);

-- Append columns: existing readers and historical application events retain
-- their existing shape; new allocations carry their human provenance.
CREATE OR REPLACE VIEW dsr_applications AS
 SELECT 'assignment:' || a.id id, a.tenant_id, COALESCE(p.org_unit_id,u.path[1]) school_id,
 a.funding_call_id call_id, a.id assignment_id, p.id proposal_id, a.assignee_user_id faculty_id,
 a.assigned_by_user_id allocated_by, a.created_at, a.status::text assignment_status, a.outcome::text outcome,
 p.status proposal_status, COALESCE(p.submitted_at,a.submitted_at) submitted_at,
 COALESCE(p.submission_reference,a.submission_reference) submission_reference,
 COALESCE(p.submission_url,a.submission_url) submission_url, a.submission_notes,
 COALESCE(p.submission_recorded_by_user_id,a.submission_recorded_by_user_id) submission_recorder,
 a.deadline_at internal_deadline, p.review_cutoff_at review_deadline,
 COALESCE(p.agency_deadline_at,c.close_date,c."deadlineAt") agency_deadline,
 COALESCE(p.title,c.scheme_title,c.title) title, COALESCE(p.agency_name,c.agency_name,c."agencyName") agency,
 p.requested_amount, COALESCE(p.sanctioned_amount,a.award_amount) sanctioned_amount,
 COALESCE(p.currency,a.award_currency,'INR') currency, COALESCE(p.current_version_no,0) version_no,
 GREATEST(a.updated_at,p.updated_at) updated_at,
 a.allocation_method, a.allocation_reason, a.allocation_note
 FROM call_assignments a LEFT JOIN grant_proposals p ON p.assignment_id=a.id AND p.tenant_id=a.tenant_id
 LEFT JOIN tenant_org_units u ON u.id=a.assignee_org_unit_id
 LEFT JOIN funding_calls c ON c.id=a.funding_call_id
 UNION ALL
 SELECT 'proposal:' || p.id, p.tenant_id,p.org_unit_id,p.funding_call_id,NULL,p.id,p.pi_user_id,
 p.created_by_user_id,p.created_at,NULL,NULL,p.status,p.submitted_at,p.submission_reference,p.submission_url,NULL,
 p.submission_recorded_by_user_id,NULL,p.review_cutoff_at,p.agency_deadline_at,p.title,p.agency_name,
 p.requested_amount,p.sanctioned_amount,p.currency,p.current_version_no,p.updated_at,
 NULL::text, NULL::text, NULL::text
 FROM grant_proposals p WHERE p.assignment_id IS NULL;
