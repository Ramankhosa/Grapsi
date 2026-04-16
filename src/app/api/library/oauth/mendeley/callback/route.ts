import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getAppOrigin } from '@/lib/oauth-config';
import { exchangeMendeleyCode, fetchMendeleyProfile } from '@/lib/library-oauth-config';
import { libraryConnectionService } from '@/lib/services/library-connection-service';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-change-in-production-min-32-chars';

export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request.nextUrl.origin);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('Mendeley OAuth error:', error);
      return NextResponse.redirect(new URL('/library?error=mendeley_denied', appOrigin));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/library?error=mendeley_missing_params', appOrigin));
    }

    // Verify signed state JWT
    let statePayload: { userId: string; purpose: string };
    try {
      statePayload = jwt.verify(state, JWT_SECRET) as { userId: string; purpose: string };
      if (statePayload.purpose !== 'mendeley_oauth') {
        throw new Error('Invalid state purpose');
      }
    } catch {
      return NextResponse.redirect(new URL('/library?error=mendeley_invalid_state', appOrigin));
    }

    const userId = statePayload.userId;

    // Exchange code for tokens
    const tokens = await exchangeMendeleyCode(code, request.nextUrl.origin);

    // Fetch profile info
    const profile = await fetchMendeleyProfile(tokens.access_token);

    // Save encrypted tokens to DB
    await libraryConnectionService.saveConnection(userId, 'mendeley', {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      displayName: profile?.displayName,
      email: profile?.email,
    });

    return NextResponse.redirect(new URL('/library?connected=mendeley', appOrigin));
  } catch (err) {
    console.error('Mendeley OAuth callback error:', err);
    return NextResponse.redirect(new URL('/library?error=mendeley_callback_failed', appOrigin));
  }
}
