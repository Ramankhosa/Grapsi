import type { Db } from './queue'

export class MonitorCapacityError extends Error {}
const positive = (value: string | undefined, fallback: number) => Math.max(1, Number(value) || fallback)
/** Limits stop and retain queued work; they never count as funder-site failures. */
export async function assertResourceCapacity(db: Db, siteId: string, keys: string[]) {
  const unique = [...new Set(keys)]
  const existing = await db.monitorResource.count({ where: { site_id: siteId, dedup_key: { in: unique } } })
  const adding = unique.length - existing
  if (!adding) return
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('monitor-resource-capacity'))`
  const [site, total] = await Promise.all([db.monitorResource.count({ where: { site_id: siteId } }), db.monitorResource.count()])
  if (site + adding > positive(process.env.MONITOR_SITE_RESOURCE_LIMIT, 5000) || total + adding > positive(process.env.MONITOR_RESOURCE_LIMIT, 100000)) throw new MonitorCapacityError('Resource inventory limit reached. Increase the approved limit or archive old inventory; queued coverage is retained.')
}
/** Serialized with version writes so concurrent sites cannot overshoot the quota. */
export async function assertContentCapacity(db: Db, siteId: string, incomingBytes: number, siteLimit: bigint | null) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('monitor-content-capacity'))`
  const [site, total] = await Promise.all([
    db.monitorResourceVersion.aggregate({ where: { resource: { site_id: siteId } }, _sum: { byte_length: true } }),
    db.monitorResourceVersion.aggregate({ _sum: { byte_length: true } }),
  ])
  const globalLimit = positive(process.env.MONITOR_STORAGE_LIMIT_BYTES, 10_000_000_000)
  if (BigInt((site._sum.byte_length ?? 0) + incomingBytes) > (siteLimit ?? 250_000_000n) || (total._sum.byte_length ?? 0) + incomingBytes > globalLimit) throw new MonitorCapacityError('Evidence storage limit reached. Retained review evidence is protected; new work is deferred.')
}
