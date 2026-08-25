# Research-area extraction prompt (LPU DSR faculty seed)

Give this prompt back to me together with the authorship spreadsheet and I will
produce the final seed file. Edit anything in it first — the wording below is
what actually drives the output, so a change here changes the seed.

Output values are **comma-separated**, which is what
`facultyImportService` expects (`MULTI_VALUE_SEPARATOR = /[;,|]/`).

---

## PROMPT — copy from here

You are a research-intelligence analyst at Lovely Professional University's
Directorate of Sponsored Research.

You are given a publication record: one row per paper, with the columns
UID, Name, Paper Title, Journal Name, Author Type. It covers papers where the
person was first and/or corresponding author between 1 January 2024 and
19 August 2026. There are no abstracts, no citation counts and no publication
dates — the titles and journal names are the only evidence available.

Group the rows by UID. UID is the identity: two people can share a name, and one
person's name may be spelled several ways, so never group by name.

For each UID, produce:

**RESEARCH AREAS** — 2 to 5 areas, ordered most to least central to their work.
- Name a real, recognised field of study at the granularity a funding call would
  use: `Wireless Sensor Networks`, `Medicinal Chemistry`, `Post-Harvest Technology`.
- Not a single vague word (`Engineering`, `Science`), and not a restatement of a
  paper title.
- Cover their actual spread. If someone publishes in both machine learning and
  crop science, name both rather than averaging them into something that
  describes neither.
- Separate the areas with commas.
- An individual area must never itself contain a comma — the comma is the
  delimiter, so `Nanotechnology, Applied` would be read as two separate areas.
  Write `Applied Nanotechnology` instead.

**KEYWORDS** — 5 to 10 specific technical terms, methods, materials, organisms or
applications taken from the titles, comma-separated, no commas inside a value.
- Prefer terms a matching engine could hit on: `graphene oxide`, `LSTM`,
  `Fusarium wilt`. Avoid filler like `analysis`, `study`, `novel approach`.

**RESEARCH SUMMARY** — 55 to 100 words, first person, as the researcher would
describe their own programme on a funding profile.
- Ground every claim in the titles. Say what they work on and which methods they
  use.
- Do not invent affiliations, collaborations, grants, awards, impact claims or
  student numbers.

**CONFIDENCE** — one of HIGH, MEDIUM, LOW.
- HIGH: many titles converging on a coherent programme.
- MEDIUM: a few titles, or a somewhat scattered record.
- LOW: one or two titles, or titles too generic to place confidently.

**INFLUENTIAL PUBLICATIONS** — up to 5 papers that best represent the programme.
- Choose for representativeness and standing, not recency. Favour papers where
  they were first *and* corresponding author, papers in the stronger journals,
  and a set that spans their areas rather than five variations of one result.
- For each, write a 60-to-100-word scope note describing what the paper most
  likely investigates, in the register of a journal abstract.

**The scope note is an inference, not a record.** You have not seen these papers.
Write only what the title and venue support. Never state a specific numeric
result, sample size, accuracy figure, p-value, dataset name or funding source —
you would be inventing it. Hedge where the title is ambiguous. A general scope
note is a correct scope note.

Return one record per UID with these fields:
`uid`, `name`, `researchAreas`, `keywords`, `researchSummary`, `confidence`,
`influentialPublications` (each with the paper's row index, its scope note, and
one line on why it was selected).

## PROMPT — copy to here

---

## Areas-only variant

If you want just the areas and nothing else, replace the "For each UID, produce"
block with:

> For each UID, return `uid`, `name`, and `researchAreas`: 2 to 5
> comma-separated research areas, ordered most to least central. Apply the
> naming and no-internal-comma rules above. Return nothing else.

---

## What I do with it

1. `01-aggregate.ts` collapses the 4,040 rows into 855 UID-keyed records.
2. `02-enrich.ts` sends this prompt plus one researcher's publication list per
   request, with a JSON schema pinned to the fields above.
3. `03-emit.ts` writes the seed files:
   - `out/lpu-faculty-roster.csv` — importer-ready; Email / School / Department
     left blank for your HR data, keyed on Employee ID.
   - `out/lpu-influential-publications.json` — the shortlist, every scope note
     flagged `abstractIsSynthetic: true`.
   - `out/lpu-profile-review.csv` — one row per researcher for review.
