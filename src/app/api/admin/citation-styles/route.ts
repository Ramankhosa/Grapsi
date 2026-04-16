import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

const citationStyleSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  inTextFormatTemplate: z.string().min(1),
  bibliographyRules: z.record(z.unknown()),
  bibliographySortOrder: z.enum(['alphabetical', 'order_of_appearance']).default('alphabetical'),
  supportsShortTitles: z.boolean().default(false),
  maxAuthorsBeforeEtAl: z.number().int().min(1).max(20).default(3),
  sortOrder: z.number().int().optional()
});

async function requireSuperAdmin(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return { user: null, error: NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 }) };
  }

  if (!user.roles?.includes('SUPER_ADMIN')) {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, error: null };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const styles = await prisma.citationStyleDefinition.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });

    return NextResponse.json({ styles });
  } catch (error) {
    console.error('[Admin CitationStyles] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch citation styles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const data = citationStyleSchema.parse(body);

    // Check if code already exists
    const existing = await prisma.citationStyleDefinition.findUnique({
      where: { code: data.code.toUpperCase() }
    });

    if (existing) {
      return NextResponse.json({ error: 'Citation style with this code already exists' }, { status: 400 });
    }

    const style = await prisma.citationStyleDefinition.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        inTextFormatTemplate: data.inTextFormatTemplate,
        bibliographyRules: data.bibliographyRules as Prisma.InputJsonValue,
        bibliographySortOrder: data.bibliographySortOrder,
        supportsShortTitles: data.supportsShortTitles,
        maxAuthorsBeforeEtAl: data.maxAuthorsBeforeEtAl,
        sortOrder: data.sortOrder ?? 0
      }
    });

    return NextResponse.json({ style }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[Admin CitationStyles] POST error:', error);
    return NextResponse.json({ error: 'Failed to create citation style' }, { status: 500 });
  }
}

