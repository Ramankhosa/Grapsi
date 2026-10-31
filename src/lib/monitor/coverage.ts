import { prisma } from '@/lib/prisma'
import type { Db } from './queue'

export async function retainCoverageGap(db: Db, siteId: string, url: string, kind: string, reason: string) {
  await db.monitorCoverageGap.upsert({where:{site_id_url_kind:{site_id:siteId,url,kind}},create:{site_id:siteId,url,kind,reason},update:{state:'OPEN',reason,last_seen_at:new Date()}})
}
export async function coverageSnapshot() {
  const [groups,recent,frontier]=await Promise.all([
    prisma.monitorCoverageGap.groupBy({by:['kind'],where:{state:'OPEN'},_count:{_all:true}}),
    prisma.monitorCoverageGap.findMany({where:{state:'OPEN'},orderBy:{last_seen_at:'desc'},take:20}),
    prisma.monitorCrawlFrontier.groupBy({by:['state'],_count:{_all:true}}),
  ])
  return {groups:Object.fromEntries(groups.map(g=>[g.kind,g._count._all])),recent,frontier:Object.fromEntries(frontier.map(g=>[g.state,g._count._all]))}
}
