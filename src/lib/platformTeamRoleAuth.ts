import { NextRequest, NextResponse } from 'next/server';

import { authenticateUser } from '@/lib/auth-middleware';

export async function requirePlatformTeamRoleAdminRequest(
  request: NextRequest,
  options: { write?: boolean } = {}
) {
  const { user, error } = await authenticateUser(request);

  if (error || !user) {
    return {
      response: NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      ),
    } as const;
  }

  const roles = Array.isArray(user.roles) ? user.roles : [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isSuperAdminViewer = roles.includes('SUPER_ADMIN_VIEWER');

  if (options.write) {
    if (!isSuperAdmin) {
      return {
        response: NextResponse.json(
          { error: 'Super admin write access required' },
          { status: 403 }
        ),
      } as const;
    }
  } else if (!isSuperAdmin && !isSuperAdminViewer) {
    return {
      response: NextResponse.json(
        { error: 'Super admin access required' },
        { status: 403 }
      ),
    } as const;
  }

  return { user } as const;
}
