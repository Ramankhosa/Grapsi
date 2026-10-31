# LPU researcher routing groundwork — 23 October 2026

Status: implemented locally as a read-only preview. Not deployed. Automatic routing activation remains disabled pending the combined faculty roster, evidence review and calibration.

## Available groundwork

- `/funding-dept/routing-preview`, linked from the management workspace for department heads and tenant-wide administrators.
- Head-only `GET /api/funding-dept/routing-preview` derives the tenant from the authenticated session, uses private/no-store responses and rejects client tenant overrides or activation parameters.
- Open released calls can be searched and paged. Catalogue-only, unpublished, inactive, closed and another tenant's private calls are excluded.
- A repeatable-read, database-enforced read-only transaction loads saved matching rows, school mappings, available coordinators and profile readiness. It does not enqueue matching, write a responsibility, allocate work, notify anyone or request a model.
- The preview derives strong/moderate counts and displayed people from the same deduplicated saved rows and the institution's existing match-width thresholds. Below-threshold suggestions are separate. Retired/manual/inferred rows do not establish a new researcher-based route.
- Saved matches that disagree with a person's current active school placement are excluded and flagged. Unplaced/invalid-placement profiles, missing Voyage research indexes and missing primary research descriptions are counted institution-wide; the first 20 affected profiles are shown with a faculty-directory link. Issue counts can overlap.
- Research fit and known career-stage/institution-type conflicts are separate. Even without a detected conflict, the preview explicitly requires full eligibility review and never asserts that medical-AI expertise establishes clinical-PI eligibility.
- Missing, old-version, fingerprint-changed, aged and vector-only snapshots have distinct warnings. A current reranked snapshot still does not certify that every evidence source was complete.
- Full matching lists are paged at ten researchers per school; changing searches discards late older responses. There is no activation or assignment action on this screen.

The common fingerprint implementation was moved into a provider-free module and re-exported at its previous location. Scoring/census version values and the fingerprint query are unchanged; existing readers keep their imports. Shared coordinator SQL now also accepts a bound call expression without raw placeholder interpolation.

## Faculty preflight for the next dataset

Use `docs/templates/lpu-additional-faculty-template.csv`. The basic template has Name, Email, Employee ID, Unit Path, School, Department, Designation, Research Areas, Keywords and Research Summary.

The new command produces a local private JSON preflight report and **cannot import or activate anything**:

```powershell
node scripts/run-local-command.js node ./node_modules/tsx/dist/cli.cjs scripts/preview-lpu-faculty.ts --file="C:/path/faculty.xlsx" --tenant-id=cmshc97c3005t6piv0y5c9c5n --out="C:/private/lpu-preflight.json"
```

It is deliberately restricted to the audited DSRLPU tenant and reads the roster/hierarchy in a repeatable-read, read-only transaction. It supports the prepared CSV/XLSX headers; it does not infer arbitrary HR workbook columns. The report flags every occurrence of duplicate email/staff numbers, ambiguous existing identity, changed email, conflicting staff numbers, unknown hierarchy paths, department names under the wrong parent, missing placement, proposed staff moves, missing new-person research evidence and explicit blank update fields needing a preserve/clear decision. No names or email addresses are printed in the console summary. The JSON contains personal roster details and belongs in private storage.

An `UPDATE` disposition means the row is matched to an existing identity with no preflight blocker; it is not a complete field-by-field change calculation or authority to overwrite manual corrections. `REVIEW` means the existing importer must not receive that row unchanged. Unit-name spelling aliases and changed email identities require deliberate reconciliation. Access/leadership columns are rejected in this research-data batch. No departments are auto-created.

## Verification

- New policy/preflight/route/service tests cover count/list identity, thresholds, weak suggestions, deduplication, changed placement, missing placement, eligibility uncertainty, stale/missing results, tenant fences, head-only access, parameter validation, duplicates, school moves and blank-field preservation.
- `scripts/verify-researcher-routing-readonly.ts` executes the actual preview SQL against SELECT-only shadow fixtures in PostgreSQL. It proves eight counted/listed faculty, tenant/activation isolation, moved/unplaced exclusions, nested coordinator call binding, catalogue exclusion, readiness counts and missing-result handling. It inserts no rows and invokes no provider.
- `scripts/verify-researcher-routing-ui.cjs` uses synthetic intercepted APIs on loopback only. Desktop/mobile checks cover eight-count/eight-list, larger-list pagination, stale/missing warnings, unplaced-profile explanations, search races, no overflow and no routing/model mutations.
- The original validation used an isolated release checkout with the compatible area classifier. During the 31 October commit review, the incompatible local classifier draft was archived, the compatible implementation retained, and the root-checkout type check passed. See `uncommitted-work-review-20261031.md` for current validation and artifact locations.
- Targeted lint passes; existing repository warnings outside these changes remain.

Browser artifacts are under `outputs/lpu-routing-groundwork/`. This Windows validation build is not a deployable Linux bundle.

## Pending after the new faculty data

Reconcile the new file with the existing 768 profiles; correct the 153 placement gaps where evidence permits; generate/retry genuinely missing or changed embeddings; review research evidence and a cross-discipline call sample; validate retrieval completeness as the roster grows; add the shared accepted-person-area reader before relying on PROFILE area classifications across all consumers; finalise lead/collaborator eligibility policy and routing thresholds; and preview the workload impact.

The central issue counts are groundwork, not a newly activated exception workflow. New durable automatic researcher-derived responsibilities, LLM adjudication jobs, expanded eligibility interpretation and final routing activation are intentionally outside this read-only preview. Existing live DSR routing is unchanged. The earlier undeployed DSR reliability migration/fixes remain a separate release dependency to assess before any deployment.
