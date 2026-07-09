/**
 * Publication metadata lookup helpers for the "Autofill from DOI" flow.
 *
 * Metadata comes from Crossref (canonical bibliographic record, abstract often
 * in JATS XML) with OpenAlex as a fallback for missing abstracts (stored as an
 * inverted index that has to be reconstructed).
 */

export interface PublicationLookupResult {
  doi: string;
  title: string;
  abstract: string;
  year: number | null;
  venue: string | null;
  source: 'crossref' | 'openalex';
}

/**
 * Accepts raw DOIs, `doi:` prefixes, and doi.org / dx.doi.org URLs.
 * Returns the bare DOI (e.g. `10.1234/abcd.5678`) or null when the input
 * does not look like a DOI.
 */
export function normalizeDoi(input: string): string | null {
  let value = input.trim();
  if (!value) return null;

  value = value.replace(/^doi:\s*/i, '');
  const urlMatch = value.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  if (urlMatch) {
    value = decodeURIComponent(urlMatch[1]);
  }

  value = value.trim().replace(/[.,;)\]]+$/, '');
  if (!/^10\.\d{4,9}\/\S+$/i.test(value)) return null;
  return value;
}

const JATS_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Crossref abstracts arrive as JATS XML fragments
 * (`<jats:p>...</jats:p>`). Strip markup, drop a leading "Abstract" heading,
 * decode common entities, and collapse whitespace.
 */
export function stripJatsMarkup(value: string): string {
  let text = value
    .replace(/<jats:title[^>]*>[\s\S]*?<\/jats:title>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const [entity, replacement] of Object.entries(JATS_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  text = text.replace(/\s+/g, ' ').trim();
  return text.replace(/^abstract[\s:.-]*/i, '').trim();
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim());
    return typeof first === 'string' ? first.trim() : null;
  }
  return null;
}

function crossrefYear(message: Record<string, any>): number | null {
  for (const key of ['issued', 'published-print', 'published-online', 'created']) {
    const year = message?.[key]?.['date-parts']?.[0]?.[0];
    if (Number.isInteger(year)) return year;
  }
  return null;
}

/** Parse a Crossref `/works/{doi}` message into a lookup result. */
export function parseCrossrefWork(message: unknown, doi: string): PublicationLookupResult | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, any>;
  const title = firstString(record.title);
  if (!title) return null;

  const rawAbstract = typeof record.abstract === 'string' ? record.abstract : '';
  return {
    doi,
    title,
    abstract: rawAbstract ? stripJatsMarkup(rawAbstract) : '',
    year: crossrefYear(record),
    venue: firstString(record['container-title']) || firstString(record['short-container-title']),
    source: 'crossref',
  };
}

/**
 * OpenAlex stores abstracts as `{ word: [positions...] }`. Rebuild the
 * original text by placing each word at its positions.
 */
export function reconstructOpenAlexAbstract(invertedIndex: unknown): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) {
        words[position as number] = word;
      }
    }
  }
  return words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Parse an OpenAlex `/works/doi:{doi}` record into a lookup result. */
export function parseOpenAlexWork(work: unknown, doi: string): PublicationLookupResult | null {
  if (!work || typeof work !== 'object') return null;
  const record = work as Record<string, any>;
  const title = firstString(record.title) || firstString(record.display_name);
  if (!title) return null;

  return {
    doi,
    title,
    abstract: reconstructOpenAlexAbstract(record.abstract_inverted_index),
    year: Number.isInteger(record.publication_year) ? record.publication_year : null,
    venue:
      firstString(record.primary_location?.source?.display_name) ||
      firstString(record.host_venue?.display_name),
    source: 'openalex',
  };
}

/**
 * Prefer the Crossref record but backfill any missing fields (most often the
 * abstract) from OpenAlex.
 */
export function mergeLookupResults(
  primary: PublicationLookupResult | null,
  fallback: PublicationLookupResult | null
): PublicationLookupResult | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...primary,
    abstract: primary.abstract || fallback.abstract,
    year: primary.year ?? fallback.year,
    venue: primary.venue || fallback.venue,
  };
}
