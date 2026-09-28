# Manual call allocation

DSR members can allocate any accessible published, active call to a faculty member within their existing school coverage. Matching data and research-profile completion are not prerequisites. Faculty without an organisation placement remain assignable only by tenant-wide administrators, as in the existing assignment permissions.

Entry points are the faculty directory, shared faculty profile, faculty report panel, DSR call dossier, general call detail and researcher-matching page. The shared dialog fixes the originating faculty member or call, then searches the other side. Call search defaults to open and undated calls. Faculty search uses school, optional department, and name, email or employee ID.

Manual requests use `allocationMethod: MANUAL` with `allocationReason` set to `FACULTY_WILLINGNESS`, `INDIRECT_FIT` or `DSR_RECOMMENDATION`. `allocationNote` is optional, faculty-visible and limited to 2,000 characters. The existing message remains the notification text. New allocations stay `ASSIGNED`; willingness does not imply acceptance. Existing allocations link to their existing lifecycle, including re-requesting.

The assignment, school attribution, opportunity snapshot and audit changes commit together. Missing school mappings are created as **Manual allocation**. Active mappings keep their provenance; ended mappings reopen with their previous state preserved in the audit history. Manual snapshots do not count as automatic matches. Notification failures do not undo a saved allocation.

## Release order

Apply `prisma/migrations/20260925110000_manual_call_allocations/migration.sql` through `prisma migrate deploy` against the intended deployment database **before** releasing the API and UI. Then generate the Prisma client and build/release the application through the normal deployment process. Existing records retain null allocation metadata. The migration also extends the school-mapping constraints and application reporting view.

## Verification

Run the unit checks with:

```sh
npx vitest run src/tests/unit/manual-allocation.test.ts src/tests/unit/manual-allocation-options.test.ts src/tests/unit/manual-allocation-mapping.test.ts src/lib/fundingDept/__tests__ src/tests/unit/org-unit-scope.test.ts src/tests/unit/assignment-status-transitions.test.ts src/tests/unit/funding-call-access.test.ts src/tests/unit/call-timeline.test.ts
npx tsc --noEmit --incremental false
```

For a migrated local database, `node scripts/run-local-command.js node node_modules/tsx/dist/cli.cjs scripts/verify-manual-allocations.ts` checks real constraints, school provenance, reopening history, snapshots and reporting metadata. Its fixtures are rolled back; it refuses non-local database hosts and sends no notifications.

With the local development server on port 3010, run `node scripts/verify-manual-allocation-ui.cjs`. It requires Playwright and Microsoft Edge; `PLAYWRIGHT_MODULE_PATH` can point to an existing Playwright installation. `ALLOCATION_UI_URL` can select another local server. All API calls are mocked, so no application data or notifications are written. Checks cover both directions, pagination, stale responses, reason validation, duplicate clicks, existing-allocation navigation, keyboard focus, nested Escape, mobile width and deadline/reopening warnings. Screenshots are written under `test-results/manual-allocation-ui`.
