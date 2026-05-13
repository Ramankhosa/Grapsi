'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';

type PlatformPermissionDefinition = {
  code: string;
  label: string;
};

type PlatformRoleDefinition = {
  code: string;
  label: string;
  description: string;
  permissions: string[];
};

type PlatformTeamUser = {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  status: string;
  tenantName: string | null;
  tenantAtiId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedRoleCodes: string[];
  permissions: string[];
};

type DefinitionsPayload = {
  roles: PlatformRoleDefinition[];
  permissions: PlatformPermissionDefinition[];
};

type UsersPayload = {
  users: PlatformTeamUser[];
  total: number;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

function getDisplayName(user: PlatformTeamUser) {
  const explicit = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return explicit || user.name || user.email;
}

export default function SuperAdminTeamRolesPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();

  const [definitions, setDefinitions] = useState<DefinitionsPayload>({ roles: [], permissions: [] });
  const [users, setUsers] = useState<PlatformTeamUser[]>([]);
  const [query, setQuery] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [status, setStatus] = useState('');
  const [selectedUser, setSelectedUser] = useState<PlatformTeamUser | null>(null);
  const [draftRoleCodes, setDraftRoleCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isPlatformAdmin = useMemo(
    () => Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.roles?.includes('SUPER_ADMIN_VIEWER')),
    [user?.roles]
  );
  const canWrite = Boolean(user?.roles?.includes('SUPER_ADMIN'));

  const roleByCode = useMemo(() => new Map(definitions.roles.map((role) => [role.code, role])), [definitions.roles]);
  const permissionByCode = useMemo(
    () => new Map(definitions.permissions.map((permission) => [permission.code, permission])),
    [definitions.permissions]
  );

  const selectedPermissions = useMemo(() => {
    const permissions = new Set<string>();
    draftRoleCodes.forEach((code) => {
      roleByCode.get(code)?.permissions.forEach((permission) => permissions.add(permission));
    });
    return Array.from(permissions);
  }, [draftRoleCodes, roleByCode]);
  const selectedUserId = selectedUser?.id || null;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isPlatformAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, isPlatformAdmin, router, user]);

  const loadDefinitions = useCallback(async () => {
    const response = await authFetch('/api/super-admin/team-roles/definitions');
    const payload = await readJson<DefinitionsPayload & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load role definitions');
    }
    setDefinitions(payload);
  }, [authFetch]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (roleCode) params.set('roleCode', roleCode);
      if (status) params.set('status', status);

      const response = await authFetch(`/api/super-admin/team-roles/users?${params.toString()}`);
      const payload = await readJson<UsersPayload>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load platform team users');
      }
      setUsers(payload.users || []);
      if (selectedUserId) {
        const refreshed = (payload.users || []).find((candidate) => candidate.id === selectedUserId) || null;
        setSelectedUser(refreshed);
        setDraftRoleCodes(refreshed?.assignedRoleCodes || []);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load platform team users');
    } finally {
      setLoading(false);
    }
  }, [authFetch, query, roleCode, selectedUserId, status]);

  useEffect(() => {
    if (!user || !isPlatformAdmin) return;
    loadDefinitions().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load role definitions');
    });
  }, [isPlatformAdmin, loadDefinitions, user]);

  useEffect(() => {
    if (!user || !isPlatformAdmin) return;
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isPlatformAdmin, loadUsers, user]);

  function openUser(nextUser: PlatformTeamUser) {
    setSelectedUser(nextUser);
    setDraftRoleCodes(nextUser.assignedRoleCodes || []);
    setSuccess(null);
    setError(null);
  }

  function toggleRole(nextRoleCode: string) {
    setDraftRoleCodes((current) =>
      current.includes(nextRoleCode)
        ? current.filter((code) => code !== nextRoleCode)
        : [...current, nextRoleCode]
    );
  }

  async function saveRoles() {
    if (!selectedUser || !canWrite) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch(`/api/super-admin/team-roles/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleCodes: draftRoleCodes }),
      });
      const payload = await readJson<{ error?: string; assignedRoleCodes?: string[]; permissions?: string[] }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save platform role assignments');
      }

      const updatedUser = {
        ...selectedUser,
        assignedRoleCodes: payload.assignedRoleCodes || draftRoleCodes,
        permissions: payload.permissions || selectedPermissions,
      };
      setSelectedUser(updatedUser);
      setUsers((current) => current.map((candidate) => (candidate.id === updatedUser.id ? updatedUser : candidate)));
      setSuccess('Platform roles updated.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save platform role assignments');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !user || !isPlatformAdmin) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-sm text-slate-600">Checking platform access...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="border-b border-slate-200 pb-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Super Admin</div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">Team Role Assignments</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Assign predefined operational role templates to platform team members without changing base user roles.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              Refresh
            </button>
          </div>
        </header>

        {!canWrite ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Viewer accounts can inspect platform role assignments but cannot modify them.
          </div>
        ) : null}

        {(error || success) ? (
          <div className="space-y-3">
            {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
            {success ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{success}</div> : null}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_160px_auto]">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Search</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="User ID, email, first name, last name"
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">App Role</span>
              <select
                value={roleCode}
                onChange={(event) => setRoleCode(event.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">All roles</option>
                {definitions.roles.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setRoleCode('');
                  setStatus('');
                }}
                className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Platform Team Users</div>
            <div className="text-xs text-slate-500">{loading ? 'Loading...' : `${users.length} users`}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">User ID</th>
                  <th className="px-4 py-3">Base Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned App Roles</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Loading platform users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No platform users match these filters.
                    </td>
                  </tr>
                ) : (
                  users.map((teamUser) => (
                    <tr
                      key={teamUser.id}
                      onClick={() => openUser(teamUser)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{getDisplayName(teamUser)}</div>
                        <div className="text-xs text-slate-500">{teamUser.email}</div>
                        <div className="text-xs text-slate-400">{teamUser.tenantName || teamUser.tenantAtiId || 'Platform'}</div>
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-slate-600">{teamUser.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {teamUser.roles.map((baseRole) => (
                            <span key={baseRole} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              {baseRole}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${teamUser.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                          {teamUser.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[360px] flex-wrap gap-1.5">
                          {teamUser.assignedRoleCodes.length > 0 ? (
                            teamUser.assignedRoleCodes.map((assignedCode) => (
                              <span key={assignedCode} className="rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
                                {roleByCode.get(assignedCode)?.label || assignedCode}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">No app roles</span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {new Date(teamUser.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selectedUser ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/35" onClick={() => setSelectedUser(null)}>
          <aside
            className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Team Member</div>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">{getDisplayName(selectedUser)}</h2>
                  <p className="mt-1 text-sm text-slate-600">{selectedUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-6 px-6 py-5">
              <section>
                <h3 className="text-sm font-semibold text-slate-900">User Identity</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">User ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-slate-700">{selectedUser.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Status</dt>
                    <dd className="mt-1 text-slate-700">{selectedUser.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">First Name</dt>
                    <dd className="mt-1 text-slate-700">{selectedUser.firstName || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Last Name</dt>
                    <dd className="mt-1 text-slate-700">{selectedUser.lastName || 'Not set'}</dd>
                  </div>
                </dl>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Operational Roles</h3>
                  {!canWrite ? <span className="text-xs font-medium text-amber-700">Read-only</span> : null}
                </div>
                <div className="mt-3 space-y-3">
                  {definitions.roles.map((role) => (
                    <label
                      key={role.code}
                      className={`block rounded-lg border p-3 ${draftRoleCodes.includes(role.code) ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={draftRoleCodes.includes(role.code)}
                          disabled={!canWrite}
                          onChange={() => toggleRole(role.code)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 disabled:cursor-not-allowed"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{role.label}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-600">{role.description}</span>
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {role.permissions.map((permissionCode) => (
                              <span key={permissionCode} className="rounded bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                                {permissionByCode.get(permissionCode)?.label || permissionCode}
                              </span>
                            ))}
                          </span>
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Effective Permissions</h3>
                {selectedPermissions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedPermissions.map((permissionCode) => (
                      <span key={permissionCode} className="rounded bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                        {permissionByCode.get(permissionCode)?.label || permissionCode}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No operational permissions selected.</p>
                )}
              </section>

              <div className="sticky bottom-0 -mx-6 border-t border-slate-200 bg-white px-6 py-4">
                <button
                  type="button"
                  onClick={() => void saveRoles()}
                  disabled={!canWrite || saving}
                  className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {saving ? 'Saving...' : 'Save Role Assignments'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
