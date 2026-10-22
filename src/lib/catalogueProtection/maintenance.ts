import type { Prisma } from '@/lib/prisma-generated'
let nextAttempt=0
/** Bounded housekeeping, piggybacked on normal requests; no new daemon. */
export async function maintainCatalogueSecurity(tx:Prisma.TransactionClient){
  if(Date.now()<nextAttempt)return
  nextAttempt=Date.now()+3600000
  const [{acquired}]=await tx.$queryRaw<Array<{acquired:boolean}>>`SELECT pg_try_advisory_xact_lock(721022,17) AS acquired`
  if(!acquired)return
  const [last]=await tx.$queryRaw<Array<{window_start:Date}>>`SELECT window_start FROM catalogue_counters WHERE user_id='system:maintenance' AND bucket='cleanup' ORDER BY window_start DESC LIMIT 1`
  if(last&&last.window_start.getTime()>Date.now()-3600000)return
  await tx.$executeRaw`DELETE FROM catalogue_exposures WHERE ctid IN(SELECT ctid FROM catalogue_exposures WHERE seen_at<now()-interval '31 days' LIMIT 10000)`
  await tx.$executeRaw`DELETE FROM catalogue_counters WHERE ctid IN(SELECT ctid FROM catalogue_counters WHERE window_start<now()-interval '7 days' LIMIT 10000)`
  await tx.$executeRaw`DELETE FROM catalogue_leases WHERE ctid IN(SELECT ctid FROM catalogue_leases WHERE expires_at<now() LIMIT 10000)`
  await tx.$executeRaw`DELETE FROM catalogue_security_events WHERE ctid IN(SELECT ctid FROM catalogue_security_events WHERE created_at<now()-interval '30 days' LIMIT 10000)`
  await tx.$executeRaw`DELETE FROM catalogue_sessions WHERE ctid IN(SELECT ctid FROM catalogue_sessions WHERE expires_at<now()-interval '30 days' LIMIT 10000)`
  await tx.$executeRaw`INSERT INTO catalogue_counters(user_id,bucket,window_start,count) VALUES('system:maintenance','cleanup',date_trunc('hour',now()),1) ON CONFLICT DO NOTHING`
}
