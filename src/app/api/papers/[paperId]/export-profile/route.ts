import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { authenticateUser } from '@/lib/auth-middleware';
import { parseVenueExportProfile, resolveExportConfigWithSources, summarizeDocxExportConfig, summarizeLatexExportConfig } from '@/lib/export/export-config-resolver';
import { extractExportProfile } from '@/lib/export/export-profile-extractor';
import { normalizeExportProfilePartial } from '@/lib/export/export-profile-schema';
import type { TenantContext } from '@/lib/metering';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      publicationVenue: {
        include: {
          citationStyle: true,
        },
      },
      citationStyle: true,
      exportProfile: true,
    },
  });
}

async function resolveTenantContext(
  request: NextRequest,
  userId: string,
  tenantId?: string | null,
): Promise<TenantContext | null> {
  const authorization = request.headers.get('authorization');
  let authContext: TenantContext | null = null;

  if (authorization) {
    authContext = await extractTenantContextFromRequest({ headers: { authorization } });
    if (authContext && (!tenantId || authContext.tenantId === tenantId)) {
      return {
        ...authContext,
        userId: authContext.userId || userId,
      };
    }
  }

  if (!tenantId) {
    return authContext
      ? {
          ...authContext,
          userId: authContext.userId || userId,
        }
      : null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });

  if (tenant && tenant.status === 'ACTIVE' && tenant.tenantPlans[0]) {
    if (authContext && authContext.tenantId !== tenantId) {
      console.warn(
        `[ExportProfile] Tenant mismatch between JWT (${authContext.tenantId}) and session (${tenantId}); using session tenant context`,
      );
    }

    return {
      tenantId: tenant.id,
      planId: tenant.tenantPlans[0].planId,
      tenantStatus: tenant.status,
      userId,
    };
  }

  return null;
}

function buildResponsePayload(session: Awaited<ReturnType<typeof getSessionForUser>>) {
  const exportProfile = session?.exportProfile;
  const venueDefaults = parseVenueExportProfile(session?.publicationVenue);
  const llmExtracted = exportProfile?.llmExtracted ? normalizeExportProfilePartial(exportProfile.llmExtracted) : null;
  const userOverrides = exportProfile?.userOverrides ? normalizeExportProfilePartial(exportProfile.userOverrides) : {};
  const resolved = resolveExportConfigWithSources(llmExtracted, userOverrides, venueDefaults);

  return {
    profile: exportProfile
      ? {
          id: exportProfile.id,
          name: exportProfile.name,
          sourceType: exportProfile.sourceType,
          sourceFileName: exportProfile.sourceFileName,
          sourceMimeType: exportProfile.sourceMimeType,
          sourceFileHash: exportProfile.sourceFileHash,
          confidence: exportProfile.confidence,
          extractionModel: exportProfile.extractionModel,
          extractionTokensIn: exportProfile.extractionTokensIn,
          extractionTokensOut: exportProfile.extractionTokensOut,
          createdAt: exportProfile.createdAt,
          updatedAt: exportProfile.updatedAt,
          llmExtracted,
          userOverrides,
        }
      : null,
    resolvedConfig: resolved.config,
    fieldSources: resolved.fieldSources,
    venueDefaults: resolved.venueDefaults,
    summaries: {
      docx: summarizeDocxExportConfig(resolved.config),
      latex: summarizeLatexExportConfig(resolved.config),
    },
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const session = await getSessionForUser(context.params.paperId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    return NextResponse.json(buildResponsePayload(session));
  } catch (error) {
    console.error('[ExportProfile] GET error:', error);
    return NextResponse.json({ error: 'Failed to load export profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const session = await getSessionForUser(context.params.paperId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';
    let fileBuffer: Buffer | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let pastedText: string | null = null;
    let sourceType: 'file' | 'pasted_text' = 'file';
    let sourceFileHash: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Reference file is required' }, { status: 400 });
      }
      if (file.size <= 0) {
        return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Reference file exceeds the 5 MB limit' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      fileName = file.name || null;
      mimeType = file.type || null;
      sourceFileHash = hashValue(fileBuffer);
    } else {
      const body = await request.json().catch(() => ({}));
      pastedText = typeof body?.pastedText === 'string' ? body.pastedText.trim() : '';
      if (!pastedText) {
        return NextResponse.json({ error: 'Paste formatting guidelines or upload a .docx/.tex file' }, { status: 400 });
      }
      sourceType = 'pasted_text';
      sourceFileHash = hashValue(Buffer.from(pastedText, 'utf8'));
    }

    if (
      session.exportProfile &&
      session.exportProfile.sourceFileHash &&
      sourceFileHash &&
      session.exportProfile.sourceFileHash === sourceFileHash &&
      session.exportProfile.sourceType === sourceType
    ) {
      return NextResponse.json(buildResponsePayload(session));
    }

    const tenantContext = await resolveTenantContext(request, user.id, session.tenantId);
    if (!tenantContext) {
      return NextResponse.json({ error: 'Unable to resolve tenant context' }, { status: 400 });
    }

    const extracted = await extractExportProfile({
      tenantContext,
      sessionId: session.id,
      fileBuffer,
      fileName,
      mimeType,
      pastedText,
    });

    await prisma.exportProfile.upsert({
      where: { sessionId: session.id },
      update: {
        llmExtracted: extracted.profile,
        userOverrides: session.exportProfile?.userOverrides ?? {},
        sourceType: extracted.sourceType,
        sourceFileName: extracted.sourceFileName,
        sourceMimeType: extracted.sourceMimeType,
        sourceFileHash: extracted.sourceFileHash,
        extractionModel: extracted.extractionModel,
        extractionTokensIn: extracted.extractionTokensIn,
        extractionTokensOut: extracted.extractionTokensOut,
        confidence: extracted.confidence,
      },
      create: {
        sessionId: session.id,
        userId: user.id,
        llmExtracted: extracted.profile,
        userOverrides: {},
        sourceType: extracted.sourceType,
        sourceFileName: extracted.sourceFileName,
        sourceMimeType: extracted.sourceMimeType,
        sourceFileHash: extracted.sourceFileHash,
        extractionModel: extracted.extractionModel,
        extractionTokensIn: extracted.extractionTokensIn,
        extractionTokensOut: extracted.extractionTokensOut,
        confidence: extracted.confidence,
      },
    });

    const refreshed = await getSessionForUser(context.params.paperId, user);
    if (!refreshed) {
      return NextResponse.json({ error: 'Paper session not found after extraction' }, { status: 404 });
    }

    return NextResponse.json(buildResponsePayload(refreshed));
  } catch (error) {
    console.error('[ExportProfile] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to extract export settings';
    const status = isClientExtractionError(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const session = await getSessionForUser(context.params.paperId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const overrides = normalizeExportProfilePartial(body?.overrides ?? {});

    await prisma.exportProfile.upsert({
      where: { sessionId: session.id },
      update: {
        userOverrides: overrides,
      },
      create: {
        sessionId: session.id,
        userId: user.id,
        llmExtracted: {},
        userOverrides: overrides,
        sourceType: 'pasted_text',
        sourceMimeType: 'text/plain',
        sourceFileHash: crypto.randomUUID(),
        confidence: 0,
      },
    });

    const refreshed = await getSessionForUser(context.params.paperId, user);
    if (!refreshed) {
      return NextResponse.json({ error: 'Paper session not found after update' }, { status: 404 });
    }

    return NextResponse.json(buildResponsePayload(refreshed));
  } catch (error) {
    console.error('[ExportProfile] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update export overrides' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const session = await getSessionForUser(context.params.paperId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    await prisma.exportProfile.deleteMany({
      where: { sessionId: session.id },
    });

    const refreshed = await getSessionForUser(context.params.paperId, user);
    if (!refreshed) {
      return NextResponse.json({ error: 'Paper session not found after reset' }, { status: 404 });
    }

    return NextResponse.json(buildResponsePayload(refreshed));
  } catch (error) {
    console.error('[ExportProfile] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to reset export profile' }, { status: 500 });
  }
}

function hashValue(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isClientExtractionError(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('unsupported reference file type')
    || normalized.includes('no export reference provided')
    || normalized.includes('uploaded file is empty')
    || normalized.includes('reference file exceeds')
    || normalized.includes('paste formatting guidelines')
    || normalized.includes('reference file is required');
}
