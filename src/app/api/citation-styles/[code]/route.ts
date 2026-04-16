import { NextRequest, NextResponse } from 'next/server';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';

export const runtime = 'nodejs';

const sampleCitation: CitationData = {
  id: 'sample',
  title: 'Sample Research Paper on Structured Writing',
  authors: ['Jane Doe', 'John Smith'],
  year: 2023,
  venue: 'Journal of Sample Studies',
  volume: '12',
  issue: '3',
  pages: '45-60',
  doi: '10.1234/sample.2023.001',
  url: 'https://example.com/sample',
  citationKey: 'Doe2023'
};

export async function GET(_request: NextRequest, context: { params: { code: string } }) {
  try {
    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Citation style code is required' }, { status: 400 });
    }

    const style = await citationStyleService.getCitationStyle(code);
    if (!style) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    const [inTextExample, bibliographyExample] = await Promise.all([
      citationStyleService.formatInTextCitation(sampleCitation, code),
      citationStyleService.formatBibliographyEntry(sampleCitation, code)
    ]);

    return NextResponse.json({
      style: {
        code: style.code,
        name: style.name,
        inTextFormatTemplate: style.inTextFormatTemplate,
        bibliographyRules: style.bibliographyRules,
        bibliographySortOrder: style.bibliographySortOrder,
        supportsShortTitles: style.supportsShortTitles,
        maxAuthorsBeforeEtAl: style.maxAuthorsBeforeEtAl
      },
      examples: {
        inText: inTextExample,
        bibliography: bibliographyExample
      }
    });
  } catch (error) {
    console.error('[CitationStyles] GET by code error:', error);
    return NextResponse.json({ error: 'Failed to fetch citation style' }, { status: 500 });
  }
}
