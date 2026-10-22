import { maintainCatalogueSecurity } from './maintenance'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'
import { CatalogueAccessError, catalogueLimits, assertBoundedIds, type ExposureKind } from './policy'

type Tx = Prisma.TransactionClient
export interface CataloguePrincipal { userId: string; sessionId: string }
async function lock(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalogue:${userId}`},0))::text`
}
export async function checkCatalogueSession(p: CataloguePrincipal, tx: Tx = prisma, recoveryOnly = false) {
  const rows = await tx.$queryRaw<Array<{restricted_until:Date|null; reason:string|null; reauth_after:Date|null; authenticated_at:Date}>>`
    SELECT a.restricted_until,a.reason,a.reauth_after,s.authenticated_at FROM catalogue_sessions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN tenants t ON t.id=u."tenantId"
    LEFT JOIN catalogue_accounts a ON a.user_id=s.user_id
    WHERE s.id=${p.sessionId} AND s.user_id=${p.userId} AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE' AND (t.id IS NULL OR t.status='ACTIVE') AND (u."accessExpiresAt" IS NULL OR u."accessExpiresAt">now())
      AND NOT EXISTS(SELECT 1 FROM refresh_tokens r WHERE r."familyId"=s.id AND r."isRevoked"=true AND r."revokedReason" IS DISTINCT FROM 'rotation')`
  const row = rows[0]
  if (!row) throw new CatalogueAccessError('REAUTH_REQUIRED','Please sign in again to access funding calls.',401)
  if(recoveryOnly)return row // Account cooldowns must not prevent session recovery.
  if (row.restricted_until && row.restricted_until.getTime()>Date.now()) throw new CatalogueAccessError('CATALOGUE_RESTRICTED',`Funding access is temporarily restricted. Try again after ${row.restricted_until.toISOString()} or contact your administrator.`,429,Math.ceil((row.restricted_until.getTime()-Date.now())/1000))
  if (row.reauth_after && row.authenticated_at<row.reauth_after) throw new CatalogueAccessError('REAUTH_REQUIRED','Please sign in again to verify this funding session.',401)
  return row
}
async function increment(tx:Tx,userId:string,bucket:string,amount:number) {
  return (await tx.$queryRaw<Array<{count:bigint}>>`INSERT INTO catalogue_counters(user_id,bucket,window_start,count) VALUES(${userId},${bucket},date_trunc('minute',now()),${amount})
    ON CONFLICT(user_id,bucket,window_start) DO UPDATE SET count=catalogue_counters.count+EXCLUDED.count RETURNING count`)[0].count
}
async function observeSharedNetwork(tx:Tx,p:CataloguePrincipal,tag?:string){
  if(!tag)return
  const [recent]=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_security_events WHERE user_id=${p.userId} AND kind='network_presence' AND created_at>now()-interval '1 hour' LIMIT 1`
  if(recent)return
  await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,detail) VALUES(${randomUUID()},${p.userId},'network_presence',jsonb_build_object('tag',${tag}::text))`
  const [pattern]=await tx.$queryRaw<Array<{accounts:number;coverage:number}>>`WITH accounts AS (SELECT DISTINCT user_id FROM catalogue_security_events WHERE kind='network_presence' AND detail->>'tag'=${tag} AND created_at>now()-interval '24 hours')
    SELECT (SELECT count(*)::int FROM accounts) AS accounts,(SELECT count(DISTINCT call_id)::int FROM catalogue_exposures e JOIN accounts a ON a.user_id=e.user_id WHERE e.seen_at>now()-interval '24 hours') AS coverage`
  if(pattern.accounts>=3&&pattern.coverage>=1000){
    await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,detail) SELECT ${randomUUID()},${p.userId},'coordinated_activity',${JSON.stringify({tag,accounts:pattern.accounts,coverage:pattern.coverage,action:'supporting_signal_only'})}::jsonb
      WHERE NOT EXISTS(SELECT 1 FROM catalogue_security_events WHERE kind='coordinated_activity' AND detail->>'tag'=${tag} AND created_at>now()-interval '30 minutes')`
  }
  // Shared university networks are normal. This observation never restricts
  // access; only independent account-level speed/coverage signals can do so.
}
async function violation(userId:string,code:string) {
  await prisma.$transaction(async tx=>{
    await lock(tx,userId)
    // Bound log growth during observation: repeated attempts share one event
    // per code/minute, while every attempt still contributes to escalation.
    const [recent]=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_security_events WHERE user_id=${userId} AND kind='limit' AND detail->>'code'=${code} AND created_at>now()-interval '1 minute' ORDER BY created_at DESC LIMIT 1`
    if(recent)await tx.$executeRaw`UPDATE catalogue_security_events SET detail=jsonb_set(detail,'{attempts}',to_jsonb(coalesce((detail->>'attempts')::int,1)+1)) WHERE id=${recent.id}`
    else await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,detail) VALUES(${randomUUID()},${userId},'limit',jsonb_build_object('code',${code}::text,'attempts',1))`
    const [{n}] = await tx.$queryRaw<Array<{n:number}>>`SELECT coalesce(sum(coalesce((detail->>'attempts')::int,1)),0)::int n FROM catalogue_security_events WHERE user_id=${userId} AND kind='limit' AND created_at>now()-interval '30 minutes'`
    // Hard quotas are always enforced. Behavioural account cooldowns have a
    // seven-day observation period, independent from the quota switch.
    const starts = Date.parse(process.env.CATALOGUE_BEHAVIOUR_ENFORCE_AFTER || '')
    if (n>=3 && Number.isFinite(starts) && Date.now()>=starts) {
      await tx.$executeRaw`INSERT INTO catalogue_accounts(user_id,restricted_until,reason) VALUES(${userId},now()+interval '24 hours','repeated_limit_attempts') ON CONFLICT(user_id) DO UPDATE SET restricted_until=EXCLUDED.restricted_until,reason=EXCLUDED.reason`
    }
  })
}
export async function beginCatalogueRequest(p:CataloguePrincipal,kind:'search'|'ai'|'metadata'|'detail',hints:{page?:number;networkTag?:string}={}) {
  const id=randomUUID()
  const outcome=await prisma.$transaction(async tx=>{
    await maintainCatalogueSecurity(tx); await lock(tx,p.userId); await checkCatalogueSession(p,tx)
    await observeSharedNetwork(tx,p,hints.networkTag)
    const n=await increment(tx,p.userId,'requests',1)
    if(n>BigInt(catalogueLimits().requests)) return 'REQUEST_LIMIT'
    if((hints.page||1)>1)await increment(tx,p.userId,'pagination',1)
    const [{coverage,details}]=await tx.$queryRaw<Array<{coverage:number;details:number}>>`SELECT count(DISTINCT call_id)::int coverage,count(DISTINCT call_id) FILTER(WHERE kind='detail')::int details FROM catalogue_exposures WHERE user_id=${p.userId} AND seen_at>now()-interval '10 minutes'`
    const [{pages}]=await tx.$queryRaw<Array<{pages:number}>>`SELECT coalesce(sum(count),0)::int pages FROM catalogue_counters WHERE user_id=${p.userId} AND bucket='pagination' AND window_start>now()-interval '5 minutes'`
    if((n>BigInt(40)||pages>=20)&&(coverage>=300||details>=100)){
      const [{recent}]=await tx.$queryRaw<Array<{recent:number}>>`SELECT count(*)::int recent FROM catalogue_security_events WHERE user_id=${p.userId} AND kind='automation_signals' AND created_at>now()-interval '5 minutes'`
      if(!recent)await tx.$executeRaw`INSERT INTO catalogue_security_events(id,user_id,kind,detail) VALUES(${randomUUID()},${p.userId},'automation_signals',${JSON.stringify({coverage,details,pages,requests:Number(n),networkTag:hints.networkTag||null})}::jsonb)`
      const starts=Date.parse(process.env.CATALOGUE_BEHAVIOUR_ENFORCE_AFTER||'')
      if(Number.isFinite(starts)&&Date.now()>=starts){
        await tx.$executeRaw`INSERT INTO catalogue_accounts(user_id,restricted_until,reauth_after,reason) VALUES(${p.userId},now()+interval '15 minutes',now(),'automated_access_pattern') ON CONFLICT(user_id) DO UPDATE SET restricted_until=EXCLUDED.restricted_until,reauth_after=EXCLUDED.reauth_after,reason=EXCLUDED.reason`
        return 'AUTOMATED_ACCESS_PATTERN'
      }
    }
    const [{n:live}]=await tx.$queryRaw<Array<{n:number}>>`SELECT count(*)::int n FROM catalogue_leases WHERE user_id=${p.userId} AND expires_at>now() AND (CASE WHEN ${kind}='ai' THEN kind='ai' ELSE kind<>'ai' END)`
    if(live >= (kind==='ai'?catalogueLimits().ai:catalogueLimits().searches)) return 'CONCURRENCY_LIMIT'
    await tx.$executeRaw`INSERT INTO catalogue_leases(id,user_id,session_id,kind,expires_at) VALUES(${id},${p.userId},${p.sessionId},${kind},now()+interval '10 minutes')`
    return null
  })
  if(outcome){await violation(p.userId,outcome);throw new CatalogueAccessError(outcome,'Too many funding requests. Please wait before trying again.')}
  return id
}

/** Pending leases count toward all windows: parallel requests cannot overspend. */
export async function reserveCatalogueExposure(p:CataloguePrincipal,leaseId:string,rawIds:string[],kind:ExposureKind) {
  const ids=assertBoundedIds(rawIds); if(!ids.length)return
  const exceeded=await prisma.$transaction(async tx=>{
    await lock(tx,p.userId);await checkCatalogueSession(p,tx)
    const leases=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM catalogue_leases WHERE id=${leaseId} AND user_id=${p.userId} AND expires_at>now()`
    if(!leases.length)throw new CatalogueAccessError('REQUEST_EXPIRED','This funding request expired. Please try again.',409)
    const [account]=await tx.$queryRaw<Array<{multiplier:number}>>`SELECT CASE WHEN allowance_until>now() THEN allowance_multiplier ELSE 1 END multiplier FROM catalogue_accounts WHERE user_id=${p.userId}`
    const multiplier=account?.multiplier||1
    for(const [days,limit] of catalogueLimits().exposure[kind]){
      const [{n}]=await tx.$queryRaw<Array<{n:number}>>`SELECT count(DISTINCT call_id)::int n FROM (
        SELECT call_id FROM catalogue_exposures WHERE user_id=${p.userId} AND kind=${kind} AND seen_at>now()-make_interval(days=>${days}::int)
        UNION ALL SELECT unnest(CASE WHEN ${kind}='detail' THEN detail_ids ELSE summary_ids END) FROM catalogue_leases WHERE user_id=${p.userId} AND expires_at>now()
        UNION ALL SELECT unnest(${ids}::text[])
      ) exposed`
      if(n>limit*multiplier)return `${kind.toUpperCase()}_${days}_DAY_LIMIT`
    }
    if(kind==='detail')await tx.$executeRaw`UPDATE catalogue_leases SET detail_ids=ARRAY(SELECT DISTINCT unnest(detail_ids||${ids}::text[])),expires_at=now()+interval '10 minutes' WHERE id=${leaseId}`
    else await tx.$executeRaw`UPDATE catalogue_leases SET summary_ids=ARRAY(SELECT DISTINCT unnest(summary_ids||${ids}::text[])),expires_at=now()+interval '10 minutes' WHERE id=${leaseId}`
    return null
  })
  if(exceeded){await violation(p.userId,exceeded);throw new CatalogueAccessError(exceeded,'Your funding viewing allowance has been reached. Try later or ask your administrator for a temporary increase.',429,3600)}
}
export async function commitCatalogueExposure(p:CataloguePrincipal,leaseId:string,bytes:number) {
  const exceeded=await prisma.$transaction(async tx=>{
    await lock(tx,p.userId); await checkCatalogueSession(p,tx)
    // Check before committing/returning the next response segment.
    const count=await increment(tx,p.userId,'bytes',bytes)
    if(count>BigInt(catalogueLimits().bytes))return true
    await tx.$executeRaw`INSERT INTO catalogue_exposures(user_id,call_id,kind,day,seen_at)
      SELECT ${p.userId},unnest(summary_ids),'summary',(now() AT TIME ZONE 'UTC')::date,now() FROM catalogue_leases WHERE id=${leaseId}
      UNION ALL SELECT ${p.userId},unnest(detail_ids),'detail',(now() AT TIME ZONE 'UTC')::date,now() FROM catalogue_leases WHERE id=${leaseId}
      ON CONFLICT(user_id,call_id,kind,day) DO UPDATE SET seen_at=EXCLUDED.seen_at`
    return false
  })
  if(exceeded){await violation(p.userId,'BYTE_LIMIT');throw new CatalogueAccessError('BYTE_LIMIT','Too much funding data requested. Please wait.')}
}
export async function endCatalogueRequest(leaseId:string) {
  await prisma.$executeRaw`DELETE FROM catalogue_leases WHERE id=${leaseId}`
}
