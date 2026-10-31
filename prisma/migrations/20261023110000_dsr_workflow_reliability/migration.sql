-- Additive: existing review and mapping history is retained.
ALTER TABLE call_school_triage ADD COLUMN action_completed_outcome text;
ALTER TABLE call_school_triage ADD CONSTRAINT dsr_completion_outcome_check CHECK
  (action_completed_outcome IS NULL OR action_completed_outcome IN ('WORK_RECORDED','NO_SUITABLE_FACULTY','NOT_RELEVANT','CAPACITY','OTHER'));

CREATE TABLE dsr_call_routing_jobs (
  call_id text PRIMARY KEY REFERENCES funding_calls(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','FAILED','COMPLETED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  locked_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  updated_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX dsr_routing_due ON dsr_call_routing_jobs(status,available_at);
CREATE INDEX dsr_deadline_ownership_events ON dsr_events(tenant_id,school_id,entity_type,entity_id,occurred_at)
  WHERE entity_type IN ('OWNERSHIP','RESPONSIBILITY');

-- Claimed in the same transaction as the inbox notification, preventing duplicate delivery on retry.
CREATE TABLE dsr_call_notice_deliveries (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id text NOT NULL REFERENCES funding_calls(id) ON DELETE CASCADE,
  school_id text NOT NULL REFERENCES tenant_org_units(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  PRIMARY KEY (tenant_id,call_id,school_id,user_id)
);

-- Preserve delivery history for legacy officer notices; retrying an existing
-- call's mapping must not replay a notice the same school officer already saw.
INSERT INTO dsr_call_notice_deliveries(tenant_id,call_id,school_id,user_id,created_at)
SELECT n.tenant_id,m.call_id,m.school_id,n.user_id,min(n.created_at)
FROM notifications n JOIN dsr_call_school_mappings m ON m.tenant_id=n.tenant_id
  AND n.link_url='/funding-dept/calls/'||m.call_id||'?school='||m.school_id
WHERE n.category='FUNDING_MATCH'
GROUP BY n.tenant_id,m.call_id,m.school_id,n.user_id
ON CONFLICT DO NOTHING;

-- Enqueue at publication in the database transaction, even if the app process exits immediately afterwards.
CREATE FUNCTION dsr_enqueue_published_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Re-saving an already published call is not a new publication. In
  -- particular, Source Watch updates must not replay DSR routing or notices.
  IF TG_OP='UPDATE' THEN
    IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.catalog_status IS NOT DISTINCT FROM OLD.catalog_status
       AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.is_active IS DISTINCT FROM false
     AND COALESCE(NEW.metadata->>'origin','') <> 'source_watch'
     AND (NEW.status::text='PUBLISHED' OR NEW.catalog_status::text='PUBLISHED')
     AND NEW.visibility::text IN ('GLOBAL_PUBLISHED','TENANT_PRIVATE') THEN
    INSERT INTO dsr_call_routing_jobs(call_id) VALUES(NEW.id)
    ON CONFLICT(call_id) DO UPDATE SET generation=dsr_call_routing_jobs.generation+1,status='PENDING',attempts=0,
      available_at=(now() AT TIME ZONE 'UTC'),locked_at=NULL,last_error=NULL,updated_at=(now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dsr_route_published_call AFTER INSERT OR UPDATE OF status,catalog_status,visibility,is_active
  ON funding_calls FOR EACH ROW EXECUTE FUNCTION dsr_enqueue_published_call();

-- Existing published calls are not replayed/notified by migration. The head can explicitly retry a call.
