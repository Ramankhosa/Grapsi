import { describe, expect, it } from 'vitest';

import type { UserRole } from '@prisma/client';
import {
  PLATFORM_CONSOLE_ROLES,
  PLATFORM_ROLES,
  isPlatformRole,
  validateRoleShape,
} from '@/lib/user-provisioning';

const role = (value: string) => value as unknown as UserRole;

describe('PLATFORM_STAFF role shape', () => {
  it('is a platform role, but not a console role', () => {
    expect(PLATFORM_ROLES).toContain(role('PLATFORM_STAFF'));
    expect(isPlatformRole(role('PLATFORM_STAFF'))).toBe(true);
    // The distinction that keeps staff out of the super-admin surfaces:
    // `requirePlatformScope` keys off the console list, not this one.
    expect(PLATFORM_CONSOLE_ROLES).not.toContain(role('PLATFORM_STAFF'));
  });

  it('is accepted as a primary role inside the platform tenant', () => {
    const result = validateRoleShape([role('PLATFORM_STAFF')], { platformTenant: true });
    expect(result.ok).toBe(true);
    expect(result.ok && result.roles).toEqual([role('PLATFORM_STAFF')]);
  });

  it('is rejected inside a customer tenant', () => {
    const result = validateRoleShape([role('PLATFORM_STAFF')], { platformTenant: false });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/platform workspace/i);
  });

  it('cannot be combined with a second primary role', () => {
    const result = validateRoleShape([role('PLATFORM_STAFF'), role('SUPER_ADMIN')], { platformTenant: true });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/only one primary role/i);
  });

  it('cannot carry tenant-scoped tags', () => {
    const result = validateRoleShape([role('PLATFORM_STAFF'), role('CALL_ADMIN')], { platformTenant: true });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/tenant-scoped tags/i);
  });
});
