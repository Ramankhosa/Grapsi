# Grapsi Local Worker

A portable Windows x64 application that pulls stored crawler pages from production,
classifies them locally, and uploads versioned results. Double-click the EXE or its
desktop shortcut. Use **Start**, **Pause**, and the tray menu to control it. Minimizing
keeps it running; closing the window stops the model and connection. Starting at
Windows sign-in is optional and off by default.

## Current rollout

The worker uses **Qwen3-4B-Instruct-2507 Q4_K_M**, with CPU inference optimized for
this 16 GB laptop. The four outputs are:

| Result | Meaning |
| --- | --- |
| CALL | Evidence of a current invitation to apply for research financial support |
| RELATED | Scheme information, directories, closed/future calls, instructions, extensions |
| GENERAL | News, award recipients, ceremonies, partnerships, ordinary jobs or procurement |
| UNSURE | Insufficient readable evidence or input too large for the context |

Results are saved in production in **review mode (`SHADOW`)**. They do not currently
skip paid triage, trigger extraction, create drafts, publish, or send notifications.
The stronger-model pipeline retains its existing decisions and budget controls.
The initial small authored benchmark was 42/46 with all 15 example calls found;
that is not a measured production accuracy rate. Production-labelled validation
is required before using GENERAL as a rejection gate. RELATED must remain available
for linked-page discovery and updates; UNSURE must remain eligible for stronger review.

## How offline processing works

1. A production timer runs every 60 seconds and queues current readable pages from
   active, approved sources. Initially ANRF and DST are approved.
2. The laptop opens an outgoing, IAM-authenticated Google Cloud IAP/SSH connection.
   Production needs no inbound route to the laptop. There is no public model endpoint.
3. The broker grants one 120-second lease per device. The worker renews it every
   25 seconds while loading/running the model. The crawler's own leases are independent.
4. A result is encrypted with Windows user protection and atomically saved before
   upload. Reconnecting resends saved uploads before claiming more work.
5. Production accepts a result once, checking device, lease, model, policy, source
   version and full content hash. Changed pages and obsolete results are rejected.
6. Sleep, power loss, network loss or process failure leaves work in production.
   Expired leases are retried; five interrupted/failed attempts mark a job FAILED
   for investigation. Backlog deadlines use the date when work is claimed.

An offline laptop adds analysis delay. It does not stop the crawler or hold its
site lease. The production timer also runs when no laptop is connected.

## Discovery and resource use

The EXE discovers Google Cloud CLI, its SSH identity, cached models and llama.cpp.
It verifies the pinned model and every runtime binary. If files are missing, it
downloads the pinned official runtime and model, with resumable model downloads.
The model is about 2.5 GB; downloaded files require additional disk space.

The model uses at most three CPU threads, below-normal priority, one job at a time,
and a 2,048-token context. It waits for 3.5 GiB free memory before starting and unloads
after five idle minutes. Working memory was approximately 2.8 GB in the earlier
local pilot. Long pages use a bounded beginning/end excerpt; this can omit relevant
information and is another reason to retain review mode.

The model listens only on a random local loopback port with a private API key.
The EXE owns its model/SSH processes; exit or forced termination cleans them up.
It reconnects with capped exponential backoff. It restarts a failed model on retry.

## Connection setup

This laptop already has Google Cloud CLI and an authorized Google account. On a
different machine, install the official Google Cloud CLI and use **Connection setup**
to sign in. The account must have access to the configured project, IAP tunnel and
VM SSH. First access may require completing Google's normal SSH host-key setup.
This is an administrative companion for the existing authorized operator, not a
public multi-user worker enrollment service. The EXE contains no database password,
Google token, or shared production API secret. It is currently unsigned.

The production target and approved model/policy are embedded in the build. This is
service/asset discovery within that configured deployment; it does not scan networks
or automatically enroll in arbitrary servers. A server policy change requires a
compatible worker build; the worker stops with an update message on incompatibility.

## Build and install

From the repository root on Windows:

```powershell
& desktop/local-worker/build.ps1
& desktop/local-worker/install.ps1 -Start
```

The build uses the Windows .NET Framework 4.8 compiler and the pinned official
llama.cpp archive in `%LOCALAPPDATA%\Grapsi\local-screening`. Node is needed to build
the embedded configuration. Running the finished EXE does not require Node or
Python separately from Google Cloud CLI's bundled runtime. Installation is per-user.

Artifacts: `outputs/local-worker/Grapsi.LocalWorker.exe`. The installer copies it to
`%LOCALAPPDATA%\Grapsi\LocalWorker` and creates a desktop shortcut. The existing model
cache under `Grapsi\local-screening` is reused rather than copied.

Diagnostics and encrypted recovery files live under `%LOCALAPPDATA%\Grapsi\LocalWorker`:
`worker.log`, `last-run.json`, `self-test.json`, and `private\outbox` / `private\archive`.
Only the current Windows user and SYSTEM can access the private directory. Do not
delete the outbox while a result is awaiting acknowledgement.

```powershell
# Offline Windows checks: quoting, JSON, encrypted writes, process cleanup, policy.
Start-Process outputs/local-worker/Grapsi.LocalWorker.exe --self-test -Wait
# Real production smoke run; waits/reconnects until two results are acknowledged.
Start-Process outputs/local-worker/Grapsi.LocalWorker.exe '--headless --max-jobs=2' -Wait
# Add --once to exit when there is currently no claimable work.
node --test tools/local-worker/broker.test.cjs
```

The database suite is restricted to a separate local database named
`grapsi_local_worker_test`; it never resets the application's database.

## Production operations

The root-owned broker is deployed independently of the web application at
`/opt/grapsi-local-worker/current`. It runs as the existing app owner and loads
database settings only on the server. The schema migration adds three sidecar
tables: `monitor_local_workers`, `monitor_local_analysis_jobs`, and
`monitor_local_analysis_results`. The production timer is
`grapsi-local-analysis-queue.timer`; the existing crawler service is
`grapsi-source-watch.service`.

```sh
sudo -u ramankhosa node /opt/grapsi-local-worker/current/broker.cjs --status
systemctl status grapsi-local-analysis-queue.timer
journalctl -u grapsi-local-analysis-queue.service --since today
```

To pause new local analysis centrally, set `enabled` to `false` in
`/etc/grapsi-local-worker.json`. Connected clients pick it up at their next claim;
in-flight valid results can still finish. Restore `true` to resume. Stop/disable
the timer as well to pause offline queue discovery. This does not stop the crawler.

Failed jobs remain visible in queue counts. Inspect `last_error`, version freshness
and the device before a targeted retry; never reset all production jobs blindly.
The broker intentionally supports deployed schemas without the optional skip-rule
table. When that table exists, active skip rules and paused sites are respected.

To roll back the broker, pause new claims, stop the queue timer, then restore the
previous verified release symlink recorded in
`/opt/grapsi-local-worker/previous-release` and restart the timer if appropriate.
Retain the additive tables/results; dropping them is unnecessary for rollback.
Database schema backups are recorded by the installer before migration. The deploy
script refuses unrelated pending migrations and never rebuilds/restarts the web app.

For a new broker release, run `tools/local-worker/package.ps1`, transfer the archive
and `deploy.sh` to the configured operator's home, then run `deploy.sh` with the
verified package SHA-256. The release directory is derived from that hash and the
current symlink changes only after schema checks succeed.
