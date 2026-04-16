import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService } from '@/lib/services/library-connection-service';

const schema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  zoteroUserId: z.string().min(1, 'Zotero user ID is required'),
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const body = await request.json().catch(() => ({}));
    const data = schema.parse(body);

    // Validate the API key by making a test call to Zotero
    const testUrl = `https://api.zotero.org/users/${encodeURIComponent(data.zoteroUserId)}/items?limit=1&format=json`;
    const testResponse = await fetch(testUrl, {
      headers: {
        'Zotero-API-Key': data.apiKey,
        'Zotero-API-Version': '3',
      },
    });

    if (!testResponse.ok) {
      const status = testResponse.status;
      if (status === 403 || status === 401) {
        return NextResponse.json(
          { error: 'Invalid API key or user ID. Please check your Zotero credentials.' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Zotero API returned status ${status}. Please try again.` },
        { status: 502 }
      );
    }

    // Derive a display name from the Zotero user ID
    const displayName = `Zotero Library (${data.zoteroUserId})`;

    // Store encrypted API key
    await libraryConnectionService.saveConnection(user.id, 'zotero', {
      accessToken: data.apiKey,
      providerUserId: data.zoteroUserId,
      displayName,
    });

    return NextResponse.json({ success: true, displayName });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to connect Zotero' },
      { status: 500 }
    );
  }
}
