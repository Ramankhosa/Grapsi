import { NextRequest, NextResponse } from 'next/server';

import { requirePlatformTeamRoleAdminRequest } from '@/lib/platformTeamRoleAuth';
import { platformTeamRoleService } from '@/lib/services/platformTeamRoleService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformTeamRoleAdminRequest(request);
  if ('response' in auth) {
    return auth.response;
  }

  return NextResponse.json(platformTeamRoleService.getDefinitions());
}
