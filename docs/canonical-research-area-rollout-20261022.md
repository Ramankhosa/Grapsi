# Canonical research-area rollout — 22 October 2026

Application commit: `270de656c8b5c16fa3dec842b9b075855c356d72`.
Production build: `i8a_Kc1GRxKHk51i97iMu`.
Target: `/var/www/granter/Grapsi`, database `grapsi`, PM2 `grantmentor`.

## Result

- The 528 imported discipline labels are the standard vocabulary for current
  directory, call, researcher-interest and organisation-area selections.
- Created 528 `voyage-4-large` vectors, at 1,024 dimensions. No substitute
  embedding provider was used and existing call embeddings were unchanged.
- Generated 58 proposals for eligible existing OPEN/ROLLING calls using Voyage
  shortlists and GPT-5.4 mini purpose/evidence checks. Accepted 56; retained two
  proposals for review. Original funding records and taxonomy links remain.
- Existing imported classifications were preserved. Closed, expired, future,
  unpublished and inactive calls were excluded from this batch.
- Four calls marked rolling had past deadlines and were excluded. No records
  were deleted or automatically closed.
- Custom research text remains supported. Suggested standard areas are optional
  and require user selection. Existing alert/default preferences remain intact.

The two pending proposals are the RP&SD administrative-office page, which does
not identify a funding research purpose, and the DFTM/DIA-CoE call, whose
specific research problems are not present in the available text. The latter's
broad defence suggestion was not automatically approved.

Recorded conservative usage estimate: **US$0.18590541**, under the US$2 job
allowance. This includes failed-request reservations and a byte-based embedding
estimate; it is not an invoice. Review model pricing reference:
[OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[Voyage](https://docs.voyageai.com/docs/pricing).

## Department and school routing

Calls and departments are matched through their research areas. A school's
effective scope includes its departments. Direct overlap or configured school
keywords can produce operational routing; broader group routing depends on the
institution's `mapBroadTier` setting. Explicit All disciplines calls match
configured school profiles. Unconfigured schools do not receive automatic
operational mappings; unclassified calls remain available for review.

The original, reviewed import crosswalk is reused in its forward direction
(new area to legacy area) to preserve existing department scope. It is not
inverted to assign many new labels to an old broad label. Administrators can
select precise new labels; older broad selections retain broader compatibility.
The 215 original department links were not rewritten.

Embeddings shortlist research labels for classification. School routing itself
uses explicit area/keyword rules and recorded administrator decisions, rather
than embedding similarity between call and department names. This rollout did
not regenerate school allocations or change existing DSR work. Imported calls
continue to enter the DSR workflow through promotion.

## Preservation and verification

- A focused 94,389,935-byte backup was restored to an isolated database before
  migration/application rehearsal. The backup explicitly includes department
  structure and area links.
- SHA-256:
  `071d241d76f28b736f5cda4b1826e4fa42c01fb99fc4e35b8ec27fe2f1fc8d5c`.
- Production preservation fingerprints matched across 34 original tables,
  including all **10,359 calls**, **215 department links**, profiles, saved
  interests, notification preferences, assignments and checked DSR records.
- The migration adds four tables and four views. Classification revisions are
  separate from original funding/profile data.
- Unit suite: **1,977 passed; two previously known Gemini fallback failures**.
  Typecheck and lint passed; lint retains existing warnings. Additive migration
  validation and isolated PostgreSQL integration checks passed.
- Isolated browser checks passed for review, canonical multi-selection, optional
  custom research text, mobile layout and directory filtering, with no browser
  errors or server-error responses.
- Live tests passed for corrected DKMS filtering, broad Kothari eligibility by
  area, canonical call-area display, reconciled statistics, private call
  responses, 113 unauthenticated method denials and immediate session revocation.
  Default Open/Rolling directory count was 2,243 at verification.
- Both hostnames and their www aliases returned healthy responses and rejected
  unauthenticated taxonomy access. The listener remains `127.0.0.1:3010`.
- Read-only Prisma comparison found no remaining `funding_calls` table/index
  drift. It reports an existing other-table relationship difference for
  `funding_opportunity_matches`: its live FK has ON DELETE CASCADE but omits the
  schema's ON UPDATE CASCADE. The restored pre-release schema and production
  have the identical FK definition. It was left unchanged.
- Only `grantmentor` was restarted. Other recorded PM2 process identities were
  unchanged; no other application's database or Nginx configuration was changed.

Operator evidence and verified backup remain under
`/var/www/granter/Grapsi/backups/active-areas-1792670687605`.
The previous production build is retained there as `previous.next`.
The owned rehearsal database/checkout and temporary browser token were removed
after successful verification. Available disk space before that cleanup was
156.1 GiB.

## Behaviour rollback

Set `CANONICAL_RESEARCH_AREAS_ENABLED=false` in the Grapsi environment and update
that flag when restarting **only** `grantmentor`. Keep the additive tables and
revision history. An application rollback must not restore a backup over newer
production work. The original funding records remain available throughout.
