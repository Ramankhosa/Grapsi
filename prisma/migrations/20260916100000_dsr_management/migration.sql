-- Management records deliberately retain old identities and snapshots after a
-- source record is removed. Authorization always resolves the tenant and school.
CREATE TABLE dsr_actions (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 call_id TEXT REFERENCES funding_calls(id) ON DELETE SET NULL,
 application_id TEXT, title TEXT NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
 waiting_with TEXT NOT NULL CHECK (waiting_with IN ('FACULTY','DSR','REVIEWER','APPROVER','AGENCY')),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE')),
 is_next BOOLEAN NOT NULL DEFAULT false, due_at TIMESTAMP(3), blocker TEXT,
 deadline_type TEXT NOT NULL DEFAULT 'ACTION' CHECK (deadline_type IN ('ACTION','AGENCY','INTERNAL_REVIEW','REVISION')),
 created_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT now(), completed_at TIMESTAMP(3),
 version INTEGER NOT NULL DEFAULT 1,
 CHECK (application_id IS NOT NULL OR call_id IS NOT NULL)
);
CREATE UNIQUE INDEX dsr_actions_one_next ON dsr_actions(tenant_id, school_id, COALESCE(application_id, 'call:' || call_id)) WHERE is_next AND status = 'OPEN';
CREATE INDEX dsr_actions_scope ON dsr_actions(tenant_id,school_id,status,due_at);
CREATE TABLE dsr_events (
 id BIGSERIAL PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 actor_user_id TEXT, kind TEXT NOT NULL, before_data JSONB, after_data JSONB,
 reason TEXT, occurred_at TIMESTAMP(3) NOT NULL DEFAULT now(), inferred BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX dsr_events_entity ON dsr_events(tenant_id,entity_type,entity_id,occurred_at,id);
CREATE INDEX dsr_events_school ON dsr_events(tenant_id,school_id,occurred_at);
CREATE TABLE dsr_submission_verifications (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, application_id TEXT NOT NULL,
 evidence_fingerprint TEXT NOT NULL, reviewer_user_id TEXT NOT NULL REFERENCES users(id),
 verified_at TIMESTAMP(3) NOT NULL DEFAULT now(), evidence_note TEXT NOT NULL,
 PRIMARY KEY(tenant_id,application_id)
);
CREATE TABLE dsr_matching_runs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 actor_user_id TEXT, scope JSONB NOT NULL, version TEXT NOT NULL,
 completeness TEXT NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL')),
 result_count INTEGER NOT NULL, candidate_count INTEGER NOT NULL,
 results JSONB NOT NULL, completed_at TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX dsr_matching_runs_call ON dsr_matching_runs(tenant_id,call_id,completed_at);
CREATE TABLE dsr_opportunity_observations (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 first_seen_at TIMESTAMP(3) NOT NULL, source TEXT NOT NULL, inferred BOOLEAN NOT NULL,
 PRIMARY KEY(tenant_id,school_id,call_id)
);
CREATE TABLE dsr_opportunity_dispositions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
 call_id TEXT NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('NO_SUITABLE_FACULTY','DECLINED','CAPACITY','AWAITING_ACTION','RELEVANCE_UNRESOLVED','OTHER')),
 explanation TEXT, actor_user_id TEXT NOT NULL REFERENCES users(id), updated_at TIMESTAMP(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,school_id,call_id), CHECK(reason <> 'OTHER' OR COALESCE(length(trim(explanation)),0) > 0)
);
ALTER TABLE assignment_follow_ups ADD COLUMN contact_target TEXT NOT NULL DEFAULT 'FACULTY';
ALTER TABLE grant_proposal_follow_ups ADD COLUMN contact_target TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE assignment_follow_ups ADD CONSTRAINT assignment_contact_target CHECK(contact_target IN ('FACULTY','AGENCY','INTERNAL','UNKNOWN'));
ALTER TABLE grant_proposal_follow_ups ADD CONSTRAINT proposal_contact_target CHECK(contact_target IN ('FACULTY','AGENCY','INTERNAL','UNKNOWN'));
UPDATE assignment_follow_ups SET contact_target='INTERNAL' WHERE kind NOT IN ('CALL','EMAIL','MEETING');
ALTER TABLE grant_proposal_documents DROP CONSTRAINT grant_proposal_documents_kind_check;
ALTER TABLE grant_proposal_documents ADD CONSTRAINT grant_proposal_documents_kind_check CHECK(kind IN ('ENDORSEMENT','FORWARDING','NOC','SANCTION_ORDER','AGREEMENT','CERTIFICATE','SUBMISSION_PROOF','OTHER'));

-- Earliest dated evidence, never publication date or migration time.
INSERT INTO dsr_opportunity_observations
SELECT tenant_id, school_id, call_id, MIN(seen_at), 'historical-evidence', true FROM (
 SELECT tenant_id, school_id, funding_call_id call_id, first_seen_at seen_at FROM funding_opportunity_matches
 UNION ALL SELECT ca.tenant_id, u.path[1], ca.funding_call_id, ca.created_at FROM call_assignments ca JOIN tenant_org_units u ON u.id=ca.assignee_org_unit_id
 UNION ALL SELECT tenant_id, org_unit_id, funding_call_id, created_at FROM call_school_triage
 UNION ALL SELECT tenant_id, org_unit_id, funding_call_id, created_at FROM grant_proposals WHERE funding_call_id IS NOT NULL
) evidence WHERE school_id IS NOT NULL GROUP BY tenant_id,school_id,call_id;

CREATE VIEW dsr_applications AS
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
 GREATEST(a.updated_at,p.updated_at) updated_at
 FROM call_assignments a LEFT JOIN grant_proposals p ON p.assignment_id=a.id AND p.tenant_id=a.tenant_id
 LEFT JOIN tenant_org_units u ON u.id=a.assignee_org_unit_id
 LEFT JOIN funding_calls c ON c.id=a.funding_call_id
 UNION ALL
 SELECT 'proposal:' || p.id, p.tenant_id,p.org_unit_id,p.funding_call_id,NULL,p.id,p.pi_user_id,
 p.created_by_user_id,p.created_at,NULL,NULL,p.status,p.submitted_at,p.submission_reference,p.submission_url,NULL,
 p.submission_recorded_by_user_id,NULL,p.review_cutoff_at,p.agency_deadline_at,p.title,p.agency_name,
 p.requested_amount,p.sanctioned_amount,p.currency,p.current_version_no,p.updated_at
 FROM grant_proposals p WHERE p.assignment_id IS NULL;

-- Baselines are current observations, not invented historical transitions.
INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind,after_data,inferred)
 SELECT tenant_id,school_id,'APPLICATION',id,'BASELINE',to_jsonb(a),true FROM dsr_applications a;
INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind,after_data,inferred)
 SELECT tenant_id,org_unit_id,'OWNERSHIP',id,'BASELINE',to_jsonb(s),true FROM funding_dept_school_assignments s;
INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind,inferred)
 SELECT tenant_id,id,'HISTORY',id,'BASELINE',false FROM tenant_org_units WHERE depth=0;

CREATE FUNCTION dsr_capture_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id TEXT; item RECORD; old_item JSONB; new_item JSONB; source_tenant TEXT; identities TEXT[];
BEGIN
 source_tenant:=COALESCE(NEW.tenant_id,OLD.tenant_id);
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=source_tenant) THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_TABLE_NAME = 'call_assignments' THEN
   identities := ARRAY['assignment:' || COALESCE(NEW.id,OLD.id)];
 ELSE
   identities := ARRAY[COALESCE('assignment:'||NEW.assignment_id,'proposal:'||NEW.id),COALESCE('assignment:'||OLD.assignment_id,'proposal:'||OLD.id)];
 END IF;
 FOR identity_id IN SELECT DISTINCT x FROM unnest(identities) x WHERE x IS NOT NULL LOOP
 SELECT after_data INTO old_item FROM dsr_events WHERE tenant_id=source_tenant AND entity_type='APPLICATION' AND entity_id=identity_id ORDER BY id DESC LIMIT 1;
 SELECT * INTO item FROM dsr_applications WHERE tenant_id=source_tenant AND id=identity_id;
 new_item := CASE WHEN item.id IS NULL THEN NULL ELSE to_jsonb(item) END;
 IF old_item IS DISTINCT FROM new_item THEN
 INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind,before_data,after_data,actor_user_id)
 VALUES(source_tenant,COALESCE(item.school_id,old_item->>'school_id'),'APPLICATION',identity_id,TG_OP,old_item,new_item,
   NULLIF(current_setting('grapsi.actor_id',true),''));
 END IF;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER dsr_assignment_history AFTER INSERT OR UPDATE OR DELETE ON call_assignments FOR EACH ROW EXECUTE FUNCTION dsr_capture_application();
CREATE TRIGGER dsr_proposal_history AFTER INSERT OR UPDATE OR DELETE ON grant_proposals FOR EACH ROW EXECUTE FUNCTION dsr_capture_application();

CREATE FUNCTION dsr_capture_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=COALESCE(NEW.tenant_id,OLD.tenant_id)) THEN RETURN COALESCE(NEW,OLD); END IF;
 INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind,before_data,after_data,actor_user_id)
 VALUES(COALESCE(NEW.tenant_id,OLD.tenant_id),COALESCE(NEW.org_unit_id,OLD.org_unit_id),'OWNERSHIP',COALESCE(NEW.id,OLD.id),TG_OP,
 CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,
 COALESCE(NULLIF(current_setting('grapsi.actor_id',true),''),NEW.assigned_by_user_id));
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER dsr_ownership_history AFTER INSERT OR UPDATE OR DELETE ON funding_dept_school_assignments FOR EACH ROW EXECUTE FUNCTION dsr_capture_ownership();

CREATE FUNCTION dsr_observe_opportunity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE school TEXT; seen TIMESTAMP; source_name TEXT;
BEGIN
 IF TG_TABLE_NAME='funding_opportunity_matches' THEN school:=NEW.school_id; seen:=NEW.first_seen_at;
 ELSIF TG_TABLE_NAME='call_school_triage' THEN school:=NEW.org_unit_id; seen:=NEW.created_at;
 ELSIF TG_TABLE_NAME='grant_proposals' THEN school:=NEW.org_unit_id; seen:=NEW.created_at;
 ELSE SELECT path[1] INTO school FROM tenant_org_units WHERE id=NEW.assignee_org_unit_id; seen:=NEW.created_at; END IF;
 IF school IS NOT NULL AND NEW.funding_call_id IS NOT NULL THEN
 INSERT INTO dsr_opportunity_observations VALUES(NEW.tenant_id,school,NEW.funding_call_id,seen,TG_TABLE_NAME,false)
 ON CONFLICT(tenant_id,school_id,call_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dsr_match_observed AFTER INSERT ON funding_opportunity_matches FOR EACH ROW EXECUTE FUNCTION dsr_observe_opportunity();
CREATE TRIGGER dsr_triage_observed AFTER INSERT ON call_school_triage FOR EACH ROW EXECUTE FUNCTION dsr_observe_opportunity();
CREATE TRIGGER dsr_assignment_observed AFTER INSERT ON call_assignments FOR EACH ROW EXECUTE FUNCTION dsr_observe_opportunity();
CREATE TRIGGER dsr_proposal_observed AFTER INSERT ON grant_proposals FOR EACH ROW EXECUTE FUNCTION dsr_observe_opportunity();

CREATE FUNCTION dsr_start_school_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.depth=0 THEN INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,kind) VALUES(NEW.tenant_id,NEW.id,'HISTORY',NEW.id,'BASELINE'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dsr_school_history_start AFTER INSERT ON tenant_org_units FOR EACH ROW EXECUTE FUNCTION dsr_start_school_history();
