import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PriorArtLLMService } from '@/lib/prior-art-llm';
import { PriorArtValidation } from '@/lib/prior-art-schema';

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No auth header or not Bearer token')
    return null
  }

  const token = authHeader.substring(7)
  console.log('Token received:', token.substring(0, 20) + '...')
  const payload = verifyJWT(token)
  console.log('JWT payload:', payload)
  if (!payload || !payload.email) {
    console.log('Invalid payload or missing email')
    return null
  }

  return payload.email
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    console.log('GET /api/patents/[patentId]/prior-art called')
    const userEmail = await getUserFromRequest(request)
    console.log('User email from token:', userEmail)
    if (!userEmail) {
      console.log('No user email, returning 401')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId } = params;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: user.id },
          {
            project: {
              OR: [
                { userId: user.id },
                { collaborators: { some: { userId: user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 });
    }

    // Get all prior art bundles for this patent
    const bundles = await prisma.priorArtSearchBundle.findMany({
      where: { patentId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } },
        queryVariants: true,
        history: {
          orderBy: { timestamp: 'desc' },
          take: 5 // Last 5 history entries
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ bundles });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/prior-art error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId } = params;
    const body = await request.json();
    const { mode, inventionBrief, bundleData } = body;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: user.id },
          {
            project: {
              OR: [
                { userId: user.id },
                { collaborators: { some: { userId: user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 });
    }

    if (!user.tenantId) {
      return NextResponse.json({ error: 'User tenant not found' }, { status: 400 });
    }

    let finalBundleData = bundleData;
    let briefRaw = null;

    if (mode === 'LLM') {
      // Validate invention brief
      if (!inventionBrief || typeof inventionBrief !== 'string') {
        return NextResponse.json({ error: 'Invention brief is required for LLM mode' }, { status: 400 });
      }

      const wordCount = inventionBrief.trim().split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount > 200) {
        return NextResponse.json({ error: `Invention brief has ${wordCount} words, which exceeds the 200 word limit` }, { status: 400 });
      }

      // Generate bundle using LLM
      const authHeader = request.headers.get('authorization')
      const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : ''

      const llmResult = await PriorArtLLMService.generateBundle({
        inventionBrief,
        jwtToken,
        patentId
      });

      if (!llmResult.success) {
        return NextResponse.json({ error: llmResult.error }, { status: 400 });
      }

      finalBundleData = llmResult.bundle;
      briefRaw = inventionBrief;

    } else if (mode === 'MANUAL') {
      // For manual mode, bundleData should be provided
      if (!bundleData) {
        return NextResponse.json({ error: 'Bundle data is required for manual mode' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'Invalid mode. Must be LLM or MANUAL' }, { status: 400 });
    }

    // Validate the bundle
    const validation = PriorArtValidation.validateBundle(finalBundleData);
    if (!validation.isValid) {
      console.error('❌ Bundle validation failed:', validation.errors);
      console.error('❌ Invalid bundle data:', JSON.stringify(finalBundleData, null, 2));
      return NextResponse.json({
        error: 'Bundle validation failed',
        validationErrors: validation.errors
      }, { status: 400 });
    }

    console.log('✅ Bundle validation passed, proceeding to create bundle...');

    // Create the bundle in a transaction
    console.log('🔄 Starting database transaction...');
    const result = await prisma.$transaction(async (tx) => {
      console.log('📝 Creating main bundle...');
      // Create the main bundle
      const bundle = await tx.priorArtSearchBundle.create({
        data: {
          patentId,
          mode: mode as any,
          status: 'DRAFT',
          briefRaw,
          inventionBrief: mode === 'LLM' ? inventionBrief : bundleData.source_summary?.title || 'Manual entry',
          bundleData: finalBundleData,
          createdBy: user.id
        }
      });

      // Create query variants
      if (finalBundleData.query_variants) {
        await tx.priorArtQueryVariant.createMany({
          data: finalBundleData.query_variants.map((variant: any) => ({
            bundleId: bundle.id,
            label: variant.label.toUpperCase() as any, // Convert to uppercase enum
            query: variant.q,
            num: variant.num,
            page: variant.page,
            notes: variant.notes
          }))
        });
      }

      // Create history entry
      await tx.priorArtSearchHistory.create({
        data: {
          bundleId: bundle.id,
          action: mode === 'LLM' ? 'LLM_GENERATED' : 'BRIEF_SUBMITTED',
          userId: user.id,
          newData: finalBundleData,
          notes: mode === 'LLM' ? 'Initial LLM generation' : 'Manual bundle creation'
        }
      });

      console.log('✅ Bundle created successfully');
      return bundle;
    });

    console.log('✅ Transaction completed successfully');
    return NextResponse.json({ bundle: result }, { status: 201 });

  } catch (error) {
    console.error('POST /api/patents/[patentId]/prior-art error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
