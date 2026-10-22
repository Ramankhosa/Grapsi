# Funding catalogue access and discovery

This change adds nine independent security/index tables. It does not rewrite
funding calls, intake records, DSR work, preferences, notification settings or
stored embeddings. Existing accounts sign in once to establish a tracked login.

## User behaviour

- `/finder` and `/finder?tab=directory` open the directory; `?tab=ai` opens chat.
  Chat history is initialised only when chat opens.
- Directory results, facets and aggregate statistics use the same filters and
  UTC lifecycle expression. Open and rolling are the directory default.
- Imported research areas and broad subjects are searchable separately. No
  hierarchy is inferred. Previous taxonomy links remain available. Only unique,
  exact leaf labels are automatically bridged. Superadmin reviews every broader
  or narrower relationship in `/admin/funding/catalogue-areas`.
- Automatic chat country refinements replace the previous country unless the
  user explicitly asks to add another. Applicant, host, funder, citizenship and
  residence roles remain separate. Mixed-role requests use the structured
  parser rather than collapsing countries into one list. Manual mode offers
  suggestions for the user to apply. Country-only changes retain the topic,
  imported areas and other selections; model placeholders do not clear them.
- Conversation history is read in small navigable windows. Earlier messages
  remain stored and can be loaded using the earlier-messages control.
- Viewing limits do not spend paid model credits. A limit response preserves
  the current search. Session management is at `/profile/funding-access`.

## Data routes

`src/lib/catalogueProtection/routes.json` records guarded App Router handlers.
Coverage tests check registered methods and new routes in the catalogue,
recommendations, intelligence and call-linked prep modules. The shared boundary
checks existing feature entitlements, database visibility, current login state,
account restrictions and PostgreSQL budgets. Pages Router reviewer discovery
and copying a catalogue call into a reviewer workspace use the same boundary.

Source-linked proposal/prep routes use their existing GRANT_PREP entitlement.
Standalone work and private default-format scaffolds keep their normal project
access. Existing user-owned reviewer documents are project work, not a global
catalogue search API. A new source copy is charged at creation. Intake and
source-monitor tools retain their existing ownership/operator fences for the
user's supplied files; import release/resolve jobs return operator receipts.
DSR/assignment routes retain their institutional scope and exclude GLOBAL_CATALOG
unless a publisher explicitly promotes a call. No DSR expansion is performed.

List projections cap summaries at 320 characters. Detail/AI reads are charged
before protected text is returned or added to a user-facing model context.
Stored snapshots, document chunks and citations are included. Hidden payloads,
vectors, internal metadata and operator notes are removed. Responses are
private/no-store; ordinary-user bulk downloads are rejected. IDs alone never
grant access. Each streamed segment checks the session again before release.

## Limits and recovery

Defaults per account, shared across processes, IPs, sessions and conversations:

| Control | Default |
| --- | --- |
| Protected requests | 60/minute |
| Concurrent searches/metadata/detail requests combined | 3 |
| Concurrent AI generations | 1 |
| Distinct summaries, rolling 1/7/30 days | 1,000 / 2,500 / 5,000 |
| Distinct details, rolling 1/7/30 days | 200 / 600 / 1,200 |
| Response bytes | 8 MB/minute |
| Directory page size | 12 default, 50 maximum |
| Active logins | 2; tabs share a login |

PostgreSQL advisory locks serialize each account's reservations. Pending leases
count against every distinct-record window. Failed responses release pending
reservations. Previously viewed records count once per rolling window; repeat
reads still consume request/byte limits. Store failure denies protected data.
Transaction locks and bounded cleanup need no additional service or process.

Configuration: `CATALOGUE_REQUESTS_PER_MINUTE`, `CATALOGUE_CONCURRENT_SEARCHES`,
`CATALOGUE_CONCURRENT_AI`, `CATALOGUE_BYTES_PER_MINUTE`, and
`CATALOGUE_SUMMARY_1_DAY` / `_7_DAY` / `_30_DAY` (or `DETAIL`) override defaults
within bounded ranges. Changes require a normal app restart.

`CATALOGUE_BEHAVIOUR_ENFORCE_AFTER` is an ISO timestamp seven days after rollout.
Before that timestamp, behavioural signals are observed only; hard quotas and
authentication always apply. Three enforced-limit violations within 30 minutes
then produce a 24-hour catalogue-only restriction. Combined rapid request/page
coverage signals cause a short cooldown and reauthentication. IP tags support
investigation and never independently cause a suspension. No permanent or
whole-account suspension is automated.

Superadmin manages restrictions, session revocation and temporary 1–10x viewing
allowances (up to 24 hours) in `/admin/funding/catalogue-security`. Changes need
a sign-in within five minutes and a reason. Every change is audited. To return
behavioural enforcement to observation, clear/postpone its timestamp and restart
only `grantmentor`; do not disable authentication or core quotas.

Quota exposure rows are retained for the rolling windows (31-day cleanup margin),
security events for 30 days, request counters for seven days, and expired
reservations are removed. Records contain IDs/counts/categories, not descriptions,
conversation contents, credentials or raw IP addresses. Maintenance batches are
bounded at 10,000 rows per table/hour, avoiding shared-machine cleanup spikes.

## Deployment gates

1. Run unit/type/lint checks and `verify-catalogue-protection.ts` on its disposable
   database. Run `verify-catalog-import.ts`; working databases are never seeded.
2. Check the additive migration and inspect drift without applying generated
   diff SQL. In particular, do not copy unrelated raw-table/index drops.
3. Capture current call/intake/DSR/profile/preference fingerprints and other app
   process/config identities. Back up only Grapsi, verify checksums and restore
   the focused backup to an isolated rehearsal database.
4. Rehearse the additive migration, area index, build and HTTP checks there.
   `scripts/sync-catalogue-areas.ts --confirm-target <exact-db-name>` rebuilds only
   the derived index. The import service updates this index after later imports.
5. Apply the additive migration to `grapsi`, seed the index and build separately
   from the live `.next`. Set the observation timestamp. Restart only
   `grantmentor`, verify health/authenticated access, and compare preservation
   baselines. Existing Voyage vectors and provider configuration remain intact.
6. As root, run `scripts/catalogue-origin-protection.sh --apply-grapsi-only`.
   It backs up and changes only the two named Grapsi vhosts and their own limit
   zones. It overwrites forwarded identity headers, validates Nginx, reloads
   gracefully and restores its own changes on failure. Verify loopback-only
   port 3010, both hostname aliases and unaffected other app process/config IDs.

Keep verified backups and `.next.prev`. An application rollback restores code
and the previous build; leave the additive tables intact. Never restore a full
backup over live data as an application rollback.

These controls limit and expose extraction. Information legitimately displayed
to an authorised person can still be copied.
