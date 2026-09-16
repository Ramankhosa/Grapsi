-- Short-lived, user-bound report snapshots keep pages and exports identical.
CREATE TABLE dsr_report_snapshots (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, scope_key TEXT NOT NULL, filter_key TEXT NOT NULL,
 payload JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
 expires_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX dsr_report_snapshots_expiry ON dsr_report_snapshots(expires_at);
