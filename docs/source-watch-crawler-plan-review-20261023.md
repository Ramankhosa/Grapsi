# Source Watch crawler plan review

Reviewed 23 October 2026 against the complete attached plan and the current working tree.

## Verdict

The architecture can support useful, economical funding discovery: deterministic discovery, an item ledger, selective LLM use, durable work, and human publication are good choices. It is not yet robust or cost bounded as specified. The most consequential omissions concern changes at existing URLs, recurring calls, the actual intake source contract, durable idempotency, and spending limits before drafting.

This was a static design and code review. Production database counts, scheduler state, billing history, and the presence of the PLATFORM tenant were not independently checked. The plan's September operational observations must be rechecked before an October rollout. No application code or production state was changed.

## Changes required before implementation

### 1. P1: Treat an item as a versioned resource, not simply a previously unseen URL

Plan: target pipeline and Phase 2.2, 2.4, 2.6.

The plan's early URL dedup marks any catalog URL as DUPLICATE. That removes precisely the URLs needed to discover deadline extensions, revised eligibility, withdrawals, and new annual rounds. The same scheme can reuse a URL indefinitely. Conversely, two highly similar titles can refer to different rounds or distinct awards; a vector neighbor is not proof of an update.

Separate resource identity, observed version, scheme, and call round. Store a normalized item-context hash and detail/document content hashes. A known URL with unchanged evidence can skip processing; changed evidence becomes a possible update or new round. Revisit active call pages and attachments even when the listing link stays unchanged. Compare funder, reference number, round/year, dates, and source evidence before proposing a merge. Similarity should retrieve candidates; ambiguity goes to a reviewer. Existing published fields must not be overwritten automatically.

Text-only synthetic items need their own identity column. `source.url#t-<hash>` conflicts with the instruction to remove URL fragments during canonicalization and can collapse distinct changes.

### 2. P1: Fix the intake contract; attaching a PDF does not make core extraction read it

Plan: Phase 2.7.

Current core extraction prepares only `details_source_key` and passes its normalized text to `extractFundingOpportunity`. Separate guideline/template sources are prepared in the `extractAll` branches. With the proposed `extractAll: false`, a small landing page plus a separate guidelines PDF does not provide the PDF's facts to core extraction.

Evidence: `src/lib/fundingIntake/service.ts:3123`, `:3147`, `:3192`. `prepareJobSourceData` also sets `source_url: null` for text and uploaded documents (`:356`, `:375`).

Introduce a bounded, evidence-preserving core source bundle, or designate the actual call notice as the details source and support bounded supplemental evidence. Core facts and expensive full guideline/template extraction should have independent switches. Preserve URL, retrieval time, content hash, document role, and page/segment anchors. Reuse the bytes/text already fetched by the crawler rather than fetching again through intake.

One top-ranked PDF is insufficient when the call notice, eligibility annexure, and later corrigendum disagree. Use document roles, dates, and reference numbers; flag unresolved conflicts. Parse text PDFs locally first; apply OCR or multimodal extraction only to selected documents that need it, with page and cost limits. Unknown fields remain unknown.

### 3. P1: Add an enforced total cost budget and reusable results

Plan: Phase 1.6 and Phase 2.5–2.7.

A daily cap of 40 drafts limits only the final stage. A large sitemap, broad keyword match, repeated rediscovery, or provider outage can still trigger substantial triage, embedding, transcription, fallback, and retry costs. Recording usage is not spending enforcement. The gateway wrapper sets `skipFeaturePolicy: true` (`src/lib/funding/llmRouting.ts:224`), so routing through it does not itself establish a crawler budget.

Reserve estimated maximum spend atomically before paid work and settle against actual usage. Set platform-wide and per-site daily budgets, per-task input/output limits, maximum fallback cost, and maximum paid attempts. Include embeddings and PDF/OCR work. Defer over-budget items without losing them, with deadline-aware scheduling and site fairness.

Cache classification and extraction by content hash plus prompt, schema, relevance-policy, extractor, and model versions. Unchanged observations should use stored results. Cross-source discoveries of the same item should share work. Provider prompt caching can reduce repeated prompt overhead but does not replace this application result cache.

Batch by estimated tokens as well as item count. Require one result per stable input item ID; reject invented or duplicate IDs. Retry missing/invalid members only. Keep reasons brief and avoid requesting deadline/amount hints repeatedly when the deterministic parser or subsequent core extraction already supplies them.

### 4. P1: Make every stage replay safe, including handoff to intake

Plan: Phase 1.1–1.3 and Phase 2.7.

`FOR UPDATE SKIP LOCKED` prevents simultaneous claims; it does not prevent a second intake batch after a crash between batch creation and saving the item's job link. Current `createBatch` unconditionally creates new batch/job rows (`src/lib/fundingIntake/service.ts:1405`). The LLM wrapper also generates a fresh random idempotency key for every invocation (`src/lib/funding/llmRouting.ts:230`).

Add a unique operation key derived from item version and stage, a unique intake handoff key, and a persisted request/result record. Save snapshot, observations, and downstream work atomically or through a transactional outbox. Use lease generation tokens so a worker whose lease expired cannot commit over its replacement. Completion must check the generation. A sweeper and the worker must use the same claims and per-host reservations.

This repairs an existing loss window: the current checker commits the new snapshot before it records the change (`src/lib/monitor/checker.ts:94`, `:112`). If later persistence fails, the next fetch can look unchanged and the finding is lost.

Model permanent failure, transient failure, exhausted retries, budget deferral, cancellation, and paused-provider work separately. Recheck site activation before execution and before handoff. Provide dead-letter inspection and explicit replay. Exactly-once provider billing cannot be assumed after an ambiguous network timeout; bound that retry risk.

### 5. P1: Strengthen fetch safety instead of copying the existing helper unchanged

Plan: Phase 1.4–1.5.

The suggested helper checks one DNS result and does not bind the subsequent connection to that validated address (`src/lib/fundingIntake/utils.ts:79`). Intake checks the final redirected URL only after the request (`:166`, `:239`). Its IP classifier is not a complete public-address validator. Reusing it unchanged leaves redirect and DNS-rebinding gaps.

Validate supported schemes, credentials, ports, all resolved addresses, and every redirect before connecting. Enforce public-network access at the connection/egress layer. Apply this to robots, sitemaps, feeds, PDFs, browser navigation, subresources, and browser-initiated API traffic. Keep crawler scopes separate from dependency hosts needed to render a site. OWASP specifically discusses redirect and DNS-pinning risks in its [SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

Do not make automatic insecure TLS retry the default. A read-only download can still return tampered funding facts or malicious model input. Prefer fixing CA/intermediate trust. If an operational exception is necessary, make it host-specific, explicit, expiring, and visible in the review evidence.

The existing 2.5 MB cap is not a download-memory limit: `fetcher.ts:22` reads the full response before slicing the string. Enforce streaming byte and decompression limits, distinguish truncated content from valid content, validate document types, and constrain XML/PDF parsing.

### 6. P1: Repair URL canonicalization before using it for identity

Plan: Phase 2.1.

The referenced `src/lib/fundingCatalogImport/normalize/text.ts:65` is a comparison-key helper. It removes the scheme, lowercases the entire path and query, and does not strip tracking/session parameters. It cannot be reused as the proposed fetchable canonical URL. `/Call/A.pdf` and `/call/a.pdf` can be different resources; query parameters can identify different opportunities.

Keep raw URL, fetched final URL, canonical fetch URL, and dedup key separately. Lowercase only case-insensitive components. Preserve meaningful paths and query values; remove known trackers with explicit rules. Support audited redirect aliases and site-specific SPA fragment rules. Treat canonical tags as hints, not authority to merge unrelated resources. Index canonical aliases for catalog and pending intake lookups instead of repeatedly normalizing the whole catalog.

### 7. P1: Replace the default first-run blind spot with a resumable bootstrap

Plan: Phase 2.2.

Manual sources baseline every existing link. Catalog sources process at most 20 high-scoring baseline items. A call already open at activation can therefore remain unprocessed forever, especially if it is outside the first 20 and never changes.

Baseline should describe observation history, not permanently prohibit relevance processing. Offer current-opportunity bootstrap for every activated site, using an ordered durable backlog and separate bootstrap cost budget. Preserve the remainder after the daily limit. Clearly distinguish expired, open, rolling, future, and unknown-deadline items. Do not infer expiry merely from a missing deadline.

### 8. P1: Make filtering prioritize ambiguous evidence rather than discard it permanently

Plan: Phase 2.3–2.5.

Sitemap slugs and anchors such as “View details” or “Advertisement 04/2026” often contain insufficient evidence for the planned keyword threshold. A permanent FILTERED decision can discard real funding before its page is read. Broad negative words such as “result” and “tender” also need context. English and Hindi do not cover every prospective source.

Use cheap deterministic extraction from listing context and structured data. Reject only strong irrelevant matches, prioritize strong positives, and put uncertain items through a bounded detail fetch before final triage. Allow UNSURE/NEEDS_EVIDENCE rather than requiring a fabricated definitive decision. Fetch this compact evidence once and reuse it in intake. Prefer an available structured feed/API where it actually covers the opportunities.

Version the relevance policy and rerun deferred/filtered decisions when evidence or policy changes. Sample rejected items for false negatives. Scope language and lexicon to each site's coverage needs. The proposed reused Jaccard tokenizer removes non-Latin characters (`src/lib/fundingIntake/utils.ts:903`), so its behavior must change for Hindi titles or be explicitly supplemented.

### 9. P1: Do not present bounded discovery as complete whole-site monitoring

Plan: Phase 3.1–3.4.

A 5,000-URL sitemap cap, top-10 listing selection, and lexicon-only crawl of depth two cannot establish complete site coverage. A new call might sit beyond the cap, behind pagination, on an approved subdomain, or in a portal whose parent labels lack funding terms. Persistent cursors are required so limits defer rather than permanently omit content. The [sitemap protocol](https://www.sitemaps.org/protocol.html) makes `lastmod` optional; it is a scheduling hint rather than proof of content identity.

Add bounded sitemap-index traversal, gzip handling, pagination/API cursors, crawl-trap detection, checkpointed frontier progress, and a small exploration budget for low-scoring paths. “Pages linking to known calls” can only be found among pages already fetched or via an explicit external index; it is not an available reverse-link lookup by itself.

Model a funder as distinct from a host. Shared government portals can represent many funders, and one funder can use several hosts. Keep host-level network pacing, site scopes/allowed related hosts, and evidence-backed funder associations separate. CDNs can be excluded from source seeding while still serving legitimate call attachments. Do not automatically fill a funder's authoritative website solely from the 80% historical-link rule; retain it as a suggestion for shared/uncertain hosts.

Expose coverage limits, unvisited frontier size, truncated runs, and next scheduled exploration. “No new calls” must be distinguishable from “not fully checked.”

### 10. P1: Calibrate quality and preserve evidence; model confidence is not verification

Plan: Phase 2.5–2.7 and Phase 4.1.

The 0.70 relevance and 0.75 confidence values are uncalibrated starting settings, not established error probabilities. A confident model can read an old notice, pick the wrong round, or attribute one funder's call to another organization on the same host.

Attach field-level evidence and immutable content versions to dates, amounts, eligibility, and identity. Preserve raw dates, date interpretation/timezone, whether an amount is per award or programme total, and unit/currency interpretation. Flag contradictions, old rounds, stale documents, and unsupported facts for completion. Revalidate important facts before publication if the source changed after drafting. “Ready to publish” should depend on deterministic readiness and evidence requirements, not classification confidence alone.

Keep remote pages and PDFs as untrusted data. Constrain outputs to schema and supplied item IDs; validate returned URLs against fetched evidence. Model output must not create crawl instructions, broaden host scopes, or write learning rules. These controls address the indirect-instruction risk described by [OWASP's prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## Additional operational and implementation corrections

1. **Browser readiness and promotion.** A page with over 200 characters can still be a JavaScript shell with no calls; a legitimate short page can be complete. Check meaningful item counts and source-specific readiness. Use DOM readiness plus a relevant selector/API result rather than relying on `networkidle`, which [Playwright discourages as a readiness criterion](https://playwright.dev/docs/api/class-page#page-goto). Browser mode should usually belong to a watch point, with periodic inexpensive fetch probes, rather than making an entire host permanently use Chromium. Block service workers if request interception is relied upon, as described in [Playwright's network documentation](https://playwright.dev/docs/network#missing-network-events-and-service-workers). Coordinate navigation and browser request load with host pacing.

2. **Robots behavior.** “Keep existing robots handling” retains fail-open behavior for network failures and server errors (`fetcher.ts:49–63`). [RFC 9309 section 2.3.1.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.4) requires complete disallow when robots is unreachable. Distinguish that from an unavailable robots resource, reuse valid cached rules appropriately, and apply policy to actual feed/PDF/redirect targets. Honor `Retry-After` and use shared host cooldowns for overload.

3. **Scheduler and outage handling.** A heartbeat written independently of task activity must remain fresh while the worker is idle. A daily sweep cannot itself detect an outage within two hours; add an independent, more frequent liveness check. The fallback must only claim work it can actually execute. Separate provider health from site fetch health: a global billing failure must not cause seven failures and auto-pause otherwise healthy funder sites. Open a provider/account circuit breaker for billing/auth failures and send one deduplicated alert; use jittered bounded retries for transient errors.

4. **Platform actor and usage identity.** Fixing only tenant fallback leaves `userId: 'system'` when no actor is passed (`llmRouting.ts:148`); `UsageLog.userId` has a User foreign key (`prisma/schema.prisma:5234`). Also, a source owner's tenant is explicitly passed by intake (`service.ts:3063`), so fallback alone does not guarantee platform cost attribution. Use an explicit platform billing context and a dedicated valid service actor. Keep reviewer ownership separate. Avoid borrowing the oldest super admin's identity, and enforce publication permission server-side even for bulk actions.

5. **Typed gateway errors.** The wrapper throws a plain `Error` containing a message (`llmRouting.ts:234`). Preserve provider code, status, request ID, retry delay, and billing/auth/transient classification through the gateway so the worker does not guess from strings. Verify that the selected fallback supports the schema and is actually configured for the new stage under the chosen control plan. A second model on the same exhausted provider account is not an independent fallback.

6. **Schema completeness.** Define task status, lease generation, unique operation key, payload/schema version, attempts limit, terminal reason, and supporting indexes explicitly. Items need content/version hashes, decision versions, intake job and call links, round identity, and separate processing and review states. A site item can appear in several feeds/listings; add per-source observations instead of a single `change_id` and site-wide `missing_since`. Only a successful complete source check may establish absence. Preserve evidence referenced by a review even after routine snapshot pruning. Specify snooze wake-up and transitions when an intake job is canceled, retried, edited, or later published outside Source Watch.

7. **Learning and metrics.** A rejection must not silently train a broad exclusion. The proposed optional rule should show affected URL examples, support rollback/expiry, and never be inferred from “duplicate” or “expired” alone. `published / surfaced` measures backlog as well as quality. Track precision on resolved relevance decisions, false negatives from a labeled/sampled audit, duplicate leakage, deadline-update recall, evidence completeness, discovery latency, backlog age, and cost per accepted opportunity. Monitor the limits of coverage separately.

8. **Cadence.** Thirty quiet days is normal for a funder that opens an annual call. Retain inexpensive daily checks for important listing/feed surfaces, adapt expensive exploration separately, and use explicit source priorities. Define timezone and `next_check_at` behavior consistently, add jitter, and prevent overdue sites or one large portal from monopolizing work.

9. **Delivery order.** Phase 1 depends on `monitored_sites` which currently appears in Phase 3; Phase 2's ledger also needs it. Move foundational site/item/observation schemas to the first migration. Ship the evidence and worker health view with the worker rather than waiting until Phase 4. Start with a small representative source cohort and autodraft off, then enable bounded drafts after measured validation. Confirm dependencies exist on the chosen base branch: the current working tree's `callRoutingJobs.ts` is untracked, so its pattern cannot simply be assumed present in a clean `main` worktree.

10. **Publication boundary.** Enforce `autoPublish: false` for monitor-origin jobs within the server handoff, independent of submitted flags. Updates require their own reviewable diff and expected-version check. Bulk publication must recheck each call's permission, readiness, source version, and state. Notifications should be idempotent, preference-aware, and driven by persisted events.

## Recommended processing order

1. Approved site scopes → structured API/feed when available → bounded listing/sitemap discovery.
2. Persist observations, identities, hashes, and durable downstream work together.
3. Reuse unchanged versions and cached decisions; look up existing catalog/pending-intake associations.
4. Cheap relevance scoring → bounded detail fetch for positive or ambiguous evidence → local parsing.
5. Budget reservation → compact LLM classification only where needed → round-aware duplicate/update decision.
6. Reuse the same source bundle for bounded core extraction → evidence validation → idempotent draft or update proposal.
7. Human review/publication → explicit feedback → audited rule updates.

The implementation should expose this invariant: unchanged evidence with unchanged processing/policy versions causes zero new triage or extraction calls. Purposeful reprocessing after a version change is recorded separately.

## Cost evaluation

Do not estimate cost from watch-list size or a draft cap alone. Measure:

`daily paid tokens = classification inputs/outputs + core extraction inputs/outputs + embedding inputs + OCR/multimodal usage + retries/fallbacks`

Price those components at their actual model rates and include non-token browser/OCR infrastructure costs separately. Report both cost per relevant discovery and cost per accepted draft. Track cached results and avoided operations.

Illustration only: 1,000 previously unprocessed candidate items at an average 200 input tokens each already contribute about 200,000 classification input tokens, before prompts, outputs, embeddings, extraction, or retries. Putting them in 40 batches saves repeated prompt overhead; it does not eliminate those item tokens. This is workload arithmetic, not a prediction of this deployment's traffic or price.

## Acceptance checks missing from the plan

Use a labeled fixture corpus covering static and rendered listings, Hindi/non-Latin titles, opaque anchors, paginated portals, feeds, scanned PDFs, and related-host attachments. Include known irrelevant items, old rounds, and ambiguous cases. Add isolated integration tests for actual claim/reclaim, uniqueness, and transaction behavior; mocked SQL calls cannot establish those guarantees. Use a dedicated test database and fixture transports, without weakening production fetch protections to permit localhost.

Required failure cases:

- A deadline changes at the same URL without a new listing link: exactly one reviewable update is created.
- A PDF changes at the same URL: its new version is observed and relevant fields are reconsidered.
- The next annual round reuses the URL/title: it remains distinguishable from the old round.
- Tracking variants merge; case-sensitive paths and meaningful query values remain distinct.
- Two watch points discover one item: one paid processing result and one intake handoff.
- More than 20 valid baseline items exist: the remainder drains from a resumable backlog.
- HTML is sparse but the PDF contains required facts: core extraction uses the PDF evidence with full guideline extraction disabled.
- A worker crashes after intake creation but before item linkage, or resumes after losing its lease: no duplicate draft and no stale commit.
- A sitemap exceeds 5,000 URLs or a listing is paginated: later segments are eventually visited.
- A triage batch returns shuffled, missing, duplicate, malformed, or invented IDs: valid members persist; only unresolved members retry.
- Provider billing fails globally: paid attempts stop promptly, items stay queued, and sites are not auto-paused for that failure.
- Concurrent tasks reach the remaining daily budget/cap: atomic reservations prevent overspend and preserve deferred candidates.
- A redirect/browser request targets a private address, or a document is oversized: fetch is blocked before unsafe access or unbounded allocation.
- Robots returns a transient server failure: the crawler defers rather than treating it as permission.
- The source changes between draft and publication: the reviewer sees a stale-evidence warning or a versioned update.
- An unchanged full repeat run performs no new classification/core-extraction calls and sends no duplicate notifications.

Measure recall and precision separately, with thresholds chosen from the actual labeled corpus and review capacity. A provisional recall target such as 95% is a product acceptance choice to validate, not a property established by this plan. Do not claim robust intelligent discovery until same-URL updates, bootstrap completeness within the stated scope, recovery, and cost limits are demonstrated.
