# Source Watch production rollout — 24 October 2026

Status: deployed and verified. Web activation completed at **24 October 2026, 16:48:36 IST**. The dedicated worker and Source Watch-only scheduler are running.

Release target: `9de9c263dad92185665ab52b6cc58e29bc147abe` on `feature/source-watch-crawler`.

Production: GCE `patentnest-production-20251121-051811`, project `awesome-pivot-450611-e6`, zone `asia-south2-b`; application `/var/www/granter/Grapsi`, PM2 owner `ramankhosa`, web process `grantmentor`, port 3010. Protected release evidence: `/var/www/granter/Grapsi/backups/source-watch-20261024-01`.

The original staged release `d3aa09a` required three focused follow-up commits:

- `af3eb49`: fix Anthropic's SDK base URL. The SDK already adds `/v1/messages`; the old configuration produced `/v1/v1/messages` and a live 404. A mocked SDK transport test verifies the exact outgoing path.
- `69a9aec`: include the Source Watch JSON schema in the prompt for fallback providers that do not consume `response_format`.
- `9de9c26`: accept a single valid fenced JSON value without another paid attempt; preserve prose and malformed JSON for stage validators to reject.

Gemini `gemini-3.1-flash` and Anthropic `claude-haiku-4.5` independently passed metered synthetic checks. Only the three Source Watch plan-stage configurations use Gemini primary and Anthropic fallback. GLM's endpoint timed out; other modules' routing was preserved. Earlier uncertain reservations were retained.

Validation completed before activation:

- 56 integration tests passed on the local disposable database, including the two new response-format tests.
- 112 selected unit tests passed across the combined run and a successful isolated retry of the document-parser suite after its test process exited unexpectedly.
- Final server type check and targeted lint passed.
- The dedicated worker UID passed database/public connectivity, private IPv4/IPv6 blocking, and sandboxed Chromium under the same systemd restrictions as the worker service.
- Existing production database backup and restored-database migration rehearsal are retained. All 56 integration tests also passed against the restored production database using the final committed server checkout.
- The main workspace's unrelated DSR changes and the feature worktree's pre-existing uncommitted browser/document edits were excluded.

Rollout controls: automatic drafts, notifications and semantic embedding work remain disabled. Humans publish. Paid budgets are $2 per platform day, $0.25 per site day, and $1 for backlog bootstrap work. The scheduler runs Source Watch jobs only.

Approved source URLs remain unchanged: ANRF `https://anrfonline.in/ANRF/HomePage` and DST `https://onlinedst.gov.in/Projectproposalformat.aspx`. Both completed live crawler checks with no recorded source errors. A separate pre-activation HEAD probe received 403 from ANRF, but the crawler's actual check succeeded. No TLS bypass or automatic site approval was added.

Operational scripts are retained in `outputs/source-watch-review-20261024/`. Use `activate-v2.sh`, not the superseded `activate.sh`. Its rollback only moves live build/dependency paths when their protected previous copies exist; it restores web runtime switches and environment backups as well. It checks the exact monitor page bundle and its static assets on loopback and all four public hostnames, and compares all other PM2 process IDs, statuses and restart counters.

## Activation evidence

- Live commit: `9de9c263dad92185665ab52b6cc58e29bc147abe`.
- Build: `WhovVJkDT1E42OQDy996R`.
- `DEPLOYED`: `2026-10-24T11:18:36Z`.
- Final process/queue snapshot: `2026-10-24T11:21:19.329Z` (16:51:19 IST), retained as protected `FINAL_VERIFICATION.json` and copied to `outputs/source-watch-review-20261024/live/`.
- All four hostnames passed health, monitor-page, exact current monitor-bundle/static asset and anonymous API access checks: aigrantmentor.com, www.aigrantmentor.com, aigrantmentor.online, www.aigrantmentor.online.
- Authenticated health, discoveries, sites, metrics, sources and changes GET endpoints returned 200. A short-lived operator token remained in memory and was never printed. Live browser checks blocked all non-GET/HEAD requests.
- Authenticated Discoveries, Sites and Quality screens rendered without client runtime errors; screenshots were inspected and retained in the local `live/` evidence folder.
- `grapsi-source-watch.service` is active/running, PID `1578047`, zero restarts, with a fresh heartbeat.
- PM2 `grapsi-source-watch-scheduler` is online, PID `1578153`, zero restarts, with `FUNDING_SCHEDULER_ONLY_SOURCE_WATCH=true`. It is saved for restart recovery; the worker service is enabled.
- Only `grantmentor` was restarted, once. All pre-existing other PM2 processes retained their IDs, states and restart counters.
- Both source checks completed. Screening, extraction, site discovery, housekeeping and URL-index refresh tasks executed. At the captured snapshot there were 28 stored resource versions and one evidence link; ongoing background work continues. An extracted item requiring more evidence remained `NEEDS_EVIDENCE` rather than creating a draft.
- Source Watch created zero catalogue drafts and published zero calls. Automatic drafting, notifications and semantic matching remain off. Budget reservations plus settled costs stayed within every ledger's allowance; ambiguous earlier provider charges remain reserved.

## Superadmin controls

Open `https://aigrantmentor.com/funding/monitor` and select **Sites**. Select sites and use **Pause selected** to prevent new claims for those sites. Existing queued work waits and a currently running job may finish. **Approve selected** activates/resumes a site and queues discovery; **Explore site** queues an immediate crawl of an active site. The **Sources** tab also offers per-watch-point pause/resume and Check now.

There is no global web Start/Stop control for the worker or scheduler. Full shutdown requires stopping the dedicated systemd worker and the named PM2 scheduler on the server. Pausing a site is not an emergency cancellation of an in-flight provider request.

Previous build, previous dependencies, environment/runtime-switch backups, database backup and source bundles are retained in the protected release directory. Keep the staged checkout and the earlier Research Discovery checkout, because deployed assets may reference their absolute paths. A full rollback must stop the new worker and scheduler before restoring the compatible legacy web build; do not automatically restore the entire database.
