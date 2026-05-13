import { describe, expect, it } from 'vitest';

import {
  PLATFORM_ROLE_CODES,
  getPermissionsForRoleCodes,
  isPlatformPermissionCode,
  isPlatformRoleCode,
} from '@/lib/platformTeamRoles';

describe('platform team role definitions', () => {
  it('keeps role codes typed and validates known role codes', () => {
    expect(PLATFORM_ROLE_CODES).toContain('FUNDING_OPERATIONS_MANAGER');
    expect(isPlatformRoleCode('FUNDING_OPERATIONS_MANAGER')).toBe(true);
    expect(isPlatformRoleCode('UNKNOWN_ROLE')).toBe(false);
  });

  it('maps funding operation and publisher roles to separate permissions', () => {
    expect(getPermissionsForRoleCodes(['FUNDING_OPERATIONS_MANAGER'])).toContain('funding.operations.write');
    expect(getPermissionsForRoleCodes(['FUNDING_OPERATIONS_MANAGER'])).not.toContain('funding.publisher.write');
    expect(getPermissionsForRoleCodes(['FUNDING_PUBLISHER'])).toContain('funding.publisher.write');
    expect(getPermissionsForRoleCodes(['FUNDING_PUBLISHER'])).not.toContain('funding.operations.write');
  });

  it('validates permission codes', () => {
    expect(isPlatformPermissionCode('tenant.manage')).toBe(true);
    expect(isPlatformPermissionCode('funding.admin.everything')).toBe(false);
  });
});
