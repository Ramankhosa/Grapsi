# Local analysis worker rollout — 24 October 2026

The laptop companion and independent production queue are deployed in review mode.
See [the operator guide](../desktop/local-worker/README.md) for normal use,
connection setup, recovery rules and production stop/rollback procedures.

## Production release

- Existing web/crawler source release: `9de9c263dad92185665ab52b6cc58e29bc147abe`.
- Companion broker package SHA-256:
  `ad07915aa1d1e89df1bf62c61baa11deff170ef1c94ded0a62f3ac4c675b32d8`.
- Active broker: `/opt/grapsi-local-worker/releases/ad07915aa1d1e89d`, through the
  root-owned `/opt/grapsi-local-worker/current` symlink.
- Additive migration: `20261024150000_local_analysis_worker`, three sidecar tables.
- Protected schema backup from the final broker installation:
  `/var/www/granter/Grapsi/backups/local-worker-2026-10-24T14-44-39-861Z`.
- `grapsi-local-analysis-queue.timer` is enabled and active; discovery every 60 seconds.
- `grapsi-source-watch.service` remained active. The web app was not rebuilt or restarted.
- Approved source hosts: `anrfonline.in`, `onlinedst.gov.in`.
- The installed production schema lacks the optional `monitor_skip_rules` table;
  the broker detects that condition without applying unrelated migrations.

## Installed laptop application

- Installed EXE: `%LOCALAPPDATA%\Grapsi\LocalWorker\Grapsi.LocalWorker.exe`.
- Desktop shortcut: **Grapsi Local Worker**. The app was opened and connected to
  production after installation. Windows sign-in startup remains optional.
- EXE SHA-256: `1d1e371d149dbf600d48e41a080ee88de469935acfa3139db76edcf706e1d964`.
- A copy and operator guide are in the main workspace's
  `outputs/local-worker-20261024` folder.

## Validation

- 19 real PostgreSQL integration tests passed on a separately guarded local test database.
  Coverage includes offline queueing, expired leases, exclusive claims, idempotent
  acknowledgements, stale content/version rejection, skip rules, production pause,
  bounded retries, current-date classification of backlog, and bounded RPC input.
- Prisma schema validation, JavaScript syntax checks, PowerShell parsing and diff
  whitespace checks passed.
- Windows self-tests passed: argument quoting, Unicode JSON, encrypted durable
  writes, owned-process cleanup and embedded model/policy metadata.
- The first production smoke run returned three acknowledged results with no
  pending uploads. Inference took 21.3–32.1 seconds for these actual excerpts;
  model loading took approximately three seconds in this run. Excerpts and laptop
  load differ from the earlier short-text benchmark.
- A further normal run returned two more acknowledged results.
- A live recovery test forcibly terminated the EXE's model process, then its SSH
  transport. The worker restarted the model, reconnected without input, waited
  through lease expiry, returned two acknowledged results and exited with no
  pending uploads or owned background processes. Seven production results had
  been accepted by the end of these tests.

## Deployment scope

This release records local classifications for production review. It does not use
GENERAL to discard pages or automatically start extraction/drafting/publication.
The previous small authored benchmark is insufficient to authorize that gate;
real labelled production examples must measure false negatives first. Queue
correctness tests verify transport/recovery, not model classification accuracy.

The worker uses the operator's existing Google Cloud authorization. It is suitable
for this authorized laptop; public enrollment of unrelated computers would require
a separate restricted device identity and enrollment mechanism.
