import { prisma } from '@/lib/prisma'
export class SharedWorkPendingError extends Error {
  constructor() { super('Another worker is extracting this exact evidence; the result will be reused.'); this.name = 'SharedWorkPendingError' }
}
export async function claimSharedWork(key: string, owner: string) {
  const rows = await prisma.$queryRaw<Array<{ input_key: string }>>`
    INSERT INTO monitor_processing_claims(input_key,owner,lease_until) VALUES(${key},${owner},now()+interval '600 seconds')
    ON CONFLICT(input_key) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,updated_at=now()
    WHERE monitor_processing_claims.lease_until<now() OR monitor_processing_claims.owner=excluded.owner RETURNING input_key`
  if (!rows.length) throw new SharedWorkPendingError()
}
export async function releaseSharedWork(key: string, owner: string) {
  await prisma.$executeRaw`DELETE FROM monitor_processing_claims WHERE input_key=${key} AND owner=${owner}`
}
