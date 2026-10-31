import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { visibleCallSql } from './callSql'

export function routingRetryMinutes(attempt: number): number { return Math.min(360,2 ** Math.min(Math.max(1,attempt),9)) }

/** Explicit retry; ordinary publication is enqueued atomically by the database trigger. */
export async function requestCallRouting(callId: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO dsr_call_routing_jobs(call_id) VALUES(${callId})
    ON CONFLICT(call_id) DO UPDATE SET generation=dsr_call_routing_jobs.generation+1,status='PENDING',attempts=0,
      available_at=(now() AT TIME ZONE 'UTC'),locked_at=NULL,last_error=NULL,updated_at=(now() AT TIME ZONE 'UTC')`)
}

/** Bounded durable worker. Stale leases are recoverable and one failed call cannot block others. */
export async function sweepCallRouting(options: { limit?: number; callId?: string; tenantId?: string } = {}) {
  const limit=Math.max(1,Math.min(50,options.limit ?? 10))
  const result={processed:0,completed:0,failed:0}
  for (let index=0;index<limit;index++) {
  const jobs=await prisma.$queryRaw<Array<{call_id:string;generation:number;attempts:number}>>(Prisma.sql`
    WITH due AS (SELECT j.call_id FROM dsr_call_routing_jobs j JOIN funding_calls fc ON fc.id=j.call_id
      WHERE ((j.status IN ('PENDING','FAILED') AND j.available_at <= (now() AT TIME ZONE 'UTC') AND j.attempts<8)
        OR (j.status='RUNNING' AND j.locked_at < (now() AT TIME ZONE 'UTC')-interval '15 minutes'))
        ${options.callId ? Prisma.sql`AND j.call_id=${options.callId}` : Prisma.empty}
        ${options.tenantId ? Prisma.sql`AND ${visibleCallSql(options.tenantId)}` : Prisma.empty}
      ORDER BY j.available_at,j.call_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE dsr_call_routing_jobs j SET status='RUNNING',attempts=j.attempts+1,locked_at=(now() AT TIME ZONE 'UTC'),updated_at=(now() AT TIME ZONE 'UTC')
      FROM due WHERE j.call_id=due.call_id RETURNING j.call_id,j.generation,j.attempts`)
  const job=jobs[0]
  if(!job) break
  result.processed++
    try {
      const { classifyFundingCall }=await import('@/lib/funding/disciplineClassifier')
      const { mapCallToSchools }=await import('./callSchoolMapping')
      const { notifyCoveringOfficers }=await import('./newCallNoticeService')
      await classifyFundingCall(job.call_id)
      await mapCallToSchools(job.call_id)
      await notifyCoveringOfficers(job.call_id)
      await prisma.$executeRaw(Prisma.sql`UPDATE dsr_call_routing_jobs SET status='COMPLETED',last_error=NULL,locked_at=NULL,updated_at=(now() AT TIME ZONE 'UTC')
        WHERE call_id=${job.call_id} AND generation=${job.generation} AND attempts=${job.attempts} AND status='RUNNING'`)
      result.completed++
    } catch(error) {
      // Keep diagnostics server-side: classification errors can contain provider details.
      console.error('[DSR ROUTING] Failed',job.call_id,error)
      await prisma.$executeRaw(Prisma.sql`UPDATE dsr_call_routing_jobs SET status='FAILED',last_error='Classification, mapping or delivery failed. Retry routing or inspect server logs.',locked_at=NULL,
        available_at=(now() AT TIME ZONE 'UTC')+${routingRetryMinutes(job.attempts)}*interval '1 minute',updated_at=(now() AT TIME ZONE 'UTC')
        WHERE call_id=${job.call_id} AND generation=${job.generation} AND attempts=${job.attempts} AND status='RUNNING'`)
      result.failed++
    }
  }
  return result
}

export function kickCallRouting(callId: string): void {
  void sweepCallRouting({callId,limit:1}).catch(error=>console.error('[DSR ROUTING] Worker unavailable',error))
}
