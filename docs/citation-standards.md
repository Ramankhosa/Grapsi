# Citation and Bibliography Standards Mapping

Last updated: 2026-02-13

This document maps implemented citation/bibliography formatting logic to widely used style authorities, and lists the metadata fields captured so our literature and citation pipeline can generate standards-aligned references.

## Standards Sources Used

- APA 7 (reference basics and journal article patterns):
  - https://owl.purdue.edu/owl/research_and_citation/apa_style/apa_formatting_and_style_guide/reference_list_basic_rules.html
  - https://owl.purdue.edu/owl/research_and_citation/apa_style/apa_formatting_and_style_guide/reference_list_articles_in_periodicals.html
- IEEE (official publisher guidance + reference guide pointer):
  - https://journals.ieeeauthorcenter.ieee.org/your-role-in-article-production/ieee-editorial-style-manual/
- Chicago Author-Date (official sample citations):
  - https://www.chicagomanualofstyle.org/tools_citationguide/citation-guide-2.html
- MLA 9 (official MLA quick guide):
  - https://style.mla.org/works-cited/works-cited-a-quick-guide/
- Vancouver / ICMJE / NLM formats:
  - https://www.icmje.org/recommendations/
  - https://www.nlm.nih.gov/bsd/uniform_requirements.html
  - https://www.ncbi.nlm.nih.gov/books/NBK7256/
- Harvard note:
  - Harvard is not governed by a single global authority; institutional variants exist.
  - Implementation follows common author-date journal/book/web sequencing used in major university Harvard guides and aligns with our style definition defaults.

## Metadata Fields Captured and Stored

Core fields:
- `title`, `authors`, `year`, `venue`, `volume`, `issue`, `pages`, `doi`, `url`, `isbn`, `publisher`, `edition`, `sourceType`

Extended fields:
- `editors`, `publicationPlace`, `publicationDate`, `accessedDate`, `articleNumber`, `issn`, `journalAbbreviation`

Persistent identifiers:
- `pmid`, `pmcid`, `arxivId`

These fields are now persisted in both:
- `citations`
- `reference_library`

## Implemented Sequence Rules (by Style)

In-text sequence:
- APA 7: `(Author, Year)`
- IEEE: `[n]`
- Vancouver: `(n)` (bibliography still numeric order)
- Chicago Author-Date: `(Author Year)`
- MLA 9: `(Author Page)` with fallback locator behavior
- Harvard: `(Author Year)`

Bibliography/reference sequence highlights:
- APA 7 journal article:
  - `Authors. (Year). Title. Journal, volume(issue), pages. DOI/URL`
- IEEE journal article:
  - `Authors, "Title," Journal Abbrev/Journal, vol., no., pp./Art. no., date, doi`
- Chicago Author-Date journal article:
  - `Authors Year. "Title." Journal volume, no. issue: pages/article number. DOI/URL`
- MLA 9 journal article:
  - `Authors. "Title." Journal, vol., no., year, pp. pages. DOI/URL`
- Harvard journal article:
  - `Authors (Year) 'Title', Journal, volume(issue), pp. pages. doi/URL`
- Vancouver journal article:
  - `Authors. Title. Journal Abbrev. Year;volume(issue):pages/articleNumber. doi. PMID/PMCID`

Web/electronic patterns implemented:
- Access dates supported via `accessedDate`
- Online availability captured via `url`
- DOI normalization used for display across styles
- Preprint and biomedical identifiers appended where style logic supports them (e.g., Vancouver/IEEE outputs include `PMID`, `PMCID`, `arXiv` when present)

## Code Traceability

Primary formatter implementation:
- `src/lib/services/citation-style-service.ts`
  - `formatAPA7Bibliography`
  - `formatIEEEBibliography`
  - `formatChicagoAuthorDateBibliography`
  - `formatMLA9Bibliography`
  - `formatHarvardBibliography`
  - `formatVancouverBibliography`
  - `formatInTextCitation`
  - `generateBibliography`

Data ingestion and persistence:
- `src/lib/services/literature-search-service.ts`
- `src/lib/services/citation-service.ts`
- `src/lib/services/reference-library-service.ts`

API wiring and UI payload propagation:
- `src/app/api/papers/[paperId]/citations/...`
- `src/app/api/papers/[paperId]/drafting/route.ts`
- `src/app/api/papers/[paperId]/export/route.ts`
- `src/components/paper/CitationPickerModal.tsx`
- `src/components/paper/CitationManager.tsx`
- `src/components/paper/FloatingWritingPanel.tsx`
