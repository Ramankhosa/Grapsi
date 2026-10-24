-- Also upgrades installations of the initial foundation migration that did
-- not yet contain this guard. Expired leases are reclaimed on the same row.
CREATE UNIQUE INDEX IF NOT EXISTS "monitor_tasks_one_running_per_site"
  ON "monitor_tasks" ("site_id") WHERE "status" = 'RUNNING' AND "site_id" IS NOT NULL;
