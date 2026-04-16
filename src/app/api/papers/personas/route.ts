/**
 * API Routes for Paper Writing Personas
 * 
 * Allows users to create, manage, and share writing style personas for academic papers.
 * Similar to patent writing personas but organized by paper type instead of jurisdiction.
 */

import { NextResponse, NextRequest } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { invalidatePaperWritingSampleCache } from '@/lib/paper-writing-sample-service';
import { z } from 'zod';

// ============================================================================
// Validation Schemas
// ============================================================================

const createPersonaSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']).default('PRIVATE'),
  isTemplate: z.boolean().default(false)
});

const updatePersonaSchema = z.object({
  personaId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']).optional(),
  isActive: z.boolean().optional()
});

const createSampleSchema = z.object({
  personaId: z.string().min(1),
  paperTypeCode: z.string().min(1).max(50), // JOURNAL_ARTICLE, CONFERENCE_PAPER, * (universal)
  sectionKey: z.string().min(1).max(50),
  sampleText: z.string().min(50).max(2000),
  notes: z.string().max(500).optional()
});

const updateSampleSchema = z.object({
  sampleId: z.string().min(1),
  sampleText: z.string().min(50).max(2000).optional(),
  notes: z.string().max(500).optional(),
  isActive: z.boolean().optional()
});

// ============================================================================
// GET - Fetch user's personas and samples
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeOrgPersonas = searchParams.get('includeOrg') === 'true';
    const personaId = searchParams.get('personaId');

    if (personaId) {
      const persona = await prisma.paperWritingPersona.findFirst({
        where: {
          id: personaId,
          OR: [
            { createdBy: user.id },
            { 
              tenantId: user.tenantId || undefined,
              visibility: 'ORGANIZATION',
              isActive: true
            }
          ]
        }
      });

      if (!persona) {
        return NextResponse.json({ error: 'Persona not found or access denied' }, { status: 404 });
      }

      const samples = await prisma.paperWritingSample.findMany({
        where: {
          personaId,
          isActive: true
        },
        orderBy: [
          { paperTypeCode: 'asc' },
          { sectionKey: 'asc' }
        ]
      });

      return NextResponse.json({
        success: true,
        samples: samples.map(s => ({
          id: s.id,
          paperTypeCode: s.paperTypeCode,
          sectionKey: s.sectionKey,
          sampleText: s.sampleText,
          notes: s.notes,
          wordCount: s.wordCount
        }))
      });
    }

    const userPersonas = await prisma.paperWritingPersona.findMany({
      where: {
        createdBy: user.id,
        isActive: true
      },
      include: {
        _count: { select: { samples: true } }
      },
      orderBy: { name: 'asc' }
    });

    let orgPersonas: any[] = [];
    if (includeOrgPersonas && user.tenantId) {
      orgPersonas = await prisma.paperWritingPersona.findMany({
        where: {
          tenantId: user.tenantId,
          visibility: 'ORGANIZATION',
          isActive: true,
          createdBy: { not: user.id }
        },
        include: {
          _count: { select: { samples: true } },
          creator: { select: { name: true, email: true } }
        },
        orderBy: [
          { isTemplate: 'desc' },
          { name: 'asc' }
        ]
      });
    }

    return NextResponse.json({
      success: true,
      personas: [
        ...userPersonas.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          visibility: p.visibility,
          isTemplate: p.isTemplate,
          isOwn: true,
          sampleCount: p._count.samples
        })),
        ...orgPersonas.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          visibility: p.visibility,
          isTemplate: p.isTemplate,
          isOwn: false,
          createdByName: p.creator?.name || p.creator?.email,
          sampleCount: p._count.samples
        }))
      ]
    });

  } catch (error) {
    console.error('GET personas error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create persona, update persona, create sample, update sample
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user || !user.tenantId) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json();
    const action = body.action || 'create_persona';

    switch (action) {
      case 'create_persona': {
        const validation = createPersonaSchema.safeParse(body);
        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid input', details: validation.error.errors },
            { status: 400 }
          );
        }

        const { name, description, visibility, isTemplate } = validation.data;

        const existing = await prisma.paperWritingPersona.findUnique({
          where: {
            createdBy_name: {
              createdBy: user.id,
              name
            }
          }
        });

        if (existing) {
          return NextResponse.json(
            { error: 'A persona with this name already exists' },
            { status: 409 }
          );
        }

        const persona = await prisma.paperWritingPersona.create({
          data: {
            tenantId: user.tenantId,
            createdBy: user.id,
            name,
            description,
            visibility,
            isTemplate
          }
        });

        return NextResponse.json({
          success: true,
          persona: {
            id: persona.id,
            name: persona.name,
            description: persona.description,
            visibility: persona.visibility,
            isTemplate: persona.isTemplate
          }
        });
      }

      case 'update_persona': {
        const validation = updatePersonaSchema.safeParse(body);
        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid input', details: validation.error.errors },
            { status: 400 }
          );
        }

        const { personaId, ...updates } = validation.data;

        const persona = await prisma.paperWritingPersona.findFirst({
          where: {
            id: personaId,
            createdBy: user.id
          }
        });

        if (!persona) {
          return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
        }

        const updated = await prisma.paperWritingPersona.update({
          where: { id: personaId },
          data: updates
        });

        return NextResponse.json({
          success: true,
          persona: {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            visibility: updated.visibility,
            isTemplate: updated.isTemplate,
            isActive: updated.isActive
          }
        });
      }

      case 'create_sample': {
        const validation = createSampleSchema.safeParse(body);
        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid input', details: validation.error.errors },
            { status: 400 }
          );
        }

        const { personaId, paperTypeCode, sectionKey, sampleText, notes } = validation.data;

        const persona = await prisma.paperWritingPersona.findFirst({
          where: {
            id: personaId,
            createdBy: user.id
          }
        });

        if (!persona) {
          return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
        }

        const existing = await prisma.paperWritingSample.findFirst({
          where: {
            userId: user.id,
            paperTypeCode: paperTypeCode.toUpperCase(),
            personaId,
            sectionKey
          }
        });

        if (existing) {
          // Update existing
          const updated = await prisma.paperWritingSample.update({
            where: { id: existing.id },
            data: {
              sampleText,
              notes,
              wordCount: sampleText.trim().split(/\s+/).length,
              isActive: true
            }
          });

          // Invalidate cache for this user
          invalidatePaperWritingSampleCache(user.id);

          return NextResponse.json({
            success: true,
            sample: {
              id: updated.id,
              paperTypeCode: updated.paperTypeCode,
              sectionKey: updated.sectionKey,
              sampleText: updated.sampleText,
              notes: updated.notes,
              wordCount: updated.wordCount
            },
            updated: true
          });
        }

        // Create new sample
        const sample = await prisma.paperWritingSample.create({
          data: {
            userId: user.id,
            tenantId: user.tenantId,
            personaId,
            personaName: persona.name,
            paperTypeCode: paperTypeCode.toUpperCase(),
            sectionKey,
            sampleText,
            notes,
            wordCount: sampleText.trim().split(/\s+/).length
          }
        });

        // Invalidate cache for this user
        invalidatePaperWritingSampleCache(user.id);

        return NextResponse.json({
          success: true,
          sample: {
            id: sample.id,
            paperTypeCode: sample.paperTypeCode,
            sectionKey: sample.sectionKey,
            sampleText: sample.sampleText,
            notes: sample.notes,
            wordCount: sample.wordCount
          }
        });
      }

      case 'update_sample': {
        const validation = updateSampleSchema.safeParse(body);
        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid input', details: validation.error.errors },
            { status: 400 }
          );
        }

        const { sampleId, ...updates } = validation.data;

        // Verify ownership
        const sample = await prisma.paperWritingSample.findFirst({
          where: {
            id: sampleId,
            userId: user.id
          }
        });

        if (!sample) {
          return NextResponse.json({ error: 'Sample not found' }, { status: 404 });
        }

        const updateData: any = { ...updates };
        if (updates.sampleText) {
          updateData.wordCount = updates.sampleText.trim().split(/\s+/).length;
        }

        const updated = await prisma.paperWritingSample.update({
          where: { id: sampleId },
          data: updateData
        });

        // Invalidate cache for this user
        invalidatePaperWritingSampleCache(user.id);

        return NextResponse.json({
          success: true,
          sample: {
            id: updated.id,
            paperTypeCode: updated.paperTypeCode,
            sectionKey: updated.sectionKey,
            sampleText: updated.sampleText,
            notes: updated.notes,
            wordCount: updated.wordCount,
            isActive: updated.isActive
          }
        });
      }

      case 'delete_sample': {
        const { sampleId } = body;
        if (!sampleId) {
          return NextResponse.json({ error: 'sampleId required' }, { status: 400 });
        }

        // Soft delete
        await prisma.paperWritingSample.updateMany({
          where: {
            id: sampleId,
            userId: user.id
          },
          data: { isActive: false }
        });

        // Invalidate cache for this user
        invalidatePaperWritingSampleCache(user.id);

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('POST personas error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Delete persona (soft delete)
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json();
    const { personaId } = body;

    if (!personaId) {
      return NextResponse.json({ error: 'personaId required' }, { status: 400 });
    }

    // Verify ownership
    const persona = await prisma.paperWritingPersona.findFirst({
      where: {
        id: personaId,
        createdBy: user.id
      }
    });

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    // Soft delete persona and its samples
    await prisma.$transaction([
      prisma.paperWritingPersona.update({
        where: { id: personaId },
        data: { isActive: false }
      }),
      prisma.paperWritingSample.updateMany({
        where: { personaId },
        data: { isActive: false }
      })
    ]);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('DELETE persona error:', error);
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    );
  }
}

