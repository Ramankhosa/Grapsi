import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { blueprintService } from '@/lib/services/blueprint-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  citationId: z.string().min(1),
  sectionKey: z.string().min(1),
  dimension: z.string().min(1),
  action: z.enum(['CONFIRM', 'REMOVE', 'CHANGE_MAPPING']),
  newSectionKey: z.string().optional(),
  newDimension: z.string().optional(),
  newRemark: z.string().optional(),
  reviewComment: z.string().optional()
});

type SessionUser = { id: string; roles?: string[] };

function normalizeToken(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function getSessionForUser(sessionId: string, user: SessionUser) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    select: {
      id: true
    }
  });
}

async function resolveBlueprintDimension(
  sessionId: string,
  sectionKey: string,
  dimension: string
): Promise<{ sectionKey: string; dimension: string } | null> {
  const blueprint = await blueprintService.getBlueprint(sessionId);
  if (!blueprint?.sectionPlan?.length) {
    return null;
  }

  const normalizedSection = normalizeToken(sectionKey);
  const section = blueprint.sectionPlan.find(s => normalizeToken(String(s.sectionKey || '')) === normalizedSection);
  if (!section) {
    return null;
  }

  const normalizedDimension = normalizeToken(dimension);
  const matchedDimension = (section.mustCover || []).find(dim => normalizeToken(String(dim || '')) === normalizedDimension);
  if (!matchedDimension) {
    return null;
  }

  return {
    sectionKey: section.sectionKey,
    dimension: matchedDimension
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const [usageRows, blueprint] = await Promise.all([
      prisma.citationUsage.findMany({
        where: {
          citation: { sessionId, isActive: true },
          usageKind: 'DIMENSION_MAPPING',
          dimension: { not: null }
        },
        select: {
          id: true,
          citationId: true,
          sectionKey: true,
          dimension: true,
          remark: true,
          confidence: true,
          mappingSource: true,
          inclusionStatus: true,
          reviewComment: true,
          reviewedAt: true,
          reviewedByUserId: true
        },
        orderBy: [
          { sectionKey: 'asc' },
          { citationId: 'asc' }
        ]
      }),
      blueprintService.getBlueprint(sessionId)
    ]);

    const sectionOptions = (blueprint?.sectionPlan || [])
      .map(section => ({
        sectionKey: section.sectionKey,
        sectionTitle: section.purpose || section.sectionKey,
        dimensions: Array.isArray(section.mustCover) ? section.mustCover : []
      }))
      .filter(section => section.dimensions.length > 0);

    return NextResponse.json({
      mappings: usageRows.map(row => ({
        id: row.id,
        citationId: row.citationId,
        sectionKey: row.sectionKey,
        dimension: row.dimension,
        remark: row.remark || '',
        confidence: row.confidence || 'MEDIUM',
        mappingSource: row.mappingSource || 'auto',
        inclusionStatus: row.inclusionStatus,
        reviewComment: row.reviewComment || '',
        reviewedAt: row.reviewedAt,
        reviewedByUserId: row.reviewedByUserId
      })),
      sectionOptions
    });
  } catch (error) {
    console.error('[MappingReview] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch mapping review state' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = actionSchema.parse(body);

    const candidateRows = await prisma.citationUsage.findMany({
      where: {
        citationId: data.citationId,
        usageKind: 'DIMENSION_MAPPING',
        dimension: { not: null },
        citation: { sessionId, isActive: true }
      },
      select: {
        id: true,
        citationId: true,
        sectionKey: true,
        dimension: true,
        remark: true,
        confidence: true,
        mappingSource: true,
        inclusionStatus: true,
        reviewComment: true
      }
    });

    const row = candidateRows.find(item =>
      normalizeToken(item.sectionKey) === normalizeToken(data.sectionKey)
      && normalizeToken(String(item.dimension || '')) === normalizeToken(data.dimension)
    );

    if (!row) {
      return NextResponse.json({ error: 'Mapping row not found' }, { status: 404 });
    }

    const now = new Date();
    const reviewComment = typeof data.reviewComment === 'string'
      ? data.reviewComment.trim().slice(0, 2000)
      : '';

    if (data.action === 'CONFIRM' || data.action === 'REMOVE') {
      const updated = await prisma.citationUsage.update({
        where: { id: row.id },
        data: {
          inclusionStatus: data.action === 'CONFIRM' ? 'INCLUDED' : 'EXCLUDED',
          reviewComment: reviewComment || null,
          reviewedAt: now,
          reviewedByUserId: user.id
        },
        select: {
          id: true,
          citationId: true,
          sectionKey: true,
          dimension: true,
          remark: true,
          confidence: true,
          mappingSource: true,
          inclusionStatus: true,
          reviewComment: true,
          reviewedAt: true,
          reviewedByUserId: true
        }
      });

      return NextResponse.json({
        mapping: {
          ...updated,
          remark: updated.remark || '',
          confidence: updated.confidence || 'MEDIUM',
          mappingSource: updated.mappingSource || 'auto',
          reviewComment: updated.reviewComment || ''
        }
      });
    }

    const targetSection = String(data.newSectionKey || '').trim();
    const targetDimension = String(data.newDimension || '').trim();
    if (!targetSection || !targetDimension) {
      return NextResponse.json({ error: 'New section and dimension are required for mapping change' }, { status: 400 });
    }

    const resolvedTarget = await resolveBlueprintDimension(sessionId, targetSection, targetDimension);
    if (!resolvedTarget) {
      return NextResponse.json({ error: 'Selected section/dimension is not part of the active blueprint' }, { status: 400 });
    }

    const updatedRemarkRaw = typeof data.newRemark === 'string' ? data.newRemark.trim() : '';
    const updatedRemark = updatedRemarkRaw ? updatedRemarkRaw.slice(0, 2000) : (row.remark || '');

    const merged = await prisma.$transaction(async tx => {
      const duplicate = await tx.citationUsage.findFirst({
        where: {
          citationId: row.citationId,
          usageKind: 'DIMENSION_MAPPING',
          sectionKey: resolvedTarget.sectionKey,
          dimension: resolvedTarget.dimension
        },
        select: {
          id: true
        }
      });

      if (duplicate && duplicate.id !== row.id) {
        const updatedTarget = await tx.citationUsage.update({
          where: { id: duplicate.id },
          data: {
            remark: updatedRemark || null,
            mappingSource: 'manual',
            inclusionStatus: 'INCLUDED',
            reviewComment: reviewComment || null,
            reviewedAt: now,
            reviewedByUserId: user.id,
            mappedAt: now
          },
          select: {
            id: true,
            citationId: true,
            sectionKey: true,
            dimension: true,
            remark: true,
            confidence: true,
            mappingSource: true,
            inclusionStatus: true,
            reviewComment: true,
            reviewedAt: true,
            reviewedByUserId: true
          }
        });

        await tx.citationUsage.delete({
          where: { id: row.id }
        });

        return updatedTarget;
      }

      return tx.citationUsage.update({
        where: { id: row.id },
        data: {
          sectionKey: resolvedTarget.sectionKey,
          dimension: resolvedTarget.dimension,
          remark: updatedRemark || null,
          mappingSource: 'manual',
          inclusionStatus: 'INCLUDED',
          reviewComment: reviewComment || null,
          reviewedAt: now,
          reviewedByUserId: user.id,
          mappedAt: now
        },
        select: {
          id: true,
          citationId: true,
          sectionKey: true,
          dimension: true,
          remark: true,
          confidence: true,
          mappingSource: true,
          inclusionStatus: true,
          reviewComment: true,
          reviewedAt: true,
          reviewedByUserId: true
        }
      });
    });

    return NextResponse.json({
      mapping: {
        ...merged,
        remark: merged.remark || '',
        confidence: merged.confidence || 'MEDIUM',
        mappingSource: merged.mappingSource || 'auto',
        reviewComment: merged.reviewComment || ''
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[MappingReview] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update mapping review state' }, { status: 500 });
  }
}
