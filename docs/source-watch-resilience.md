# Source Watch reliability upgrade

Production owns all evidence, jobs, results, attempts and review state. Worker 1.1.1 pulls work over the existing IAM/IAP connection. It needs no inbound laptop port. `MONITOR_LOCAL_SCREENING_REQUIRED=true` holds new paid screening until a result for the current source version and text hash exists. Laptop inactivity never enables a paid fallback. Already screened extraction work can continue within existing budgets.

Keep `MONITOR_AUTO_DRAFT_ENABLED=false`, notifications off and the existing $2 platform, $0.25 site and $1 bootstrap daily limits during validation. Publication remains an explicit curator action.

## Evidence and identity

The v2 local contract uses one lightweight pass for CALL/RELATED/GENERAL/UNSURE, at most two proposed titles, stated opening/closing dates and exact quotations, invitation quotations, multiple-call and incomplete-evidence flags. Production removes unsupported titles, ambiguous/unquoted dates and unsupported invitations once and retains warnings. Model headings and dates never replace accepted catalogue facts or establish identity/open status. Long pages use bounded sections around observed funding/application/deadline text. Omitted content is marked.

Results bind source version, raw/text/input hashes, pinned model SHA, policy and assessment date. Old results and encrypted Windows outboxes remain readable; legacy clients may upload saved results, but only the new protocol can claim title jobs.

URL matches use approved identity keys and observed redirects, funder and explicit round/reference information. A similar title only retrieves candidates. Differing references remain ambiguous; explicit differing rounds stay separate. Published primary evidence can skip all paid work only when complete text matches exactly and no unfetched attachments remain. Otherwise extraction proposes an update. Recheck identity under the handoff lock before making any draft.

Extraction v2 uses explicit nullable schemas, short E1/E2 evidence IDs, quotations, grounded identity, invitation and current-window checks. Empty extraction means `NEEDS_EVIDENCE`. Unsupported optional values are null with warnings. Amounts are optional. Dates and conflicting identity remain unresolved. Gemini is primary, with the configured independent Haiku fallback. Request rejections preserve status/code/request ID; reasoning-only text is excluded; empty billable responses preserve usage. Definitive configuration failures are not resubmitted unchanged. Successful paid receipts survive interruption between model response and cache storage.

Caches include complete captured evidence, extraction schema, prompt and routing versions. One shared claim holds identical extraction input while a worker runs; expired claims can be recovered. Claims last ten minutes, longer than the bounded five 60-second provider attempts. Stored dates recalculate lifecycle without another paid call. Intake reuses the validated payload.

## Operations

Superadmins use Source Watch → Sites to pause/resume sources and Health to inspect crawler/laptop status and replay a particular retained failure. The laptop window has Start/Pause and retains encrypted pending uploads after power loss. Startup is optional. Offline warning: three minutes; ageing backlog warning: six hours. Known update/deadline hints and aged work get priority. A GENERAL result never suppresses a page; deterministic samples remain available for audit.

Discovery follows actual approved links from listing/promotional/uncertain pages. Health retains unreadable evidence, observed funding links requiring related-host approval and exploration capacity gaps. Provider and budget deferrals have separate queue states. Approval of a related host resolves the retained dependency when encountered again. Existing scope and network restrictions remain enforced.

## Upgrade and rollback

Apply additive migrations `20261025100000_local_titles_and_shared_extraction` and `20261025110000_monitor_coverage_gaps` after protected backup and a restored-database rehearsal. Generate a fresh Prisma client and build in an isolated checkout. `tools/local-worker/stage-resilience.sh` only stages/builds; it cannot activate the release. Keep the previous server build, dependency path, broker target, environment and worker EXE for rollback. Preserve the worker's private folder and outboxes when replacing its EXE. Allow only currently approved active sites in the broker configuration.

Activation must update the web release, crawler runtime symlinks and broker together; enable local-first only with the current worker available. Rollback restores previous targets and disables the new local-first flag, retaining additive columns and collected results. Do not bulk-reset failures or release historical uncertain money reservations.

Worker 1.1.1 retains the 1.1.0 policy in a frozen module for saved submissions and duplicate acknowledgements. Older workers receive their original policy for outbox recovery but cannot claim new jobs. The new policy preserves literal source quotations while accepting title capitalization differences, selects main-body context before repeated navigation, and marks only genuine omissions. Model, prompt, response schema and date safeguards are unchanged. No schema migration is needed for this patch.

## Pilot

`tools/local-worker/export-pilot.cjs` exports a read-only corpus of published catalogue source evidence and captured crawler pages. Published membership is a provisional funding reference, not an independent source/window label. Adjudicate each row's `expected` values against its evidence and set `reviewed=true` only after that review.

`node tools/local-worker/pilot.cjs --dataset=<absolute JSON path> --endpoint=http://127.0.0.1:11535 --key-file=<private API key path> --out=<absolute JSONL path>` runs the pinned local model with the production prompt/schema. Results are flushed after every page and resume by policy/input hash. It never spends cloud money or changes catalogue records. The report refuses acceptance readiness without 300 adjudicated pages and 100 genuine reference calls. Local retention is distinct from measured end-to-end recall. Deadline accuracy, final precision and cost per usable extraction require reviewed cloud outcomes; unknown metrics remain null.

Before broader rollout, record title accuracy, final opportunity precision, missed-call risk, deadline accuracy, extraction cost and queue age. Demonstrate a current real source → reviewed unpublished draft and a proposed existing-call update. Keep negative-result suppression disabled even after this upgrade.

For the focused patch, `tools/local-worker/focused-validation.cjs --corpus=<original corpus> --results=<original JSONL> --audit=<19-case audit JSON> --out=<absolute output folder>` verifies the old policy/input hashes and revalidates saved raw responses against the original packed inputs without inference. Its separate 19-page corpus is used for a fresh packing comparison. Keep the 300-page baseline immutable and report both experiments separately; neither replaces the missing independent acceptance labels.
