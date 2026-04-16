import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyJWT } from '@/lib/auth';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    // Authenticate user
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyJWT(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Verify the user owns this search
    const searchRun = await prisma.noveltySearchRun.findUnique({
      where: { id: searchId },
      select: {
        id: true,
        userId: true,
        status: true,
        title: true
      }
    });

    if (!searchRun) {
      return NextResponse.json(
        { error: 'Novelty search not found' },
        { status: 404 }
      );
    }

    if (searchRun.userId !== payload.sub) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    if (searchRun.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Report is not yet available for sharing' },
        { status: 400 }
      );
    }

    // Generate share token
    const timestamp = Date.now().toString();
    const secret = process.env.SHARE_TOKEN_SECRET || 'default-share-secret';

    // Create a simple hash for token integrity
    const hash = crypto
      .createHash('sha256')
      .update(`${searchId}.${timestamp}.${secret}`)
      .digest('hex')
      .substring(0, 8);

    // Create token: searchId.timestamp.hash
    const shareToken = Buffer.from(`${searchId}.${timestamp}.${hash}`).toString('base64url');

    // Generate shareable URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/share/novelty-report/${searchId}?token=${shareToken}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      expiresIn: '1 week',
      reportTitle: searchRun.title
    });

  } catch (error) {
    console.error('Generate share link API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
