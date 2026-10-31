# Pending-work review — 31 October 2026

## Release scope

- Remove third-party catalogue attribution and listing links from Key facts and the Send to DSR preview. Internal import provenance remains intact.
- Retain the DSR workflow fixes: durable publication routing, retry visibility, atomic notification claims, tenant-scoped allocations and notices, effective entry deadlines, historical deadline accountability, complete school backlog and personal contribution counts.
- Retain the head-only researcher-routing preview, shared scoring configuration/fingerprint, and read-only faculty roster preflight. Researcher-based automatic routing remains disabled; the preview does not create responsibilities or allocations.
- Retain server protection that strips incoming middleware invocation headers before forwarding to the application.

## Review corrections and cleanup

- The local research-area AI draft removed the organisation-review argument and its organisation-specific behavior while the caller still required it. Preserve the existing compatible implementation; archive the draft patch rather than ship the regression.
- Exclude local worktrees and generated output from test discovery and TypeScript compilation. The original test command discovered duplicate suites inside two local worktrees; those copies resolved imports against this checkout and produced misleading failures.
- Ignore future generated output and local worktrees in Git. Existing tracked award deliverables are unchanged.
- Move 13 untracked output directories out of the repository. They contain generated screenshots/reports, deployment bundles, old worker installers, benchmark experiments and private roster exports. Preserve them in the local archive; do not commit personal roster data or release binaries.
- Keep the blank faculty CSV template at `docs/templates/lpu-additional-faculty-template.csv` and update its instructions.
- Fix the unescaped apostrophe reported by lint in the modified management workspace.
- Correct two stale Gemini test expectations to use the canonical model name already used by the service. Retain the legacy-name request in the rate-limit test so it verifies alias resolution and fail-fast behavior. No provider implementation changes were needed.
- Archive the stale, empty Git index lock dated 23 October after checking for a Git write operation; it prevented commits.

Local archive: `C:\Users\raman\Documents\Grapsi-local-artifacts\2026-10-31-review`.
The `outputs` subdirectory preserves the old output paths below that archive root. Historical documents referring to those reports describe earlier validation; the files are not runtime dependencies.

## Current checks

- Final full default test run: **2,118 tests passed**, zero failures, across 266 test files. Real-database integration suites remain excluded by the existing opt-in configuration. The JSON result is preserved as `tests-final.json` in the local archive.
- TypeScript check passed in the main checkout.
- 196 targeted tests passed across 24 suites (DSR, allocation, routing, roster preflight and research areas).
- Both PostgreSQL fixture checks passed in read-only transactions: DSR workflow/report queries and researcher-routing preview queries. No fixture rows were inserted.
- Prisma schema validation passed.
- Targeted lint passed after fixing the reported apostrophe.
- The optimized production build passed in a separate temporary output directory (build `Z-v1LGJ8D9bPmmI0XFL9I`); TypeScript and lint were checked separately. The temporary build was moved to `validation-build` in the local archive. Existing Browserslist age/deprecation notices remain.

## Deployment requirement

Apply `20261023110000_dsr_workflow_reliability` before activating the new application, then regenerate the Prisma client and build. The migration adds completion outcomes, routing jobs, notification claims and the publication trigger; it does not enqueue the historical catalogue.

Keep the authenticated reminder sweep scheduled; it recovers failed routing jobs. The normal publish path starts a queued job immediately. No production migration or deployment was performed during this commit review.
