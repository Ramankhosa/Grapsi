import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService } from '@/lib/services/library-connection-service';
import { isMendeleyConfigured } from '@/lib/library-oauth-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const connections = await libraryConnectionService.getActiveConnections(user.id);
    const mendeleyReady = isMendeleyConfigured();

    if (!mendeleyReady) {
      console.warn(
        '[library/connections] Mendeley not configured. MENDELEY_CLIENT_ID present:',
        !!process.env.MENDELEY_CLIENT_ID,
        'MENDELEY_CLIENT_SECRET present:',
        !!process.env.MENDELEY_CLIENT_SECRET
      );
    }

    return NextResponse.json({
      connections,
      providers: {
        mendeley: { configured: mendeleyReady },
        zotero: { configured: true },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load connections' },
      { status: 500 }
    );
  }
}
