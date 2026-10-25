import { prisma } from '@/lib/prisma'
import type { Db } from './queue'
import { identifyUrl } from './urlIdentity'
import { jaccard, tokens } from './relevance'

export function roundIdentity(title: string, reference: string | null, deadline: string | null, funderId: string | null, explicitRound?: string | null) {
  const year = title.match(/\b20\d{2}(?:[-/]\d{2,4})?\b/)?.[0] ?? deadline?.slice(0, 4) ?? null
  // A common title/year on a shared portal is not sufficient for an exact claim.
  const referenceKey = reference ? tokens(reference).filter(t => !/^20\d{2}$/.test(t)).join('-') : ''
  const scheme = funderId && referenceKey ? `${funderId}:${referenceKey}` : null
  return { schemeKey: scheme, roundKey: explicitRound ?? (scheme && year ? year : null) }
}
export async function matchCatalog(url: string, title: string, funderId: string | null, db: Db = prisma, explicitRound?: string | null, observedAliases: string[] = [], reference?: string | null) {
  const urls=[...new Set([url,...observedAliases].filter(Boolean))]
  const keys=urls.map(u=>identifyUrl(u)?.dedupKey).filter((k):k is string=>Boolean(k))
  const owners = keys.length ? await db.fundingCallUrlKey.findMany({ where: { dedup_key: { in: keys } }, take: 30 }) : []
  const ids = owners.map(o => o.funding_call_id).filter((s): s is string => Boolean(s))
  // Consult current rows even when the periodically refreshed URL index is stale.
  const direct = await db.fundingCall.findMany({ where: { OR: [{ id: { in: ids } }, { source_url: { in: urls } }, { sourceUrl: { in: urls } }, { official_urls: { hasSome: urls } }] }, select: { id: true, title: true, funder_id: true, close_date: true,metadata:true }, take: 20 })
  const storedRound=(c:typeof direct[number])=>(c.metadata as {source_watch_identity?:{round?:string}}|null)?.source_watch_identity?.round
  const storedReference=(c:typeof direct[number])=>(c.metadata as {source_watch_identity?:{reference?:string}}|null)?.source_watch_identity?.reference
  if(reference&&direct.some(c=>storedReference(c)&&storedReference(c)!==reference))return {type:'AMBIGUOUS',confidence:'AMBIGUOUS',callId:null,candidates:direct}
  if(explicitRound&&direct.length&&direct.every(c=>storedRound(c)&&storedRound(c)!==explicitRound))return {type:'NEW_ROUND_OF',confidence:'PROBABLE',callId:null,candidates:direct}
  if(explicitRound&&!/^20\d{2}(?:[-/]\d{2,4})?$/.test(explicitRound)&&direct.some(c=>!storedRound(c)))return {type:'AMBIGUOUS',confidence:'AMBIGUOUS',callId:null,candidates:direct}
  const year = explicitRound?.match(/\b20\d{2}\b/)?.[0] ?? title.match(/\b20\d{2}\b/)?.[0]
  const callYear = (c: typeof direct[number]) => c.title.match(/\b20\d{2}\b/)?.[0] ?? (explicitRound && c.close_date ? c.close_date.getUTCFullYear().toString() : null)
  const sameRound = direct.filter(c => (!explicitRound||!storedRound(c)||storedRound(c)===explicitRound)&&(!year || !callYear(c) || callYear(c) === year))
  if (sameRound.length === 1 && (!funderId || !sameRound[0].funder_id || sameRound[0].funder_id===funderId) && jaccard(title, sameRound[0].title) >= 0.75) return { type: 'UPDATE_OF', confidence: 'EXACT', callId: sameRound[0].id, candidates: direct }
  if (direct.length && year && direct.every(c => callYear(c) && callYear(c) !== year)) return { type: 'NEW_ROUND_OF', confidence: 'PROBABLE', callId: null, candidates: direct }
  const candidates = direct.length ? direct : await db.fundingCall.findMany({ where: {
    ...(funderId ? { funder_id: funderId } : {}),
    title: { contains: tokens(title).filter(t => t.length > 4)[0] ?? title.slice(0, 30), mode: 'insensitive' },
  }, select: { id: true, title: true, funder_id: true, close_date: true }, take: 30 })
  const similar = candidates.filter(c => jaccard(title, c.title) >= 0.65)
  return { type: similar.length || direct.length ? 'AMBIGUOUS' : 'NEW', confidence: similar.length || direct.length ? 'AMBIGUOUS' : 'NONE', callId: null, candidates: [...direct, ...similar].slice(0, 10) }
}

/** The same advisory locks are taken by handoff and publish, in stable order. */
export async function lockClaim(db: Db, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}
