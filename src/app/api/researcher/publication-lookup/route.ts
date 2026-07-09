import { NextRequest, NextResponse } from 'next/server';

import { requireRecommendationUser } from '@/lib/recommendations/request-auth';
import {
  mergeLookupResults,
  normalizeDoi,
  parseCrossrefWork,
  parseOpenAlexWork,
  type PublicationLookupResult,
} from '@/lib/researcherProfile/publication-lookup';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'GrantGenie/1.0 (publication-autofill; mailto:support@grantgenie.app)';

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function lookupCrossref(doi: string): Promise<PublicationLookupResult | null> {
  const payload = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  const message = (payload as { message?: unknown } | null)?.message;
  return parseCrossrefWork(message, doi);
}

async function lookupOpenAlex(doi: string): Promise<PublicationLookupResult | null> {
  const payload = await fetchJson(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
  return parseOpenAlexWork(payload, doi);
}

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  const doi = normalizeDoi(request.nextUrl.searchParams.get('doi') || '');
  if (!doi) {
    return NextResponse.json(
      { error: 'Enter a valid DOI, e.g. 10.1038/s41586-020-2649-2 or a doi.org link.' },
      { status: 400 }
    );
  }

  try {
    const crossref = await lookupCrossref(doi);
    // OpenAlex is only needed when Crossref has no record or no abstract.
    const openAlex = crossref?.abstract ? null : await lookupOpenAlex(doi);
    const publication = mergeLookupResults(crossref, openAlex);

    if (!publication) {
      return NextResponse.json(
        { error: 'No publication found for this DOI. Check the DOI or fill the fields manually.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ publication });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Publication lookup failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
