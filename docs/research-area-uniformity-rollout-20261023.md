# Shared research areas: production rollout, 23 October 2026

Status: deployed and verified. Production application commit: `8f3a06274d1191887e647ca6c690300194ff3664`; build: `uFJGkj3VBE-k60y8I768m`.

## Result

The 528 imported research-area labels are the current controlled collection across call editing and intake, directory and chatbot filters, saved interests, department settings, DSR filtering, matching and classification counts. Researchers can retain their own descriptions and keywords for Voyage semantic matching. Imported broad subjects remain separate; no subject hierarchy was invented.

Current classifications use one shared read boundary. Accepted corrections take precedence over old source tags. Previous selections and old links retain an explicit compatibility path. Original descriptions, vectors, saved preferences and historical classifications are preserved. Closed historical calls were neither reclassified nor deleted.

People matching now uses accepted area labels. Corrected classifications invalidate the report fingerprint, mark the stored result stale and enter the next bounded refresh instead of waiting for the normal six-hour cache expiry. Recorded assignments, applications and responsibilities remain authoritative.

## Normal intake and AI

The isolated production copy exercised real LLM extraction of call facts, guidelines and an embedded application form, followed by draft classification, publication, Voyage embedding generation, school mapping and actionable-queue relevance.

The research-area classifier reuses the 528 cached Voyage vectors, shortlists candidates and asks GPT-5.4 mini for an evidence-supported decision. The tested hematology call shortlisted 22 candidates and selected Hematology, Leukemia, Regenerative medicine and Stem cell biology. Publication reused the unchanged classification. Changing the research purpose produced a fresh decision; an accepted manual selection survived a forced automatic retry.

Two extraction defects were fixed: explicit form questions could be omitted when another part of the document was recognised as budget/attachments, and an OpenAI fallback could receive a larger output allowance than its model supports. Repeat extraction also verified that an approved template is preserved.

The configured GLM provider timed out from the server. GPT-5.4 mini was added as an explicit fallback to 15 funding extraction stage configurations and 9 funding extraction task configurations that had no fallback. Existing primary choices and existing fallback chains were preserved. Real tests passed for core, guideline and template extraction through that fallback. The original provider's connectivity issue remains; extraction can use the verified fallback.

Unsupported required facts are still reviewable: the test confirmed that publication refused a missing funding-kind field until it was explicitly supplied during review. No real users were notified by the tests, and no synthetic calls were inserted into production.

## Department conversion

All 215 original department-area links remain intact. Eleven units received additive, exact-label translations supported by the reviewed forward crosswalk. Previous routing scope remains available.

For the other 130 units, Voyage and GPT-5.4 mini prepared proposals from each unit's own name and confirmed scope. All 130 were imported as **pending proposals**, with no automatic approval, reassignment or notification. Superadmin can inspect the evidence and approve selected proposals. Deliberate scope removal remains an explicit department-editor action.

The department preview/batch cost estimate was **US$0.21439647**, below its US$2 cap. Real extraction smoke tests incurred separate provider usage. Progress and usage receipts are retained with the release backup.

## Verification

- Full unit run: 1,983 passed; only the two pre-existing Gemini service failures remained. Focused final checks and disposable PostgreSQL integration passed.
- Type checking passed. Lint had no errors; existing warnings remain. The additive migration check passed.
- Integration covered accepted-label precedence, precise department scope, universal calls, legacy filters, unique counts, stale proposal rejection, multi-area AI context, draft eligibility, manual decisions and report-cache invalidation.
- Browser checks passed for the shared collection, search, review acknowledgements, DSR area filter and the department area picker at desktop and 390-pixel mobile widths. The surrounding existing organisation tree can extend horizontally on narrow screens; the area dialog fits the viewport.
- Final live preservation checks confirmed all 10,359 calls, 215 original department links, 36 preserved table fingerprints and 58 original classification-history records. Other applications' process identities remained unchanged.
- Live testing identified a missing private/no-store header on the DSR facets response. The follow-up patch was built and verified on the isolated copy, then deployed. Private/no-store headers now cover DSR lists, facets and error responses.
- Live directory filters, universal calls and statistics reconciled. The default Open/Rolling directory contained 2,230 unique calls at verification time. DSR facets exposed the same 528 labels. All 115 tested catalogue methods rejected anonymous access, and a revoked session immediately lost access.
- All four Grapsi hostnames returned healthy responses and denied anonymous taxonomy access. The application remained bound to `127.0.0.1:3010`.
- Read-only Prisma comparison found no remaining `funding_calls` table/index drift. A pre-existing ON UPDATE difference on the referencing `funding_opportunity_matches` foreign key remains; the actual foreign key, including ON DELETE CASCADE, was identical in the restored pre-release copy and production after release. It was not modified.
- The existing active-call review still has 56 accepted classifications and 2 pending call classifications. Department proposals are a separate queue; all 130 remain pending.

## Recovery evidence

Focused backup: `/var/www/granter/Grapsi/backups/uniform-areas-1792679147136/before-active-areas.dump`.

SHA-256: `b689fe3d4be27d8a65fd97ca6dbbe26a122f56c1aa1316e0ebf7ae88990bdbe9`.

The 97,091,201-byte backup was restored and verified across 49 tables before rollout. The previous production build and the original LLM fallback settings are retained in the same protected release directory. Recovery does not require restoring a database over later user work.

The temporary rehearsal database, checkout, browser credential and intermediate application build were removed after verification. The focused backup and original recovery build remain protected on the server.

Application data access was confined to Grapsi and its temporary rehearsal copy. Only `grantmentor` was restarted. Patentnest and other applications' databases, processes, ports and Nginx configuration were left unchanged.
