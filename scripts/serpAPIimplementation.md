Here’s a single, consolidated SRS that Cursor (or any dev AI) can implement end-to-end without ambiguity. It merges everything we discussed: **UI**, **LLM bundle generation/approval**, **local-first search**, **SerpAPI calls with a hard 1-per-5s rate limit**, **result merge/dedupe/intersection/ranking**, **shortlist & details fetch**, and **storage schema**.

---
Note: serp api key is in .env file under variable name "Serp_API_KEY"
# SRS — Prior-Art Search Platform (v1)

## 0) Purpose & Scope

Build a system that:

1. Generates a **SerpAPI-ready search bundle** (either by LLM from an invention brief or user manual entry).
2. Requires **human approval** of the bundle.
3. Executes a **local-first** three-variant search (broad/baseline/narrow) with **SerpAPI fallback** under **≤1 request/5s**.
4. **Merges, dedupes, and ranks** results using intersection signals.
5. **Shortlists** top candidates and **fetches full details** (claims/description) selectively.
6. **Persists** all artifacts (raw + normalized) to a growing local database for reuse.

Out of scope: legal opinions, official EPO/WIPO verifiers (planned later).

---

## 1) Roles

* **Author/Researcher**: provides brief or fills the form.
* **Reviewer/Attorney**: reviews, edits, and approves the bundle; decides shortlist for details.
* **System**: guides, validates, rate-limits, stores, and computes rankings.

---

## 2) End-to-End Flow

1. **Mode Selection**: “Use LLM on my brief” or “Manual form.”
2. **LLM Mode**: Brief → LLM emits JSON **bundle** with core fields populated → user can add/override optional fields or leave blank.
   **Manual Mode**: Render the **same form** with core fields empty for manual entry.
3. **Validate & Approve**: JSON Schema + guardrails; on approval, snapshot is frozen (**ApprovedBundle**).
4. **Run Search (Phase-2 engine)**:

   * **Local-first**: query local DB to satisfy each variant; if insufficient, call **SerpAPI** (`google_patents`) for that variant, observing **≤1 request/5s**.
   * Persist raw + normalized results.
5. **Merge/Dedupe/Rank**:

   * Build intersections (found in 2 or 3 variants).
   * Score all unique hits and sort.
6. **Shortlist & Details**:

   * Auto-shortlist top-K (editable).
   * Fetch **details** for shortlisted only (`google_patents_details`), under rate limit.
7. **Archive & Export**:

   * Persist everything with provenance.
   * Export JSON/CSV.

---

## 3) UI (Web App)

### Layout

* **Left Panel**: Brief (LLM mode) and **ApprovedBundle** viewer (read-only after approval).
* **Center**: Run controls & unified results table.
* **Right**: Shortlist & details viewer.

### Screens & Controls

1. **Bundle Builder**

   * Mode selector (LLM / Manual).
   * Textarea for brief (LLM).
   * Structured JSON form (same schema in §4.1).
   * Live validation and guardrail hints.
   * **Approve** button (enabled only when valid & safe).

2. **Search Runner**

   * “Start Search” → pipeline tracker:

     * Local DB lookup ✅/❌
     * Variant calls (Broad / Baseline / Narrow) with **5s countdown** pill between calls
     * Merge/Dedupe/Score stage
   * Request counter: “N/3 variant calls, 1 per 5s”

3. **Unified Results**

   * Table columns: **Score**, Title, Publication, Date, CPC roots, **Badges** (B/M/N), Link/PDF.
   * Filters: Year, Assignee, Variant badge, Score range.
   * Sorting: Score (default), Date.
   * Toggle to adjust scoring weights (optional advanced panel).

4. **Shortlist & Details**

   * Auto top-K list; user can promote/demote.
   * “Fetch Details for Selected” (rate-limited).
   * Detail panel shows Claims, Abstract, Description, Classifications, Citations; highlight query terms; links to GP page and PDF.

5. **Runs & Reuse**

   * History list: past runs, counts, dates.
   * “Reuse cached results” option before making new API calls.

**User Decisions**: Approve bundle, Start Search, optionally tweak weights, confirm shortlist for details, export.

---

## 4) Contracts

### 4.1 Approved Bundle (JSON Schema: conceptual; implement as JSON Schema Draft-7)

```json
{
  "source_summary": {
    "title": "string",
    "problem_statement": "string",
    "solution_summary": "string"
  },
  "core_concepts": ["string"],
  "synonym_groups": [["string"]],
  "phrases": ["string"],
  "exclude_terms": ["string"],
  "technical_features": ["string"],
  "spec_limits": [
    { "quantity": "string", "operator": ">", "value": 0, "unit": "string" }
  ],
  "cpc_candidates": ["string"],
  "ipc_candidates": ["string"],
  "domain_tags": ["string"],
  "date_window": { "from": "YYYY-MM-DD or \"\"", "to": "YYYY-MM-DD or null" },
  "jurisdictions_preference": ["string"],
  "ambiguous_terms": ["string"],
  "sensitive_tokens": ["string"],
  "query_variants": [
    { "label": "broad", "q": "string", "num": 20, "page": 1, "notes": "string" },
    { "label": "baseline", "q": "string", "num": 20, "page": 1, "notes": "string" },
    { "label": "narrow", "q": "string", "num": 20, "page": 1, "notes": "string" }
  ],
  "serpapi_defaults": { "engine": "google_patents", "hl": "en", "no_cache": false },
  "fields_for_details": [
    "title","abstract","claims","classifications","publication_date",
    "priority_date","worldwide_applications","events",
    "patent_citations","non_patent_citations","pdf","description"
  ],
  "detail_priority_rules": "string"
}
```

**Guardrails**:

* Exactly 3 variants (broad/baseline/narrow).
* `q` ≤ 300 chars; ≤ 2 quoted phrases.
* `num` ≤ 50; `page` ≥ 1.
* `sensitive_tokens` must be empty on approval.

### 4.2 SerpAPI Calls

**Search (lists):**
`GET https://serpapi.com/search`
Params: `engine=google_patents`, `q`, `num`, `page` (or `start`), `hl`, `no_cache`, `api_key`.

**Details (full text):**
`GET https://serpapi.com/search`
Params: `engine=google_patents_details`, `patent_id`, `json_restrictor` (join of `fields_for_details`), `hl`, `no_cache`, `api_key`.

**Rate Limit**: Enforce **global min 5 seconds** between successive calls per endpoint.

---

## 5) Local-First Strategy

* For each variant:

  * Attempt local retrieval from **patents** / **variant_hits** cache to satisfy `num` items (e.g., via text index on title+abstract and/or previously stored hits linked to similar `q_hash`).
  * If count ≥ `num`, **skip API** for that variant.
* Regardless, all retrieved items flow into the per-run merge/score pipeline.

---

## 6) Data Model (PostgreSQL recommended)

### 6.1 Runs / Variants

**runs**
`run_id (PK)`, `bundle_hash`, `approved_bundle JSONB`, `started_at`, `finished_at`, `status`, `config JSONB`,
`user_id (FK)`, `credits_consumed INT DEFAULT 1`, `api_calls_made INT DEFAULT 0`, `cost_estimate DECIMAL(10,4)`

**query_variants**
`variant_id (PK)`, `run_id (FK)`, `label (broad|baseline|narrow)`, `q TEXT`, `num INT`, `page_target INT`, `page_executed INT`

### 6.2 Raw Snapshots (for audit)

**search_results_raw**
`raw_id (PK)`, `run_id (FK)`, `variant_id (FK)`, `page_no INT`, `payload JSONB`, `received_at TIMESTAMPTZ`

**details_raw**
`raw_id (PK)`, `publication_number TEXT NULL`, `patent_id TEXT`, `payload JSONB`, `fetched_at TIMESTAMPTZ`

### 6.3 Canonical Catalog (normalized)

**patents**
`publication_number (PK)`, `title TEXT`, `abstract TEXT`, `language TEXT`,
`publication_date DATE`, `priority_date DATE`, `filing_date DATE`,
`assignees TEXT[]`, `inventors TEXT[]`, `cpcs TEXT[]`, `ipc TEXT[]`,
`link TEXT`, `pdf_link TEXT`, `extras JSONB`,
`first_seen_at TIMESTAMPTZ`, `last_seen_at TIMESTAMPTZ`
Indexes: `btree(publication_number)`, `gin(cpcs)`, `btree(publication_date)`, `GIN tsvector(title+abstract)`.

**variant_hits**
`run_id (FK)`, `variant_id (FK)`, `publication_number (FK)`,
`rank_in_variant INT`, `snippet TEXT`, `found_at TIMESTAMPTZ`
PK: `(run_id, variant_id, publication_number)`
Index: `(run_id, publication_number)`.

**patent_details**
`publication_number (PK, FK)`, `claims JSONB`, `description TEXT`,
`classifications JSONB`, `worldwide_applications JSONB`,
`events JSONB`, `legal_events JSONB`,
`citations_patent JSONB`, `citations_npl JSONB`,
`pdf_link TEXT`, `fetched_at TIMESTAMPTZ`.

**results_unified**
`run_id (FK)`, `publication_number (FK)`,
`found_in_variants TEXT[]`, `rank_broad INT NULL`, `rank_baseline INT NULL`, `rank_narrow INT NULL`,
`is_intersection TEXT CHECK (is_intersection IN ('none','I2','I3'))`,
`score NUMERIC(5,4)`, `shortlisted BOOL DEFAULT false`
PK: `(run_id, publication_number)`
Indexes: `(run_id, score DESC, publication_date DESC)`, `(run_id, is_intersection)`.

**user_credits**
`user_id (PK, FK)`, `total_credits INT`, `used_credits INT DEFAULT 0`, `monthly_reset DATE`,
`last_search_at TIMESTAMPTZ`, `plan_tier TEXT` // free, basic, pro, enterprise

---

## 7) Normalization Rules

**Patent ID Normalization:**
* `patent/US1234567B1/en` → `US1234567B1`
* `scholar/6497879044063343659` → keep as-is for details API
* Normalize case and remove spaces from publication numbers

**From Search (`organic_results[]`)** → `patents` + `variant_hits`

* Upsert `patents` by normalized `publication_number`.
* Update missing fields non-destructively (don't overwrite existing non-nulls).
* Insert `variant_hits` with `rank_in_variant` and `snippet`.
* Extract and store CPC/IPC classifications as arrays.
* Keep Google links (`link`, `pdf`) if present.

**From Details** → `patent_details`

* Upsert full text fields; set `fetched_at = now()`.
* Parse and store structured data (claims as JSONB, classifications as arrays).
* Keep snapshot in `details_raw` for audit.
* Handle both patent/ and scholar/ ID formats.

---

## 8) Merging, Intersections, Scoring

### Sets

Let `B`, `M`, `N` be sets of `publication_number` from broad/baseline/narrow.

* `I3 = B ∩ M ∩ N` (found in all three)
* `I2 = (B∩M) ∪ (B∩N) ∪ (M∩N)` (found in any two)
* `U = (B ∪ M ∪ N) \ I2` (found in only one)

### Score (0..1, tunable)

```
score = 0.35 * title_density
      + 0.20 * snippet_density
      + 0.20 * variant_signal    // narrow=1.0, baseline=0.6, broad=0.3 (max over variants)
      + 0.15 * cpc_overlap       // with approved CPC roots, if any
      + 0.10 * recency           // normalized over last ~10 years
      + consensus_bonus
```

* `consensus_bonus`: +0.15 if in `I3`, +0.08 if in `I2` (cap at 1.0).
* Dedupe by `publication_number`; keep per-variant ranks for display.

### Ordering & Shortlist

* Sort by `score desc`, then `publication_date desc`.
* Auto top-K (default 10) → `shortlisted=true` (user can adjust).

---

## 9) Rate Limiting & Caps

**Global rule**: **≥ SERP_RATE seconds** between consecutive requests per endpoint (configurable via environment variable).

**Current setup**: `SERP_RATE=5` (free tier - one request every 5 seconds)

**Future tier upgrades**:
- **Basic tier (1000/month)**: `SERP_RATE=2`
- **Pro+ tiers**: `SERP_RATE=1`
- **Enterprise**: `SERP_RATE=1` (unlimited)

**Credit counting**: Each user search counts as **1 credit** regardless of API calls made internally (variants + details).

*Pseudocode*

```
function call_serpapi(endpoint, params):
  rate_limit = parseInt(process.env.SERP_RATE || '5')
  wait_until(now - last_call_ts[endpoint] >= rate_limit * 1000)  // Convert to milliseconds
  resp = http_get(endpoint, params)
  last_call_ts[endpoint] = now
  // Increment internal API call counter (not user-visible credits)
  return resp
```

**Per-run caps (configurable)**:

* Variants: exactly 3
* Pages per variant: 1–3
* `num` per page: ≤ 50
* Auto details: top-K (e.g., 10)
* Details TTL: 14–30 days (avoid re-fetch)
* Max total API calls per search: 13 (3 variants + 10 details)

---

## 10) Execution Pseudocode (concise)

```
run_search(ApprovedBundle):
  create run; status=running
  all_hits = []

  for v in [broad, baseline, narrow]:
    hits = local_lookup(v.q, v.num)              // patents/title-abstract index, or prior hits
    if hits.count < v.num:
      call_serpapi_rate_limited('google_patents', v)
      persist_raw_and_norm(v, response)
      hits = hits ∪ norm_from_db(run_id, v.label)
    all_hits.append(hits)

  unified = merge_dedupe(all_hits)               // by publication_number; collect variant flags & ranks
  score_all(unified, ApprovedBundle)             // section 8
  shortlist = top_k(unified, K)

  for p in shortlist:
    if details_missing_or_stale(p.publication_number):
      call_serpapi_rate_limited('google_patents_details', p.patent_id, fields_for_details)
      upsert_details(p.publication_number, details)

  status=completed; persist summary counts
```

---

## 11) Error Handling & Cost Monitoring

**API-Specific Errors:**
* **Invalid patent ID (404)** → Mark as failed, continue with others.
* **Quota exceeded (429)** → Stop all API calls, show upgrade prompt, mark `credit_exhausted`.
* **Malformed query (400)** → Log error, try fallback query, inform user.
* **Rate limit hit** → Wait and retry with exponential backoff.
* **Network timeout** → Retry up to 3 times, then mark failed.

**General Errors:**
* **Local-first miss** → graceful SerpAPI fallback.
* **Variant failure** → record and proceed; allow retry.
* **Partial completion** → mark `completed_with_warnings`.

**Cost Monitoring:**
* Track API calls per run in `runs.api_calls_made`
* Always consume 1 user credit per search (`runs.credits_consumed = 1`)
* Calculate cost estimate based on API calls made
* Monitor monthly usage against plan limits

---

## 12) Security & Privacy

* Keep `SERPAPI_API_KEY` server-side; never log or expose.
* Redact `sensitive_tokens` before any outbound request.
* Audit trail: store brief, raw LLM JSON, edited JSON, approvals, and request metadata.

---

## 13) Config Defaults

* `SERP_RATE` (env var): 5 (free tier), configurable per plan
* `pages_per_variant = 1..3` (default 1)
* `num_per_page = 20`
* `shortlist_k = 10`
* `details_ttl_days = 14`
* `credits_per_search = 1` (fixed)
* Scoring weights/bonuses per §8.

**Plan Tiers & Rate Limits:**
* Free: 100 searches/month, `SERP_RATE=5`
* Basic: 1000 searches/month, `SERP_RATE=2`
* Pro: 5000 searches/month, `SERP_RATE=1`
* Enterprise: unlimited, `SERP_RATE=1`

---

## 14) Acceptance Criteria

* **AC-1**: ApprovedBundle validated, snapshot frozen; no `sensitive_tokens` outbound.
* **AC-2**: Local-first check attempted for each variant; API called only if needed.
* **AC-3**: Hard rate limit enforced: ≤1 call/5s/endpoint.
* **AC-4**: Three variant result sets stored (raw + normalized); deduped unified view created with intersection badges.
* **AC-5**: Ranking deterministic given same inputs; tunable via config.
* **AC-6**: Shortlist generated; details fetched only for shortlist; details cached (TTL).
* **AC-7**: All artifacts persisted with `run_id`; export works.
* **AC-8**: Secrets not logged; errors surfaced with actionable messages.

---

## 15) Implementation Priorities & Phased Rollout

### Phase 1: Core Search Pipeline (2 weeks)
* ✅ Database schema setup
* ✅ SerpAPI integration with rate limiting
* ✅ Basic local-first search (exact matches)
* ✅ Result merging and deduplication
* ✅ Simple scoring (no ML features)

### Phase 2: Enhanced Features (2 weeks)
* ✅ LLM bundle generation integration
* ✅ Human approval workflow
* ✅ Patent ID normalization
* ✅ Enhanced error handling
* ✅ Credit counting system

### Phase 3: Advanced Features (2 weeks)
* ✅ Fuzzy local search with text similarity
* ✅ Query caching and reuse
* ✅ Advanced scoring with intersections
* ✅ UI/UX refinements
* ✅ Analytics dashboard

### Phase 4: Optimization & Scale (1 week)
* ✅ Performance optimizations
* ✅ Background indexing
* ✅ Cost monitoring improvements
* ✅ International patent support

---

This spec is intentionally compact but complete: it tells Cursor **what to build**, **how to call**, **what to store**, and **how to rank**—with minimal but sufficient pseudocode and exact schema/field names so implementation is uniform.
