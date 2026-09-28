import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureManualAllocationMapping } from '@/lib/assignments/manualAllocationMapping'
import { departmentEventTitle } from '@/lib/fundingDept/callTimeline'

const unit = vi.fn(), query = vi.fn(), execute = vi.fn()
const tx = { tenantOrgUnit: { findFirst: unit }, $queryRaw: query, $executeRaw: execute } as any
const input = { tenantId: 'tenant', callId: 'call', orgUnitId: 'department', actorId: 'officer', reason: 'Indirect research fit: interdisciplinary work' }
beforeEach(() => { vi.resetAllMocks(); unit.mockResolvedValue({ id: 'department', path: ['school', 'department'] }); execute.mockResolvedValue(1) })

describe('manual allocation school responsibility', () => {
  it('creates a missing mapping with manual provenance and an audit event', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ source: 'MANUAL_ALLOCATION', is_active: true }])
    await ensureManualAllocationMapping(tx, input)
    expect(query.mock.calls[1][0].sql).toContain("'MANUAL_ALLOCATION'")
    expect(query.mock.calls[1][0].values).toContain('school')
    expect(execute.mock.calls[1][0].values).toContain('MANUAL_ALLOCATION')
    expect(execute.mock.calls[1][0].values).toContain(input.reason)
  })
  it('preserves an existing active mapping and its original date and source', async () => {
    query.mockResolvedValueOnce([{ source: 'ORIGIN', is_active: true }])
    await ensureManualAllocationMapping(tx, input)
    expect(query).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1) // advisory lock only
  })
  it('reopens an ended mapping and preserves the earlier removal in the audit', async () => {
    const before = { is_active: false, source: 'ADDED_BY_HEAD', ended_reason: 'Previously outside school remit', ended_by: 'head' }
    query.mockResolvedValueOnce([before]).mockResolvedValueOnce([{ is_active: true, source: 'MANUAL_ALLOCATION' }])
    await ensureManualAllocationMapping(tx, input)
    expect(query.mock.calls[1][0].sql).toContain('ended_at=NULL')
    expect(execute.mock.calls[1][0].values).toContain(JSON.stringify(before))
    expect(execute.mock.calls[1][0].values).toContain('REOPENED_BY_ALLOCATION')
  })
  it('keeps admin allocations to unplaced faculty unattributed', async () => {
    await ensureManualAllocationMapping(tx, { ...input, orgUnitId: null })
    expect(query).not.toHaveBeenCalled()
  })
  it('does not attribute a member reopening to the DSR head', () => {
    expect(departmentEventTitle({ entity_type: 'MAPPING', kind: 'REOPENED_BY_ALLOCATION', school_name: 'Engineering', after_data: {} })).toBe("Manual allocation reopened Engineering's responsibility")
  })
})
