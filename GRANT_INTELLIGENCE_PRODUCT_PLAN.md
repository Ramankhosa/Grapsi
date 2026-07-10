# Grant Intelligence Product Plan

*Prepared 2026-07-10. Based on a code-grounded review of the funding corpus/data model, intake pipeline, documents RAG, Finder, Idea Intelligence, and Grant Prep subsystems (6 deep-read subsystem maps + first-hand verification).*

---

## Part 1 — Review: what the grant intelligence layer is today

### 1.1 What you actually have (and it's more than you think)

**Two embedded corpora, not one.**

| Corpus | Model | What's in it | Search infra |
|---|---|---|---|
| Funding calls | `FundingCall` | scheme, agency (free text), amounts, dates, eligibility facet arrays, raw/normalized text | pgvector 768 + 1024 (IVFFlat), trigger-maintained weighted tsvector, facet SQL filters |
| Funded awards | `PublicProject` | title, abstract, objectives, milestones, **budget amount + components, manpower, equipment, publications/patents/outcomes**, PI + institution + state, sanction year, scheme hierarchy. Sources: PRISM, BIRAC, CSIR, ICMR, ICSSR + NSF, NIH, UKRI, CORDIS, NWO, World Bank | same dual-embedding + tsvector pattern, plus per-row embedding provenance columns |

The award-level corpus is the defensible asset. A directory of calls is replicable; "what ICMR actually funded, at what budget, from which institutions, with what outcomes" is not.

**Five working engines, each individually well-engineered:**

1. **Idea Intelligence** (`src/lib/ideaIntelligence/service.ts`) — the closest thing to the vision already: paste an idea → LLM structures it into facets → parallel hybrid retrieval (funded projects top-15, open calls top-6, live Semantic Scholar/OpenAlex/Crossref + patents + web) → evidence-grounded PRESENT/PARTIAL/ABSENT/UNASSESSED facet-overlap matrix → **deterministic** saturation/whitespace/momentum scores → positioning brief → versioned refinement candidates with verbatim-quote-verified citations and groundedness scores. Resumable stages, strong anti-hallucination discipline throughout.
2. **Finder** (`recommendationSearchService` / `recommendationConversationService`) — conversational hybrid search (vector + FTS + Voyage rerank), SSE streaming, cheap-first heuristic parsing, manual/auto filter governance, zero-result recovery ladder, persisted runs and snapshots.
3. **Documents RAG** (`src/lib/fundingDocuments/`) — per-call PDFs parsed → 18 typed sections (eligibility, budget_rules, important_dates…) → protected chunking → embedded → cited QA with structural page/section citations and quality checks that cross-validate documents against catalog fields.
4. **Grant Prep** (`src/lib/grantPrep/`) — 12-stage marker-committed state machine, hashed idea anchor with drift detection, deterministic rule hard-blocks (budget/duration/thrust), template→stage mapping, frozen `grant_handoff_v1` payload into blueprint + section drafting.
5. **Paste-your-own-call primitives** — user import (URL/text/PDF) → `TENANT_PRIVATE` FundingCall; owner-run guideline and template extraction from pasted text (`/api/funding/calls/[callId]/user-guidelines/extract`, `user-template/extract`); same document pipeline.

Plus platform strengths: centralized metered LLM gateway with per-plan/per-stage model routing, dual embedding columns with provider-migration safety, quota metering, tenant isolation enforced in SQL.

### 1.2 The seven gaps that keep this from being a serious intelligence product

**Gap 1 — The modules are islands; there is no intelligence loop.**
Idea Intelligence's call matching is a cosmetic top-6 list (calls are *not* in the facet matrix). Its "anchor project" is stored but never used by `execute()`. Export to Idea Bank creates an unlinked record (`ideaBankIdeaId` never populated). Grant Prep uses **zero retrieval** — no embeddings, no funded-project evidence, and its ideation stage doesn't consume Idea Intelligence output. Finder can't validate; Idea Intelligence can't search interactively. Doc-QA endpoints (`/api/funding/calls/[callId]/qa`) are built but have no user-facing consumer, and the whole doc-intelligence layer sits behind `ENABLE_FUNDING_DOC_INTELLIGENCE` which defaults to **false**. The user's journey dead-ends at every module boundary.

**Gap 2 — No agency intelligence.** Agency is free text in two parallel columns (`agencyName`, `agency_name`). No Agency entity, no scheme lineage (the same call recurring yearly), no funding-pattern analytics. At 50k calls the same funder fragments into dozens of spellings. The corpus is a lookup table, not a brain.

**Gap 3 — Nothing produces a verdict.** Doc-QA is explicitly instructed never to declare eligibility verdicts. Idea Intelligence deliberately avoids fundability claims. That discipline is correct — but the product never answers the user's actual question: *"Can I apply? Will this fit? What exactly do I fix?"* There is no per-criterion eligibility check, no decomposed fit score, no gap report against a specific call.

**Gap 4 — Idea validation never reads the call text.** The facet matrix compares against projects/publications/patents/web but **not** against call or guideline documents — so "validate my idea against this call" doesn't actually exist at evidence depth.

**Gap 5 — No adversarial layer.** Compliance/reviewer-readiness report builders exist in `src/lib/grants/compliance.ts`, but nothing simulates how an ICMR/SERB review panel would attack an idea before the user commits weeks to it.

**Gap 6 — 50k-scale ops debt.** Dedup is lexical and checks only the 50 most recently updated calls; no unique constraint on `sourceFingerprint`. IVFFlat indexes were built on near-empty tables (centroids are stale after bulk load; recall degrades until reindex). Taxonomy mapping is manual-only. In-process queues die with the server. `take: 50` hardcoded lists. Local-disk file storage (some under `public/`). Mined JSON/CSV rows carry flat confidence 0.85 with no evidence — indistinguishable from verified extractions.

**Gap 7 — No learning loop, no time dimension.** Run diagnostics are stored and never consumed. No saved-idea alerts when matching calls open. No outcome tracking (submitted? funded?). Deadlines are static fields, not a predicted calendar.

---

## Part 2 — The plan: what true AI-backed grant intelligence looks like

### 2.0 The one-sentence reframe

Stop shipping three chat tools; ship **one engine with a persistent Idea at the center, a Corpus Brain underneath, and verdict instruments the user points at any (idea × call) pair** — where every output is an evidence-cited, decomposed, honest verdict, not more prose.

### 2.1 North-star user journeys

**A. Idea-first, no agency in mind (brainstorm/validate)**
Paste idea → structured facets → landscape (funded neighbors, saturation/whitespace — *exists*) → **"Fundable homes"**: ranked agencies/schemes with evidence ("BIRAC funded 14 similar projects 2021-25, median ₹48L, typically 24 months, your institution type wins 30% of them; next expected call window: Oct 2026") → pick a home → Fit & Eligibility Verdict → Gap Report → Strengthen → Grant Prep → Draft.

**B. Call-first, call in database**
Open call → **Call Brief**: what this scheme funded before (lineage-linked awards), typical award size and duration, who wins it, thrust drift, evaluation criteria → "Brainstorm ideas for this call" (seeds generated from whitespace × user profile) or "Validate my idea" → same verdict path.

**C. Call-first, pasted call (not in database)**
Paste text/URL/PDF → private FundingCall + auto guideline/template/document extraction (*all primitives exist*) → **semantic twin matching**: "this resembles SERB-CRG; attaching SERB's funding history" → identical verdict/gap/reviewer instruments. A pasted call is never a second-class citizen.

**D. Standing intelligence**
Saved ideas get re-matched as new calls land; lineage predicts recurring calls *before they open* ("DBT-BioCARe expected to reopen ~Jan 2027 — start prep now, 3-month lead").

### 2.2 The six engines

#### Engine 1 — Corpus Brain (data foundation; everything else stands on this)

- **Agency + Scheme entities.** New models: `FundingAgency` (canonical name, aliases, type, parent ministry) and `FundingScheme` (agency FK, canonical scheme name, aliases). LLM + trigram batch job resolves `agency_name`/`agencyName` across all 50k calls and `PublicProject.schemeHierarchy` into these entities. This single change unlocks: agency pages, faceting, lineage, and pattern analytics.
- **Call lineage.** Batch job clusters calls of the same scheme across years (scheme entity + title similarity + annual cadence) → `FundingCallLineage`. Yields deadline calendars and next-open predictions.
- **Auto-taxonomy.** LLM classification of all calls and awards into the existing OECD FORD taxonomy (`FundingCallResearchAreaTaxonomy` already carries `source` and `confidence` fields — built for exactly this; today the only writer is the manual admin API).
- **Funding-pattern analytics** as materialized views per agency/scheme: award-size distribution, topic distribution over time, institution-type and state winner profiles, seasonal deadline cycles, thrust drift. Cheap SQL over `PublicProject`; refresh nightly.
- **Ops hardening (prerequisite for trust at 50k):** semantic dedup pass over the full corpus (embeddings exist — pairwise near-neighbor sweep + curator queue); unique constraint on `sourceFingerprint`; reindex vectors after bulk load (or migrate to HNSW); embedding backfill job for NULL-embedding rows; bulk-publish endpoint; paginate admin lists; move uploads off `public/` local disk; surface mined-vs-verified extraction confidence on every call.

#### Engine 2 — Fit & Eligibility Verdict (idea × call → structured verdict)

The core new intelligence. Input: idea (structured facets — exists) + call (structured fields + guideline pack + doc chunks — exist) + researcher profile (exists). Output: a **verdict card**, not prose:

- **Eligibility: per-criterion PASS / FAIL / NEEDS_INFO**, each citing the exact call/guideline text (structural citations pattern already proven in doc-QA) and the profile fact it was checked against. "NEEDS_INFO" triggers one targeted question, never a guess.
- **Fit, decomposed** (no single magic number without parts):
  - *Thematic fit* — extend the existing facet-overlap matrix to include **call/guideline chunks as a comparison corpus** (closes Gap 4; the matrix machinery already handles 4 evidence types, this adds a 5th).
  - *Precedent fit* — nearest funded awards under this agency/scheme via lineage: "3 of your 5 facets appear in projects this scheme funded; your facet 4 has never been funded here."
  - *Scale fit* — budget/duration vs call ceilings (the crore/lakh parsing and hard-block logic already exists in `grantPrep/sessionState.ts` — extract it into a shared lib).
  - *Career/institution fit* — from eligibility facets × profile.
- New model `IdeaCallAssessment` (ideaVersionId, fundingCallId, verdictJson, evidenceJson, createdAt) so verdicts are persistent, comparable across calls, and re-runnable when the idea version changes.

Honesty rules (keep the discipline you already have): every verdict component cites its evidence; UNASSESSED is a first-class value; deterministic checks wherever possible; LLM only where judgment is needed, always against retrieved text.

#### Engine 3 — Gap Report & Strengthen (targeted, per-call)

- **Gap report**: given a verdict, enumerate concretely what's missing — unaddressed evaluation criteria (from the guideline pack), methodology elements present in funded neighbors but absent from the idea (from the facet matrix), differentiation weaknesses on saturated facets, scale mismatches. Each gap links to its evidence and to the grant-prep stage that would fix it.
- **Strengthen**: the refinement-candidate machinery (3 candidates, verified quotes, groundedness scores, version lineage with score deltas — *all exists*) gets re-targeted: candidates are generated **against specific gaps for a specific call**, not just general landscape positioning. The score-delta-vs-parent-version mechanic becomes "did this revision close the gap?"

#### Engine 4 — Reviewer Simulation Panel

- Build 3 reviewer personas per assessment from the agency's own evaluation criteria (guideline packs), the scheme's funded-project profile, and standard Indian panel archetypes (scientific-merit hawk, feasibility/budget skeptic, societal-impact assessor).
- Each persona attacks the idea independently; a synthesis pass produces: rubric scores per criterion, top 5 objections ranked by severity, and suggested pre-emptions.
- **Objections feed Grant Prep directly** as needs-review discussion points in the relevant stages — the marker/point machinery already supports seeded points (the ideation decision route does exactly this today).

#### Engine 5 — Opportunity & Whitespace Explorer (brainstorm mode)

- Interactive: pick agency/domain → funded-topic map over time (saturation vs whitespace vs momentum — the deterministic signals already computed per-run, now precomputed corpus-wide from the taxonomy + embeddings) → click a whitespace region → generate idea seeds grounded in (whitespace evidence × user profile × publications) → each seed is one click from a full validation run.
- This is the "brainstorm with no agency in mind" entry, and it's the feature generic ChatGPT cannot replicate — it requires the award corpus.

#### Engine 6 — The Idea Spine (product integration; turns tools into a product)

- Promote `IdeaIntelligenceSession` into the persistent **Idea** object with a lifecycle: `spark → validated → call_matched → in_prep → drafted → submitted (+ outcome)`. Populate the existing dead columns (`projectId`, `ideaBankIdeaId`); add `lifecycleState`.
- Every engine reads and writes this object. Grant Prep's ideation stage consumes the validated idea + verdict + gap report as its idea anchor (the anchor mechanism exists; today it's built from scratch inside prep). The handoff payload carries the evidence chain into drafting.
- **One workspace UI** replacing the /finder vs /funding/intelligence vs /projects/…/prep silos: the idea at the center, instruments around it (Validate · Find homes · Gap scan · Strengthen · Simulate review · Start prep), with conversational chat as the interface layer (the finder SSE contract is the proven pattern) but engines always producing structured, persistent artifacts. Nothing the user does is a dead end.

### 2.3 Experience-level fixes (credibility depends on these)

- Idea runs: move from synchronous 300s HTTP + 2s polling to a background job with SSE stage streaming (finder's SSE infra is reusable). A closed tab must not kill a run.
- Grant Prep: stream the assistant reply; run marker/tidy passes after the stream ends (today each turn is 4-5 blocking sequential LLM calls).
- Turn on what's built: deploy `ENABLE_FUNDING_DOC_INTELLIGENCE`, seed LLM stage models, run pending migrations (MEMORY notes say these were still pending); wire the orphaned QA endpoint into the call detail page.
- Cross-call comparison in chat ("compare eligibility of results 2 and 4 from their documents") — doc retrieval is single-call-scoped today.

### 2.4 Phased roadmap

**Phase 1 — Foundation & loop-closing (~2-3 weeks)**
Turn on doc intelligence + deploy steps · Agency/Scheme entities + resolution job over both corpora · auto-taxonomy job · semantic dedup + fingerprint constraint + vector reindex + embedding backfill · bulk publish + pagination · link Idea Intelligence ↔ Idea Bank ↔ Grant Prep (populate the dead FK columns, pass the idea anchor through).
*Exit test: one user goes idea → validation → pick call → prep → draft without re-entering context anywhere.*

**Phase 2 — Verdict Engine (~3-4 weeks)**
Criterion extraction from guideline packs → per-criterion eligibility verdicts with citations · call/guideline chunks added to the facet-overlap matrix · decomposed fit score · `IdeaCallAssessment` model + verdict card UI · unified paste-your-own-call flow with semantic twin matching.
*Exit test: for any (idea, call) — including a pasted call — the user gets a cited eligibility verdict and decomposed fit in under 2 minutes.*

**Phase 3 — Corpus Brain analytics (~3-4 weeks)**
Call lineage detection · funding-pattern materialized views · agency/scheme pages ("what DBT funds") · deadline calendar + next-open predictions · Whitespace Explorer v1 on the precomputed topic map.

**Phase 4 — Adversarial & strengthen (~2-3 weeks)**
Reviewer simulation panel · gap reports wired into refinement candidates and grant-prep seeded points · gap-closure score deltas.

**Phase 5 — The living product (ongoing)**
Unified idea workspace · saved-idea alerts on new/predicted calls · outcome tracking (submitted/funded) feeding ranking · learning from stored run diagnostics · institutional (research office) dashboards as the Enterprise wedge.

### 2.5 Why this wins

- **The moat is the award corpus × entity resolution × lineage** — not the LLM. Anyone can wrap GPT around a call PDF; nobody else can say "here are the 14 nearest funded Indian projects, their budgets, and this scheme's three-year thrust drift."
- **Verdicts over vibes.** Per-criterion, evidence-cited, deterministic-where-possible — the anti-hallucination discipline already in the codebase is exactly the right foundation; the plan extends it to the questions users actually pay to answer.
- **Continuity is the product.** The idea object that matures from spark to submission is what makes users stay; every existing module becomes an instrument on that spine instead of a separate destination.
