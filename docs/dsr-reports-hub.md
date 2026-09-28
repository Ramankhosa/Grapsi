# DSR Reports hub

`/funding-dept/reports` holds four linked reports. The call window, `/funding-dept/calls/[callId]`, is the fifth. Every tab keeps its filters in the URL, so any number on screen can open another report already filtered.

| Tab | Question it answers | Service |
|---|---|---|
| Incoming Calls | Which open calls reach my schools, and have I finished acting on each? | `src/lib/fundingDept/incomingCalls.ts` |
| Assigned Calls | Where does every allocation stand: faculty reply, deadlines, last follow-up, submission? | `assignedCalls.ts` |
| Pendency | Which directly matched calls had nobody allocated, and whose school were they? | `pendencyReport.ts` |
| Follow-ups | What follow-up effort went in, week by week, per member and per allocation? | `followUpReport.ts` |

All four share `hubScope.ts` and `hubHandler.ts`. They are served from `GET /api/funding-dept/reports/{incoming-calls|assigned-calls|pendency|follow-ups}`, and each supports `format=csv|xlsx`.

## Definitions

Each definition lives in `reportDefinitions.ts` as SQL and TypeScript. The glossary copy is in `reportGlossary.ts`.

- **Action status** is set per call and school. Only the coordinator's manual mark can make it *Completed*. Any recorded review, shortlist, allocation, follow-up or named action makes it *In progress*. A call row shows its least-advanced school.
- **Pendency** means at least one automatic strong or moderate faculty match in the school, first seen by the deadline day. There must be no allocation that was taken up, no independent application, and no "not relevant" decision.
  - The states are Missed, At risk (14 days or less) and Pending.
  - A coordinator mark without an allocation is listed but not counted.
  - This is **not** the escalation ladder's "untouched" rule. The ladder still uses `untouchedSql`.
- **Follow-up weeks** run Monday to Sunday, India time. TRIAGE history rows are excluded. A logged reminder counts as a follow-up (and is also shown on its own). An allocation counts in a week only if it was still open at the end of that week: a decline closes at the faculty reply, a lapse when it lapsed, a submission when it was submitted. Allocations in a school with no coordinator are counted under "No coordinator".
- **Responsible coordinator** is a per-call transfer owner while that person is an active member who still covers the school, otherwise the school's primary member. The Overview, Call Register and hub all use this rule.

## Scope

- A coordinator sees their primary schools. If they also cover schools as deputy, a **Portfolio** switch shows those instead (`portfolio=deputy`). The two are never added together.
- The head's **DSR member** filter narrows Incoming, Assigned and Follow-ups to that member's primary schools. Pendency instead filters by responsible coordinator, so each by-member number opens exactly its rows.
- Every summary tile opens exactly the rows it counts. "Submitted this month" uses `submittedIn=month`. Deadline filters (`due`) only apply to live allocations.

## Actions added

- `POST /api/funding-dept/calls/[callId]/action-status` with `{ schoolIds, completed, note }`. It stores the mark in `call_school_triage.action_completed_*`, stamps `decided_at` if it is empty, and writes a `dsr_events` REVIEW row (`ACTION_COMPLETED` or `ACTION_REOPENED`).
- `PATCH /api/assignments/[id]` accepts a `cancelReason` with `CANCELLED` ("Unallocate"). It logs a NOTE follow-up and moves the candidate back to SHORTLISTED.
- `GET /api/funding-dept/calls/[callId]/schools` feeds the call window's "All schools" panel.

## Old pages

- `/funding-dept/queue` redirects to Incoming Calls.
- `/funding-dept/assignments` redirects to Assigned Calls with "allocated by me".
- `/funding-dept` redirects to the hub.
- The pendency escalation notice and the tenant-admin oversight cards now link into the hub.

## Release

1. `prisma migrate deploy`. Order matters: first `20260925100000_dsr_call_school_mappings`, then `20260925110000_manual_call_allocations`, then `20260926100000_call_action_completion`. The last one is additive: three columns plus an index on `call_school_triage`.
2. Restart the app so the regenerated Prisma client loads.
3. Verify on a disposable clone. This never touches working data:
   `node ./node_modules/tsx/dist/cli.cjs scripts/verify-dsr-reports-hub.ts` (51 checks)

## Time zones

The match census (`currentMatches.ts`) and the opportunity snapshot now write `funding_opportunity_matches` timestamps as UTC, like the ORM does. Before this, a Postgres session in Asia/Kolkata stored them 5½ hours ahead. Rows already written that way keep the skew; they only move Pendency's "days unallocated" and the deadline-day cut-off by a few hours.
