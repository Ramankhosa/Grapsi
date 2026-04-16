import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService, LibraryProvider } from '@/lib/services/library-connection-service';
import { referenceConnectorService } from '@/lib/services/reference-connector-service';

const schema = z.object({
  provider: z.enum(['mendeley', 'zotero']),
  fullSync: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json().catch(() => ({}));
    const data = schema.parse(body);
    const provider = data.provider as LibraryProvider;

    // Get valid token (auto-refreshes Mendeley tokens if expired)
    const { accessToken, providerUserId } = await libraryConnectionService.ensureValidToken(user.id, provider);

    let result;
    if (provider === 'mendeley') {
      result = await referenceConnectorService.importFromMendeley(user.id, {
        accessToken,
      });
    } else {
      if (!providerUserId) {
        return NextResponse.json(
          { error: 'Zotero user ID is missing. Please reconnect your Zotero account.' },
          { status: 400 }
        );
      }
      result = await referenceConnectorService.importFromZotero(user.id, {
        apiKey: accessToken,
        userId: providerUserId,
      });
    }

    const status = result.errors.length > 0
      ? (result.imported > 0 ? 'partial' : 'failed')
      : 'success';
    const message = `Imported ${result.imported}, updated ${(result as any).updated || 0}, skipped ${result.skipped}`;

    await libraryConnectionService.updateSyncStatus(
      user.id,
      provider,
      status,
      message,
      result.imported
    );

    return NextResponse.json({
      provider,
      imported: result.imported,
      updated: (result as any).updated || 0,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
