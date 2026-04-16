import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceReconciliationService } from '@/lib/services/reference-reconciliation-service';
import { libraryConnectionService } from '@/lib/services/library-connection-service';

const runSchema = z.object({
  referenceIds: z.array(z.string().min(1)).optional(),
  documentIds: z.array(z.string().min(1)).optional(),
  applyAutoLinks: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
  includeAlreadyLinkedDocuments: z.boolean().optional().default(true),
});

const rollbackSchema = z.object({
  batchId: z.string().min(1),
});

const linkSchema = z.object({
  batchId: z.string().min(1).optional(),
  documentId: z.string().min(1),
  referenceId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  batchId: z.string().min(1).optional(),
  documentId: z.string().min(1),
  referenceId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const batchId = request.nextUrl.searchParams.get('batchId');
    if (!batchId) {
      return NextResponse.json({ error: 'batchId query parameter is required' }, { status: 400 });
    }

    const events = await referenceReconciliationService.getBatchAudit(batchId, user.id);
    return NextResponse.json({ batchId, events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load reconciliation audit' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || 'run').toLowerCase();

    if (mode === 'rollback') {
      const data = rollbackSchema.parse(body);
      const result = await referenceReconciliationService.rollbackBatch({
        userId: user.id,
        actorUserId: user.id,
        tenantId: (user as any).tenantId || null,
        batchId: data.batchId,
      });
      return NextResponse.json({ mode: 'rollback', ...result });
    }

    if (mode === 'link') {
      const data = linkSchema.parse(body);
      const result = await referenceReconciliationService.applyManualLink({
        userId: user.id,
        actorUserId: user.id,
        tenantId: (user as any).tenantId || null,
        batchId: data.batchId,
        documentId: data.documentId,
        referenceId: data.referenceId,
        reason: data.reason,
      });
      return NextResponse.json({ mode: 'link', ...result });
    }

    if (mode === 'reject') {
      const data = rejectSchema.parse(body);
      const result = await referenceReconciliationService.recordManualRejection({
        userId: user.id,
        actorUserId: user.id,
        tenantId: (user as any).tenantId || null,
        batchId: data.batchId,
        documentId: data.documentId,
        referenceId: data.referenceId,
        reason: data.reason,
      });
      return NextResponse.json({ mode: 'reject', ...result });
    }

    const data = runSchema.parse(body);
    // Build providers from stored connections (tokens never touch the client)
    const providers: Record<string, string | undefined> = {};
    try {
      const { accessToken } = await libraryConnectionService.ensureValidToken(user.id, 'mendeley');
      providers.mendeleyAccessToken = accessToken;
    } catch { /* no Mendeley connection */ }
    try {
      const { accessToken, providerUserId } = await libraryConnectionService.ensureValidToken(user.id, 'zotero');
      providers.zoteroApiKey = accessToken;
      providers.zoteroUserId = providerUserId ?? undefined;
    } catch { /* no Zotero connection */ }
    const result = await referenceReconciliationService.runReconciliation({
      userId: user.id,
      actorUserId: user.id,
      tenantId: (user as any).tenantId || null,
      referenceIds: data.referenceIds,
      documentIds: data.documentIds,
      applyAutoLinks: data.applyAutoLinks,
      dryRun: data.dryRun,
      includeAlreadyLinkedDocuments: data.includeAlreadyLinkedDocuments,
      providers,
    });

    return NextResponse.json({
      mode: 'run',
      ...result,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request payload', details: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to run reconciliation' },
      { status: 500 }
    );
  }
}
