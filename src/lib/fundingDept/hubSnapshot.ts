import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import type { HubScope } from './hubScope'
import type { ExportTable } from './managementExport'

export type HubSnapshot = { payload: Record<string, any>; tables: ExportTable[]; asOf: string; timeZone: string; periodLabel: string; periodStart?: string; periodEnd?: string }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function hubSnapshotKeys(scope: HubScope, report: string, params: URLSearchParams) {
  return {
    scope: hash([scope.lens, scope.portfolio, [...scope.schoolIdsIgnoringMember].sort(), scope.memberUserId]),
    filters: hash(['hub-v2', report, [...params].filter(([key, value]) => value && !['snapshot', 'page', 'logPage', 'format'].includes(key)).sort(([a], [b]) => a.localeCompare(b))]),
  }
}
export async function readHubSnapshot(id: string, scope: HubScope, keys: ReturnType<typeof hubSnapshotKeys>): Promise<HubSnapshot | null> {
  const rows = await prisma.$queryRaw<Array<{ payload: HubSnapshot }>>(Prisma.sql`SELECT payload FROM dsr_report_snapshots
    WHERE id=${id} AND tenant_id=${scope.tenantId} AND user_id=${scope.userId} AND scope_key=${keys.scope} AND filter_key=${keys.filters} AND expires_at>now()`)
  return rows[0]?.payload ?? null
}
export async function writeHubSnapshot(scope: HubScope, keys: ReturnType<typeof hubSnapshotKeys>, payload: HubSnapshot) {
  const id = randomUUID()
  await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`DELETE FROM dsr_report_snapshots WHERE tenant_id=${scope.tenantId} AND expires_at<now()`),
    prisma.$executeRaw(Prisma.sql`INSERT INTO dsr_report_snapshots(id,tenant_id,user_id,scope_key,filter_key,payload,expires_at)
      VALUES(${id},${scope.tenantId},${scope.userId},${keys.scope},${keys.filters},${JSON.stringify(payload)}::jsonb,${new Date(Date.now() + 15 * 60000)})`),
  ])
  return id
}
