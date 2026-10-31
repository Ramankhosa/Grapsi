# Source Watch implementation verification — 24 October 2026

## Verdict

**Deployment held.** The inspected release is the uncommitted Phase 1 implementation in `.claude/worktrees/source-watch-crawler`, branch `feature/source-watch-crawler`, based on `5352094e65988a237a8cfbe9136f3cec0964d00a`. It is not the autonomous funding crawler described in the full plan.

The worker executes only `CHECK_SOURCE` and `REFRESH_URL_INDEX` (`src/lib/monitor/execute.ts:10`). New-item screening, metered AI, extraction, draft handoff, approval workflow and whole-site discovery are not implemented. Foundation tables for those later stages do not establish working behavior.

No production migration, application deployment, process restart, scheduler activation, paid AI call or notification was performed during this review. Production remains on the existing legacy release.

## Confirmed findings

Each of the seven findings below has a newly added failing regression test. Tests use fixture networks and a dedicated local database, not production.

| Priority | Finding and consequence | Location | Recommended fix |
|---|---|---|---|
| P1 | The approved-host check applies only after a redirect. An initial request to an unapproved public host succeeds, even when `inScope` rejects it. Untrusted child sitemap URLs can therefore escape the site's approved scope. Public/private-address protection remains a separate check; this is an approved-host bypass, not a demonstrated private-address bypass. | `src/lib/monitor/safeFetch.ts:354` | Apply the scope predicate to every target before robots, pacing, DNS and transport, including the initial URL. Test sitemap children and redirected targets. |
| P1 | A sitemap index that references itself loops without consuming the child-request budget. The test had to stop it after 13 attempts despite a limit of 3. In production it can keep a worker occupied and repeatedly request the site. | `src/lib/monitor/checkSource.ts:624`, `:644` | Count every fetch, track visited/queued canonical sitemap URLs across continuation checks, and bound index expansion and total frontier size. Cycles must not become successful proof of complete coverage. |
| P1 | Descending into a nested sitemap index replaces the entire queue, dropping unvisited siblings. Calls in those siblings are never observed. | `src/lib/monitor/checkSource.ts:646` | Splice children into the remaining frontier or maintain a persistent queue/stack. Preserve sibling progress and deduplicate expansion. |
| P1 | After a completed paginated pass, a 304 on the first page ends the next check. Page two is never requested even if it has new calls. A first-page validator cannot validate the rest of the listing. | `src/lib/monitor/checkSource.ts:503`, `:561` | Persist pagination topology and per-page validators, or periodically require a full traversal. Refresh only observations supported by pages actually validated. |
| P1 | An empty listing returns PARTIAL on the first check but its ETag is saved. The next 304 is accepted as complete, masking the unresolved extraction failure. The validator update also runs after selector failure/truncation. | `src/lib/monitor/checkSource.ts:751`, `:716` | Save reusable validators only with a trusted extraction state; a 304 must inherit that state's completeness and error status. Retry incomplete content without those validators. |
| P1 | An HTML error page returned with HTTP 200 for a sitemap parses as `unknown`, but the check falls through as COMPLETE. Existing opportunities can then be marked missing. | `src/lib/monitor/checkSource.ts:642–706` | Reject unexpected MIME/root structure and parse failures as incomplete. Distinguish a valid empty URL set from an invalid document. Never infer absence from an invalid response. |
| P2 | Hindi-only opportunity anchors fail the meaningful-item test because JavaScript `\W` removes their letters. A valid listing is classified as having no meaningful items. | `src/lib/monitor/checkSource.ts:44` | Use Unicode letter/number properties consistently with the item extractor, and test Hindi and mixed-language pages. |

Regression files:

- `.claude/worktrees/source-watch-crawler/src/tests/integration/monitor/review-regressions.monitor-db.test.ts` — six failing coverage/completeness checks.
- `.claude/worktrees/source-watch-crawler/src/tests/unit/monitor-review-scope.test.ts` — failing initial approved-host check.

## Additional concerns from code inspection

- The browser's advertised 8 MiB limit is calculated from `Content-Length` headers, then evaluated after rendering (`src/lib/monitor/browser.ts:204`, `:233`). It does not enforce a streaming download ceiling, and missing or misleading headers evade accounting. Enforce a real resource budget and cancel work when it is exhausted before browser activation.
- The queue's one-running-task-per-site claim uses a `NOT EXISTS` check while locking only task rows. Two simultaneous claimers can select different tasks for the same site. Existing coverage claims sequentially, so it does not test this race. Use a site-level lock or database constraint/claim design and add a concurrent test.
- Legacy mode retains the direct, unmetered Anthropic triage path and its old provider-failure behavior. Phase 1 should not be described as delivering the plan's AI cost controls.
- Retention cleanup and notification-preference enforcement remain absent, as Claude disclosed. The outbox intentionally never retries SENDING deliveries; its comment refers to a daily digest that is not established by this implementation. Document that delivery-loss tradeoff accurately.
- The PM2 ecosystem defaults target `/srv/grapsi/current`; actual production uses `/var/www/granter/Grapsi` and the `grantmentor` application. Do not apply the ecosystem file wholesale to this server.

## Production readiness probe

Read-only checks were performed through the existing GCE IAP connection, using the application's owner account.

| Check | Observed |
|---|---|
| Live revision | `5352094e65988a237a8cfbe9136f3cec0964d00a`, matching the foundation's committed base |
| Application | `grantmentor` online; loopback `/api/health` returned `status: ok` |
| Engine | Legacy default; browser disabled |
| Funding scheduler | No matching PM2 process present |
| Cron secret | `FUNDING_ALERT_CRON_SECRET` absent from effective on-disk environment |
| Source Watch worker | No matching PM2 process present |
| Tenant IDs | Neither literal `PLATFORM` nor the currently referenced `platform-funding-ingestion` exists |
| SITE_URL | Two definitions in production `.env` |
| Existing monitored sources | Two ACTIVE sources |
| Foundation migration | Not applied |

The missing scheduler means the two ACTIVE rows do not demonstrate automatic scheduled monitoring. Independent AI-provider credit/fallback, production Chromium sandboxing and a dedicated worker user's egress restrictions remain unverified. No TLS exception was added and no source URLs were changed.

## Validation

- 110 targeted unit tests passed across eight suites.
- 20 original integration tests passed, including three local Chromium checks.
- All 181 migrations applied successfully to a fresh disposable local database, `grapsi_source_watch_verify_20261024_test`. This does not validate the production backfill against existing data or production lock duration.
- Full TypeScript check passed, including the newly added review regression files. The build's automatic temporary addition to `tsconfig.json` was reverted.
- Lint passed with zero errors and 84 existing warnings, using the worktree's own configuration to avoid duplicate parent plugin discovery.
- Seven newly added regression tests failed as described above. The original passing suites did not cover these cases.
- Reproduction logs are retained in `outputs/source-watch-review-20261024/regression-integration.log` and `regression-scope.log` in the main workspace. No implementation fixes were applied as part of this review; the failing tests are deliberate evidence for the handoff.
- Optimized production build passed in a separate local output directory; build ID `gwL9LtoUzW51i0d2CTT2I`. In-build lint/type passes were disabled because those checks were run independently. A successful build does not resolve the failed behavior tests or verify production runtime behavior.

## Release recommendation

Fix the confirmed regressions and run both the original suites and the new checks before signing off Phase 1. Prepare a focused commit from this worktree; do not mix the main workspace's unrelated edits or publish its 82 ancestor commits incidentally.

For a foundation-only release, retain `MONITOR_ENGINE=legacy`, leave the v2 worker/browser off, back up production, verify the migration against a restored database, deploy a separate build with rollback, and smoke-test authenticated source/health/evidence routes. Legacy mode also uses the new database-backed fetcher and health queries, so the schema is required even with v2 disabled.

Restore scheduled operation only after validating the cron secret, intended jobs and notification/AI effects. Do not start every scheduler job merely to make Source Watch run. Resolve duplicate `SITE_URL` and the ingestion tenant/billing identity deliberately.

Complete Phases 2–3 before claiming automatic opportunity detection, extraction and draft creation. Complete Phase 4 before claiming whole-site discovery from one seed. Human publication remains the agreed policy.
