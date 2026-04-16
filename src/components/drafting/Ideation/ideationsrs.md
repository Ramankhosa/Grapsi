Below is a **revised, “no-room-for-imagination” SRS** for an **interactive mind-map patent ideation engine** embedded inside **PatentNest.ai**, including **classification categories**, **UI/UX operations**, **LLM+SerpAPI integration**, **JSON contracts**, **data tables**, **edge cases**, and a **worked example (Disposable Syringe)**.

---

## 0) Simple explanation of what Gemini told you (in plain words)

Gemini’s point was:

* Don’t let the AI “chat ideas.” Make it **engineered**:

  1. **Classify** what the user entered (product/system/process/etc.)
  2. Expand into **dimensions** (materials, mechanism, lifecycle, constraints, risks, etc.)
  3. Use **operators** (ways to modify: segment, invert, add feedback, etc.)
  4. Generate **Idea Frames** (structured invention candidates)
  5. Run a **novelty pressure gate**: if too crowded, mutate methodically (swap operator/dimension)
  6. Keep everything **traceable and repeatable** (same input + same settings = same results)

**Example (Disposable syringe, prevent reuse):**

* Dimension = “Failure/Risk: reuse”
* Operator = “Segmentation”
* Idea = “Plunger snaps after full depression”
* Novelty search finds many “breakable plunger” patents → **solution saturated**
* Keep problem, swap operator → “Chemical change” → “Plunger material hardens irreversibly on first use”

---

## 1) Architecture decision: “app inside app” vs separate app

### Recommendation: **Implement as a module/service inside PatentNest**, not a separate app.

* **Same auth, same billing, same tenant controls, same idea→draft pipeline**
* Cleaner user journey: ideation → shortlist → export to drafting (PatentNest sections)

### Internal structure

* **UI module**: `/ideation` route in PatentNest
* **Backend service**: `IdeationService` (internal API)
* **Shared stores**: users/tenants/usage logs already exist
* **Optional microservice later** only if:

  * you need independent scaling, or
  * heavy search caching & vector operations overload main app

---

## 2) Classification categories (must be explicit and programmable)

### Primary “Invention Class” (one or more allowed)

Your system must support **multi-label** classification (not single):

1. **PRODUCT/DEVICE** (physical object: syringe, umbrella, shoe)
2. **SYSTEM** (multiple interacting components; often includes software + hardware)
3. **METHOD/PROCESS** (steps; manufacturing, operating, analysis)
4. **COMPOSITION/FORMULATION** (chemical, materials, mixtures)
5. **SOFTWARE/ALGORITHM** (pure logic/data)
6. **BIOTECH/PHARMA** (bio materials, treatment)
7. **MANUFACTURING** (process + tooling + QA)
8. **SERVICE/WORKFLOW** (human-centered operational method; may still be patentable as method/system if technical)
9. **HYBRID** (auto-detected when multiple labels are strong; must fork or merge)

### Dominance logic (mandatory)

* Output must include:

  * `labels: [{class, weight}]`
  * `dominantClass`
  * `forkMode`: `single | fork | merge`
* Rule of thumb:

  * If top-2 weights close (e.g., within 0.15), run **fork** pipelines in parallel and merge results.

---

## 3) JSON contracts (LLM must return ONLY these objects)

### 3.1 InputNormalization JSON

Fields are strict; no prose.

* `coreEntity` (string)
* `intentGoal` (string)
* `constraints` (array strings)
* `assumptions` (array strings)
* `context` (domain/use setting)
* `negativeConstraints` (things user forbids: “no electronics”)
* `knownComponents` (array: parts)
* `unknownsToAsk` (array questions; UI may surface them)

### 3.2 Classification JSON

* `labels: [{class, weight, rationaleShort}]`
* `dominantClass`
* `forkMode`
* `archetype` (MECH/ELEC/SOFT/CHEM/BIO/MIXED)

### 3.3 DimensionGraph JSON

Mind-map nodes + edges.

* `nodes: [{id, type, title, descriptionShort, family, selectable, defaultExpanded, tags}]`
* `edges: [{from, to, relation}]`

Node `type` examples:

* `Seed`, `Component`, `DimensionFamily`, `DimensionOption`, `Operator`, `Constraint`, `IdeaFrame`, `EvidenceCluster`

### 3.4 CombineRecipe JSON

* `selectedComponents[]`
* `selectedDimensions[]`
* `selectedOperators[]`
* `recipeIntent` (divergent | convergent | risk-reduction | cost-reduction)
* `count` (how many ideas requested)

### 3.5 IdeaFrame JSON (core output)

Each idea must be “patent-friendly structured”:

* `ideaId`
* `title`
* `classLabels`
* `problem`
* `principle` (one-liner)
* `components` (list)
* `mechanismSteps` (list)
* `triggerCondition`
* `technicalEffect`
* `constraintsSatisfied`
* `operatorsUsed`
* `dimensionsUsed`
* `variants` (2–5)
* `claimHooks` (phrases to convert into claim elements)
* `riskNotes` (why it might fail)
* `searchQueries[]` (for novelty search)

### 3.6 NoveltyGate JSON

* `query`
* `results: [{source, title, snippet, url, similarityScore, whyRelevant}]`
* `conceptSaturation` (low/med/high)
* `solutionSaturation` (low/med/high)
* `noveltyScore` (0–100)
* `recommendedAction` (keep | mutateOperator | mutateDimension | narrowToMicroProblem | askUserQuestion)

---

## 4) Data storage tables (minimum set)

### Core tables

1. **IdeationSession**

   * id, tenantId, userId, createdAt, updatedAt
   * seedText, seedNormalizationJson, classificationJson
   * settingsJson (deterministic seed, model choices, budget caps)

2. **MindMapNode**

   * id, sessionId, nodeId (graph id), type, title
   * payloadJson, state (expanded/collapsed/hidden/removed)
   * createdBy (system/user), parentNodeId

3. **MindMapEdge**

   * id, sessionId, fromNodeId, toNodeId, relation

4. **CombineTray**

   * id, sessionId, selectedNodeIds[], recipeJson

5. **IdeaFrame**

   * id, sessionId, ideaFrameJson
   * status (draft/shortlisted/rejected/exported)
   * noveltySummaryJson, finalScore

6. **EvidenceResult**

   * id, ideaId, provider (serpapi/google_patents/etc)
   * rawJson, parsedJson, createdAt

7. **UsageLog**

   * tie into your existing system: per request token cost + serpapi call counts.

### Caching tables (cost control)

8. **SearchCache**

   * cacheKey (normalized query), provider, resultJson, expiresAt

9. **EmbeddingCache** (optional if you do local similarity)

   * textHash, embeddingVectorRef, model, createdAt

---

## 5) Stages + UI/UX + operations (expanded SRS table)

> Example used throughout: **Seed = “Disposable syringe that prevents reuse; low cost; no electronics.”**

| Stage | Feature (must exist)          | UI/UX elements                                                         | Execution (backend + LLM + search)                                                              | Example behavior                                             |
| ----- | ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0     | Entry point inside PatentNest | Sidebar menu: **Ideation**; “New Session” button                       | Create `IdeationSession`                                                                        | User clicks Ideation → New                                   |
| 1     | Seed input capture            | Seed textbox + optional “Goal” + “Constraints” chips                   | Store raw; call LLM → `InputNormalization JSON`                                                 | “Disposable syringe” + constraints                           |
| 2     | Clarify unknowns (optional)   | “Quick questions” card (dismissable)                                   | If `unknownsToAsk` non-empty, show; user answers update normalization                           | Ask: “One-time lock by breakage allowed?”                    |
| 3     | Classification                | Classification panel with multi-label pills + confidence               | LLM returns `Classification JSON`; user can override (manual reweight)                          | Product 0.82, Method 0.41 → fork?                            |
| 4     | Fork/Merge control            | Toggle: “Run multi-track ideation”                                     | If forkMode=fork → run 2 tracks (Product-track + Method-track)                                  | Track A: device; Track B: method                             |
| 5     | Dimension mind-map expansion  | Center canvas mind-map; left “Dimension families”                      | LLM returns `DimensionGraph JSON` seeded by dominant class/archetype                            | Families: Mechanism, Material, Lifecycle, Risk               |
| 6     | Expand/contract like mind-map | Click node to expand; collapse chevron; zoom/pan                       | Expanding triggers LLM “expand node” call for that branch only                                  | Expand “Risk: Reuse” → options                               |
| 7     | Selection operations          | Checkbox/select on nodes; multi-select; “Select path”                  | Update `MindMapNode.state`; add to CombineTray                                                  | Select “Reuse prevention” + “Breakage”                       |
| 8     | Prune operations              | Right-click node → Hide/Remove; “Undo”                                 | Mark node hidden; preserve for undo; no deletion from DB                                        | Hide “Electronics” branch                                    |
| 9     | Combine Tray (key UX)         | Right panel tray: Components / Dimensions / Operators                  | Tray builds `CombineRecipe JSON`; validates min selections                                      | Must have ≥1 operator OR auto-suggest                        |
| 10    | Operator Library (TRIZ-lite)  | Operator palette cards with icons                                      | System offers operator suggestions based on selected dimensions                                 | Suggest: Segmentation, Inversion                             |
| 11    | Generate Idea Frames          | “Generate” button with count slider (3/5/10)                           | LLM returns array of `IdeaFrame JSON`                                                           | Idea: “Plunger snaps after first full press”                 |
| 12    | Deterministic mode (debug)    | Settings: “Repeatable results” toggle + seed value                     | Pass deterministic seed to LLM strategy (fixed prompts, fixed sampling settings where possible) | Same input → same frames                                     |
| 13    | Novelty search trigger        | Auto-check toggle; “Run novelty check” per idea                        | Build queries from `searchQueries[]`; call SerpAPI; store Evidence                              | Searches “breakable plunger reuse prevention syringe patent” |
| 14    | Evidence visualization        | Evidence drawer: clustered results, similarity bars                    | Parse results; compute similarity + density heuristics                                          | Shows 8 similar hits                                         |
| 15    | Novelty Pressure Gate         | Gate status badge: Green/Amber/Red                                     | LLM produces `NoveltyGate JSON` + recommended action                                            | “Solution saturated → mutate operator”                       |
| 16    | Mutation actions              | Buttons: “Mutate operator”, “Mutate dimension”, “Narrow micro-problem” | Execute recommended action: regenerate only delta (cheap)                                       | Swap Segmentation → Chemical change                          |
| 17    | Micro-problem drill-down      | “Zoom into sub-problem” node expands                                   | Create sub-branch for specific pain point (needle reuse, contamination, plunger reset)          | Focus: “plunger reset prevention”                            |
| 18    | Compare ideas                 | Compare table view: novelty, feasibility, cost, manufacturability      | Score using heuristics + LLM “critic” (budgeted)                                                | Idea B wins: high novelty                                    |
| 19    | User editing / manual tweaks  | Edit Idea Frame fields with locked schema                              | Edits create “user override” layer; preserve original                                           | User edits constraint: “must be ISO syringe compatible”      |
| 20    | Shortlist / library           | Save/star; tags; folders; session library                              | Update IdeaFrame status; allow retrieval later                                                  | “Shortlist 2 ideas”                                          |
| 21    | Export to drafting            | “Send to Patent Draft” button                                          | Convert IdeaFrame → PatentNest Invention Facts object                                           | Start draft with selected idea                               |
| 22    | Audit trail (traceability)    | “Why this idea?” panel                                                 | Show operators/dimensions + evidence links                                                      | “Operator: Inversion; Dim: Lifecycle”                        |
| 23    | Safety & guardrails           | “Not for medical advice / compliance notice”                           | Rules: avoid giving unsafe usage instructions; focus on design-level                            | For syringe: avoid misuse guidance                           |
| 24    | Session persistence           | Autosave indicator; session timeline                                   | Persist nodes + tray + ideas; restore view state                                                | Resume tomorrow                                              |
| 25    | Collaboration (optional)      | Share session (tenant), comments                                       | RBAC + comment threads per idea node                                                            | PI reviews branches                                          |

---

## 6) LLM integration plan (how to force JSON + control cost)

### 6.1 How we force JSON reliably

**Hard rule:** every LLM call must use:

* “Return ONLY valid JSON matching schema X”
* “If missing info, fill `unknownsToAsk` rather than inventing facts”
* Strict server-side JSON validation:

  * If invalid → one repair attempt using a cheaper “JSON repair” prompt
  * If still invalid → fail gracefully and show “Regenerate” option

### 6.2 Cost controls (practical + strong)

1. **Branch-local generation**: expanding a node calls LLM only for that branch (not whole graph).
2. **Caching**

   * SearchCache by query hash (SerpAPI is expensive)
   * Reuse evidence across similar ideas
3. **Two-model strategy**

   * Cheap model for: classification, dimension expansion, UI micro-copy
   * Strong model only for: final IdeaFrame generation + novelty reasoning
4. **Token budgets per session**

   * Session budget slider: Low/Med/High
   * Hard stop when user hits cap; allow “continue with low-cost mode”
5. **Dedup before search**

   * Generate 10 ideas → embed cluster locally → novelty-check only top 3 distinct clusters
6. **Novelty gate stages**

   * First pass: cheap heuristic from search snippets + similarity
   * Second pass (only if shortlisted): deeper LLM analysis
7. **User-driven search**

   * Default: run novelty only when user clicks “Check novelty”
   * Auto-check can be enabled but limited to top N ideas

---

## 7) Known cracks, bugs, loopholes, edge cases (must handle)

1. **Hybrid inputs** (“smart shoe”, “AI-based agriculture credit”)

   * Must fork and show tracks; user can merge or choose track.
2. **Too-vague seed** (“make education better”)

   * System must ask clarifying questions; do not hallucinate domain.
3. **Overloaded mind-map** (100+ nodes)

   * Must have “collapse all”, “show selected path”, “focus mode”.
4. **User selects incompatible dimensions**

   * CombineTray validator must warn but still allow “force generate”.
5. **SerpAPI noise / irrelevant results**

   * Must show “why relevant” and allow user to mark result irrelevant (feedback improves ranking).
6. **False “saturation”**

   * Must distinguish concept vs solution saturation; offer “micro-problem narrowing”.
7. **Medical / safety sensitive domains**

   * Must avoid instructions for wrongdoing; stay at design/patent level.
8. **Determinism expectations**

   * True determinism across LLMs is hard; implement “best-effort determinism” with fixed prompts + stable settings + caching.
9. **User deletes branch then regrets**

   * Soft-delete with Undo stack is mandatory.
10. **Export mismatch** (IdeaFrame missing elements needed by drafting)

* Export adapter must validate and request missing fields.

---

## 8) “Simulator” to test UI/UX before implementation

Yes—build a **clickable simulator** *before* coding real LLM/search:

### Simulator MVP (fastest path)

* A mock UI where:

  * mind-map expands using **static JSON fixtures**
  * “Generate ideas” returns **pre-baked IdeaFrame JSON**
  * “Novelty search” returns **cached sample results**
* Goal: validate **operations, flows, and UX** without spending tokens.

### What you’ll validate in simulator

* expand/collapse usability
* combine tray flow
* pruning/undo
* compare/shortlist/export journey
* information overload control

(Once UX is correct, swap fixtures with real backend calls.)

---

## 9) Is anything still missing for an AI agent (Cursor) to build it?

This SRS is **buildable**, but Cursor will still need two explicit add-ons to avoid “interpretation drift”:

1. **Exact schemas** (as JSON Schema files) for:

   * InputNormalization, Classification, DimensionGraph, CombineRecipe, IdeaFrame, NoveltyGate
2. **API endpoint list** (names + request/response bodies):

   * `/ideation/session/create`
   * `/ideation/normalize`
   * `/ideation/classify`
   * `/ideation/graph/expand`
   * `/ideation/idea/generate`
   * `/ideation/novelty/check`
   * `/ideation/idea/mutate`
   * `/ideation/idea/export`

If you want, I’ll produce those **schemas + endpoint contracts** next (still no code), so Cursor can implement without guessing.
