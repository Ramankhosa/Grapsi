/**
 * Bulk Abstract Enrichment API
 * POST - Enrich all citations missing abstracts
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { abstractEnrichmentService } from '@/lib/services/abstract-enrichment-service';

// Maximum citations to process in one request to prevent timeout
const MAX_ENRICHMENT_BATCH = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Validate paperId
    if (!params.paperId || typeof params.paperId !== 'string') {
      return NextResponse.json({ error: 'Invalid paper ID' }, { status: 400 });
    }

    // Get all citations for this paper
    const citations = await prisma.citation.findMany({
      where: {
        sessionId: params.paperId,
        session: { userId: user.id },
      },
    });

    // Filter citations without abstracts
    const citationsWithoutAbstract = citations.filter(c => !c.abstract || c.abstract.length < 50);

    if (citationsWithoutAbstract.length === 0) {
      return NextResponse.json({
        message: 'All citations already have abstracts',
        enriched: 0,
        total: citations.length,
        withAbstract: citations.length,
        withoutAbstract: 0,
      });
    }

    // Limit batch size to prevent timeout
    const batchToProcess = citationsWithoutAbstract.slice(0, MAX_ENRICHMENT_BATCH);
    const remaining = citationsWithoutAbstract.length - batchToProcess.length;

    // Enrich each citation (with rate limiting)
    const results: Array<{
      id: string;
      title: string;
      success: boolean;
      source?: string;
    }> = [];

    for (const citation of batchToProcess) {
      try {
        // Add delay to avoid rate limiting external APIs
        await new Promise(resolve => setTimeout(resolve, 600));

        const enrichResult = await abstractEnrichmentService.enrichCitation({
          doi: citation.doi || undefined,
          title: citation.title,
          authors: citation.authors,
        });

        if (enrichResult.found && enrichResult.abstracts.length > 0) {
          const bestAbstract = enrichResult.abstracts[0];

          // Update citation with found abstract
          await prisma.citation.update({
            where: { id: citation.id },
            data: {
              abstract: bestAbstract.abstract,
              notes: `${citation.notes || ''}\n[Abstract auto-enriched from ${bestAbstract.source}]`.trim(),
            },
          });

          results.push({
            id: citation.id,
            title: citation.title,
            success: true,
            source: bestAbstract.source,
          });
        } else {
          results.push({
            id: citation.id,
            title: citation.title,
            success: false,
          });
        }
      } catch (err) {
        console.error(`Failed to enrich citation ${citation.id}:`, err);
        results.push({
          id: citation.id,
          title: citation.title,
          success: false,
        });
      }
    }

    const enrichedCount = results.filter(r => r.success).length;
    const totalWithoutAbstract = citationsWithoutAbstract.length - enrichedCount;

    return NextResponse.json({
      message: remaining > 0 
        ? `Enriched ${enrichedCount} citations. ${remaining} more pending - run again to continue.`
        : `Enriched ${enrichedCount} of ${batchToProcess.length} citations`,
      enriched: enrichedCount,
      failed: batchToProcess.length - enrichedCount,
      remaining,
      total: citations.length,
      withAbstract: citations.length - totalWithoutAbstract,
      withoutAbstract: totalWithoutAbstract,
      results,
    });
  } catch (err) {
    console.error('Bulk enrichment error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enrich abstracts' },
      { status: 500 }
    );
  }
}

// GET: Check abstract status for all citations
export async function GET(
  request: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const citations = await prisma.citation.findMany({
      where: {
        sessionId: params.paperId,
        session: { userId: user.id },
      },
      select: {
        id: true,
        title: true,
        doi: true,
        abstract: true,
      },
    });

    const withAbstract = citations.filter(c => c.abstract && c.abstract.length >= 50);
    const withoutAbstract = citations.filter(c => !c.abstract || c.abstract.length < 50);

    return NextResponse.json({
      total: citations.length,
      withAbstract: withAbstract.length,
      withoutAbstract: withoutAbstract.length,
      missingAbstracts: withoutAbstract.map(c => ({
        id: c.id,
        title: c.title,
        hasDOI: !!c.doi,
      })),
      readyForReview: withAbstract.length >= citations.length * 0.7, // 70% threshold
    });
  } catch (err) {
    console.error('Abstract status check error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to check abstract status' },
      { status: 500 }
    );
  }
}

