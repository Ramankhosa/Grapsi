import { NextRequest, NextResponse } from 'next/server';

import { requirePlatformTeamRoleAdminRequest } from '@/lib/platformTeamRoleAuth';
import { platformTeamRoleService } from '@/lib/services/platformTeamRoleService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformTeamRoleAdminRequest(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const users = await platformTeamRoleService.listUsers({
      query: request.nextUrl.searchParams.get('query'),
      roleCode: request.nextUrl.searchParams.get('roleCode'),
      status: request.nextUrl.searchParams.get('status'),
    });

    return NextResponse.json({ users, total: users.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load platform team users',
      },
      { status: 400 }
    );
  }
}
