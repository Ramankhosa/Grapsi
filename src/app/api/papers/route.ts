import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperLibraryService } from '@/lib/services/paper-library-service';

export async function GET(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const status = url.searchParams.get('status'); // DRAFT, IN_PROGRESS, COMPLETED
  const paperTypeCode = url.searchParams.get('paperType');
  const sortBy = url.searchParams.get('sortBy') || 'updatedAt'; // createdAt, updatedAt, title
  const sortOrder = url.searchParams.get('sortOrder') || 'desc';
  const search = url.searchParams.get('search');

  // Build where clause
  // Papers are identified by having a researchTopic (created for all papers but not patents)
  const where: any = {
    userId: user.id,
    researchTopic: { isNot: null } // Only paper sessions (have research topic, patents don't)
  };

  if (status) where.status = status;
  if (paperTypeCode) {
    const paperType = await prisma.paperTypeDefinition.findUnique({ where: { code: paperTypeCode } });
    if (paperType) where.paperTypeId = paperType.id;
  }
  if (search) {
    where.OR = [
      { researchTopic: { title: { contains: search, mode: 'insensitive' } } },
      { researchTopic: { researchQuestion: { contains: search, mode: 'insensitive' } } }
    ];
  }

  // Query papers with related data
  const [papers, total] = await Promise.all([
    prisma.draftingSession.findMany({
      where,
      include: {
        paperType: { select: { code: true, name: true, sectionOrder: true } },
        citationStyle: { select: { code: true, name: true } },
        publicationVenue: { select: { code: true, name: true } },
        researchTopic: { select: { title: true } },
        citations: { select: { id: true } },
        annexureDrafts: {
          where: { jurisdiction: 'PAPER' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { extraSections: true }
        }
      },
      orderBy: { [sortBy]: sortOrder },
      skip: offset,
      take: limit
    }),
    prisma.draftingSession.count({ where })
  ]);

  // Transform response
  const transformedPapers = papers.map(paper => {
    // Calculate progress and word count from extraSections
    const draft = paper.annexureDrafts[0];
    let wordCount = 0;
    let sectionsCompleted = 0;

    if (draft?.extraSections) {
      const sections = typeof draft.extraSections === 'string'
        ? JSON.parse(draft.extraSections)
        : draft.extraSections;
      Object.values(sections).forEach((content: any) => {
        if (content && String(content).trim()) {
          sectionsCompleted++;
          wordCount += String(content).replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
        }
      });
    }

    const sectionOrder = paper.paperType?.sectionOrder as string[] | undefined;
    const totalSections = sectionOrder?.length || 6;
    const progress = Math.round((sectionsCompleted / totalSections) * 100);

    return {
      id: paper.id,
      title: paper.researchTopic?.title || 'Untitled Paper',
      paperType: paper.paperType,
      citationStyle: paper.citationStyle,
      publicationVenue: paper.publicationVenue,
      status: paper.status,
      progress,
      citationsCount: paper.citations.length,
      wordCount,
      targetWordCount: paper.targetWordCount,
      createdAt: paper.createdAt,
      updatedAt: paper.updatedAt
    };
  });

  return NextResponse.json({
    papers: transformedPapers,
    pagination: { total, limit, offset, hasMore: offset + limit < total }
  });
}

export async function POST(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: 401 });
  }

  if (!user.tenantId) {
    return NextResponse.json({ error: 'A tenant-scoped account is required to create papers' }, { status: 403 });
  }

  const body = await request.json();
  const { title, paperTypeCode, citationStyleCode, venueCode, researchTopic } = body;

  // Validate required fields - only title is required at creation
  // Paper type and citation style can be configured later in Paper Foundation stage
  if (!title) {
    return NextResponse.json({
      error: 'Missing required field: title'
    }, { status: 400 });
  }

  // Optionally lookup paper type (can be set later)
  let paperType = null;
  if (paperTypeCode) {
    paperType = await prisma.paperTypeDefinition.findUnique({
      where: { code: paperTypeCode.toUpperCase() }
    });
    if (!paperType) {
      return NextResponse.json({ error: 'Paper type not found' }, { status: 404 });
    }
  }

  // Optionally lookup citation style (can be set later)
  let citationStyle = null;
  if (citationStyleCode) {
    citationStyle = await prisma.citationStyleDefinition.findUnique({
      where: { code: citationStyleCode.toUpperCase() }
    });
    if (!citationStyle) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }
  }

  // Optionally lookup venue
  let venue = null;
  if (venueCode) {
    venue = await prisma.publicationVenue.findUnique({
      where: { code: venueCode.toUpperCase() }
    });
  }

  // Create placeholder patent for paper sessions (required by DraftingSession schema)
  // TODO: Remove this once paper drafting is fully decoupled from patent model
  const placeholderProject = await prisma.project.create({
    data: { name: `[Paper] ${title}`, userId: user.id, tenantId: user.tenantId! }
  });

  const placeholderPatent = await prisma.patent.create({
    data: {
      projectId: placeholderProject.id,
      createdBy: user.id,
      title: `[Paper] ${title}`
    }
  });

  // Determine citation style ID: prefer explicit selection, then venue default, else null
  const citationStyleId = citationStyle?.id || venue?.citationStyleId || null;

  // Create paper session with optional research topic
  // Note: status uses IDEA_ENTRY (first stage in DraftingSessionStatus enum)
  const paper = await prisma.draftingSession.create({
    data: {
      patentId: placeholderPatent.id, // Required by schema - uses placeholder
      userId: user.id,
      tenantId: user.tenantId,
      paperTypeId: paperType?.id || null, // Optional - can be set in Paper Foundation stage
      citationStyleId, // Optional - can be set in Paper Foundation stage
      publicationVenueId: venue?.id || null,
      status: 'IDEA_ENTRY', // Initial stage for papers
      literatureReviewStatus: 'NOT_STARTED',
      researchTopic: {
        create: {
          title: title,
          researchQuestion: researchTopic?.researchQuestion || 'To be defined',
          hypothesis: researchTopic?.hypothesis,
          keywords: researchTopic?.keywords || [],
          methodology: 'OTHER', // Default, can be updated later
          contributionType: 'EMPIRICAL' // Default, can be updated later
        }
      }
    },
    include: {
      paperType: { select: { code: true, name: true } },
      citationStyle: { select: { code: true, name: true } },
      publicationVenue: { select: { code: true, name: true } },
      researchTopic: true
    }
  });

  // Log creation in history
  await prisma.draftingHistory.create({
    data: {
      sessionId: paper.id,
      action: 'PAPER_CREATED',
      userId: user.id,
      stage: 'IDEA_ENTRY',
      newData: { paperTypeCode: paperTypeCode || null, citationStyleCode: citationStyleCode || null, title }
    }
  });

  // Auto-create a dedicated collection for this paper in the user's library.
  // Fail-open: paper creation should still succeed even if collection setup fails.
  try {
    await paperLibraryService.ensurePaperCollection(user.id, paper.id, title);
  } catch (collectionError) {
    console.warn('[Papers] Failed to auto-create paper library collection:', collectionError);
  }

  return NextResponse.json({ paper }, { status: 201 });
}
