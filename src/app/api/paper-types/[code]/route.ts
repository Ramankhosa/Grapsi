import { NextRequest, NextResponse } from 'next/server';
import { paperTypeService, type PaperTypeWithSections } from '@/lib/services/paper-type-service';
import { sectionTemplateService, type SectionContextPolicy } from '@/lib/services/section-template-service';

export const runtime = 'nodejs';

type PaperTypeResponse = {
  code: string;
  name: string;
  description?: string | null;
  requiredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  defaultWordLimits: Record<string, number>;
  defaultCitationStyle?: string | null;
  sortOrder: number;
  sectionContextPolicies?: Record<string, SectionContextPolicy>;
};

function toResponse(
  paperType: PaperTypeWithSections,
  sectionContextPolicies?: Record<string, SectionContextPolicy>
): PaperTypeResponse {
  return {
    code: paperType.code,
    name: paperType.name,
    description: paperType.description ?? null,
    requiredSections: paperType.requiredSections,
    optionalSections: paperType.optionalSections,
    sectionOrder: paperType.sectionOrder,
    defaultWordLimits: paperType.defaultWordLimits,
    defaultCitationStyle: paperType.defaultCitationStyle ?? null,
    sortOrder: paperType.sortOrder ?? 0,
    sectionContextPolicies
  };
}

export async function GET(_request: NextRequest, context: { params: { code: string } }) {
  try {
    const rawCode = context.params.code;
    const code = rawCode ? rawCode.toUpperCase() : '';

    if (!code) {
      return NextResponse.json({ error: 'Paper type code is required' }, { status: 400 });
    }

    const paperType = await paperTypeService.getPaperType(code);
    if (!paperType) {
      return NextResponse.json({ error: 'Paper type not found' }, { status: 404 });
    }

    const sectionContextPolicies = await sectionTemplateService.getSectionContextPolicyMap(
      code,
      paperType.sectionOrder
    );

    return NextResponse.json({ paperType: toResponse(paperType, sectionContextPolicies) });
  } catch (error) {
    console.error('[PaperTypes] GET by code error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch paper type' },
      { status: 500 }
    );
  }
}
