import { NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { prisma } from '@/lib/prisma'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function requireUserManageablePrivateFundingCall(
  actor: FundingActor,
  fundingCallId: string
) {
  if (!actor.tenantId) {
    return {
      response: NextResponse.json(
        { message: 'A tenant-scoped account is required to manage private funding uploads' },
        { status: 403 }
      ),
    }
  }

  const call = await prisma.fundingCall.findFirst({
    where: {
      id: fundingCallId,
      visibility: 'TENANT_PRIVATE',
      tenantId: actor.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      visibility: true,
      createdByUserId: true,
      metadata: true,
    },
  })

  if (!call) {
    return {
      response: NextResponse.json(
        { message: 'Private funding call not found or not manageable by this account' },
        { status: 404 }
      ),
    }
  }

  const metadata = asRecord(call.metadata)
  const userImport = asRecord(metadata?.user_import)
  const ownerUserId = typeof metadata?.owner_user_id === 'string'
    ? metadata.owner_user_id
    : typeof userImport?.owner_user_id === 'string'
      ? userImport.owner_user_id
      : null

  return {
    call,
    ownerUserId,
    isOwner: call.createdByUserId === actor.id || ownerUserId === actor.id,
  }
}
