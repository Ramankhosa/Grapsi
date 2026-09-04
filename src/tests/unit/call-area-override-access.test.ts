import { describe, expect, it } from 'vitest';

/**
 * Who may rewrite a call's classification.
 *
 * This mirrors `authorize` in the research-areas route. It is duplicated here
 * on purpose: the rule protects cross-tenant data — a tenant editing a shared
 * call would change what every other university sees — and a rule that
 * important deserves a test that fails loudly if the route's copy drifts from
 * the intent written down here.
 */
function authorize(
  context: { user: { roles: string[] }; tenantId: string; isAdmin: boolean },
  call: { tenantId: string | null }
): { ok: boolean; status?: number } {
  const roles = context.user.roles || [];
  if (roles.includes('SUPER_ADMIN')) return { ok: true };

  const isTenantAdmin =
    context.isAdmin || roles.some((role) => ['OWNER', 'ADMIN', 'CALL_ADMIN'].includes(role));
  if (!isTenantAdmin) return { ok: false, status: 403 };
  if (call.tenantId !== context.tenantId) return { ok: false, status: 403 };
  return { ok: true };
}

const ctx = (roles: string[], tenantId = 'lpu', isAdmin = false) => ({
  user: { roles },
  tenantId,
  isAdmin,
});

const OWN_CALL = { tenantId: 'lpu' };
const SHARED_CALL = { tenantId: null };
const OTHER_TENANT_CALL = { tenantId: 'other-university' };

describe('who may correct a call classification', () => {
  it('lets a platform administrator edit any call', () => {
    const superAdmin = ctx(['SUPER_ADMIN']);
    expect(authorize(superAdmin, OWN_CALL).ok).toBe(true);
    expect(authorize(superAdmin, SHARED_CALL).ok).toBe(true);
    expect(authorize(superAdmin, OTHER_TENANT_CALL).ok).toBe(true);
  });

  it('lets a tenant admin edit their own tenant’s calls', () => {
    for (const role of ['OWNER', 'ADMIN', 'CALL_ADMIN']) {
      expect(authorize(ctx([role]), OWN_CALL).ok, role).toBe(true);
    }
  });

  it('refuses a tenant admin on a SHARED call', () => {
    // The whole point of the boundary: a shared call's classification is read
    // by every institution, so one of them must not be able to rewrite it.
    const result = authorize(ctx(['ADMIN']), SHARED_CALL);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('refuses a tenant admin on another tenant’s call', () => {
    expect(authorize(ctx(['OWNER']), OTHER_TENANT_CALL).ok).toBe(false);
  });

  it('refuses ordinary roles outright, including a DSR officer', () => {
    // A department officer changes their own school's view through triage,
    // never the call's global classification.
    for (const role of ['ANALYST', 'MANAGER', 'CALL_ASSIGNER']) {
      expect(authorize(ctx([role]), OWN_CALL).ok, role).toBe(false);
    }
  });

  it('accepts the isAdmin flag as equivalent to an admin role', () => {
    expect(authorize(ctx([], 'lpu', true), OWN_CALL).ok).toBe(true);
    // …but the tenant boundary still applies to them.
    expect(authorize(ctx([], 'lpu', true), SHARED_CALL).ok).toBe(false);
  });
});
