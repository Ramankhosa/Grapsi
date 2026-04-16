import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paperTypeService, type PaperTypeWithSections } from '@/lib/services/paper-type-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PaperTypeResponse = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  requiredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  defaultWordLimits: Record<string, number>;
  defaultCitationStyle?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function toResponse(paperType: PaperTypeWithSections & { createdAt?: Date; updatedAt?: Date }): PaperTypeResponse {
  return {
    id: paperType.id,
    code: paperType.code,
    name: paperType.name,
    description: paperType.description ?? null,
    requiredSections: paperType.requiredSections,
    optionalSections: paperType.optionalSections,
    sectionOrder: paperType.sectionOrder,
    defaultWordLimits: paperType.defaultWordLimits,
    defaultCitationStyle: paperType.defaultCitationStyle ?? null,
    isActive: paperType.isActive,
    sortOrder: paperType.sortOrder ?? 0,
    createdAt: paperType.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: paperType.updatedAt?.toISOString() || new Date().toISOString()
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    if (includeInactive) {
      // Direct database query to include inactive paper types (for admin UI)
      const paperTypes = await prisma.paperTypeDefinition.findMany({
        orderBy: { sortOrder: 'asc' }
      });

      const transformed = paperTypes.map(pt => ({
        ...pt,
        requiredSections: Array.isArray(pt.requiredSections) 
          ? pt.requiredSections as string[]
          : JSON.parse(pt.requiredSections as string || '[]'),
        optionalSections: Array.isArray(pt.optionalSections)
          ? pt.optionalSections as string[]
          : JSON.parse(pt.optionalSections as string || '[]'),
        sectionOrder: Array.isArray(pt.sectionOrder)
          ? pt.sectionOrder as string[]
          : JSON.parse(pt.sectionOrder as string || '[]'),
        defaultWordLimits: typeof pt.defaultWordLimits === 'object' && pt.defaultWordLimits !== null
          ? pt.defaultWordLimits as Record<string, number>
          : JSON.parse(pt.defaultWordLimits as string || '{}')
      }));

      return NextResponse.json({ paperTypes: transformed.map(toResponse) });
    }

    // Use service for cached active-only query
    const paperTypes = await paperTypeService.getAllPaperTypes();
    return NextResponse.json({ paperTypes: paperTypes.map(toResponse) });
  } catch (error) {
    console.error('[PaperTypes] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch paper types' },
      { status: 500 }
    );
  }
}
