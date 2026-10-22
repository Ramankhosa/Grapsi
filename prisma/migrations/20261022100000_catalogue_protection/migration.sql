-- Separate security state: never alters a funding call or a saved preference.
CREATE TABLE catalogue_sessions (
 id text PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 authenticated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, user_agent text
);
CREATE INDEX catalogue_sessions_user_idx ON catalogue_sessions(user_id, expires_at);
CREATE TABLE catalogue_accounts (
 user_id text PRIMARY KEY, restricted_until timestamptz, reason text, reauth_after timestamptz,
 allowance_multiplier integer NOT NULL DEFAULT 1 CHECK (allowance_multiplier BETWEEN 1 AND 10),
 allowance_until timestamptz
);
CREATE TABLE catalogue_counters (
 user_id text NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL,
 count bigint NOT NULL DEFAULT 0, PRIMARY KEY(user_id,bucket,window_start)
);
CREATE TABLE catalogue_leases (
 id text PRIMARY KEY, user_id text NOT NULL, session_id text NOT NULL, kind text NOT NULL,
 expires_at timestamptz NOT NULL, summary_ids text[] NOT NULL DEFAULT '{}', detail_ids text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX catalogue_leases_user_idx ON catalogue_leases(user_id,expires_at);
CREATE TABLE catalogue_exposures (
 user_id text NOT NULL, call_id text NOT NULL, kind text NOT NULL, day date NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,call_id,kind,day)
);
CREATE INDEX catalogue_exposures_window_idx ON catalogue_exposures(user_id,kind,seen_at,call_id);
CREATE TABLE catalogue_security_events (
 id text PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL, actor_id text,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_events_user_idx ON catalogue_security_events(user_id,created_at);
CREATE INDEX catalogue_events_retention_idx ON catalogue_security_events(created_at);
CREATE TABLE catalogue_areas (
 id text PRIMARY KEY, source_key text NOT NULL, kind text NOT NULL, label text NOT NULL,
 normalized_label text NOT NULL, version text NOT NULL,
 UNIQUE(source_key,kind,normalized_label)
);
CREATE TABLE catalogue_call_areas (
 call_id text NOT NULL, area_id text NOT NULL REFERENCES catalogue_areas(id) ON DELETE RESTRICT,
 source_record_id text NOT NULL DEFAULT '', PRIMARY KEY(call_id,area_id,source_record_id)
);
CREATE INDEX catalogue_call_areas_area_idx ON catalogue_call_areas(area_id,call_id);
CREATE TABLE catalogue_area_crosswalk (
 native_area_id text NOT NULL, imported_area_id text NOT NULL REFERENCES catalogue_areas(id) ON DELETE RESTRICT,
 relation text NOT NULL DEFAULT 'unresolved', approved_by text, approved_at timestamptz,
 PRIMARY KEY(native_area_id,imported_area_id)
);
