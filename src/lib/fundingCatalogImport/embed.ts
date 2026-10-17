/**
 * Embedding imported calls: what a publish would embed
 * (fundingCallEmbeddingInput / fundingCallEmbeddingTarget), written with raw
 * SQL so updatedAt does not move, and only for rows an import created. Used by
 * scripts/embed-catalog-calls.ts in bulk and after enriching one promoted call.
 */
import crypto from 'node:crypto'

import prisma from '@/lib/prisma'
import { EmbeddingService } from '@/lib/services/embeddingService'
import { fundingCallEmbeddingInput, fundingCallEmbeddingTarget } from '@/lib/services/fundingCatalogService'

export function embeddingInputHash(input: { text: string; title: string }): string {
  return crypto.createHash('sha256').update(`${input.title}\n${input.text}`).digest('hex').slice(0, 32)
}

/** (Re-)embed these imported calls when their vector is missing, stale or their text changed. */
export async function embedImportedCalls(ids: string[]): Promise<{ embedded: number; upToDate: number }> {
  if (ids.length === 0) return { embedded: 0, upToDate: 0 }
  const target = fundingCallEmbeddingTarget()
  const column = target.column
  const state = await prisma.$queryRawUnsafe<Array<{ id: string; has_vector: boolean; version: string | null; input_hash: string | null }>>(
    `SELECT id, (${column} IS NOT NULL) AS has_vector, metadata->>'embedding_version' AS version, metadata->>'embedding_input_hash' AS input_hash
       FROM funding_calls WHERE id = ANY($1::text[]) AND import_run_id IS NOT NULL`,
    ids
  )
  const calls = await prisma.fundingCall.findMany({ where: { id: { in: state.map((row) => row.id) } } })
  const byId = new Map(calls.map((call) => [call.id, call]))
  const pending: Array<{ id: string; text: string; title: string; hash: string }> = []
  let upToDate = 0
  for (const row of state) {
    const call = byId.get(row.id)
    if (!call) continue
    const input = fundingCallEmbeddingInput(call)
    const hash = embeddingInputHash(input)
    if (row.has_vector && row.version === target.version && row.input_hash === hash) {
      upToDate++
      continue
    }
    pending.push({ id: row.id, ...input, hash })
  }
  if (pending.length === 0) return { embedded: 0, upToDate }

  const result = await new EmbeddingService().generateDocumentEmbeddingsBatch(pending.map((item) => ({ text: item.text, title: item.title })))
  if (result.error) throw new Error(`Embedding provider error: ${result.error}`)
  const now = new Date().toISOString()
  for (let i = 0; i < pending.length; i++) {
    await prisma.$executeRawUnsafe(
      `UPDATE funding_calls
          SET ${column} = $1::vector,
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'embedding_status', 'generated', 'embedding_version', $2::text, 'embedding_model', $3::text,
                'embedding_dimensions', $4::int, 'embedding_task_type', 'RETRIEVAL_DOCUMENT',
                'embedding_updated_at', $5::text, 'embedding_error', NULL, 'embedding_input_hash', $6::text)
        WHERE id = $7 AND import_run_id IS NOT NULL`,
      `[${result.embeddings[i].join(',')}]`,
      target.version,
      result.modelName || target.modelName,
      result.outputDimensionality || target.outputDimensionality,
      now,
      pending[i].hash,
      pending[i].id
    )
  }
  return { embedded: pending.length, upToDate }
}
