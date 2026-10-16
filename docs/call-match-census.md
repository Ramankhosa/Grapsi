# The call-to-people match census

## The problem this fixes

A coordinator opening a call window saw a figure that disagreed with its own
list: **"Matched faculty: 5"** above a list whose top two people were labelled
`WEAK`. On the Incoming Calls report the same call claimed **121 matched
faculty** across sixteen schools. Opening those people showed they did not
match the call.

The two numbers came from two different algorithms running in opposite
directions:

| | Direction | Tiering | Used by |
|---|---|---|---|
| `person-call-census-v1` | for each researcher, *which calls suit me?* | relative to **that researcher's own best call** | every "matched faculty" figure |
| `researcherSearchService` | for each call, *who suits this call?* | Voyage reranker, **absolute** thresholds | the call window's list |

Because v1 tiered each person against their own best call, **everybody's top
call came out `strong`** however poor the fit. A broadly-worded call sits near
the top of many people's lists, so it collected a `strong` row from each of
them — which is where "121" came from. The same pair could therefore be
`strong` in the count and `weak` in the list.

## The fix

The census now runs in the **same direction as the list, through the same
pipeline**, and the call window reads the stored rows back instead of searching
again. One scoring, written once, read by both.

- `src/lib/fundingDept/callMatchCensus.ts` — scores one call against the
  tenant's people (`researcherSearchService` in `census: true` mode) and writes
  `funding_opportunity_matches` rows at `source_version = 'call-people-census-v2'`.
  Tenant-wide per call on purpose: a call reaching twenty schools is scored
  once, and each school reads its slice.
- `src/lib/fundingDept/currentMatches.ts` — unchanged public API
  (`reportSchoolMatchStates`, `queueSchoolMatchRefresh`,
  `refreshCurrentSchoolMatches`), but it now schedules call censuses rather
  than looping researchers. Reports never wait for it.
- The dossier route serves `people` from the stored census, falling back to a
  live search (flagged as `peopleBasis: 'live'`) only for a call the census has
  not reached yet.

### Counting rules, in one place

`reportDefinitions.ts` owns both forms:

- `currentQualifyingMatchSql(alias)` — what a *live* "matched faculty" figure
  counts: current, automatic, `strong` or `moderate`.
- `qualifyingMatchSql(alias, deadline)` — the pendency form, which does not
  require `is_current` so a call missed months ago still shows the matches it
  had then.
- `UNCOUNTED_MATCH_VERSIONS` — `manual-allocation-v1` (a human decision, not a
  match) and `person-call-census-v1` (the retired scoring). Those rows stay in
  the table as history and are counted nowhere.

Reports brought onto the shared rule: Incoming Calls, the call window's school
table, Pendency, the member funnel (`memberFunnelService`) and the management
report (`managementService`) — the last two had been counting weak and
reconstructed rows as matched faculty.

**Routing is deliberately not tightened.** `actionableSchoolCallWhereSql` still
routes a call to a school on *any* current match, weak included. "Is this worth
a look?" should be generous; "how many faculty match?" must not be. Tightening
routing to the counted tiers would empty the school queues of everything the
taxonomy had not already mapped.

## Cost

Scoring is bounded by `dsr_match_score_cache`, keyed by
`(reranker model, call text, person document)`. Only a changed call or a changed
profile is re-scored, so a steady-state refresh makes **no reranker calls at
all**. A pass censuses at most 25 stale open calls, 125 ms apart. Closed calls
are never re-censused — their matches are history.

## Match width — the institution chooses how good is good enough

A cross-encoder's absolute scale is domain-specific: calls and profiles written
broadly score lower than sharply-worded ones, and an agency's house style moves
the whole distribution. There is no cutoff that is right for every institution,
so it is a setting — expressed the way an office actually thinks about it.

`src/lib/fundingDept/matchBands.ts` owns all of it:

| Width | Strong match | Good match | Counts |
|---|---|---|---|
| **Narrow** (default) | ≥ 0.65 | ≥ 0.50 | strong + good |
| **Balanced** | ≥ 0.55 | ≥ 0.42 | strong + good |
| **Wide** | ≥ 0.45 | ≥ 0.35 | strong + good |

Narrow is exactly what shipped before the setting existed, so a tenant that
never opens the screen sees no change. "Possible match" is shown on every list
and counted by none of them.

**The band is derived, never stored.** `match_tier` is still written for history
and for pre-scoring rows, but every count and label comes from `match_score`
compared against the tenant's cutoffs at read time. That is what makes the
setting usable: moving it re-labels every report instantly, with no re-census
and no reranker spend. Stored bands would mean re-scoring the catalogue on every
change.

Set at **Tenant admin → Funding department → "How wide a match counts"**
(`MatchWidthCard`), which shows what each width would do to that institution's
own figures before they commit — read from scores already stored, so the preview
is free. Stored as `dept_settings.matchWidth`; no migration.

Coordinators can also try a width from the call window's **Match width**
control without changing the institution's setting (`?width=` on the dossier and
schools routes). It re-counts stored scores; it never re-scores anything.

### Underlying knobs

The widths sit on top of the retrieval gate, which decides what is stored at
all and stays env-tunable:

```
RESEARCHER_MATCH_RERANK_GATE=0.35    # below this, not stored, so never countable
RESEARCHER_MATCH_RERANK_STRONG=0.65  # only the live search's own tiers
RESEARCHER_MATCH_RERANK_MODERATE=0.5
```

Because the widest band starts at the gate, everything stored can count at
Wide. Lower the gate only if Wide still reads too empty — and note it increases
what is stored.

`scripts/verify-call-match-census.ts` prints the live distribution, which is the
same evidence the admin card shows:

```
Reranker calibration — 101 scored (call, person) pairs
  max 0.490 · p10 0.363 · median 0.291 · min 0.236
    >= 0.50      0  (0%)
    >= 0.45      3  (3%)
```

On the dev corpus some seeded calls score no higher than 0.49 and so report
**0 matched faculty** at Narrow, while a well-targeted call reaches 0.52–0.59
and reports normally. That spread is the argument for the setting: run the
script (or open the admin card) against production and let the office pick.

## Release steps

1. `npx prisma migrate deploy` — `20261014100000_call_people_match_census`
   adds `dsr_call_match_state` and `dsr_match_score_cache`, marks every v1 row
   `is_current = false`, and clears `dsr_match_projection_state` so each school
   rebuilds.
2. Confirm `VOYAGE_API_KEY` is set. Without a reranker the census falls back to
   relative vector gating — still call-centric and therefore still consistent,
   but less well calibrated. `dsr_call_match_state.basis` records which was used.
3. Run `scripts/verify-call-match-census.ts` and calibrate as above.
4. Expect the first sweep to be the expensive one: every open call is scored
   once. After that the cache absorbs it.

## Verifying

`scripts/verify-call-match-census.ts` checks, per call and school, that:

- the figure a report counts equals the qualifying people in the list,
- no counted person is ranked below a weak one,
- no retired v1 row is still current, and every current automatic match comes
  from the new scoring.

Because a corpus can score everything below the threshold (making the first
check pass trivially at 0 = 0), the script also re-runs with the moderate
threshold lowered to 0.40 and proves the invariant where it can actually fail.

## Mapping-logic audit (15 Oct 2026)

Reviewed alongside this work: `callSchoolMapping.ts`, `disciplineMatcher.ts`,
`callUnitRelevance.ts`.

**Fixed**

1. **Drafts were mapped to schools.** `remapSchoolOpenCalls` carried its own
   copy of the visibility predicate with no status test on the tenant's own
   calls, so editing a school's research areas mapped unpublished drafts to it.
   Nothing displayed them (every report filters on visibility), but the row
   carried `mapped_at` — the date "new" ages from — so a call drafted months
   before publication arrived already stale. Now uses the shared
   `visibleCallSql` / `openCallSql`, which also deletes the duplicated
   open-date SQL.
2. **`planTenantMappings` did not scope calls to the tenant.** It takes a
   tenant and call ids as separate arguments and trusted the pairing; one wrong
   caller would map another tenant's private call into this tenant's schools.
   Now filtered through `visibleCallSql`. No caller was doing this — it closes
   the hole rather than fixing a live bug.

**Deliberate, documented, left alone**

- *Unmapped schools are treated oppositely by the two modules.* Mapping gives
  an unmapped school nothing ("its profile would otherwise match every call");
  relevance falls back to the whole catalogue so the school still sees work.
  Different questions, defensible answers — but worth knowing before reading a
  report for a school with no research areas set.
- *Global shadowing in `disciplineMatcher.firingTerms`.* A longer term
  suppresses a shorter one it contains, across all areas at once. Text saying
  both "machine learning" and "learning outcomes" loses the Education hit. The
  alternative (per-area shadowing) regressed worse: it let one phrase fire every
  area beneath a group.
- *Add-only mappings.* Narrowing a school's profile never removes
  responsibilities it already has; only the head ends a mapping, with a reason.
