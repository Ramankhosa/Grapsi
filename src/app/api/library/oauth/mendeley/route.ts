import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAppOrigin } from '@/lib/oauth-config';
import { isMendeleyConfigured, getMendeleyAuthUrl } from '@/lib/library-oauth-config';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-change-in-production-min-32-chars';

export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request.nextUrl.origin);

  try {
    // Accept auth token from query param (full-page redirect can't set headers)
    const token = request.nextUrl.searchParams.get('authorization') || '';
    if (!token) {
      return NextResponse.redirect(new URL('/library?error=mendeley_no_auth', appOrigin));
    }

    const payload = verifyJWT(token);
    if (!payload?.sub) {
      return NextResponse.redirect(new URL('/library?error=mendeley_invalid_auth', appOrigin));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return NextResponse.redirect(new URL('/library?error=mendeley_no_auth', appOrigin));
    }

    if (!isMendeleyConfigured()) {
      return NextResponse.redirect(new URL('/library?error=mendeley_not_configured', appOrigin));
    }

    // Signed state JWT prevents CSRF -- includes userId so callback can look up the right user
    const state = jwt.sign(
      { userId: user.id, nonce: crypto.randomUUID(), purpose: 'mendeley_oauth' },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    const authUrl = getMendeleyAuthUrl(state, request.nextUrl.origin);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error('Mendeley OAuth initiation error:', err);
    return NextResponse.redirect(new URL('/library?error=mendeley_callback_failed', appOrigin));
  }
}
