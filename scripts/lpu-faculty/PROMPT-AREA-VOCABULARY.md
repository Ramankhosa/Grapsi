# Research-area vocabulary prompt

Attach `lpu-area-vocabulary.xlsx` and give Claude the prompt below.
Ask for the completed workbook back with the same rows and one column filled.

This is ONE job over 1,857 labels — not 855 separate researcher jobs. Once the
mapping comes back, every researcher is re-labelled locally at no cost.

---

## PROMPT — copy from here

You are standardising the research-area vocabulary for a university's
Directorate of Sponsored Research, so that researchers can be matched to funding
calls.

The attached workbook's "Labels" sheet has 1,857 rows. Each row is a research
area label currently attached to at least one researcher, along with how many
researchers use it and a sample of their keywords. The `Canonical Label` column
is empty. Fill it in.

### The problem you are solving

These labels were written one researcher at a time, so they are far too finely
split. 1,512 of the 1,857 are used by exactly ONE researcher. Three separate
labels read "5G Communication", "5G Wireless Technology" and "6G Wireless
Communication" — that is one field, written three ways. When a funding call about
wireless communication arrives, none of them reliably matches.

The obvious overcorrection is just as bad. Collapsing everything to
faculty-level buckets like "Agriculture", "Engineering" or "Management" would
mean a single call recommends 117 researchers at once, which is noise, not a
recommendation.

### The target

Aim for roughly **300 canonical labels**, such that each ends up shared by about
**5 to 15 researchers**. The `Used By` column tells you how many researchers each
input label carries, so you can keep a running sense of how large a group is
getting as you assign labels to it.

If a canonical label looks like it is heading past ~25 researchers, it is too
broad — split it into two more specific fields.

### Rules

1. **Fill only the `Canonical Label` column.** `Current Label`, `Used By` and the
   keywords column must come back exactly as supplied.
2. **Return all 1,857 rows, in the same order.** Do not drop, merge, reorder or
   deduplicate rows. Two rows mapping to the same canonical label is the whole
   point — they stay as two rows.
3. **A canonical label must be a real, recognisable field of study** at the
   granularity a funding call would name: "Wireless Communication Systems",
   "Post-Harvest Technology", "Medicinal Chemistry", "Computer Vision".
4. **Never use a bare faculty-level word** as a canonical label — not
   "Agriculture", "Engineering", "Chemistry", "Management", "Science". These are
   the buckets that produce 117-researcher matches.
5. **Never make a canonical label narrower than the input label.** You are
   merging upward, never splitting downward.
6. **Group by what is actually studied, not by wording.** "Fruit Crop Production
   and Orcharding" and "Horticultural Stress Physiology" are both horticulture.
   "Deep Learning for Medical Imaging" belongs with medical image analysis, not
   with general deep learning.
7. **A label used by many researchers is usually already the right size.** If a
   label's `Used By` count is 5 or more, prefer keeping it as its own canonical
   label rather than folding it into something else.
8. **Reuse canonical labels across rows aggressively.** Ending up with 1,200
   canonical labels means the job was not done; ending up with 40 means it went
   too far.

### If you process this in batches

1,857 rows is a lot. If you work through it in chunks, do it in **two phases**,
because otherwise chunk 3 will invent "Wireless Communications" while chunk 1
already used "Wireless Communication Systems" — recreating the exact
fragmentation this task exists to remove.

**Phase 1 — decide the vocabulary first.** Read all 1,857 labels, then write out
the ~300 canonical labels you intend to use, as a numbered list. Show me this
list before mapping anything.

**Phase 2 — map every row to that fixed list.** Work through the rows in
batches, assigning each one a label from the Phase 1 list. Do not introduce a
new canonical label mid-way; if you hit something genuinely unfitting, note it
and keep going, and we will add it deliberately at the end.

### Worked example

| Current Label | Used By | Canonical Label |
|---|---|---|
| 5G Communication | 1 | Wireless Communication Systems |
| 5G Wireless Technology | 1 | Wireless Communication Systems |
| 6G Wireless Communication | 1 | Wireless Communication Systems |
| Fruit Crop Production and Orcharding | 1 | Horticulture and Fruit Science |
| Horticultural Stress Physiology and Biostimulants | 1 | Horticulture and Fruit Science |
| Plant Pathology | 18 | Plant Pathology |

Note the last row: already the right size, so it stays as itself.

Return the completed workbook.

## PROMPT — copy to here

---

## What happens next

Hand the completed workbook back and I will, at no API cost:

1. Apply the mapping to all 855 researchers.
2. Put the canonical labels into `Research Areas` — this is what funding matching
   and filtering use.
3. Move each researcher's original specific labels into `Keywords`, so nothing
   derived is lost and precision is preserved.
4. Report the resulting spread — labels per researcher, researchers per label —
   so we can confirm we landed near 5-15 and not at either extreme.
5. Regenerate the roster, then re-run the pre-flight and the existing-tenant
   rehearsal before anything is seeded.

Research summaries, scope notes, keywords and the 2,320 influential publications
are untouched.
