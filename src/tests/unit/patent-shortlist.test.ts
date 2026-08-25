import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PatentSearchItem } from '@/lib/patentIntelligence/types'

const mocks = vi.hoisted(() => ({
  patentShortlistItem: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  ideaIntelligenceRun: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks, default: mocks }))

import { assertIdeaRunOwnership, removeFromShortlist, saveToShortlist, toShortlistDto } from '@/lib/patentIntelligence/shortlist'

const RECORD: PatentSearchItem = {
  id: 'IN20282005A', publicationNumber: 'IN 2028/2005 A', publicationNumberKey: 'IN20282005A', applicationNumber: null, kind: 'A',
  country: 'IN', jurisdiction: 'IN', title: 'Membrane', abstract: null, applicants: [], inventors: [], classifications: [],
  classificationGroups: [], filingDate: null, publicationDate: null, filingYear: null, publicationYear: null, numberOfPages: null,
  numberOfClaims: null, extractionConfidence: null, source: null, relevance: null,
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1', tenantId: 'tenant-1', userId: 'user-1', ideaRunId: null, publicationNumber: 'IN 2028/2005 A',
    publicationNumberKey: 'IN20282005A', title: 'Membrane', recordJson: RECORD, note: null, source: 'patentnest',
    createdAt: new Date('2026-08-22T10:00:00Z'), updatedAt: new Date('2026-08-22T10:00:00Z'), ...overrides,
  }
}

describe('shortlist persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.patentShortlistItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
    mocks.patentShortlistItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
  })

  it('creates a row on first save with the normalized key', async () => {
    mocks.patentShortlistItem.findUnique.mockResolvedValue(null)
    const result = await saveToShortlist({ userId: 'user-1', tenantId: 'tenant-1', record: { ...RECORD, publicationNumberKey: 'in 2028/2005 a' }, note: 'cite', ideaRunId: 'run-1' })
    expect(result.created).toBe(true)
    expect(mocks.patentShortlistItem.findUnique).toHaveBeenCalledWith({ where: { userId_publicationNumberKey: { userId: 'user-1', publicationNumberKey: 'IN20282005A' } } })
    expect(mocks.patentShortlistItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', ideaRunId: 'run-1', publicationNumberKey: 'IN20282005A', note: 'cite', source: 'patentnest' }),
    })
    expect(result.item.publicationNumberKey).toBe('IN20282005A')
  })

  it('updates an existing row and leaves the note alone when it is not provided', async () => {
    mocks.patentShortlistItem.findUnique.mockResolvedValue(row({ note: 'keep me' }))
    const result = await saveToShortlist({ userId: 'user-1', tenantId: 'tenant-1', record: RECORD })
    expect(result.created).toBe(false)
    expect(mocks.patentShortlistItem.create).not.toHaveBeenCalled()
    const updateArgs = mocks.patentShortlistItem.update.mock.calls[0][0]
    expect(updateArgs.where).toEqual({ userId_publicationNumberKey: { userId: 'user-1', publicationNumberKey: 'IN20282005A' } })
    expect(updateArgs.data).not.toHaveProperty('note')
    expect(updateArgs.data).not.toHaveProperty('ideaRunId')

    await saveToShortlist({ userId: 'user-1', tenantId: 'tenant-1', record: RECORD, note: null })
    expect(mocks.patentShortlistItem.update.mock.calls[1][0].data).toHaveProperty('note', null)
  })

  it('scopes deletes and ownership checks to the user', async () => {
    mocks.patentShortlistItem.deleteMany.mockResolvedValue({ count: 0 })
    expect(await removeFromShortlist('user-1', 'row-9')).toBe(false)
    expect(mocks.patentShortlistItem.deleteMany).toHaveBeenCalledWith({ where: { id: 'row-9', userId: 'user-1' } })

    mocks.ideaIntelligenceRun.findFirst.mockResolvedValue(null)
    expect(await assertIdeaRunOwnership('user-1', 'run-x')).toBe(false)
    expect(mocks.ideaIntelligenceRun.findFirst).toHaveBeenCalledWith({ where: { id: 'run-x', userId: 'user-1' }, select: { id: true } })
  })

  it('tolerates malformed stored records', () => {
    const dto = toShortlistDto(row({ recordJson: 'garbage' }))
    expect(dto.record).toMatchObject({ publicationNumber: 'IN 2028/2005 A', publicationNumberKey: 'IN20282005A', title: 'Membrane', applicants: [] })
    const partial = toShortlistDto(row({ recordJson: { title: 'Only title', abstract: 'abs' } }))
    expect(partial.record).toMatchObject({ publicationNumber: 'IN 2028/2005 A', title: 'Only title', abstract: 'abs' })
    expect(dto.createdAt).toBe('2026-08-22T10:00:00.000Z')
  })
})
