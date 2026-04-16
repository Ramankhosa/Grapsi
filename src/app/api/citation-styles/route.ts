import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type CitationStyleResponse = {
  code: string;
  name: string;
  inTextFormatTemplate: string;
  bibliographySortOrder: string;
  supportsShortTitles: boolean;
  maxAuthorsBeforeEtAl: number;
};

export async function GET() {
  try {
    const styles = await prisma.citationStyleDefinition.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });

    const response: CitationStyleResponse[] = styles.map(style => ({
      code: style.code,
      name: style.name,
      inTextFormatTemplate: style.inTextFormatTemplate,
      bibliographySortOrder: style.bibliographySortOrder,
      supportsShortTitles: style.supportsShortTitles,
      maxAuthorsBeforeEtAl: style.maxAuthorsBeforeEtAl
    }));

    return NextResponse.json({ styles: response });
  } catch (error) {
    console.error('[CitationStyles] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch citation styles' }, { status: 500 });
  }
}
