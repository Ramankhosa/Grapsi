-- "Action completed" is the coordinator's own statement that this school's work
-- on this call is done (circulated, allocated, or judged and closed). It is a
-- manual mark, kept apart from `status` and `decided_at` so no automatic event
-- (an allocation, a shortlist, a sweep stamp) can ever complete a call for them.
ALTER TABLE call_school_triage
  ADD COLUMN action_completed_at TIMESTAMP(3),
  ADD COLUMN action_completed_by_user_id TEXT,
  ADD COLUMN action_completed_note TEXT,
  ADD CONSTRAINT call_school_triage_action_completed_by_fkey
    FOREIGN KEY (action_completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT call_school_triage_action_completed_note_check
    CHECK (action_completed_note IS NULL OR length(action_completed_note) <= 1000);

CREATE INDEX idx_call_school_triage_action_completed
  ON call_school_triage(tenant_id, org_unit_id, action_completed_at);
