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

## Full review and authorized final decisions — 21 October 2026

At the user's request, all 1,528 blocking pending conflicts were covered with
GPT-5.4 mini: 54 fresh completed reviews were reused and 1,474 items were run
in 30 batches. One validation-feedback retry recovered 155 of the initial 206
failed responses. The final analysis had 1,477 valid recommendations and 51
rejected outputs. No calls, conflicts, sources or alerts changed during analysis.

Operator entry points `finalDecisionPolicy.ts` and `finalizeAiReview.ts` implement
the user's explicit authorization to apply safe final decisions. This does not
relax the UI's existing bulk-approval gate. Both sides must be imported catalogue
records, and the subject must still be staged. Transactions lock and recheck
current inputs. Distinct-opportunity decisions require the narrow existing gate
or >=95% confidence with corroborating funder/source/title or round/date facts;
source, eligibility and other unresolved conflicts stay held. Archiving requires
>=98% confidence and exact matching identity, descriptive, eligibility, amount,
date, discipline and country facts, with no attached work. No physical deletion
or publication is performed. An integration test specifically verifies protection
of a non-FK intake reference. The relevant suite has 85 passing tests.

The final dry plan qualified 122 distinct-opportunity resolutions and no exact
duplicate archives. All 122 were applied, with no skips. This cleared 102 calls:
102 imports are now STAGED/CLEAR, 1,628 remain STAGED/NEEDS_REVIEW, and the same
8,390 remain PUBLISHED/CLEAR. There are 1,406 remaining blocking conflicts:
1,355 require individual assessment and 51 have no accepted AI result. A valid
AI output is not by itself sufficient to safely resolve conflicting facts.

Before applying, a checksum-verified focused backup of the five affected tables
was saved (about 100 MB), together with a write-ahead decision journal. Artifacts
and completion markers are under `backups/catalog-final-review-20261021/`:
`manifest.json`, `final-decision-plan.json`, `before-final-decisions.dump`,
`decision-journal.jsonl`, `apply-progress.json`, and `final-summary.json`.
The earlier full database backups remain retained. Never restore over a live
database as a shortcut; use the journal and an isolated restore for recovery.

Post-apply digests prove all call factual content, source content and provenance
were retained, no original conflict record was deleted, and alerts did not
change. Full-row comparisons preserved all 238 intake calls, 74 assignments,
10 triage rows, 11 follow-ups, 412 events, 250 school mappings, 856 users and
10 tenants. Publication is still a separate explicit action.


## Collective human approval

The review screen now offers **Approve entire batch (all pages)** and **Approve all completed batches**. Both show a confirmation with same/separate recommendation counts before any writes. This is explicit human acceptance of reviewed predictions, independent of the conservative automated confidence gate. Uncertain, invalid, failed and already approved results are excluded. Result filters and pagination do not restrict these whole-batch actions.

Separate decisions keep both calls. Same decisions archive only the staged imported subject, preserving the record and linking its sources to the survivor. Intake rows are never archived; attached work blocks archival. Existing conflict repointing keeps chain comparisons open. Every approval rechecks locked current content, open conflict state and import status, and records the actor/time/note. Other blockers and publication remain separate; suggested facts are not applied.

The browser sends bounded chunks of ten frozen result IDs with confirmation hashes, displaying progress and skip reasons. Keep the page open; if interrupted, preview again to continue (already committed approvals remain saved). No schema migration required. Building this UI does not itself approve production records.


The **AI confidence above (%)** filter applies to both saved result pagination and collective approval previews, defaulting to strictly greater than 90%. Blank includes all scores. A result at exactly 90% is excluded from a 90% cutoff. The server validates the range and applies the same cutoff during confirmation; confidence remains a self-reported score, not measured accuracy. Collective approval uses the newest accepted result per conflict within its selected batch scope, and does not fall back to older high-confidence results when the newest result falls below the cutoff.

### Production deployment and human approvals — 22 October 2026

Deployed `cd16997` with the confidence filter and collective approval controls; rebuilt the incoming app and restarted only `grantmentor`. Health, authenticated directory search, confidence-filter pagination and superadmin API checks passed. Local validation: 32 focused tests and TypeScript passed. No schema migration or additional model requests were needed.

A fresh focused six-table backup and checksum are retained under production `backups/catalog-collective-20261022/`, alongside the plan, write-ahead approval journal, per-item outcomes and preservation checks. During the build, an intake call was edited through the existing workflow (guideline approval, discipline and save metadata). A comparison against the backup found no missing intake records; the change was documented and a fresh baseline captured. No live data was restored or overwritten.

With the user's explicit acceptance of the reviewed predictions, applied **1,174 decisions strictly above 90% confidence**: 1,036 separate-call decisions and 138 same-call decisions. Four stale/already-resolved results were excluded from the initial plan; seven further results changed during processing and were skipped. No stale decision was forced. Confidence is a model score, not calibrated accuracy.

Final state: 10,359 call records retained (239 intake and 10,120 imported). Imported calls: 8,390 published/clear, 1,225 staged/clear, 365 staged/needs-review, 140 rejected/archived. The 140 total includes previously archived records; this run applied 138 same-call archival decisions. There are 208 blocking conflicts still open. Call and source factual digests, alert digest, published count and original conflict IDs passed preservation checks; every captured intake/DSR/user/tenant row stayed unchanged during approval. Other PM2 processes retained their PIDs. Publication and embeddings for newly cleared calls remain separate.

### Publication of cleared calls — 22 October 2026

At the user's explicit request, published the exact frozen set of **1,225 staged/clear imported calls** after checking that no blocking conflicts remained. Generated all 1,225 search embeddings first, using only **Voyage `voyage-4-large`, 1,024 dimensions**, with the app's document input builder. Publication used the existing guarded release function, run `cmvj4s5y000y1grecqo1opklv`; all changes have release history. No app restart or deployment was needed.

Production now has **9,615 published imported calls**, 365 still staged for review, and 140 archived imported copies. All 10,359 call records remain. Notifications stayed suppressed; no alerts were created. Full-row intake/DSR/user/tenant checks, call factual-content digests, source/conflict/alert digests, other PM2 process checks and authenticated directory search passed. Audit verified all 1,225 newly published rows have the expected Voyage vector/version and **zero legacy embedding vectors**.

Focused pre-publication backup, checksum, frozen IDs, embedding progress, release result, summary and Voyage audit are retained in production `backups/catalog-publish-20261022/`. Completion marker `COMPLETE` exists. Do not rerun this operator; any subsequent publication needs a fresh selection and audit.
