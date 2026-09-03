import { describe, expect, it } from 'vitest';

import { canOpenSchoolWork } from '@/lib/fundingDept/shared';
import { emptyScope, type ManagedScope } from '@/lib/orgUnits/scope';

function scope(overrides: Partial<ManagedScope> = {}): ManagedScope {
  return { ...emptyScope('tenant_1', 'user_1'), ...overrides };
}

describe('canOpenSchoolWork', () => {
  it('lets a tenant-wide admin open any school', () => {
    expect(canOpenSchoolWork(scope({ isTenantWide: true }), 'school_a')).toBe(true);
  });

  it('lets the department head open any school, even with no coverage rows', () => {
    // The head answers for the whole department. This is the case the old
    // per-school fence got wrong: the head could open the department funnel
    // and was then refused every individual school.
    const head = scope({
      isHead: false,
      managedUnitIds: [],
      fundingDept: { isMember: true, isHead: true, memberId: 'm_head', schoolUnitIds: [] },
    });
    expect(canOpenSchoolWork(head, 'school_a')).toBe(true);
  });

  it('lets a covering officer open a school inside their reach and not one outside', () => {
    const officer = scope({
      isHead: true,
      managedUnitIds: ['school_a', 'dept_a1'],
      fundingDept: { isMember: true, isHead: false, memberId: 'm_1', schoolUnitIds: ['school_a'] },
    });
    expect(canOpenSchoolWork(officer, 'school_a')).toBe(true);
    expect(canOpenSchoolWork(officer, 'school_b')).toBe(false);
  });

  it('does not confuse an org-unit head with the department head', () => {
    // `scope.isHead` is true for anyone with a manager grant; only
    // `scope.fundingDept.isHead` is the department head.
    const unitHead = scope({ isHead: true, managedUnitIds: ['school_a'] });
    expect(canOpenSchoolWork(unitHead, 'school_b')).toBe(false);
  });

  it('refuses someone with no standing at all', () => {
    expect(canOpenSchoolWork(scope(), 'school_a')).toBe(false);
  });
});
