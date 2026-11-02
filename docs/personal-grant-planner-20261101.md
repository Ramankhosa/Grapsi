# Personal grant planner

Implemented on 1 November 2026, following the DSR reporting and funding workspace improvements.

## User workflow

- **Discovery:** star an opportunity, or open **Plan & notes** directly from its card.
- **Grant details:** the same personal controls appear above the grant details.
- **My grants:** available from the funding workspace navigation at `/funding/my-grants`. Favourites, all saved grants and the grant calendar each have a separate view.
- **Notes:** plain-text private notes, up to 10,000 characters per grant, saved to the account rather than the browser. Conflicting edits return a clear recovery path; closing an unsaved draft requires an explicit discard.
- **Calendar:** multiple named milestones per grant, with a date, time and explicit time zone. Desktop offers a month grid and agenda; mobile uses the agenda. Calendar pages and saved grants are paginated, with search for saved grant titles.
- **Reminders:** an optional email date/time on or before each milestone. The recipient is the account owner's current email, read from the server; users cannot select another recipient. Edit to change or cancel a reminder, or remove the calendar entry. Removing a favourite preserves its notes and calendar entries.

## Access and correctness

Every personal query and mutation is scoped to the authenticated tenant and person. Department heads and administrators have no extra access to another person's planner. Existing Discovery entitlement checks and the canonical published/active call visibility rules apply, including the external funding catalogue. Drafts, deactivated calls and another tenant's private calls cannot be bookmarked through these routes.

Calendar times are converted from an explicit IANA time zone to UTC instants. Invalid dates, invalid zones, past reminder times, reminders after the milestone and ambiguous/nonexistent daylight-saving times are rejected. Notes use revision checks; event edits/deletions use revision and delivery-state checks. A reminder being sent cannot be edited or removed mid-delivery. Calendar editing is disabled while notes are unsaved, to protect the draft if an entry moves off the current calendar page.

## Delivery operation

- Additive migration: `prisma/migrations/20261101090000_personal_grant_planner/migration.sql` creates `personal_grants`, `personal_grant_events` and the reminder-state enum. Existing grant and user records are unchanged.
- `scripts/funding-scheduler.js` calls `POST /api/funding/personal-grants/reminders/sweep` every minute, authenticated with the existing `FUNDING_ALERT_CRON_SECRET`. The source-watch-only scheduler mode continues to run only Source Watch jobs.
- To activate personal reminders independently, run a separate scheduler process with `FUNDING_SCHEDULER_ONLY_PERSONAL_GRANTS=true`. This mode sends only personal calendar reminders and leaves the older department reminders, alerts, digests and reports inactive in that process. It takes precedence over the source-watch-only flag; set it per process, not globally for an existing Source Watch process.
- The job is registered in the operations console with run history and health monitoring. Failed, recovered or configuration-delayed deliveries return a failed job result for operator visibility.
- Delivery uses the existing Mailjet service and verified sender. Configure the existing `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, and `SITE_URL` appropriately. `SITE_URL` supplies links back to the exact grant and calendar. The web app and scheduler must share the scheduler secret and target the same deployment.
- Conditional claims prevent overlapping sweeps from delivering the same pending entry. Only provider-confirmed acceptance becomes **Sent**. HTTP 200 responses with a rejected Mailjet message are treated as failures. Provider requests have a 30-second limit, and each sweep stops taking more work after a bounded processing window.
- With missing email configuration, reminders remain pending and retry after 5, 10, 20 and 40 minutes, then become **Delivery needs attention**. An ambiguous network failure or a claim abandoned for 10 minutes becomes **Delivery needs attention**, requiring a new reminder time. It is not automatically resent because the provider may already have accepted it.
- Account suspension, expiry, a change of tenant, tenant suspension or grant visibility withdrawal stops delivery. Private notes are not included in reminder emails or job summaries.
- **Sent** means accepted by the email provider. Inbox delivery and exact arrival time still depend on the provider; the minute scheduler provides approximate timing and catches up due reminders after downtime.

## Validation

- 38 new automated tests cover owner/tenant fences, forged payloads, notes conflicts, grant visibility, dates and DST, event limits, cancellation, concurrent claims, suspended/expired accounts, delivery failures, HTML escaping and Mailjet acceptance.
- A local PostgreSQL check executes the exact migration in an isolated schema, checks UTC times, note preservation and cascading cleanup, then rolls the entire transaction back and confirms the schema is gone. It does not apply migrations or change application data.
- The fixture-only browser script exercises the full Discovery → notes → email reminder → favourites → calendar journey, desktop and mobile layouts, unsaved-draft recovery, conflicts, stale response handling, failed saves, reminder cancellation and unfavouriting without losing notes. Every API is intercepted; no real user data or emails are used.
- Supporting scripts: `scripts/verify-personal-grants-ui.cjs` and `scripts/verify-personal-grants-schema.ts`. Screenshots and validation logs are in `outputs/personal-grants-20261101/`.
- Regression suite: 2,374 tests passed across 291 files, plus 43 native worker tests. Type checking and lint passed. The first parallel JSON-report run ended with an incomplete Vitest report; a complete rerun passed, including all document-parser tests. The complete run is recorded in `full-tests.log`.
- The optimized production build passed. Both the new personal-grant browser checks and the existing funding/DSR browser checks passed against that build.

## Rollout

This change is prepared locally and has not been deployed. Apply the database migration before enabling the new web build, then update the scheduler from the same release (either the normal scheduler or a separate personal-only process). Confirm the personal-reminder job succeeds in the operations console and verify one deliberately scheduled reminder with a test account before announcing availability. No real reminder emails were sent during implementation.
