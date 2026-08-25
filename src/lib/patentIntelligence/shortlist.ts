/**
 * Per-user patent shortlist (Prisma `PatentShortlistItem`). Every query is
 * scoped by userId — the shortlist is personal working material, not a tenant
 * resource; tenantId is stored for future tenant-wide views only.
 */

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { normalizePublicationNumberKey, toPatentSearchItem } from './searchCore'
import type { PatentSearchItem, PatentShortlistItemDto } from './types'

const SHORTLIST_MAX_ITEMS = 500

type ShortlistRow = {
  id: string
  tenantId: string | null
  userId: string
  ideaRunId: string | null
  publicationNumber: string
  publicationNumberKey: string
  title: string
  recordJson: Prisma.JsonValue
  note: string | null
  source: string
  createdAt: Date
  updatedAt: Date
}

function coerceStoredRecord(row: ShortlistRow): PatentSearchItem {
  const raw = row.recordJson
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const candidate = raw as Record<string, unknown>
    const looksNormalized = typeof candidate.publicationNumberKey === 'string'
      && Array.isArray(candidate.applicants) && Array.isArray(candidate.classifications)
    if (looksNormalized) return candidate as unknown as PatentSearchItem
    const rebuilt = toPatentSearchItem({ ...(candidate as object), publicationNumber: row.publicationNumber, title: (candidate.title as string) || row.title })
    if (rebuilt) return rebuilt
  }
  return toPatentSearchItem({ publicationNumber: row.publicationNumber, title: row.title }) as PatentSearchItem
}

export function toShortlistDto(row: ShortlistRow): PatentShortlistItemDto {
  return {
    id: row.id,
    publicationNumber: row.publicationNumber,
    publicationNumberKey: row.publicationNumberKey,
    title: row.title,
    note: row.note,
    ideaRunId: row.ideaRunId,
    record: coerceStoredRecord(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listShortlist(userId: string, options: { ideaRunId?: string | null } = {}): Promise<PatentShortlistItemDto[]> {
  const rows = await prisma.patentShortlistItem.findMany({
    where: { userId, ...(options.ideaRunId ? { ideaRunId: options.ideaRunId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: SHORTLIST_MAX_ITEMS,
  })
  return rows.map(toShortlistDto)
}

export async function assertIdeaRunOwnership(userId: string, ideaRunId: string): Promise<boolean> {
  const run = await prisma.ideaIntelligenceRun.findFirst({ where: { id: ideaRunId, userId }, select: { id: true } })
  return Boolean(run)
}

export async function saveToShortlist(input: {
  userId: string
  tenantId: string | null
  record: PatentSearchItem
  note?: string | null
  ideaRunId?: string | null
}): Promise<{ item: PatentShortlistItemDto; created: boolean }> {
  const publicationNumberKey = normalizePublicationNumberKey(input.record.publicationNumberKey || input.record.publicationNumber)
  const recordJson = { ...input.record, publicationNumberKey } as unknown as Prisma.InputJsonValue
  const where = { userId_publicationNumberKey: { userId: input.userId, publicationNumberKey } }

  const existing = await prisma.patentShortlistItem.findUnique({ where })
  const updateData: Prisma.PatentShortlistItemUpdateInput = {
    title: input.record.title,
    recordJson,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.ideaRunId !== undefined ? { ideaRunId: input.ideaRunId } : {}),
  }
  if (existing) {
    const updated = await prisma.patentShortlistItem.update({ where, data: updateData })
    return { item: toShortlistDto(updated), created: false }
  }

  try {
    const created = await prisma.patentShortlistItem.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        ideaRunId: input.ideaRunId ?? null,
        publicationNumber: input.record.publicationNumber,
        publicationNumberKey,
        title: input.record.title,
        recordJson,
        note: input.note ?? null,
        source: 'patentnest',
      },
    })
    return { item: toShortlistDto(created), created: true }
  } catch (error) {
    // Two tabs saving the same patent at once: the unique index wins, fall back to the update path.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const updated = await prisma.patentShortlistItem.update({ where, data: updateData })
      return { item: toShortlistDto(updated), created: false }
    }
    throw error
  }
}

export async function updateShortlistNote(userId: string, id: string, note: string | null): Promise<PatentShortlistItemDto | null> {
  const result = await prisma.patentShortlistItem.updateMany({ where: { id, userId }, data: { note } })
  if (!result.count) return null
  const row = await prisma.patentShortlistItem.findFirst({ where: { id, userId } })
  return row ? toShortlistDto(row) : null
}

export async function removeFromShortlist(userId: string, id: string): Promise<boolean> {
  const result = await prisma.patentShortlistItem.deleteMany({ where: { id, userId } })
  return result.count > 0
}
