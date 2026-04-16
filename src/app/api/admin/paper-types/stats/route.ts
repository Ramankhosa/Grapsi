import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperTypeService } from '@/lib/services/paper-type-service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    if (!user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const stats = await paperTypeService.getPaperTypeUsageStats();

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('[PaperTypes Stats] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500 });
  }
}

