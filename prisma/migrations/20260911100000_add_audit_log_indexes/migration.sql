-- Indexes for reading the audit log.
--
-- audit_logs has had no index but its primary key since it was created, because
-- until now nothing ever read it back — around thirty call sites write and none
-- query. Every filter the new viewer offers (a tenant's own rows, one actor's
-- history, one action across time) would otherwise be a sequential scan over a
-- table that only ever grows.
--
-- All three lead with the filter column and end with created_at, which is both
-- the sort order and the pagination cursor, so a filtered page is one index scan.
CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant_created"
  ON "audit_logs"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_actor_created"
  ON "audit_logs"("actorUserId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action_created"
  ON "audit_logs"("action", "createdAt" DESC);
