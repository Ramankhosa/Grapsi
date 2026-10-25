import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Db } from './queue'
// Shared with the Windows RPC broker so prompt, packing and hashes cannot drift.
const P = require('../../../tools/local-worker/policy.cjs') as {
  POLICY_HASH: string; MODEL: { sha256: string }; dateInIndia: () => string; sha256: (s: string) => string
  makePayload: (row: Record<string, unknown>) => Record<string, unknown>
}
export interface LocalDetails { schemaVersion: number; candidates: Array<{ title: string; titleQuote: string; invitationQuote: string | null }>; multipleCalls: boolean; needsMoreEvidence: boolean; warnings: string[] }
export interface LocalSuggestion { decision: string; details: LocalDetails; assessedOn: string; resultId: string }
export async function localSuggestion(resourceId: string, db: Db = prisma): Promise<LocalSuggestion | null> {
  const rows = await db.$queryRawUnsafe<Array<{ decision: string; details: LocalDetails; assessed_on: string; job_id: string; full_hash: string; text: string }>>(`SELECT a.decision,a.details,j.payload->>'asOfDate' AS assessed_on,a.job_id,j.payload->>'fullTextHash' AS full_hash,v.text
    FROM monitor_local_analysis_results a JOIN monitor_local_analysis_jobs j ON j.id=a.job_id
    JOIN monitor_resources r ON r.id=a.resource_id AND r.current_version_id=a.version_id
    JOIN monitor_resource_versions v ON v.id=a.version_id
    WHERE r.id=$1 AND a.policy_hash=$2 AND a.model_sha256=$3 AND j.payload->>'sourceHash'=v.raw_hash
    ORDER BY a.created_at DESC LIMIT 1`,resourceId,P.POLICY_HASH,P.MODEL.sha256)
  const row=rows[0]
  return row && row.details.schemaVersion===2 && row.full_hash===P.sha256(row.text??'') ? { decision: row.decision, details: row.details, assessedOn: row.assessed_on, resultId: row.job_id } : null
}
export async function queueLocalAnalysis(resourceId: string, db: Db = prisma) {
  const rows=await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT r.id,r.current_version_id,r.title,r.canonical_url AS url,v.text,v.truncated,v.raw_hash FROM monitor_resources r JOIN monitor_resource_versions v ON v.id=r.current_version_id WHERE r.id=$1 AND v.text IS NOT NULL`,resourceId)
  if(!rows[0])return false
  const payload=P.makePayload(rows[0]);const inputHash=P.sha256(JSON.stringify(payload))
  await db.$executeRawUnsafe(`INSERT INTO monitor_local_analysis_jobs(id,resource_id,version_id,policy_hash,input_hash,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(version_id,policy_hash) DO NOTHING`,randomUUID(),resourceId,rows[0].current_version_id,P.POLICY_HASH,inputHash,JSON.stringify(payload))
  return true
}
export async function localQueueHealth(now = new Date()) {
  const [workers,queue]=await Promise.all([
    prisma.$queryRawUnsafe<Array<{ last_seen_at: Date }>>("SELECT last_seen_at FROM monitor_local_workers WHERE app_version='1.1.0' ORDER BY last_seen_at DESC LIMIT 1"),
    prisma.$queryRawUnsafe<Array<{ state: string; count: number; oldest: Date }>>("SELECT state,count(*)::int AS count,min(created_at) AS oldest FROM monitor_local_analysis_jobs WHERE policy_hash=$1 GROUP BY state",P.POLICY_HASH),
  ])
  const age=workers[0]?now.getTime()-workers[0].last_seen_at.getTime():null
  const waiting=queue.filter(q=>q.state==='QUEUED'||q.state==='RUNNING')
  const oldest=waiting.length?Math.min(...waiting.map(q=>q.oldest.getTime())):null
  return { required: process.env.MONITOR_LOCAL_SCREENING_REQUIRED==='true', online: age!==null&&age<180000, ageSeconds: age===null?null:Math.round(age/1000), backlogWarning: oldest!==null&&now.getTime()-oldest>21600000, waiting: waiting.reduce((s,q)=>s+q.count,0), needsAttention: queue.filter(q=>q.state==='FAILED').reduce((s,q)=>s+q.count,0) }
}
