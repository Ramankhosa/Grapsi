import { getAppOrigin } from './oauth-config';

const MENDELEY_AUTH_URL = 'https://api.mendeley.com/oauth/authorize';
const MENDELEY_TOKEN_URL = 'https://api.mendeley.com/oauth/token';
const MENDELEY_PROFILE_URL = 'https://api.mendeley.com/profiles/me';
const MENDELEY_REDIRECT_PATH = '/api/library/oauth/mendeley/callback';
const MENDELEY_SCOPE = 'all';

function getClientId(): string {
  return process.env.MENDELEY_CLIENT_ID || '';
}

function getClientSecret(): string {
  return process.env.MENDELEY_CLIENT_SECRET || '';
}

export function isMendeleyConfigured(): boolean {
  return !!(getClientId() && getClientSecret());
}

export function getMendeleyRedirectUri(requestOrigin?: string): string {
  if (process.env.MENDELEY_REDIRECT_URI) {
    return process.env.MENDELEY_REDIRECT_URI;
  }
  const origin = getAppOrigin(requestOrigin);
  return new URL(MENDELEY_REDIRECT_PATH, origin).toString();
}

export function getMendeleyAuthUrl(state: string, requestOrigin?: string): string {
  const redirectUri = getMendeleyRedirectUri(requestOrigin);
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    scope: process.env.MENDELEY_OAUTH_SCOPES || MENDELEY_SCOPE,
    response_type: 'code',
    state,
  });
  return `${MENDELEY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeMendeleyCode(
  code: string,
  requestOrigin?: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const redirectUri = getMendeleyRedirectUri(requestOrigin);

  const response = await fetch(MENDELEY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mendeley token exchange failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function refreshMendeleyToken(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const response = await fetch(MENDELEY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mendeley token refresh failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function fetchMendeleyProfile(
  accessToken: string
): Promise<{ displayName: string; email?: string } | null> {
  try {
    const response = await fetch(MENDELEY_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const profile = await response.json();
    const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.display_name || 'Mendeley User';
    return { displayName, email: profile.email || undefined };
  } catch {
    return null;
  }
}
