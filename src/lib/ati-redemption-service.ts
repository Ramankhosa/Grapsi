import { Prisma } from '@/lib/prisma-generated'

export class ATIRedemptionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ATIRedemptionError'
  }
}

export async function claimATITokenUse(
  tx: Prisma.TransactionClient,
  tokenId: string
) {
  const claimed = await tx.$queryRaw<Array<{
    id: string
    tenantId: string | null
    usageCount: number
    maxUses: number | null
    fingerprint: string
    assignedTeamId: string | null
  }>>`
    UPDATE "ati_tokens"
    SET
      "usageCount" = "usageCount" + 1,
      "status" = CASE
        WHEN "maxUses" IS NOT NULL AND "usageCount" + 1 >= "maxUses"
          THEN 'USED_UP'::"ATITokenStatus"
        ELSE "status"
      END,
      "updatedAt" = NOW()
    WHERE "id" = ${tokenId}
      AND "status" IN ('ACTIVE'::"ATITokenStatus", 'ISSUED'::"ATITokenStatus")
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND ("maxUses" IS NULL OR "usageCount" < "maxUses")
    RETURNING
      "id",
      "tenantId",
      "usageCount",
      "maxUses",
      "fingerprint",
      "assignedTeamId"
  `

  if (claimed.length === 0) {
    throw new ATIRedemptionError(
      'ATI_TOKEN_UNAVAILABLE',
      'ATI token is expired, revoked, inactive, or has reached its maximum uses'
    )
  }

  return claimed[0]
}

export async function assignSignupTeam(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
  assignedTeamId?: string | null
) {
  const team = assignedTeamId
    ? await tx.team.findFirst({
        where: { id: assignedTeamId, tenantId, isActive: true },
        select: { id: true }
      })
    : await tx.team.findFirst({
        where: { tenantId, isDefault: true, isActive: true },
        select: { id: true }
      })

  if (assignedTeamId && !team) {
    throw new ATIRedemptionError('INVALID_ASSIGNED_TEAM', 'ATI token assigned team is invalid or inactive')
  }

  if (team) {
    await tx.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId } },
      create: { teamId: team.id, userId, role: 'MEMBER' },
      update: {}
    })
  }
}
