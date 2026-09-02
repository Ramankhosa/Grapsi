/**
 * POST /api/reviewer/calls/[id]/sections — the endpoint every revision goes
 * through.
 *
 * Regression: the version-numbering transaction computed
 * `effectiveIsRevision` / `effectivePreviousId` inside its closure while the
 * asset-copy step and the response body read them after it. The row was
 * committed, then the handler threw a ReferenceError — so every submission
 * (all revisions included) returned 500 with the version already created, the
 * auto-review never ran, and retries minted duplicate versions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/reviewer-auth-api', () => ({
  getReviewerSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
  requireReviewerCallAccess: vi.fn(async () => ({ call: { id: 'call-1' } })),
}))

const { txMock, prismaMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    reviewerSection: {
      findFirst: vi.fn(),
      create: vi.fn(async (args: any) => ({
        id: 'new-row-id',
        section_title: args.data.section_title,
        version: args.data.version,
      })),
    },
  }
  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      reviewerSection: { findFirst: vi.fn() },
      reviewAssetLink: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({})),
      },
    },
  }
})

vi.mock('../../../lib/prisma', () => ({ default: prismaMock }))

import handler from '../../../pages/api/reviewer/calls/[id]/sections/index'

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
    setHeader(key: string, value: unknown) {
      res.headers[key] = value
      return res
    },
    end() {
      return res
    },
  }
  return res
}

function makeReq(body: Record<string, unknown>) {
  return {
    method: 'POST',
    query: { id: 'call-1' },
    body,
    headers: {},
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reviewer section creation endpoint', () => {
  it('creates a revision and reports the revision flags after the transaction', async () => {
    // The chosen base exists on this call…
    prismaMock.reviewerSection.findFirst.mockResolvedValue({ id: 'v1-id' })
    // …and it is also the newest version of the title.
    txMock.reviewerSection.findFirst.mockResolvedValue({
      id: 'v1-id',
      version: 1,
      reviewerBucketKey: 'problem_need',
      mappingJson: { linkedSections: [{ workflowMode: 'app_draft' }] },
    })

    const res = makeRes()
    await handler(
      makeReq({
        section_title: 'Introduction',
        user_input: 'Revised text that answers the earlier remarks.',
        is_revision: true,
        previous_section_id: 'v1-id',
      }),
      res
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.section).toMatchObject({ section_title: 'Introduction', version: 2 })
    expect(res.body.is_revision).toBe(true)
    expect(res.body.previous_section_id).toBe('v1-id')

    // The new row inherits identity from the base version.
    const created = txMock.reviewerSection.create.mock.calls[0][0].data
    expect(created.version).toBe(2)
    expect(created.previous_section_id).toBe('v1-id')
    expect(created.is_revision).toBe(true)
    expect(created.reviewerBucketKey).toBe('problem_need')
    expect(created.mappingJson).toEqual({ linkedSections: [{ workflowMode: 'app_draft' }] })

    // The asset-copy step runs against the previous version — this is one of
    // the two reads that used to throw after the transaction.
    expect(prismaMock.reviewAssetLink.findMany).toHaveBeenCalledWith({
      where: { review_version_id: 'v1-id' },
    })
  })

  it('treats a re-submitted title as a revision even without the client flag', async () => {
    txMock.reviewerSection.findFirst.mockResolvedValue({
      id: 'v1-id',
      version: 1,
      reviewerBucketKey: null,
      mappingJson: null,
    })

    const res = makeRes()
    await handler(
      makeReq({ section_title: 'Objectives', user_input: 'Second attempt at the objectives.' }),
      res
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.section.version).toBe(2)
    expect(res.body.is_revision).toBe(true)
    expect(res.body.previous_section_id).toBe('v1-id')
  })

  it('creates a brand-new section as version 1 with no revision lineage', async () => {
    txMock.reviewerSection.findFirst.mockResolvedValue(null)

    const res = makeRes()
    await handler(
      makeReq({ section_title: 'Budget Justification', user_input: 'Fresh budget narrative.' }),
      res
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.section.version).toBe(1)
    expect(res.body.is_revision).toBe(false)
    expect(res.body.previous_section_id).toBeNull()
    expect(prismaMock.reviewAssetLink.findMany).not.toHaveBeenCalled()
  })
})
