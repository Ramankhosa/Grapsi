import { describe, expect, it } from 'vitest'

import { proposalReachUnitIds, resolveProposalLens } from '@/lib/proposals/access'
import type { ProposalAccessRecord } from '@/lib/proposals/access'

/**
 * The access rule is the part of this module most likely to be got wrong in a
 * way nobody notices: a leak reads exactly like a working feature.
 */

function scope(overrides: Partial<any> = {}) {
  return {
    tenantId: 't1',
    userId: 'u-me',
    isTenantWide: false,
    isHead: false,
    headUnitIds: [],
    managedUnitIds: [],
    canAssign: false,
    canViewReports: false,
    canManageStructure: false,
    canManageMembers: false,
    primaryUnitId: null,
    fundingDept: { isMember: false, isHead: false, memberId: null, schoolUnitIds: [] },
    ...overrides,
  }
}

function context(overrides: Partial<any> = {}, scopeOverrides: Partial<any> = {}) {
  return {
    user: { id: 'u-me', email: 'me@example.edu', roles: ['MEMBER'] },
    tenantId: 't1',
    isAdmin: false,
    isAssigner: false,
    isCallAdmin: false,
    isQualityAuditor: false,
    scope: scope(scopeOverrides),
    ...overrides,
  } as any
}

const proposal: ProposalAccessRecord = {
  id: 'p1',
  tenant_id: 't1',
  org_unit_id: 'school-a',
  pi_user_id: 'u-pi',
  status: 'IN_REVIEW',
  assignment: null,
  team: [{ user_id: 'u-copi' }],
}

describe('resolveProposalLens', () => {
  it('refuses another tenant outright', () => {
    expect(resolveProposalLens(context({ tenantId: 't2' }), proposal)).toBeNull()
  })

  it('gives a tenant admin the admin lens', () => {
    expect(resolveProposalLens(context({ isAdmin: true }), proposal)).toBe('admin')
  })

  it('gives the covering officer the officer lens', () => {
    const ctx = context({}, { managedUnitIds: ['school-a'], fundingDept: { isMember: true, isHead: false, memberId: 'm1', schoolUnitIds: ['school-a'] } })
    expect(resolveProposalLens(ctx, proposal)).toBe('officer')
  })

  it('gives the department head every school, with no coverage rows of their own', () => {
    const ctx = context({}, { fundingDept: { isMember: true, isHead: true, memberId: 'm1', schoolUnitIds: [] } })
    expect(resolveProposalLens(ctx, proposal)).toBe('officer')
  })

  it('shuts out an officer who covers a different school', () => {
    const ctx = context({}, { managedUnitIds: ['school-b'], fundingDept: { isMember: true, isHead: false, memberId: 'm2', schoolUnitIds: ['school-b'] } })
    expect(resolveProposalLens(ctx, proposal)).toBeNull()
  })

  it('gives the PI and a named co-investigator the faculty lens', () => {
    expect(resolveProposalLens(context({ user: { id: 'u-pi', roles: [] } }), proposal)).toBe('faculty')
    expect(resolveProposalLens(context({ user: { id: 'u-copi', roles: [] } }), proposal)).toBe('faculty')
  })

  it('shuts out a colleague who is not on the application', () => {
    expect(resolveProposalLens(context({ user: { id: 'u-stranger', roles: [] } }), proposal)).toBeNull()
  })

  it('gives a Dean over the school the read-only head lens', () => {
    const ctx = context({}, { isHead: true, managedUnitIds: ['school-a'], headUnitIds: ['school-a'] })
    expect(resolveProposalLens(ctx, proposal)).toBe('head')
  })

  it('prefers the officer lens when someone is both officer and co-investigator', () => {
    const ctx = context(
      { user: { id: 'u-copi', roles: [] } },
      { managedUnitIds: ['school-a'], fundingDept: { isMember: true, isHead: false, memberId: 'm1', schoolUnitIds: ['school-a'] } }
    )
    expect(resolveProposalLens(ctx, proposal)).toBe('officer')
  })

  it('lets whoever circulated the call follow it, read-only', () => {
    const withAssignment: ProposalAccessRecord = {
      ...proposal,
      assignment: { assigned_by_user_id: 'u-me', assignee_org_unit_id: 'dept-a1' },
    }
    // They have a real interest in the outcome, but they are not the
    // department, so they never see its internal notes.
    expect(resolveProposalLens(context(), withAssignment)).toBe('head')
  })

  it('does NOT promote a Dean to officer just because the school is in their reach', () => {
    // managedUnitIds carries manager grants as well as department coverage, so
    // reach alone would hand a Dean the department's private assessment of
    // their own faculty. Membership is what separates them.
    const dean = context({}, { isHead: true, managedUnitIds: ['school-a'], headUnitIds: ['school-a'] })
    expect(resolveProposalLens(dean, proposal)).toBe('head')

    const officer = context(
      {},
      {
        isHead: true,
        managedUnitIds: ['school-a'],
        fundingDept: { isMember: true, isHead: false, memberId: 'm1', schoolUnitIds: ['school-a'] },
      }
    )
    expect(resolveProposalLens(officer, proposal)).toBe('officer')
  })
})

describe('proposalReachUnitIds', () => {
  it('is unbounded for an admin and for the department head', () => {
    expect(proposalReachUnitIds(context({ isAdmin: true }))).toBeNull()
    expect(
      proposalReachUnitIds(
        context({}, { fundingDept: { isMember: true, isHead: true, memberId: 'm', schoolUnitIds: [] } })
      )
    ).toBeNull()
  })

  it('is the managed schools for everyone else', () => {
    expect(proposalReachUnitIds(context({}, { managedUnitIds: ['school-a', 'school-b'] }))).toEqual([
      'school-a',
      'school-b',
    ])
  })

  it('is empty, not unbounded, for a member covering nothing', () => {
    expect(proposalReachUnitIds(context())).toEqual([])
  })
})
