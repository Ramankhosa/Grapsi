import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperTypeService } from '@/lib/services/paper-type-service';

export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  requiredSections: z.array(z.string().min(1)).optional(),
  optionalSections: z.array(z.string().min(1)).optional(),
  sectionOrder: z.array(z.string().min(1)).optional(),
  defaultWordLimits: z.record(z.string(), z.number().int().positive()).optional(),
  defaultCitationStyle: z.string().max(32).optional(),
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

export async function PUT(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Paper type code is required' }, { status: 400 });
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    const paperType = await paperTypeService.updatePaperType(code, data);
    return NextResponse.json({ paperType });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to update paper type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Paper type code is required' }, { status: 400 });
    }

    await paperTypeService.deletePaperType(code);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete paper type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
