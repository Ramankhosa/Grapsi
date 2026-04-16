import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

type SessionUser = { id: string; roles?: string[] };

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const PASS1_EXCLUDED_SECTION_KEYS = new Set(['references', 'reference', 'bibliography']);

function isPass1ExcludedSection(sectionKey: string): boolean {
  return PASS1_EXCLUDED_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

function formatSectionLabel(sectionKey: string): string {
  return normalizeSectionKey(sectionKey)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function computeWordCount(content: string): number {
  const cleaned = String(content || '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.split(' ').length : 0;
}

function parseSectionOrder(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  return [];
}

function parseBlueprintOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      return String((entry as Record<string, unknown>).sectionKey || '').trim();
    })
    .filter(Boolean);
}

type Pass1Artifact = {
  content: string;
  wordCount?: number;
  generatedAt?: string;
  figureGrounding?: {
    enabled: boolean;
    selectedFigureIds: string[];
    effectiveFigureIds: string[];
    figureRefs: string[];
    figureSignature: string;
    newestFigureUpdatedAt?: string;
    waitedForMetadata?: boolean;
  } | null;
};

function parsePass1FigureGrounding(value: unknown): Pass1Artifact['figureGrounding'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const figureSignature = String(record.figureSignature || '').trim();
  const selectedFigureIds = Array.isArray(record.selectedFigureIds)
    ? record.selectedFigureIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const effectiveFigureIds = Array.isArray(record.effectiveFigureIds)
    ? record.effectiveFigureIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const figureRefs = Array.isArray(record.figureRefs)
    ? record.figureRefs.map((ref) => String(ref || '').trim()).filter(Boolean)
    : [];

  if (!record.enabled && selectedFigureIds.length === 0 && effectiveFigureIds.length === 0 && figureRefs.length === 0) {
    return null;
  }

  return {
    enabled: record.enabled === true,
    selectedFigureIds,
    effectiveFigureIds,
    figureRefs,
    figureSignature,
    newestFigureUpdatedAt: String(record.newestFigureUpdatedAt || '').trim() || undefined,
    waitedForMetadata: record.waitedForMetadata === true ? true : undefined,
  };
}

function parsePass1Artifact(value: unknown): Pass1Artifact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const content = String(record.content || '').trim();
  if (!content) return null;
  const wordCountRaw = Number(record.wordCount);
  const generatedAtRaw = String(record.generatedAt || '').trim();
  return {
    content,
    ...(Number.isFinite(wordCountRaw) && wordCountRaw > 0 ? { wordCount: wordCountRaw } : {}),
    ...(generatedAtRaw ? { generatedAt: generatedAtRaw } : {}),
    figureGrounding: parsePass1FigureGrounding(record.figureGrounding)
  };
}

async function getSessionForUser(sessionId: string, user: SessionUser) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    select: {
      id: true,
      bgGenStatus: true,
      paperType: { select: { sectionOrder: true } },
      paperBlueprint: { select: { sectionPlan: true } }
    }
  });
}

export async function GET(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const dbSections = await prisma.paperSection.findMany({
      where: { sessionId },
      select: {
        sectionKey: true,
        displayName: true,
        status: true,
        baseContentInternal: true,
        pass1Artifact: true,
        pass1CompletedAt: true,
        updatedAt: true
      }
    });

    const byKey = new Map(
      dbSections.map((section) => [normalizeSectionKey(section.sectionKey), section])
    );

    const orderedKeys: string[] = [];
    const seen = new Set<string>();
    const addKey = (rawKey: string) => {
      const normalized = normalizeSectionKey(rawKey);
      if (!normalized || seen.has(normalized) || isPass1ExcludedSection(normalized)) return;
      seen.add(normalized);
      orderedKeys.push(normalized);
    };

    parseBlueprintOrder(session.paperBlueprint?.sectionPlan).forEach(addKey);
    parseSectionOrder(session.paperType?.sectionOrder).forEach(addKey);
    dbSections.forEach((section) => addKey(section.sectionKey));

    const sections = orderedKeys.map((sectionKey) => {
      const record = byKey.get(sectionKey);
      const artifact = parsePass1Artifact(record?.pass1Artifact);
      const baseContent = String(record?.baseContentInternal || '').trim();
      const content = artifact?.content || baseContent || '';
      const hasContent = content.length > 0;
      const generatedAt = artifact?.generatedAt
        || (record?.pass1CompletedAt ? record.pass1CompletedAt.toISOString() : null);
      const source = artifact?.content
        ? 'pass1_artifact'
        : baseContent
          ? 'base_content_internal'
          : 'none';

      return {
        sectionKey,
        displayName: String(record?.displayName || formatSectionLabel(sectionKey)),
        status: String(record?.status || 'NOT_STARTED'),
        hasContent,
        content,
        wordCount: hasContent
          ? (artifact?.wordCount && artifact.wordCount > 0 ? artifact.wordCount : computeWordCount(content))
          : 0,
        generatedAt,
        source,
        updatedAt: record?.updatedAt ? record.updatedAt.toISOString() : null,
        figureGrounding: artifact?.figureGrounding || null
      };
    });

    const withContentCount = sections.filter((section) => section.hasContent).length;

    return NextResponse.json({
      success: true,
      bgGenStatus: session.bgGenStatus || 'IDLE',
      sections,
      summary: {
        totalSections: sections.length,
        withPass1Content: withContentCount,
        withoutPass1Content: sections.length - withContentCount
      }
    });
  } catch (err) {
    console.error('[ReferenceDraft] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch reference draft output' },
      { status: 500 }
    );
  }
}
