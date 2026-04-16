import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export async function GET(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { reportId } = params;
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Invalid or missing access token' },
        { status: 401 }
      );
    }

    // Verify the token format and extract data
    try {
      const decodedToken = Buffer.from(token, 'base64url').toString('utf-8');
      const [searchId, timestamp, hash] = decodedToken.split('.');

      if (!searchId || !timestamp || !hash) {
        throw new Error('Invalid token format');
      }

      // Check if token is expired (1 week)
      const tokenTime = parseInt(timestamp);
      const now = Date.now();
      if (now - tokenTime > 7 * 24 * 60 * 60 * 1000) {
        return NextResponse.json(
          { error: 'This shared link has expired' },
          { status: 410 }
        );
      }

      // Verify the token integrity
      const secret = process.env.SHARE_TOKEN_SECRET || 'default-share-secret';
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${searchId}.${timestamp}.${secret}`)
        .digest('hex')
        .substring(0, 8);

      if (hash !== expectedHash) {
        return NextResponse.json(
          { error: 'Invalid access token' },
          { status: 401 }
        );
      }

      // Fetch the novelty search data
      const searchRun = await prisma.noveltySearchRun.findUnique({
        where: { id: searchId },
        include: {
          user: { select: { name: true, email: true } }
        }
      });

      if (!searchRun) {
        return NextResponse.json(
          { error: 'Report not found' },
          { status: 404 }
        );
      }

      // Check if sharing is allowed (you might want to add a sharing_enabled flag to the model)
      // For now, allow sharing for all completed searches
      if (searchRun.status !== 'COMPLETED') {
        return NextResponse.json(
          { error: 'Report is not yet available' },
          { status: 404 }
        );
      }

      // Prepare the report data in the same format as the authenticated endpoint
      const reportData = {
        searchId: searchRun.id,
        title: searchRun.title,
        stage0Results: searchRun.stage0Results,
        stage1Results: searchRun.stage1Results,
        stage35Results: searchRun.stage35Results,
        stage4Results: searchRun.stage4Results,
        createdAt: searchRun.createdAt,
        updatedAt: searchRun.updatedAt
      };

      return NextResponse.json(reportData);

    } catch (tokenError) {
      console.error('Token validation error:', tokenError);
      return NextResponse.json(
        { error: 'Invalid access token' },
        { status: 401 }
      );
    }

  } catch (error) {
    console.error('Share report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
