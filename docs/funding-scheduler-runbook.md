# Funding scheduler runbook

Four funding endpoints are cron-protected and do nothing until something calls
them on a schedule. `scripts/funding-scheduler.js` is that something — a
dependency-free Node process that fires them against the local web app.

| Endpoint | Cadence | What it does |
| --- | --- | --- |
| `POST /api/funding-dept/reminders/sweep` | hourly (:05) | Follow-up reminders + the D30/D14/D7/D1 and NOACK nudge ladder |
| `POST /api/funding/alerts/dispatch` | hourly (:20) | Healing sweep: alerts for published calls that were never dispatched |
| `POST /api/funding/alerts/digest` | daily at `FUNDING_DIGEST_HOUR`:35 (`{"frequency":"daily"}`), Mondays also `{"frequency":"weekly"}` | Bundles queued alerts into one email per user |
| `POST /api/funding-dept/reports/weekly` | Mondays at `FUNDING_DIGEST_HOUR`:35 | Weekly digest to each department member and the head |

All four authenticate with the `x-funding-alert-secret` header. Every job is
idempotent server-side (unique-key claims, conditional updates, a 5-day digest
stamp), so a duplicate or overlapping fire is harmless.

## Production setup (one time)

1. Add to the production env file (same file the web app reads):

   ```
   FUNDING_ALERT_CRON_SECRET=<long random string>
   ```

   Generate one with `openssl rand -hex 32`. The web app and the scheduler must
   see the same value — restart the web app after adding it.

2. Start the scheduler under PM2 from the checkout:

   ```bash
   pm2 start scripts/funding-scheduler.js --name grapsi-funding-scheduler
   pm2 save
   ```

   (On the standalone/`current`-symlink layout, `pm2 reload ecosystem.config.js`
   picks up the `grapsi-funding-scheduler` app defined there instead.)

3. Verify: `pm2 logs grapsi-funding-scheduler` should show a `started` line, and
   within the hour a `-> 200` line per hourly endpoint.

Optional env:

- `FUNDING_SCHEDULER_BASE_URL` — default `http://127.0.0.1:3010`
- `FUNDING_DIGEST_HOUR` — local hour for digests/weekly report, default 3
- `GRAPSI_ENV_FILE` — explicit env file path (otherwise `.env.production`, then `.env`, beside the repo root)

## Manual fire (testing)

```bash
curl -s -X POST -H "x-funding-alert-secret: $FUNDING_ALERT_CRON_SECRET" -H "Content-Type: application/json" http://127.0.0.1:3010/api/funding-dept/reminders/sweep
```

```bash
curl -s -X POST -H "x-funding-alert-secret: $FUNDING_ALERT_CRON_SECRET" -H "Content-Type: application/json" -d '{"frequency":"daily"}' http://127.0.0.1:3010/api/funding/alerts/digest
```

Without the header, the endpoints fall back to requiring a platform funding
operator session — a missing/typoed secret shows up as 401/403 in the
scheduler logs.
