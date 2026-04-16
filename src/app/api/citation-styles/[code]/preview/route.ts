import { NextRequest, NextResponse } from 'next/server';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';

export const runtime = 'nodejs';

function buildCitationFromQuery(searchParams: URLSearchParams): CitationData {
  const title = searchParams.get('title') || 'Sample Research Paper on Structured Writing';
  const authorsParam = searchParams.get('authors') || 'Jane Doe, John Smith';
  const authors = authorsParam.split(',').map(a => a.trim()).filter(Boolean);
  const year = parseInt(searchParams.get('year') || '2023', 10);

  return {
    id: 'preview',
    title,
    authors: authors.length > 0 ? authors : ['Anonymous'],
    year: Number.isNaN(year) ? undefined : year,
    venue: searchParams.get('venue') || 'Journal of Sample Studies',
    volume: searchParams.get('volume') || undefined,
    issue: searchParams.get('issue') || undefined,
    pages: searchParams.get('pages') || undefined,
    doi: searchParams.get('doi') || undefined,
    url: searchParams.get('url') || undefined,
    citationKey: searchParams.get('key') || 'Doe2023'
  };
}

export async function GET(request: NextRequest, context: { params: { code: string } }) {
  try {
    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Citation style code is required' }, { status: 400 });
    }

    const style = await citationStyleService.getCitationStyle(code);
    if (!style) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const citation = buildCitationFromQuery(searchParams);

    const [inText, bibliography] = await Promise.all([
      citationStyleService.formatInTextCitation(citation, code),
      citationStyleService.formatBibliographyEntry(citation, code)
    ]);

    return NextResponse.json({
      style: code,
      inText,
      bibliography
    });
  } catch (error) {
    console.error('[CitationStyles] Preview error:', error);
    return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 });
  }
}
