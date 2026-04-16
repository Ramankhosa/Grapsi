import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService, LibraryProvider } from '@/lib/services/library-connection-service';

const VALID_PROVIDERS = new Set<string>(['mendeley', 'zotero']);

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { provider } = await params;
    if (!VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    await libraryConnectionService.removeConnection(user.id, provider as LibraryProvider);

    return NextResponse.json({ success: true, provider });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
