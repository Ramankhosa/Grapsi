import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationStyleService } from '@/lib/services/citation-style-service';

export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  inTextFormatTemplate: z.string().min(1).optional(),
  bibliographyRules: z.record(z.unknown()).optional(),
  bibliographySortOrder: z.enum(['alphabetical', 'order_of_appearance']).optional(),
  supportsShortTitles: z.boolean().optional(),
  maxAuthorsBeforeEtAl: z.number().int().min(1).max(20).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional()
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

export async function GET(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Citation style code is required' }, { status: 400 });
    }

    const style = await prisma.citationStyleDefinition.findUnique({
      where: { code }
    });

    if (!style) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    return NextResponse.json({ style });
  } catch (error) {
    console.error('[Admin CitationStyles] GET by code error:', error);
    return NextResponse.json({ error: 'Failed to fetch citation style' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Citation style code is required' }, { status: 400 });
    }

    const existing = await prisma.citationStyleDefinition.findUnique({
      where: { code }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    const style = await prisma.citationStyleDefinition.update({
      where: { code },
      data: {
        name: data.name,
        inTextFormatTemplate: data.inTextFormatTemplate,
        bibliographyRules: data.bibliographyRules as Prisma.InputJsonValue,
        bibliographySortOrder: data.bibliographySortOrder,
        supportsShortTitles: data.supportsShortTitles,
        maxAuthorsBeforeEtAl: data.maxAuthorsBeforeEtAl,
        sortOrder: data.sortOrder,
        isActive: data.isActive
      }
    });

    // Invalidate cache
    citationStyleService.invalidateCache();

    return NextResponse.json({ style });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[Admin CitationStyles] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update citation style' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Citation style code is required' }, { status: 400 });
    }

    const existing = await prisma.citationStyleDefinition.findUnique({
      where: { code }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    // Check if style is being used by any sessions
    const usageCount = await prisma.draftingSession.count({
      where: { citationStyleId: existing.id }
    });

    if (usageCount > 0) {
      return NextResponse.json({ 
        error: `Cannot delete citation style: ${code} is being used by ${usageCount} sessions. Deactivate it instead.` 
      }, { status: 400 });
    }

    // Check if style is being used by any venues
    const venueUsageCount = await prisma.publicationVenue.count({
      where: { citationStyleId: existing.id }
    });

    if (venueUsageCount > 0) {
      return NextResponse.json({ 
        error: `Cannot delete citation style: ${code} is being used by ${venueUsageCount} publication venues. Update the venues first.` 
      }, { status: 400 });
    }

    // Soft delete by setting inactive
    await prisma.citationStyleDefinition.update({
      where: { code },
      data: { isActive: false }
    });

    // Invalidate cache
    citationStyleService.invalidateCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin CitationStyles] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete citation style' }, { status: 500 });
  }
}

