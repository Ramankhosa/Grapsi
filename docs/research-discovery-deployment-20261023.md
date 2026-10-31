# Research Discovery production deployment — 23 October 2026

Deployed at **2026-10-23 08:44:23 UTC (14:14:23 IST)**.

- Production commit: `5352094e65988a237a8cfbe9136f3cec0964d00a`.
- Build: `QGV6qtJNDuuiaTQ42XvYU`.
- Previous commit: `64a0ee16d0dcd52340310bd9ce7fa1940b88bbf1`.
- Previous build: `NCZG_Trt-ng9rkGWt5Aay`.
- Entry: Dashboard → Research Discovery, https://aigrantmentor.com/discovery.

Includes the discovery dashboard, protected call/people search APIs, canonical-area and own-word searches, researcher evidence scoring, and the fix making school faculty lists use the same match predicate as their counts.

## Validation

- Production schema preflight confirmed 528 standard discipline areas and the required canonical views.
- 72 targeted tests passed with the production configuration, including both canonical and legacy area-reader routing assertions.
- Full type check passed in a clean release checkout. The unrelated local draft edit to `researchAreas/ai.ts` was excluded; the existing compatible production implementation was retained.
- Lint passed using the release's own configuration. Parent configuration discovery was disabled to avoid merging the enclosing production checkout's duplicate plugin installation.
- Optimized production build succeeded.
- Private loopback preview passed health, discovery/reviewer page, matching-build and static-asset checks. Anonymous catalogue endpoints returned 401.
- All four hostnames passed health 200, discovery page 200, discovery asset 200 and anonymous discovery API 401: aigrantmentor.com, www.aigrantmentor.com, aigrantmentor.online, www.aigrantmentor.online.
- A real Chromium check of the public discovery page rendered its signed-out sign-in screen with no client runtime errors.
- Only the `grantmentor` application was restarted. All other PM2 process IDs, statuses and restart counts matched the pre-release snapshot.

No database migration, deliberate application-data modification, paid search-provider call or notification was performed by the deployment workflow. Read-only schema probes and mocked search tests were used.

## Recovery evidence

Protected release directory: `/var/www/granter/Grapsi/backups/research-discovery-20261023-01`.

It retains the source bundle, validation/build logs, previous build, before/after process snapshots and activation script with rollback handling. The `checkout` is retained because compiled assets may reference its absolute paths. Do not remove the release directory while this build is in service.
