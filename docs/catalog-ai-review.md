# AI import review

Superadmin → Funding → AI Import Review (`/admin/funding/ai-review`). Only a
writing Superadmin may read or operate the module; tenant admins, platform
funding operators and Superadmin viewers are refused at the API boundary.

Filter pending blocking conflicts, preview the selection and select all matches
or individual review items. All matching includes results beyond the first 100
shown. The batch limit defaults to 100. Counts distinguish review items from
unique calls. A model picker checks supported models against the OpenAI account.
GPT-5.4 mini is the default ($0.75 input/$4.50 output per million tokens).
GPT-5 mini is an explicitly labelled deprecated economy option ($0.25/$2.00),
available only while the account retains access. Rates were verified against
official model cards on 21 October 2026. Preview estimates use approximate input
tokens and an 8,192-token allowance for completion including medium-effort
reasoning. Estimates are not spend ceilings; retries can add cost. The selected
model is stored on each batch and shown in batch details; it cannot be switched
partway through a batch. Provider errors never silently fall back to Gemini.

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
`OPENAI_API_KEY`; it processes only explicitly created active batches. Historical
Gemini batches retain their model and require `GOOGLE_AI_API_KEY` if resumed.
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
Prisma client and deploy the application. Deploying the module does not itself
start paid reviews or change calls.

Validation: `scripts/verify-catalog-ai-review.ts` uses a schema-only disposable
local database and mocked provider responses. It verifies the actual migration,
selection, duplicate-batch refusal, concurrent claiming, usage persistence,
approvals, unchanged intake, surviving blockers, stale inputs and zero alerts.

## Production pilot — 21 October 2026

Application commit `a5a20d5` was deployed to Grapsi on patentnest, and
`grantmentor` restarted successfully. A fresh full Grapsi backup and checksum
are retained under `backups/catalog-ai-review-20261021/`. Health, authenticated
search, existing-record preservation and unchanged catalogue fingerprints passed.
Other applications' process IDs remained unchanged; no other database was modified.

Real Gemini 2.5 Flash trials exposed output-shape problems, unsupported suggestions,
and confusion between missing-fact audits and pair comparisons. The deployed
fixes constrain the provider's response schema, verify suggested values against
verbatim evidence, bound long quotes only after confirming the full quotation,
and explicitly distinguish single-record audits. Earlier batches are cancelled
and retained for audit; they must not be treated as successful evaluations.

The final pilot batch `cmvi53z350001heulilh0ws59` covers 12 conflicts involving
20 unique calls. Seven recommendations passed validation (three same-opportunity,
three separate-opportunity, one needs-information); five outputs were rejected
by evidence checks. No recommendation qualified for bulk approval. No approval,
merge, publication, call edit, source edit, conflict resolution or alert occurred.
All call/conflict/source/alert fingerprints remain identical to the pre-deployment
snapshot. Results are visible in the Superadmin module's saved batches.

This pilot establishes operation and fail-closed behavior, not reliable unattended
resolution. In particular, the model called complementary eligibility listings
separate opportunities despite describing the same programme; the conservative
bulk-approval gate refused that result. Use assisted review and targeted retries;
do not automatically approve the backlog based on this pilot.

## GPT picker and comparison pilot — 21 October 2026

Application commit `a80d45d` deployed the account-verified GPT picker and strict
OpenAI structured outputs. No additional migration was needed. New batches
default to GPT-5.4 mini; the picker can select GPT-5 mini, with a deprecation
notice. Both options were confirmed available to the production account.

The same 12 conflicts (20 calls) were reviewed with GPT-5.4 mini in batch
`cmvi5mgr80001133vxepvmg8a`: 11 passed validation, one was rejected (empty
evidence quote). The valid recommendations comprise six same-opportunity, two
separate-opportunity and three needs-information results. Unlike the earlier
Gemini result, GPT identified the G.E.R.M. eligibility variants as one programme
with inconsistent eligibility wording. This is a small qualitative comparison,
not a calibrated accuracy evaluation or justification for unattended approval.

Usage: 21,733 input tokens and 12,501 completion tokens including reasoning,
approximately $0.07255 at uncached published rates. A separate one-item real
GPT-5 mini review through the API verified that UI/API model selection pins the
chosen model on the saved batch and completes successfully. Model-specific
previews were checked to reflect different prices. Anonymous API access was
rejected; the page and authenticated APIs returned successfully.

No recommendation was approved. Original call, conflict, source and alert
fingerprints remain unchanged. Health, search and captured intake/DSR/user
preservation checks passed after the app restart. The final local checks include
71 relevant tests, typechecking and the disposable-database rehearsal.
