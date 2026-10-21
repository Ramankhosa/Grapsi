/**
 * Reversing an import run.
 *
 * Archives calls the run CREATED. Never physically delete a call: references
 * can live in JSON/text, and work can attach after an attachment check. A
 * cascading DELETE could otherwise erase that work. Provenance and linked
 * funders remain available for history. Field updates made to earlier imported
 * calls are reverted from the change log. Existing (pre-import) calls are
 * never touched: they have no import_run_id and the run never wrote them.
 */
import type { PrismaClient } from '@/lib/prisma-generated'

import { referencingColumns } from './safety'

export async function callsWithAttachedWork(db: PrismaClient, callIds: string[]): Promise<Set<string>> {
  const attached = new Set<string>()
  if (callIds.length === 0) return attached
  for (const { table, column } of await referencingColumns(db)) {
    const extra = table === 'funding_call_research_area_taxonomies' ? `AND t.source <> 'auto:crosswalk'` : ''
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT DISTINCT t."${column}"::text AS id FROM "${table}" t WHERE t."${column}" = ANY($1::text[]) ${extra}`,
      callIds
    )
    rows.forEach((row) => attached.add(row.id))
  }
  return attached
}

export async function rollbackImportRun(input: {
  db: PrismaClient
  runId: string
  dryRun: boolean
  confirmTarget?: string | null
  log?: (m: string) => void
}) {
  const { db } = input
  const log = input.log || (() => {})
  const database = (await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name
  if (!input.dryRun && input.confirmTarget !== database) {
    throw new Error(`Refusing to roll back: --confirm-target must equal the target database name (${database}).`)
  }
  const run = await db.fundingImportRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new Error(`No import run ${input.runId}.`)

  const createdRows = await db.fundingCall.findMany({ where: { import_run_id: input.runId }, select: { id: true, catalog_status: true, visibility: true } })
  // A call promoted to the funding department is department work now: a
  // rollback never pulls it out silently. Withdraw it from DSR first.
  const promoted = createdRows.filter((c) => c.visibility === 'GLOBAL_PUBLISHED')
  if (promoted.length > 0) log(`${promoted.length} of the run's calls are promoted to the funding department and are left alone: withdraw them first.`)
  const created = createdRows.filter((c) => c.visibility !== 'GLOBAL_PUBLISHED')
  const createdIds = created.map((c) => c.id)
  const toDelete: string[] = []
  const toArchive = createdIds
  const updates = await db.fundingImportChange.findMany({
    where: { run_id: input.runId, operation: 'UPDATE', entity_table: 'funding_calls', entity_id: { notIn: createdIds } },
    orderBy: { created_at: 'desc' },
  })
  const createdFunders = await db.funder.findMany({ where: { import_run_id: input.runId }, select: { id: true } })
  log(`Run ${input.runId}: ${createdIds.length} calls created (${toArchive.length} to archive; physical deletion disabled), ${updates.length} field updates to revert, ${createdFunders.length} funders created.`)
  if (input.dryRun) return { deleted: 0, archived: 0, reverted: 0, funders: 0, toDelete: toDelete.length, toArchive: toArchive.length }

  const deleted = 0
  let archived = 0
  if (toArchive.length > 0) {
    archived = Number(
      await db.$executeRawUnsafe(
        `UPDATE funding_calls SET catalog_status = 'ARCHIVED', status = 'ARCHIVED', is_active = false, "archivedAt" = now()
         WHERE id = ANY($1::text[]) AND import_run_id = $2
           AND visibility::text <> 'GLOBAL_PUBLISHED'`,
        toArchive,
        input.runId
      )
    )
  }
  let reverted = 0
  for (const change of updates) {
    if (!change.field) continue
    const call = await db.fundingCall.findFirst({ where: { id: change.entity_id, import_run_id: { not: null } }, select: { id: true } })
    if (!call) continue
    await db.fundingCall.update({ where: { id: call.id }, data: { [change.field]: change.before_value as any } })
    reverted++
  }
  const funderIds = createdFunders.map((f) => f.id)
  let funders = 0
  if (funderIds.length > 0) {
    funders = Number(
      await db.$executeRawUnsafe(
        `DELETE FROM funders f WHERE f.id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM funding_calls c WHERE c.funder_id = f.id)`,
        funderIds
      )
    )
  }
  // Provenance rows this run introduced whose call/funder is now gone. Call
  // and funder records are cleaned independently: a call's record keeps its
  // funder link even after the call is deleted.
  // A LINKED record (an imported copy set aside as "same as" another call) is
  // the run's own row even though it points at a call the run did not create.
  await db.externalSourceRecord.deleteMany({
    where: { first_import_run_id: input.runId, entity_type: 'CALL', OR: [{ funding_call_id: null }, { link_role: 'LINKED' }] },
  })
  await db.externalSourceRecord.deleteMany({ where: { first_import_run_id: input.runId, entity_type: 'FUNDER', funder_id: null } })
  await db.fundingImportRun.update({ where: { id: input.runId }, data: { status: 'ROLLED_BACK', finished_at: new Date() } })
  log(`Rolled back: deleted ${deleted}, archived ${archived}, reverted ${reverted} field updates, removed ${funders} funders.`)
  return { deleted, archived, reverted, funders, toDelete: toDelete.length, toArchive: toArchive.length }
}
