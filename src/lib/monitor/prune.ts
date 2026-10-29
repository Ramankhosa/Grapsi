import type { Db } from './queue'

/**
 * Stored page copies that only repeat the text of a newer (or the current)
 * copy of the same page. Before 29 Oct 2026 every raw-HTML change stored a new
 * copy, and the duplicates filled several sites' evidence allowance.
 *
 * A copy is kept when anything uses it: it is the page's current copy, a
 * laptop result or a live laptop job points at it, it is review evidence or a
 * draft's source, it is pinned, or it holds a stored document file. Deleting a copy also
 * removes laptop jobs that were superseded before they ran (no result).
 */
export const DUPLICATE_VERSIONS_SQL = `
  SELECT v.id FROM monitor_resource_versions v JOIN monitor_resources r ON r.id = v.resource_id
  WHERE v.id IS DISTINCT FROM r.current_version_id
    AND v.file_path IS NULL
    AND v.pin_refcount = 0
    AND v.meaningful_hash IS NOT NULL
    AND EXISTS (SELECT 1 FROM monitor_resource_versions w
      WHERE w.resource_id = v.resource_id AND w.meaningful_hash = v.meaningful_hash AND w.id <> v.id
        AND (w.id = r.current_version_id OR w.created_at > v.created_at OR (w.created_at = v.created_at AND w.id > v.id)))
    AND NOT EXISTS (SELECT 1 FROM monitor_local_analysis_results a WHERE a.version_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM monitor_local_analysis_jobs j WHERE j.version_id = v.id AND j.state <> 'SUPERSEDED')
    AND NOT EXISTS (SELECT 1 FROM monitor_opportunity_evidence e WHERE e.version_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM monitor_opportunities o WHERE v.id = ANY(o.drafted_from_version_ids))`

/** Delete duplicate copies in batches; each batch re-checks, so a copy that came into use meanwhile is kept. */
export async function deleteDuplicateVersions(db: Db, onBatch?: (copies: number, bytes: bigint) => void) {
  let copies = 0, bytes = 0n
  for (;;) {
    const gone = await db.$queryRawUnsafe<Array<{ byte_length: number }>>(`DELETE FROM monitor_resource_versions WHERE id IN (${DUPLICATE_VERSIONS_SQL} LIMIT 1000) RETURNING byte_length`)
    if (!gone.length) return { copies, bytes }
    copies += gone.length
    bytes += gone.reduce((sum, g) => sum + BigInt(g.byte_length ?? 0), 0n)
    onBatch?.(copies, bytes)
  }
}
