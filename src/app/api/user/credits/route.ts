import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Force dynamic rendering - this route accesses request headers
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const payload = verifyJWT(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const credits = await prisma.userCredit.findUnique({
      where: { userId: payload.sub },
    });

    // If no credits record exists, create one with defaults
    if (!credits) {
      const newCredits = await prisma.userCredit.create({
        data: {
          userId: payload.sub,
          totalCredits: 100, // Free tier default
          usedCredits: 0,
          monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          planTier: 'free',
        },
      });

      return NextResponse.json({
        credits: {
          total: newCredits.totalCredits,
          used: newCredits.usedCredits,
          remaining: newCredits.totalCredits - newCredits.usedCredits,
          monthlyReset: newCredits.monthlyReset.toISOString(),
          planTier: newCredits.planTier,
        },
      });
    }

    return NextResponse.json({
      credits: {
        total: credits.totalCredits,
        used: credits.usedCredits,
        remaining: credits.totalCredits - credits.usedCredits,
        monthlyReset: credits.monthlyReset.toISOString(),
        planTier: credits.planTier,
      },
    });

  } catch (error) {
    console.error('Get credits error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve credits',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
