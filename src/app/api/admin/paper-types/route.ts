import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperTypeService } from '@/lib/services/paper-type-service';

export const runtime = 'nodejs';

const paperTypeSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  requiredSections: z.array(z.string().min(1)).min(1),
  optionalSections: z.array(z.string().min(1)).optional().default([]),
  sectionOrder: z.array(z.string().min(1)).min(1),
  defaultWordLimits: z.record(z.string(), z.number().int().positive()),
  defaultCitationStyle: z.string().max(32).optional(),
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

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const data = paperTypeSchema.parse(body);

    const paperType = await paperTypeService.createPaperType({
      code: data.code.toUpperCase(),
      name: data.name,
      description: data.description,
      requiredSections: data.requiredSections,
      optionalSections: data.optionalSections,
      sectionOrder: data.sectionOrder,
      defaultWordLimits: data.defaultWordLimits,
      defaultCitationStyle: data.defaultCitationStyle,
      sortOrder: data.sortOrder
    });

    return NextResponse.json({ paperType }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to create paper type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
