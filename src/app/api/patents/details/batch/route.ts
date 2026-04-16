import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyJWT } from '@/lib/auth';

/**
 * POST /api/patents/details/batch
 * Fetch detailed patent information for multiple patents by publication numbers
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyJWT(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { publicationNumbers } = body;

    if (!Array.isArray(publicationNumbers) || publicationNumbers.length === 0) {
      return NextResponse.json(
        { error: 'publicationNumbers array is required' },
        { status: 400 }
      );
    }

    // Normalize patent numbers (remove kind codes, uppercase)
    const normalizePn = (pn: string) => {
      return pn.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '');
    };

    const normalizedPns = publicationNumbers.map(normalizePn);
    const allPns = [...publicationNumbers, ...normalizedPns];

    // Fetch patents from database - try exact matches first, then normalized
    const patents = await prisma.priorArtPatent.findMany({
      where: {
        OR: [
          { publicationNumber: { in: publicationNumbers } },
          // Try matching normalized versions
          ...normalizedPns.map(pn => ({
            publicationNumber: {
              startsWith: pn
            }
          }))
        ]
      },
      include: {
        details: true
      }
    });

    // Create a map for quick lookup - index by both original and normalized numbers
    const patentMap: Record<string, any> = {};
    
    patents.forEach(patent => {
      const normalized = normalizePn(patent.publicationNumber);
      const patentData = {
        publicationNumber: patent.publicationNumber,
        title: patent.title,
        abstract: patent.abstract,
        publicationDate: patent.publicationDate,
        priorityDate: patent.priorityDate,
        filingDate: patent.filingDate,
        inventors: patent.inventors || [],
        assignees: patent.assignees || [],
        cpcs: patent.cpcs || [],
        ipcs: patent.ipcs || [],
        link: patent.link,
        pdfLink: patent.pdfLink,
        // Include details if available
        ...(patent.details ? {
          description: patent.details.description,
          worldwideApplications: patent.details.worldwideApplications,
        } : {})
      };
      
      // Index by both original and normalized publication numbers
      patentMap[patent.publicationNumber] = patentData;
      patentMap[normalized] = patentData;
      
      // Also index by all requested publication numbers that match
      publicationNumbers.forEach(reqPn => {
        const reqNormalized = normalizePn(reqPn);
        if (normalizePn(patent.publicationNumber) === reqNormalized || 
            patent.publicationNumber.toUpperCase().includes(reqNormalized) ||
            reqNormalized.includes(normalizePn(patent.publicationNumber))) {
          patentMap[reqPn] = patentData;
          patentMap[reqNormalized] = patentData;
        }
      });
    });

    return NextResponse.json({
      success: true,
      patents: patentMap
    });

  } catch (error) {
    console.error('Batch patent details API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

