# DSR reporting correction rollout

The daily entry point is now the school desk. The previous summary remains at
`/funding-dept/summary`. Head users see the department control room in the same desk.

## Database update

Deploy pending migrations before serving this code. The new migration is
`20260922150000_dsr_reporting_corrections`; it depends on the earlier role-workbench
migration. Do not use schema push as a substitute: these migrations include views,
audit-support tables and inferred historical origin attribution.

The correction migration invalidates old operational match flags, but preserves
their historical evidence. A school's first report read rebuilds its complete
person-call projection. Later reads reuse that projection only while its input
fingerprint remains unchanged. Expect the first load to take longer for large
schools; no external AI calls are made by this refresh.

## Reporting rules

- Workbench counts are duties; cards group the duties of one school/call together.
- Incoming counts are intake events, including duplicate submissions and unrouted jobs.
- Corrective-action counts exclude routine actions. Status filters also apply to exports.
- Expired untouched calls are hidden. Open work remains visible. Deadlines use India calendar days.
- Faculty lifetime engagement is separate from filtered workload and current school assignment.
- Historical movement is explicitly unavailable under incompatible detail/expiry filters,
  rather than showing a misleading reconciliation.

## Verification

- Unit/regression suites: `src/lib/fundingDept/__tests__` and the DSR management,
  accountability scope, member funnel, reporting period, funding-call access and
  intake utility suites under `src/tests/unit`.
- Disposable PostgreSQL verifier: `node node_modules/tsx/dist/cli.cjs scripts/verify-dsr-corrections.ts`.
  It clones only the local database schema, applies the pending migrations to a new
  database, creates synthetic fixtures, and removes that exact database afterward.
  It never copies tenant data or migrates the working database. PostgreSQL command-line
  tools are required; use `PG_BIN` to override their directory.
- Production build and TypeScript validation.

Before rollout, check the screens with actual member, deputy, head and administrator
accounts, including assignment authority, large-school load time, and a realistic
unrouted intake. Automated verification does not replace this visual acceptance check.
