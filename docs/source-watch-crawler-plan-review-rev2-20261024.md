# Source Watch revision 2: plan review

Reviewed 24 October 2026 against the complete 375-line attachment and the current working tree. This is a design and static code review; no production state, provider billing, or live crawler performance was tested.

## Verdict

Revision 2 fixes the principal architectural problems in revision 1: resource versions, round-aware matching, evidence bundles, platform billing, budget reservations, durable handoffs, bootstrap backlogs, explicit coverage, and shadow rollout are all substantially better specified. Proceed with the foundation after resolving the execution contracts below. A further expansion of the architecture is unnecessary; the remaining work is mostly tightening boundaries and verifying reused code.

It is not yet justified to claim hard cost bounds, exactly-once external effects, or reliable freshness at publication. The most concrete new discovery is that the proposed local PDF parser already performs hidden paid transcription.

## Required corrections

### 1. P1 — The proposed local parser can make unreserved LLM calls

Plan lines 143–146 propose `parseFundingDocument` as the local PDF parser, with selected OCR/multimodal work as a later controlled step. The existing function does not maintain that boundary:

- `src/lib/fundingDocuments/parser.ts:142` loops over every PDF page.
- At `:158`, a page containing fewer than 30 non-whitespace characters automatically triggers gateway transcription.
- At `:105`, each transcription builds a file content part from the entire PDF, even though the prompt asks for a particular page.
- At `:123`, transcription failures are caught and converted into empty text.
- `parseFundingDocument` at `:212` exposes no local-only, selected-pages, or maximum-pages options.

A scanned or mostly blank document can therefore make many paid calls, repeatedly submitting the PDF, before the planned OCR reservation and selection logic runs. A failed transcription can also look like successfully parsed empty content.

**Required change:** split local parsing from transcription. Make local-only behavior explicit and default for the monitor, with selected page ranges and enforceable page/time/memory limits. Return statuses such as NEEDS_OCR and PARSE_FAILED. Paid transcription must receive a reservation/attempt context and submit only selected pages or a bounded crop, with content-hash reuse. Cancellation must stop the underlying parser, not merely time out its caller.

**Test:** a scanned 30-page fixture produces zero model requests in local-only mode; transcribing two selected pages produces only the permitted attempts and does not submit the original 30-page PDF twice.

### 2. P1 — Budget enforcement must cover actual attempts below the gateway

Plan lines 154–157 reserve an estimate using the worst allowed fallback and settle an ambiguous timeout at the estimate. That is insufficient to establish a hard bound if lower layers retry or fall back independently.

Current code already does this: `src/lib/metering/providers/gemini-provider.ts:288` permits three attempts inside one provider call. A response with an empty output throws at `:329` and enters the same retry loop, even though the response can carry billable usage. The router then tries additional models (`src/lib/metering/providers/provider-router.ts:585`). The monitor could see one logical operation while several billable requests have occurred.

**Required change:** centralize attempt control or expose a monitor execution policy that disables hidden SDK/provider/router retries. Persist each attempt separately, including unsuccessful requests with known usage. Before every possible paid attempt, reserve its conservative maximum or reserve the sum of all permitted attempt maxima up front. Include supported reasoning/output limits and document/image charges; an expected input-token estimate is not a maximum. Each fallback must remain inside the allowed model/account/cost policy.

Keep an uncertain charge reserved until reconciled or conservatively booked at its upper bound. A retry needs an additional reservation. Define orphan reservation recovery, process crashes after dispatch, midnight rollover, pricing-version changes, and settlement idempotency. Known charged usage must not disappear when a response fails validation.

**Test:** a billable empty response, an ambiguous timeout, an internal retry, and a successful fallback all appear as separate attempts and cannot exceed the total reserved allowance. Repeat with concurrent tasks and a day boundary.

### 3. P1 — Separate recurring fetch keys, reusable computation keys, and external delivery semantics

Plan line 88 defines the unique task operation key as resource version + stage + processing versions. That is suitable for deterministic work on an already known evidence version. It cannot also identify recurring CHECK/REVISIT tasks: a completed fetch of an unchanged resource would keep colliding with the next scheduled fetch, before the system can discover a new version. A source's initial discovery may not even have a resource version yet.

**Required change:** specify keys by task kind:

- CHECK/REVISIT/DISCOVER: source or resource + scheduled occurrence/check generation.
- PARSE/TRIAGE/EXTRACT/EMBED: actual input fingerprint + applicable processing versions.
- HANDOFF: opportunity/review revision + intended action.
- NOTIFY: event + recipient + channel.

An ordinary retry reuses the operation key; a deliberate new occurrence or revision gets a new one. Define how a deliberate replay differs from retrying a DONE or DEAD task.

The invariant at line 40 should promise at most one committed local result/handoff. A database key cannot guarantee a single provider charge or email delivery across a crash after external acceptance but before local acknowledgment. Use provider idempotency where supported and otherwise document bounded duplicate risk or the chosen delivery tradeoff. Keep attempts separate from the one accepted result.

Fencing must cover the actual domain writes, budget actions, intake creation, and downstream task inserts in the same guarded transaction. An idempotent intake handoff alone does not prove that a worker with an obsolete lease cannot create its first handoff. Check expected generation and RUNNING state, define expiry semantics, and roll back on a failed fence.

**Test:** two unchanged scheduled revisits both execute their fetch, while repeated extraction of identical inputs reuses its result. Pause a worker just before handoff, reclaim its lease, then resume it: the obsolete worker creates no new effects.

### 4. P1 — Freshness and expected-version checks must be implemented in the shared write services

Plan lines 181 and 203–205 include stale-evidence flags and expected-version checks, but their exact enforcement is not defined. A flag set only when a new content version is observed stays false when a source has not been successfully checked for a week. “No observed change” does not mean “recently verified.”

The existing update and publish methods read the call, perform work, and later update by ID alone (`src/lib/services/fundingCatalogService.ts:731`, `:812`, `:827`, `:912`). They expose no expected-revision parameter. A check in the Source Watch UI or route can pass and still allow a concurrent edit to be overwritten later.

**Required change:** store the last successful validation time and status for each required evidence resource; a 304 refreshes that validation time without creating a content version. Define an allowed freshness window and behavior for unreachable/truncated evidence. In the central write service, require the expected call revision, review revision, and evidence-manifest version, and use them in the actual database mutation. Enforce this on single and bulk actions, API calls, retries, and alternate UI paths. Human overrides, if supported, require explicit reason and audit.

Also define the imported-catalog update path: the current `publishFundingCall` explicitly refuses imported calls at `:838`. Most catalog matches may therefore require a reviewed update with provenance rather than the normal publish endpoint. A deadline correction must not reactivate a rejected/archived call or overwrite curator-owned fields incidentally.

**Test:** change a call after validation but before the final write; it fails with a conflict. An unchanged but unsuccessfully validated source is reported as stale/unknown. A reviewed update to an imported call preserves its origin and selected-field provenance.

### 5. P1 — Cache keys need the complete effective input, including context

Plan line 92 hashes stage/model/prompt/schema/policy versions and evidence. It does not explicitly define evidence hashing, site-specific settings, funder context, or mutable catalog matching context. Reusing identical PDF text across a shared portal and a confirmed funder site can yield different attribution or relevance when that context is supplied to the model. Adding a corrigendum must invalidate extraction even when the landing page does not change.

**Required change:** give each stage a canonical input manifest. Include selected resource hashes, document roles, evidence anchors, context snippets, parser/selection versions, and all site/audience/funder configuration that influences the result. Exclude volatile retrieval timestamps from semantic cache identity. Record the actual fallback model and routing-policy version so accepted fallback results remain reusable under the same policy.

Keep classification caching separate from current-catalog candidate retrieval: an unchanged funding classification can be reused while inexpensive association lookup runs again against current catalog state. Cache embeddings by the actual embedding text, model, task type, and dimensions; a relevance-policy bump alone need not regenerate an unchanged embedding.

Define conservative meaningful-text hashes in addition to raw file/page hashes, so a changing visitor counter or reorder does not repeatedly trigger model work. Preserve the raw version for audit. Process time-dependent deadline status deterministically without a new model call.

**Test:** identical inputs share a result across watch points; changed site relevance settings, funder context, selected annexures, or parser output invalidate only affected stages. Reordered incidental markup and a policy change unrelated to embedding text do not trigger new embeddings.

### 6. P2 — EXPIRED resources need a low-frequency reopen path

Plan line 166 revisits resources linked to OPEN, FUTURE, ROLLING, and UNKNOWN calls. EXPIRED calls are excluded. A funder may reuse the same page and “Apply now” link for a later round without changing the listing text or a useful sitemap timestamp. Once the old round expires, the resource can fall out of tracking and the new round remains invisible.

**Required change:** distinguish current call status from a resource's continuing role as a scheme landing page. Keep cheap conditional probes for confirmed recurring scheme URLs and a post-deadline grace period; increase frequency around expected opening seasons where justified. Put old UNKNOWN/ROLLING resources under a bounded long-term revisit policy too, so their inventory does not grow unchecked.

**Test:** an expired call's unchanged listing points to a reused URL whose details now announce the next year. A scheduled probe discovers the new round.

### 7. P2 — The asynchronous URL index leaves a duplicate-creation race

Plan line 133 refreshes catalog/intake URL keys incrementally using `updated_at`. Two discoveries from different mirrored/related hosts can both miss a newly created intake/call association before the refresh runs. Unique handoff keys prevent repeated handoff for one opportunity, but do not merge two independently created opportunity rows. Time-only cursors can also mishandle tied timestamps and do not by themselves handle deleted aliases.

**Required change:** update important URL aliases and pending handoff associations transactionally with their writes, or record reliable change events. Use an ordered `(updated_at, id)` cursor with overlap/reconciliation if polling is retained, plus explicit deletion handling. Perform a final authoritative association check at handoff. Define a unique identity/claim for confident exact call-round matches; ambiguous matches remain reviewable rather than being forced into a merge. Run a final duplicate check before publication for findings that waited in review.

**Test:** two discoveries arrive while the URL index is deliberately stale; only one intended call-round draft is created, or the pair is explicitly held for duplicate review. Alias edits/deletions and tied timestamps converge correctly.

## Tighten these specifications during foundation work

1. **Browser enforcement.** DNS pinning in an Undici agent does not pin Chromium's connections. The OS-level egress rule must be a mandatory tested boundary for the entire browser process tree, including redirects and subresources. Define WebSocket behavior separately; Playwright has a separate [WebSocket routing API](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket). Treat browser responses as byte/time/request-budgeted too, and close contexts on timeout or lease loss. State the fresh-context and Chromium sandbox policy explicitly. Charge pacing/cooldown to the actual destination host, including shared attachment hosts and related hosts. The plan already includes egress restrictions; this is a request to make their enforcement and exit tests precise, not a request to add another security subsystem.

2. **Robots state.** Cache is per origin, user agent, and policy context, not just host; HTTP/HTTPS and approved alternate ports can have different policies. For a robots 429, shared overload cooldown must take precedence over the broad “4xx allow all” branch. Apply safe fetching to robots itself without recursive robots checks. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3) permits access when robots is unavailable; the crawler may choose the more conservative overload policy. A general-news feed must still be shown to cover calls before it replaces a scoped listing.

3. **Unicode tokenization.** `\p{L}\p{N}` alone omits combining marks used in Hindi and other scripts. Specify Unicode normalization and combining-mark-aware tokenization (`\p{M}` where appropriate), then test actual word boundaries and variants rather than only confirming the absence of ASCII stripping.

4. **Evidence and partial parsing.** Segment IDs, roles, URLs, and versions should come from a trusted manifest; remote text must not be able to forge `[[S3 | role=CORRIGENDUM ...]]` boundaries. Check returned quotations against the referenced segment, beyond checking that a URL exists. “Head of one document” is triage evidence, not proof that eligibility/deadline facts later in the document were read. Model MISSING_EVIDENCE and PARTIAL separately from irrelevant or complete. Include withdrawal/cancellation and reopening, which an explicit past close date alone cannot represent.

5. **Retention.** Pinned evidence must survive while review/publication audit requires it, but should not mean permanent unlimited retention. Define reference-counted unpinning, retention periods, storage quotas, orphan blob cleanup, and garbage collection of task/cache history. A task table used as an outbox needs dispatched/completed retention rules so cleanup does not accidentally permit duplicate effects.

6. **Recall claims.** Auditing sampled negatives estimates errors among observed and filtered candidates. It does not establish recall for calls never reached by discovery or omitted during document selection. Report stage-specific recall and false-negative estimates separately, with sampling weights where needed. Maintain an independent manually verified list of official announcements for a held-out site/time cohort to test end-to-end discovery. State the denominator and uncertainty on the UI's recall metric.

7. **Phase dependencies.** Phase 1 requires pagination/sitemap continuation exit tests, but the necessary frontier/cursor implementation appears in Phase 4. Move minimal continuation into Phase 1; reserve scaling and exploration refinements for Phase 4. Phase 2's manual “Draft it” depends on Phase 3's bounded, platform-billed handoff; move the button to Phase 3 or explicitly constrain it to an isolated legacy path with clearly different guarantees. Add actual precision/recall, budget, and queue-age acceptance thresholds before enabling autodraft; passing behavioral examples alone does not establish classification quality.

8. **Legacy cutover and rollback.** One existing source reduces data volume, not integration risk. Specify when the old checker, Check-now handler, preview endpoint, direct triage path, and scheduler stop executing. Backfill active source configuration and pending review state, preserve old links, and make the transition restart-safe. A rollback must not restart the old paid path alongside the new worker. Carry policy enforcement into every paid path used by source-watch-origin jobs, including later manual retries and core extraction recovery.

## Recommended next step

Amend the plan with the local-only parser API, provider-attempt accounting contract, task-kind key definitions, stage input manifests, and central publish/update compare-and-set semantics. These are the contracts most likely to force costly rework if deferred. Then implement the foundation with the browser included, using the small representative cohort and shadow rollout already proposed.

Do not add more autonomous agent loops, LLM source selection, or a separate model-based verifier to address these issues. Deterministic state management, bounded evidence acquisition, and measured exceptions are sufficient. The architecture already contains the necessary components; the remaining concern is whether their guarantees survive integration and failures.
