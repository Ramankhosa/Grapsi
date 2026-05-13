import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePlatformTeamRoleAdminRequest } from '@/lib/platformTeamRoleAuth';
import { platformTeamRoleService } from '@/lib/services/platformTeamRoleService';

export const runtime = 'nodejs';

const updateSchema = z.object({
  roleCodes: z.array(z.string()).max(20).default([]),
});

export async function PUT(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await requirePlatformTeamRoleAdminRequest(request, { write: true });
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const payload = updateSchema.parse(await request.json());
    const result = await platformTeamRoleService.replaceUserRoles({
      targetUserId: params.userId,
      roleCodes: payload.roleCodes,
      assignedByUserId: auth.user.id,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid platform role assignment request', details: error.flatten() },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to update platform role assignments';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
