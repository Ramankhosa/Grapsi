import prisma from '@/lib/prisma'
import { SESSION_LIMIT } from './policy'

/** Refresh rotation must never create a catalogue session for an old login. */
export async function registerCatalogueSession(userId: string, familyId: string, expiresAt: Date, userAgent?: string, refresh = false) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalogue:${userId}`},0))::text`
    if (refresh) {
      await tx.$executeRaw`UPDATE catalogue_sessions SET expires_at=${expiresAt} WHERE id=${familyId} AND user_id=${userId} AND revoked_at IS NULL AND expires_at>now()`
      return
    }
    await tx.$executeRaw`INSERT INTO catalogue_sessions(id,user_id,expires_at,user_agent) VALUES(${familyId},${userId},${expiresAt},${(userAgent || '').slice(0,200)})`
    const old = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_sessions WHERE user_id=${userId} AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC,id DESC OFFSET ${SESSION_LIMIT}`
    for (const session of old) {
      await tx.$executeRaw`UPDATE catalogue_sessions SET revoked_at=now() WHERE id=${session.id}`
      await tx.refreshToken.updateMany({where:{userId,familyId:session.id,isRevoked:false},data:{isRevoked:true,revokedAt:new Date(),revokedReason:'catalogue_session_limit'}})
    }
  })
}
