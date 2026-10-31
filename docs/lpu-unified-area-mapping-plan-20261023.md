# LPU: one research-area vocabulary across calls, hierarchy and people

Planning update: the user chose researcher-based school routing as the primary approach. `lpu-researcher-first-routing-plan-20261023.md` controls the implementation priority and includes intake of the next faculty dataset. This document remains the supporting live audit and vocabulary/evidence assessment; full manual 528-area school mapping is not a prerequisite.

## Live evidence

Read-only, repeatable-read production audit at 2026-10-23 11:31:15 UTC. The target is `DSRLPU`, tenant `cmshc97c3005t6piv0y5c9c5n`. Two other LPU-named records are a one-user tenant and an empty test tenant; they were not included. No application record was changed, proposal accepted, model requested or notification sent during this audit.

| Measure | Live result |
| --- | ---: |
| Standard discipline labels / indexed vectors | 528 / 528 |
| Active users / researcher profiles | 774 / 768 |
| Active organisation units / root schools | 138 / 32 |
| Profiles placed in an active unit | 615 |
| Profiles with no unit | 153 |
| Invalid materialised unit paths / invalid linked units | 0 / 0 |
| Profiles with Voyage vectors / declared text areas | 768 / 768 |
| Distinct declared researcher labels | 238 |
| People with confirmed saved-area standard links | 0 |
| People with accepted PROFILE classification links | 0 |
| People whose text areas exactly match at least one standard label | 29 |
| Units with explicit standard selections / retained legacy selections | 11 / 138 |
| Distinct standard labels explicitly selected by units | 2: Chemistry and Physics |
| Units with pending LLM proposals | 130 |
| Visible published operational calls / with standard discipline links | 190 / 95 |
| Visible operational calls with at least one active stored school mapping | 31 |
| Catalogue-only published active calls / with standard links | 9,615 / 9,615 |

These call counts include historical deadlines; they are not open-call counts. The 190-call population excludes the catalogue-only population. Both `callMappingRoutingEnabled` and `mapBroadTier` are enabled for DSRLPU. Every root school has an active assigned DSR member, which does not itself prove that a member is available today.

The incomplete explicit selections do not mean all other calls are invisible: legacy compatibility and semantic person matching still operate. Conversely, having 768 embedded profiles does not establish complete deterministic standard-area search coverage.

The attached 528-row coverage matrix separates 2 areas already explicitly selected, 75 further areas with pending proposals, and 451 with neither. The last group is **unassessed**, not proof that LPU lacks that capability. The 138-row unit matrix includes actual selected areas, existing LLM suggestions, their reasoning and aggregate faculty-area evidence.

## The common binding

Use the existing immutable `catalogue_areas.id` as the common `area_id`. For example, Artificial intelligence is `scientify:discipline:2dd0692ccbadb1132a63c285eaf76547`. Its display label, local synonyms and free-text descriptions can vary without changing its identity.

An entity can have several area IDs. Keep LPU's real organisation tree separate from the flat collection of 528 disciplines. Do not invent a subject/discipline hierarchy from the nine imported subjects. Do not reduce a person or call to one area string.

The shared conceptual links are:

- Call to standard area, with source evidence and revision.
- Organisation unit to standard area, with confirmed institutional remit.
- Researcher to standard area, with expertise evidence and confirmation state.
- Researcher to actual organisation unit, from HR/administrative placement.
- Call to school responsibility, with the classification and unit evidence that justified routing.

An area is a common discovery key, not proof of grant eligibility, interest, current capacity or clinical authority.

## Correct the evidence before approving more mappings

The current organisation proposer (`researchAreas/organisationReview.ts`) uses a unit's name and its existing selected scope. It describes the old scope as confirmed. Individual faculty evidence is deliberately not currently used to redefine the department. This protects against accidental scope expansion, but it also means a wrong old seed can be translated into an apparently confident new suggestion.

Examples from live pending proposals:

- CSE / Programming proposes Medicine, Surgery, Public health and Epidemiology alongside AI and Cyber security because those old labels were supplied as confirmed scope. Its faculty evidence includes medical image analysis and AI for diagnostics. That supports a computing contribution to health research, not an automatic claim to lead clinical research.
- CSE / DevOps proposes Medicine and Interdisciplinary from the same type of inherited evidence. Multiple disciplines alone should not make Interdisciplinary an unrestricted routing catch-all.
- Biotechnology and Biosciences / Forensic Sciences proposes materials and pharmaceutical disciplines while omitting forensic remit. Its reasoning says the supplied scope provides no evidence for forensic science itself, even though its name and three of its four faculty profiles provide relevant forensic evidence.

These are review flags, not automatic decisions to delete genuine interdisciplinary activity. A stored `needsReview=false` from the current proposer does not resolve conflicting input evidence. Do not bulk-accept the 130 proposals unchanged or simply preserve every old area as permanent current routing scope.

## LLM-assisted mapping workflow

1. Resolve the 153 unplaced profiles from the roster and HR evidence. The LLM may propose an academic fit but must not invent an employee's actual reporting department. Until resolved, include them in institution-wide discovery and an explicit unplaced-researcher review queue.
2. Prepare one LPU evidence bundle per unit: school and ancestor names, unit remit where available, old mappings labelled as historical, confirmed canonical selections, faculty area frequencies and bounded research/publication evidence. Exclude names, emails and employee IDs from model input when they add no mapping evidence.
3. Reuse the cached 528-area Voyage index to retrieve candidates. Add literal matches and relevant existing candidates. Use a reverse pass over all 528 areas to find areas missed by unit-first retrieval; absence from an LLM shortlist is not evidence of no capability.
4. Ask the LLM for constrained IDs and cited input passages. Separate `institutional remit`, `researcher expertise` and `application/collaboration context`; report contradictions, missing evidence and unsupported candidates. These are proposed new metadata roles, not current application fields.
5. Map the 238 researcher labels through a reusable, versioned dictionary of exact equivalences, broader categories and related areas. Confirm per person against their summary/keywords when a label is ambiguous. Preserve their original labels and specificity. Do not treat a broad/related label translation as an exact synonym.
6. Validate every output ID against the current collection, verify quoted evidence exists, protect accepted human revisions and hash source inputs. A changed roster, unit scope or prompt invalidates a stale proposal. Model similarity and self-reported confidence are ranking signals, not probabilities.
7. Present a concrete impact preview: units and people affected, new call-school responsibilities, current routes proposed for retirement, and uncertain cases. Apply clean translations in bounded, auditable batches; retain ambiguous cases in review. Record deliberate scope replacement separately from add-only conversion.

The existing LLM proposals are useful candidate material, not the final mapping. No additional paid generation was necessary to identify the structural problems in this assessment.

## Propagation and matching rules

- A unit's confirmed areas roll upward to its school and the tenant, deduplicated by ID. A school may also have its own confirmed remit. Do not copy its union downward into every department or person.
- Faculty expertise may propose a new unit capability and support individual collaboration routing; it does not silently rewrite the institution's confirmed remit.
- A classified call reaches relevant units and their ancestor schools. A recorded qualifying researcher match may independently surface it as a collaboration opportunity, with that different reason visible.
- People are matched using their own area links and research evidence. A school-area match cannot be expanded into the whole school roster. Counts and person lists must use the same qualifying rows, scope, score policy and revision.
- Apply actual eligibility constraints before representing anyone as eligible. Distinguish a potential collaborator from an eligible lead investigator. Unknown eligibility is visible rather than assumed.
- Imported GLOBAL_CATALOG calls remain discovery results until an explicit institutional release policy promotes them. Preview school/person fit without creating DSR responsibility, notifications or artificial pendency. Release should be deduplicated by stable call ID, not by title or URL spelling.
- All-disciplines calls use universal-call semantics; do not stamp All disciplines onto every person. Interdisciplinary is not interchangeable with All disciplines.
- Keep current routing separate from historic accountability. Retiring an unsupported current mapping must preserve old allocations, audit dates and deadline ownership.

Example: a proposed AI-assisted crop disease call is classified with the existing Artificial intelligence and Plant science IDs, if the actual call text supports both. Agriculture can be reached through Plant science; CSE through its Artificial Intelligence and Machine Learning unit. Match individual plant-disease and AI researchers, and identify complementary collaborators. Other agriculture/computing staff do not automatically count as matched. Eligibility, once known, can still exclude a candidate.

## Application changes needed

Reuse existing catalogue IDs, classification revisions, evidence storage, organisation paths and DSR responsibilities. Add a shared effective-person-area reader that unifies accepted PROFILE links and relevant saved-area links with explicit source/confirmation metadata. Today PROFILE is an allowed write entity but Discovery's standard search reads saved-area links and exact text labels, not accepted PROFILE links. Merely writing PROFILE classifications would therefore leave a consumer gap.

Route all person search, person dossiers, matching input and coverage reporting through that reader. Keep personal alert opt-ins separate from institutional expertise discovery. Add explicit/effective unit-area readers for the approved scope; legacy compatibility becomes a visible transitional source rather than an invisible permanent authority.

Invalidate/rebuild dependent results on accepted call-area corrections, unit remapping/reparenting, researcher area or placement changes, activation changes and matching-policy changes. Use durable, idempotent jobs with revision fingerprints; an embedding/classification failure must show incomplete or stale coverage instead of a successful zero. Deduplicate deliveries and expose failures/retries.

The earlier local DSR fixes remain a separate undeployed change set. They improve queue completeness and reliability but do not by themselves resolve these classification/placement gaps.

## Complete coverage means accounted-for exceptions

Every standard area needs a reviewed LPU status: confirmed capability, pending evidence, no currently evidenced capability, or a deliberate routing exception. An area can belong to several departments/schools; some areas may have no current LPU capability. Forcing every area into a school merely to reach 100% creates false positives.

The dashboard should expose:

- Area to schools/departments/people, with confirmed versus proposed evidence.
- People missing placement or standard-area confirmation.
- Units with old-only mappings, contradictory evidence or unresolved scope.
- Classified calls with no institutional route and unclassified released calls.
- Relevant schools with zero qualifying people or no available coordinator.
- Queue delivery failures, outdated projections and an explainable route for every responsibility.

Release checks: all 138 active units have a reviewed coverage status; all 768 profiles have confirmed placement or an explicit unresolved state; all 528 areas are accounted for; accepted IDs resolve; no silent downward expertise inheritance; every released call is routed or in a visible exception queue; unique person/call counts reconcile with detail lists; old work and manual corrections survive remapping. Include negative examples from Programming/Medicine and interdisciplinary crop-AI examples, not just positive overlap tests.

## Suggested execution order

1. LPU placement and seed-scope correction; validate the prepared matrices.
2. Evidence-aware LLM proposals and reviewed 238-to-528 vocabulary bridge.
3. Shared person/unit readers and area coverage UI with route explanations.
4. Dry-run existing open, released calls; reconcile counts and prevent notification floods.
5. Bounded application, match refresh and routing activation; monitor explicit exceptions.

This is a verified assessment and implementation plan. The audit and review matrices are complete; this new mapping model has not been implemented or applied to production.
