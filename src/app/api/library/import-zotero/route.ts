import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService } from '@/lib/services/library-connection-service';
import { referenceConnectorService } from '@/lib/services/reference-connector-service';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { referenceReconciliationService } from '@/lib/services/reference-reconciliation-service';

const schema = z.object({
  limit: z.number().min(1).max(500).optional(),
  collectionId: z.string().optional(),
  autoReconcile: z.boolean().optional().default(true),
  dryRunReconcile: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json().catch(() => ({}));
    const data = schema.parse(body);

    // Get API key and user ID from stored connection
    const { accessToken: apiKey, providerUserId } = await libraryConnectionService.ensureValidToken(user.id, 'zotero');

    if (!providerUserId) {
      return NextResponse.json(
        { error: 'Zotero user ID is missing. Please reconnect your Zotero account.' },
        { status: 400 }
      );
    }

    const result = await referenceConnectorService.importFromZotero(user.id, {
      apiKey,
      userId: providerUserId,
      limit: data.limit,
    });

    if (data.collectionId && result.referenceIds.length > 0) {
      await referenceLibraryService.addToCollection(user.id, data.collectionId, result.referenceIds).catch(() => undefined);
    }

    let reconciliation: any = null;
    if (data.autoReconcile && result.referenceIds.length > 0) {
      reconciliation = await referenceReconciliationService.runReconciliation({
        userId: user.id,
        actorUserId: user.id,
        tenantId: (user as any).tenantId || null,
        referenceIds: result.referenceIds,
        applyAutoLinks: true,
        dryRun: data.dryRunReconcile,
        providers: {
          zoteroApiKey: apiKey,
          zoteroUserId: providerUserId,
        },
      }).catch((err: unknown) => ({
        error: err instanceof Error ? err.message : 'Reconciliation failed',
      }));
    }

    return NextResponse.json({
      provider: 'zotero',
      ...result,
      reconciliation,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import from Zotero' },
      { status: 500 }
    );
  }
}
