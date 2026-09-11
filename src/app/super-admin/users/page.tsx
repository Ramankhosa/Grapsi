'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';

/**
 * Platform user directory.
 *
 * The console previously had no way to see users across tenants, create an
 * account, or change anybody's role — the only cross-tenant roster was the
 * "change administrator" picker inside the tenants table, and new super admins
 * could only be made with a shell script. This page is the surface for all
 * three, backed by /api/v1/platform/users.
 */

type PlatformUser = {
  id: string;
  email: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  primary_role: string | null;
  status: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_ati_id: string | null;
  is_platform_staff: boolean;
  is_pending_activation: boolean;
  has_password: boolean;
  oauth_provider: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TenantOption = {
  id: string;
  name: string;
  ati_id: string;
  status: string;
  is_platform: boolean;
  user_count: number;
};

type PlatformTeamRoleOption = {
  code: string;
  label: string;
  description: string;
};

type AssignableRoles = {
  platform: string[];
  hierarchy: string[];
  additive: string[];
  platform_team: PlatformTeamRoleOption[];
};

type DirectoryPayload = {
  users: PlatformUser[];
  total: number;
  tenants: TenantOption[];
  assignable_roles: AssignableRoles;
  message?: string;
};

type ActivationDetails = {
  email: string;
  link: string;
  expiresAt: string;
  emailSent: boolean;
  emailError: string | null;
  /** Reset links and activation links render through the same banner. */
  kind: 'activation' | 'reset';
};

/**
 * A password an admin has just set for somebody else. Held in memory only — it
 * is never stored in readable form, so once this is dismissed the only way back
 * is to set another one.
 */
type TemporaryPasswordDetails = {
  email: string;
  password: string;
  mustChange: boolean;
  sessionsRevoked: boolean;
  /** The account had no password before this, so it just gained a way in. */
  addedPasswordLogin: boolean;
  oauthProvider: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SUPER_ADMIN_VIEWER: 'Super Admin (Viewer)',
  PLATFORM_STAFF: 'Platform Staff',
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
  MEMBER: 'Member',
  CALL_ASSIGNER: 'Call Assigner',
  CALL_ADMIN: 'Call Admin',
  QUALITY_AUDITOR: 'Quality Auditor',
};

const ROLE_HINTS: Record<string, string> = {
  SUPER_ADMIN: 'Full platform control, including creating other super admins.',
  SUPER_ADMIN_VIEWER: 'Reads every platform screen. Cannot change anything.',
  PLATFORM_STAFF: 'No access on its own. Gains exactly the platform team roles you grant below.',
  OWNER: 'The tenant principal. One per workspace by convention.',
  ADMIN: 'Full workspace administration, including its users and roles.',
  MANAGER: 'Runs work and teams; can read the user list but not change roles.',
  ANALYST: 'Standard working account.',
  VIEWER: 'Read-only access to the workspace.',
  MEMBER: 'Basic tenant member — sees published calls, gets no admin surfaces.',
  CALL_ASSIGNER: 'Can assign funding calls to faculty and view assignment dashboards.',
  CALL_ADMIN: 'Scoped tenant admin — funding calls, faculty roster, org tree. Cannot change roles.',
  QUALITY_AUDITOR: 'Read-only access to all reviews and reports for quality oversight.',
};

const ROLE_CHIP: Record<string, string> = {
  SUPER_ADMIN: 'bg-violet-100 text-violet-800',
  SUPER_ADMIN_VIEWER: 'bg-violet-50 text-violet-700',
  PLATFORM_STAFF: 'bg-cyan-100 text-cyan-800',
  OWNER: 'bg-purple-100 text-purple-800',
  ADMIN: 'bg-rose-100 text-rose-800',
  MANAGER: 'bg-sky-100 text-sky-800',
  ANALYST: 'bg-emerald-100 text-emerald-800',
  VIEWER: 'bg-slate-100 text-slate-700',
  MEMBER: 'bg-slate-100 text-slate-700',
  CALL_ASSIGNER: 'bg-amber-100 text-amber-800',
  CALL_ADMIN: 'bg-indigo-100 text-indigo-800',
  QUALITY_AUDITOR: 'bg-teal-100 text-teal-800',
};

const PAGE_SIZE = 50;

function roleLabel(role: string) {
  return ROLE_LABELS[role] || role;
}

function displayName(user: PlatformUser) {
  const explicit = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return explicit || user.name || user.email;
}

/** GOOGLE -> Google. The enum is shouted; the sentence around it is not. */
function providerLabel(provider: string) {
  return provider.charAt(0) + provider.slice(1).toLowerCase();
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

const EMPTY_ROLES: AssignableRoles = { platform: [], hierarchy: [], additive: [], platform_team: [] };

export default function SuperAdminUsersPage() {
  const { user: authUser, isLoading, authFetch } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<AssignableRoles>(EMPTY_ROLES);

  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'platform' | 'tenant'>('all');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activation, setActivation] = useState<ActivationDetails | null>(null);
  const [copied, setCopied] = useState(false);

  // Password recovery
  const [resetting, setResetting] = useState<PlatformUser | null>(null);
  const [resetMode, setResetMode] = useState<'link' | 'temporary'>('link');
  const [resetSendEmail, setResetSendEmail] = useState(true);
  const [resetPassword, setResetPassword] = useState('');
  const [resetRequireChange, setResetRequireChange] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<TemporaryPasswordDetails | null>(null);
  const [tempCopied, setTempCopied] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createTenantId, setCreateTenantId] = useState('');
  const [createRole, setCreateRole] = useState('');
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createTeamRoles, setCreateTeamRoles] = useState<string[]>([]);
  const [createSendEmail, setCreateSendEmail] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Role editor
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isPlatformAdmin = useMemo(
    () => Boolean(authUser?.roles?.includes('SUPER_ADMIN') || authUser?.roles?.includes('SUPER_ADMIN_VIEWER')),
    [authUser?.roles]
  );
  const canWrite = Boolean(authUser?.roles?.includes('SUPER_ADMIN'));

  const createTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === createTenantId) || null,
    [tenants, createTenantId]
  );
  // Platform staff hold a platform role and no tenant tags; customer tenants are
  // the mirror image. The form follows whichever tenant is picked.
  const createIsPlatform = Boolean(createTenant?.is_platform);
  const createPrimaryOptions = createIsPlatform ? assignableRoles.platform : assignableRoles.hierarchy;

  const editIsPlatform = Boolean(editing?.tenant_ati_id === 'PLATFORM' || (!editing?.tenant_id && editing?.is_platform_staff));
  const editPrimaryOptions = editIsPlatform ? assignableRoles.platform : assignableRoles.hierarchy;

  const allRoles = useMemo(
    () => [...assignableRoles.platform, ...assignableRoles.hierarchy, ...assignableRoles.additive],
    [assignableRoles]
  );

  useEffect(() => {
    if (isLoading) return;
    if (!authUser) {
      router.replace('/login');
      return;
    }
    if (!isPlatformAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, isPlatformAdmin, router, authUser]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (tenantFilter) params.set('tenant_id', tenantFilter);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (scopeFilter !== 'all') params.set('scope', scopeFilter);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));

      const response = await authFetch(`/api/v1/platform/users?${params.toString()}`);
      const payload = await readJson<DirectoryPayload>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to load users');
      }
      setUsers(payload.users || []);
      setTotal(payload.total || 0);
      setTenants(payload.tenants || []);
      setAssignableRoles(payload.assignable_roles || EMPTY_ROLES);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [authFetch, search, tenantFilter, roleFilter, statusFilter, scopeFilter, page]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    // Debounced so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(() => void loadUsers(), 250);
    return () => clearTimeout(timer);
  }, [isPlatformAdmin, loadUsers]);

  function resetCreateForm() {
    setCreateEmail('');
    setCreateFirstName('');
    setCreateLastName('');
    setCreateRole('');
    setCreateTags([]);
    setCreateTeamRoles([]);
    setCreateSendEmail(true);
    setCreateError(null);
  }

  function openCreate() {
    resetCreateForm();
    setActivation(null);
    const firstCustomer = tenants.find((tenant) => !tenant.is_platform && tenant.status === 'ACTIVE');
    setCreateTenantId(firstCustomer?.id || tenants[0]?.id || '');
    setShowCreate(true);
  }

  function pickCreateTenant(tenantId: string) {
    setCreateTenantId(tenantId);
    // The two role families don't overlap, so a role chosen for one scope is
    // never valid in the other.
    setCreateRole('');
    setCreateTags([]);
    setCreateTeamRoles([]);
  }

  async function submitCreate() {
    if (!createTenantId || !createRole) {
      setCreateError('Pick a workspace and a role');
      return;
    }
    // Caught here as well as server-side so the admin sees it against the
    // checkboxes rather than as a banner after a round trip.
    if (createRole === 'PLATFORM_STAFF' && createTeamRoles.length === 0) {
      setCreateError('Platform Staff carries no access on its own — grant at least one platform team role');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const response = await authFetch('/api/v1/platform/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: createEmail.trim(),
          first_name: createFirstName.trim() || undefined,
          last_name: createLastName.trim() || undefined,
          tenant_id: createTenantId,
          roles: [createRole, ...createTags],
          platform_role_codes: createIsPlatform && createTeamRoles.length > 0 ? createTeamRoles : undefined,
          send_activation_email: createSendEmail,
        }),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to create user');
      }

      setShowCreate(false);
      resetCreateForm();
      setActivation({
        email: payload.user.email,
        link: payload.activation_link,
        expiresAt: payload.activation_expires_at,
        emailSent: Boolean(payload.activation_email_sent),
        emailError: payload.activation_email_error || null,
        kind: 'activation',
      });
      setCopied(false);
      setSuccess(`${payload.user.email} created in ${payload.user.tenant_name}.`);
      setPage(0);
      await loadUsers();
    } catch (nextError) {
      setCreateError(nextError instanceof Error ? nextError.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  function openEditor(target: PlatformUser) {
    setEditing(target);
    const isPlatform = target.tenant_ati_id === 'PLATFORM' || (!target.tenant_id && target.is_platform_staff);
    const primaryPool = isPlatform ? assignableRoles.platform : assignableRoles.hierarchy;
    setEditRole(target.roles.find((role) => primaryPool.includes(role)) || target.primary_role || '');
    setEditTags(target.roles.filter((role) => assignableRoles.additive.includes(role)));
    setEditError(null);
  }

  async function submitRoles() {
    if (!editing || !editRole) {
      setEditError('Pick a primary role');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const roles = editIsPlatform ? [editRole] : [editRole, ...editTags];
      const response = await authFetch(`/api/v1/platform/users/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_roles', roles }),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to update roles');
      }
      setSuccess(
        `${editing.email} is now ${payload.user.roles.map(roleLabel).join(', ')}.` +
          (payload.platform_tenant_attached ? ' Attached to the platform workspace.' : '')
      );
      setEditing(null);
      await loadUsers();
    } catch (nextError) {
      setEditError(nextError instanceof Error ? nextError.message : 'Failed to update roles');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(target: PlatformUser) {
    const nextStatus = target.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setError(null);
    try {
      const response = await authFetch(`/api/v1/platform/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_status', status: nextStatus }),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to change status');
      }
      setSuccess(`${target.email} is now ${nextStatus.toLowerCase()}.`);
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to change status');
    }
  }

  async function reissueActivation(target: PlatformUser) {
    setError(null);
    try {
      const response = await authFetch(`/api/v1/platform/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend_activation', send_email: true }),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to reissue the activation link');
      }
      setActivation({
        email: target.email,
        link: payload.activation_link,
        expiresAt: payload.activation_expires_at,
        emailSent: Boolean(payload.activation_email_sent),
        emailError: payload.activation_email_error || null,
        kind: 'activation',
      });
      setCopied(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to reissue the activation link');
    }
  }

  function openReset(target: PlatformUser) {
    setResetting(target);
    setResetMode('link');
    setResetSendEmail(true);
    setResetPassword('');
    setResetRequireChange(true);
    setResetError(null);
    setTempPassword(null);
    setError(null);
  }

  async function submitReset() {
    if (!resetting) return;
    setResetBusy(true);
    setResetError(null);
    try {
      const body =
        resetMode === 'link'
          ? { action: 'send_password_reset', send_email: resetSendEmail }
          : {
              action: 'set_temporary_password',
              password: resetPassword.trim() || undefined,
              require_change: resetRequireChange,
            };
      const response = await authFetch(`/api/v1/platform/users/${resetting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to reset the password');
      }

      if (resetMode === 'link') {
        setActivation({
          email: resetting.email,
          link: payload.activation_link,
          expiresAt: payload.activation_expires_at,
          emailSent: Boolean(payload.activation_email_sent),
          emailError: payload.activation_email_error || null,
          kind: 'reset',
        });
        setCopied(false);
      } else {
        // Held in state and nowhere else — this is the one moment it is
        // readable.
        setTempPassword({
          email: resetting.email,
          password: payload.temporary_password,
          mustChange: Boolean(payload.must_change_password),
          sessionsRevoked: Boolean(payload.sessions_revoked),
          addedPasswordLogin: Boolean(payload.added_password_login),
          oauthProvider: payload.oauth_provider || null,
        });
        setTempCopied(false);
      }

      setResetting(null);
      await loadUsers();
    } catch (nextError) {
      setResetError(nextError instanceof Error ? nextError.message : 'Failed to reset the password');
    } finally {
      setResetBusy(false);
    }
  }

  /** Lift a forced change without touching the password — for one set in error. */
  async function clearForcedChange(target: PlatformUser) {
    setError(null);
    try {
      const response = await authFetch(`/api/v1/platform/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'require_password_change', required: false }),
      });
      const payload = await readJson<any>(response);
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to clear the password change');
      }
      setSuccess(`${target.email} can sign in with their current password again.`);
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to clear the password change');
    }
  }

  async function copyTempPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword.password);
      setTempCopied(true);
    } catch {
      setTempCopied(false);
    }
  }

  async function copyActivationLink() {
    if (!activation) return;
    try {
      await navigator.clipboard.writeText(activation.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (isLoading || !authUser || !isPlatformAdmin) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-sm text-slate-600">Checking platform access...</div>;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="border-b border-slate-200 pb-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Super Admin</div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">Users &amp; Roles</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Every account on the platform. Create users directly into any workspace, change what they can do, and
                promote platform staff — including other super admins.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Refresh
              </button>
              {canWrite ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add user
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {!canWrite ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Viewer accounts can browse the directory but cannot create users or change roles.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}
        {success ? (
          <div className="flex items-start justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>{success}</span>
            <button type="button" onClick={() => setSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
              Dismiss
            </button>
          </div>
        ) : null}

        {activation ? (
          <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-sky-900">
                  {activation.kind === 'reset' ? 'Password reset link' : 'Activation link'} for {activation.email}
                </div>
                <p className="mt-1 text-xs text-sky-800">
                  {activation.emailSent
                    ? 'Emailed to them. Share this link too if the message does not arrive — it sets their password.'
                    : 'Send this link to them — it is how they set their password.'}{' '}
                  Expires {new Date(activation.expiresAt).toLocaleString()}.
                  {activation.kind === 'reset' ? ' Their current password keeps working until they use it.' : ''}
                </p>
                {activation.emailError ? (
                  <p className="mt-1 text-xs font-medium text-rose-700">
                    The link was created, but the email failed: {activation.emailError}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyActivationLink()}
                  className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => setActivation(null)}
                  className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:border-sky-400"
                >
                  Hide
                </button>
              </div>
            </div>
            <code className="mt-3 block break-all rounded border border-sky-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
              {activation.link}
            </code>
          </section>
        ) : null}

        {tempPassword ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  Temporary password for {tempPassword.email}
                </div>
                <p className="mt-1 text-xs text-amber-900">
                  Shown once — it is stored only as a hash, so nobody can read it back. Pass it on over a channel
                  you trust, not email.
                  {tempPassword.mustChange
                    ? ' They will be asked to choose their own password as soon as they sign in with it.'
                    : ' They can keep using it until they change it themselves.'}
                  {tempPassword.sessionsRevoked ? ' Their other sessions have been signed out.' : ''}
                  {tempPassword.addedPasswordLogin
                    ? tempPassword.oauthProvider
                      ? ` This account had no password before, so it now signs in either way — ${providerLabel(tempPassword.oauthProvider)} still works.`
                      : ' This account had no password before, so this is now its way in.'
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyTempPassword()}
                  className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
                >
                  {tempCopied ? 'Copied' : 'Copy password'}
                </button>
                <button
                  type="button"
                  onClick={() => setTempPassword(null)}
                  className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-500"
                >
                  Done
                </button>
              </div>
            </div>
            <code className="mt-3 block break-all rounded border border-amber-300 bg-white px-3 py-2 font-mono text-sm tracking-wide text-slate-800">
              {tempPassword.password}
            </code>
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="block lg:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Search</span>
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Email, name, or user ID"
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</span>
              <select
                value={tenantFilter}
                onChange={(event) => {
                  setTenantFilter(event.target.value);
                  setPage(0);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">All workspaces</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.is_platform ? `${tenant.name} (platform)` : tenant.name} · {tenant.user_count}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Role</span>
              <select
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  setPage(0);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">All roles</option>
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(0);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['all', 'tenant', 'platform'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => {
                  setScopeFilter(scope);
                  setPage(0);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  scopeFilter === scope
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {scope === 'all' ? 'Everyone' : scope === 'tenant' ? 'Customer users' : 'Platform staff'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setTenantFilter('');
                setRoleFilter('');
                setStatusFilter('');
                setScopeFilter('all');
                setPage(0);
              }}
              className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
            >
              Clear filters
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Directory</div>
            <div className="text-xs text-slate-500">{loading ? 'Loading...' : `${total} users`}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No users match these filters.
                    </td>
                  </tr>
                ) : (
                  users.map((row) => {
                    const isSelf = row.id === authUser.user_id;
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">
                            {displayName(row)}
                            {isSelf ? <span className="ml-2 text-xs font-normal text-slate-400">(you)</span> : null}
                          </div>
                          <div className="text-xs text-slate-500">{row.email}</div>
                          {row.is_pending_activation ? (
                            <div className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              Not activated
                            </div>
                          ) : null}
                          {row.must_change_password ? (
                            <div className="mt-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                              Must change password
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-700">{row.tenant_name || '—'}</div>
                          <div className="text-xs text-slate-400">
                            {row.is_platform_staff ? 'Platform staff' : row.tenant_ati_id || 'No workspace'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-[280px] flex-wrap gap-1.5">
                            {row.roles.map((role) => (
                              <span
                                key={role}
                                className={`rounded px-2 py-1 text-xs font-medium ${ROLE_CHIP[role] || 'bg-slate-100 text-slate-700'}`}
                              >
                                {roleLabel(role)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              row.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                          {new Date(row.created_at).toLocaleDateString()}
                          {row.password_changed_at ? (
                            <span className="mt-1 block text-[11px] text-slate-400">
                              Password set {new Date(row.password_changed_at).toLocaleDateString()}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canWrite && !isSelf ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditor(row)}
                                className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                              >
                                Edit roles
                              </button>
                              {row.is_pending_activation ? (
                                <button
                                  type="button"
                                  onClick={() => void reissueActivation(row)}
                                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                                >
                                  Resend link
                                </button>
                              ) : null}
                              {/* Shown on every account. Hiding it for people
                                  with no password of their own made the whole
                                  feature invisible in the case it exists for —
                                  the modal explains what applies instead. */}
                              <button
                                type="button"
                                onClick={() => openReset(row)}
                                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                              >
                                Reset password
                              </button>
                              {row.must_change_password ? (
                                <button
                                  type="button"
                                  onClick={() => void clearForcedChange(row)}
                                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                                >
                                  Cancel forced change
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void toggleStatus(row)}
                                className={`text-xs font-semibold ${
                                  row.status === 'ACTIVE'
                                    ? 'text-rose-600 hover:text-rose-800'
                                    : 'text-emerald-600 hover:text-emerald-800'
                                }`}
                              >
                                {row.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{isSelf ? 'Managed by another admin' : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Add a user</h2>
            <p className="mt-1 text-sm text-slate-600">
              The account is created immediately with no password. They set their own through the activation link,
              which you can email or hand over yourself.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Email</span>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                  placeholder="person@university.edu"
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">First name</span>
                <input
                  value={createFirstName}
                  onChange={(event) => setCreateFirstName(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last name</span>
                <input
                  value={createLastName}
                  onChange={(event) => setCreateLastName(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</span>
                <select
                  value={createTenantId}
                  onChange={(event) => pickCreateTenant(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id} disabled={tenant.status !== 'ACTIVE'}>
                      {tenant.is_platform ? `${tenant.name} — platform staff` : tenant.name}
                      {tenant.status !== 'ACTIVE' ? ` (${tenant.status.toLowerCase()})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {createIsPlatform ? 'Platform role' : 'Primary role'}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {createPrimaryOptions.map((role) => (
                  <label
                    key={role}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      createRole === role ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="createRole"
                      value={role}
                      checked={createRole === role}
                      onChange={(event) => setCreateRole(event.target.value)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{roleLabel(role)}</span>
                      <span className="block text-xs text-slate-500">{ROLE_HINTS[role]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {createIsPlatform ? (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Platform team roles
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {createRole === 'PLATFORM_STAFF'
                    ? 'Everything this account can do comes from here. Pick at least one.'
                    : 'Optional. Super admins already hold every capability; these matter when the account is downgraded later.'}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {assignableRoles.platform_team.map((teamRole) => (
                    <label
                      key={teamRole.code}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        createTeamRoles.includes(teamRole.code)
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={createTeamRoles.includes(teamRole.code)}
                        onChange={() =>
                          setCreateTeamRoles((current) =>
                            current.includes(teamRole.code)
                              ? current.filter((code) => code !== teamRole.code)
                              : [...current, teamRole.code]
                          )
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{teamRole.label}</span>
                        <span className="block text-xs text-slate-500">{teamRole.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {!createIsPlatform ? (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Additional tags</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {assignableRoles.additive.map((role) => (
                    <label
                      key={role}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        createTags.includes(role) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={createTags.includes(role)}
                        onChange={() =>
                          setCreateTags((current) =>
                            current.includes(role) ? current.filter((tag) => tag !== role) : [...current, role]
                          )
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{roleLabel(role)}</span>
                        <span className="block text-xs text-slate-500">{ROLE_HINTS[role]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="mt-5 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={createSendEmail}
                onChange={(event) => setCreateSendEmail(event.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-slate-700">
                Email them the activation link now
                <span className="block text-xs text-slate-500">
                  The link is shown to you either way, so you can deliver it yourself.
                </span>
              </span>
            </label>

            {createError ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {createError}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCreate()}
                disabled={creating}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create user'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Reset password for {displayName(resetting)}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {resetting.email}
              {resetting.tenant_name ? ` · ${resetting.tenant_name}` : ''}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              For people who cannot reset it themselves — a mailbox that no longer exists, a wrong address on the
              roster, or mail that simply is not arriving. Everything here is written to the audit log.
            </p>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">How they sign in today: </span>
              {resetting.has_password
                ? `Password${resetting.oauth_provider ? `, and ${providerLabel(resetting.oauth_provider)}` : ''}.`
                : resetting.oauth_provider
                  ? `${providerLabel(resetting.oauth_provider)} only — there is no password on this account yet.`
                  : 'No password set yet — the account was created but never activated.'}
            </div>

            <div className="mt-5 space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  resetMode === 'link' ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="resetMode"
                  value="link"
                  checked={resetMode === 'link'}
                  onChange={() => setResetMode('link')}
                  className="mt-1 h-4 w-4"
                />
                <span className="text-sm text-slate-800">
                  {resetting.has_password ? 'Send a reset link' : 'Send a set-password link'}
                  <span className="block text-xs text-slate-500">
                    Safest option.{' '}
                    {resetting.has_password
                      ? 'Their current password keeps working until they use it, and the link is shown to you as well so you can hand it over.'
                      : 'The link lets them choose a password themselves, and it is shown to you as well so you can hand it over.'}{' '}
                    Valid 24 hours.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  resetMode === 'temporary' ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="resetMode"
                  value="temporary"
                  checked={resetMode === 'temporary'}
                  onChange={() => setResetMode('temporary')}
                  className="mt-1 h-4 w-4"
                />
                <span className="text-sm text-slate-800">
                  Set a temporary password
                  <span className="block text-xs text-slate-500">
                    For when they cannot receive the link at all. Shown to you once so you can read it out, and
                    every open session on the account is signed out immediately.
                    {!resetting.has_password
                      ? resetting.oauth_provider
                        ? ` This account has no password, so it gains one — ${providerLabel(resetting.oauth_provider)} sign-in keeps working alongside it.`
                        : ' This account has no password, so this is what gets them in without waiting on email.'
                      : ''}
                  </span>
                </span>
              </label>
            </div>

            {resetMode === 'link' ? (
              <label className="mt-5 flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  checked={resetSendEmail}
                  onChange={(event) => setResetSendEmail(event.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-slate-700">
                  Email them the link now
                  <span className="block text-xs text-slate-500">
                    Shown to you either way. Leave it off if you already know the address does not work.
                  </span>
                </span>
              </label>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Temporary password
                  </span>
                  <input
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    placeholder="Leave blank to generate a strong one"
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    A generated password avoids look-alike characters, so it survives being read down a phone line.
                    Twelve characters minimum if you type your own.
                  </span>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={resetRequireChange}
                    onChange={(event) => setResetRequireChange(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-slate-700">
                    Make them choose their own password at next sign-in
                    <span className="block text-xs text-slate-500">
                      Recommended. The temporary password then buys nothing but the password change itself.
                    </span>
                  </span>
                </label>
                {!resetRequireChange ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Without this, a password you chose and delivered over chat or a phone call stays live on the
                    account indefinitely.
                  </div>
                ) : null}
              </div>
            )}

            {resetError ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {resetError}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetting(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReset()}
                disabled={resetBusy}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {resetBusy
                  ? 'Working...'
                  : resetMode === 'link'
                    ? 'Create reset link'
                    : 'Set temporary password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Roles for {displayName(editing)}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {editIsPlatform
                ? 'Platform staff hold one platform role. Tenant roles and tags do not apply here.'
                : `In ${editing.tenant_name || 'their workspace'}. One primary role, plus any tags on top.`}
            </p>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Primary role</p>
              <div className="mt-2 space-y-2">
                {editPrimaryOptions.map((role) => (
                  <label
                    key={role}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      editRole === role ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="editRole"
                      value={role}
                      checked={editRole === role}
                      onChange={(event) => setEditRole(event.target.value)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{roleLabel(role)}</span>
                      <span className="block text-xs text-slate-500">{ROLE_HINTS[role]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {!editIsPlatform ? (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Additional tags</p>
                <div className="mt-2 space-y-2">
                  {assignableRoles.additive.map((role) => (
                    <label
                      key={role}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        editTags.includes(role) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={editTags.includes(role)}
                        onChange={() =>
                          setEditTags((current) =>
                            current.includes(role) ? current.filter((tag) => tag !== role) : [...current, role]
                          )
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{roleLabel(role)}</span>
                        <span className="block text-xs text-slate-500">{ROLE_HINTS[role]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {editError ? (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {editError}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRoles()}
                disabled={saving}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save roles'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
