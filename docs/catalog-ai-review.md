# AI import review

Superadmin → Funding → AI Import Review (`/admin/funding/ai-review`). Only a
writing Superadmin may read or operate the module; tenant admins, platform
funding operators and Superadmin viewers are refused at the API boundary.

Filter pending blocking conflicts, preview the selection and select all matches
or individual review items. All matching includes results beyond the first 100
shown. The batch limit defaults to 100. Counts distinguish review items from
unique calls. Preview estimates use approximate input tokens and a 2,048-token
output allowance at Gemini 2.5 Flash's published $0.30/$2.50 per million rates
(21 October 2026). Estimates are not spend ceilings; retries can add cost.

Each batch snapshots its inputs, actor, model, selection and content hashes.
An advisory lock prevents overlapping unfinished batches. Claiming work locks
the batch row; expiring leases and token-guarded completion support recovery
and prevent concurrent workers from completing one another's work. Provider
requests time out after 60 seconds; leases last 120 seconds. Failed items can
be explicitly retried, with at most three attempts per item.
Provider errors, network failures and timeouts pause the batch, preventing an
outage or quota limit from generating repeated requests across the queue.

The open page processes one item at a time. Closing it retains progress and
stops new browser-driven requests. Reopen a saved batch and select Resume.
For processing while the browser is closed, optionally run:

```
node node_modules/tsx/dist/cli.cjs scripts/catalog-ai-review-worker.ts
```

Run the optional worker under the app owner, with Grapsi's environment and
`GOOGLE_AI_API_KEY`; it processes only explicitly created active batches.
`--once` processes at most one item. Pause/cancel stop new claims; a request
already running may complete and its result remains auditable. Cancelled
batches cannot resume. No additional service is installed automatically.

The analysis covers duplicate listings, distinct rounds/stages, related schemes,
funder, deadline, amount/currency, eligibility, country restrictions, source
conflicts, missing information and insufficient evidence. It sends stored text
only, uses no website/search tools and treats source text as untrusted. Exact
evidence quotes and output schema are checked. Input hashes include complete
selected content even where provider text is truncated. Recommendations and
usage are saved separately; suggested facts never edit call data.

Only explicitly approved, >=95% confident distinct-round/related-program results
with evidence on both sides can clear a duplicate pair in bulk. Approval locks
and rechecks inputs and call state, writes the conflict resolution and refreshes
import review gates atomically. Other blockers remain. Intake calls are never
edited. Publication, duplicate merges, rejected calls and factual corrections
remain individual explicit operations in the existing import review screen.
AI confidence is not a calibrated accuracy guarantee; assess a pilot before
approving a large set. No notification or publication occurs during AI review.

Deploy the additive `20261021130000_catalog_ai_review` migration, generate the
Prisma client and deploy the application. This change does not start paid
reviews, deploy itself, or alter production data. Production remains on the
previous catalogue deployment until this module is separately deployed.

Validation: `scripts/verify-catalog-ai-review.ts` uses a schema-only disposable
local database and mocked provider responses. It verifies the actual migration,
selection, duplicate-batch refusal, concurrent claiming, usage persistence,
approvals, unchanged intake, surviving blockers, stale inputs and zero alerts.
