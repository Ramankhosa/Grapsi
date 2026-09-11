/**
 * What the audit log records, sorted into things a person might come looking for.
 *
 * The log mixes two very different kinds of event. Around forty concern who may
 * do what — roles granted, coverage moved, passwords reset by an administrator,
 * tokens revealed. The rest are ordinary product activity: a section generated,
 * a literature search run, a persona created. Both belong in the log; only the
 * first belongs on the screen somebody opens when asking "who changed this?".
 *
 * So the viewer defaults to the governance groups and keeps everything else one
 * click away rather than hidden. An investigation that needs a product event can
 * still find it; a routine review is not buried under drafting noise.
 *
 * Sessions is its own group and off by default purely on volume — a login row is
 * written on every sign-in, and it would crowd out everything else.
 *
 * Pure data, no database access, so the groups can be asserted in a unit test.
 */

export const AUDIT_GROUPS = [
  'access',
  'org',
  'teams',
  'tenancy',
  'platform',
  'sessions',
  'activity',
] as const
export type AuditGroup = (typeof AUDIT_GROUPS)[number]

export const AUDIT_GROUP_COPY: Record<AuditGroup, { label: string; help: string }> = {
  access: {
    label: 'Access and identity',
    help: 'Roles granted and removed, accounts provisioned or suspended, passwords reset by an administrator.',
  },
  org: {
    label: 'Organisation and department',
    help: 'The school and department tree, who heads what, funding-department membership and school coverage.',
  },
  teams: {
    label: 'Teams and quotas',
    help: 'Team membership, and the service access and quota overrides attached to a team or a person.',
  },
  tenancy: {
    label: 'Tenancy and invitations',
    help: 'Organisations created, the owner seat moved, invitations and access tokens issued or revoked.',
  },
  platform: {
    label: 'Platform configuration',
    help: 'Platform team roles, runtime settings and usage resets. Changes made by staff, not by a tenant.',
  },
  sessions: {
    label: 'Sign-ins',
    help: 'Logins, logouts and first-login activations. High volume, so it is off unless you ask for it.',
  },
  activity: {
    label: 'Product activity',
    help: 'Ordinary work: drafting, literature searches, personas, reference linking. Rarely what an audit is looking for.',
  },
}

/** Groups shown before anybody touches a filter. */
export const DEFAULT_GROUPS: readonly AuditGroup[] = ['access', 'org', 'teams', 'tenancy', 'platform']

/**
 * Every action string written anywhere, mapped to its group.
 *
 * Kept as one explicit table rather than a prefix rule. Prefixes lie: `USER_LOGIN`
 * and `USER_ROLE_CHANGE` share one, and belong in different groups. A new action
 * absent from this table falls through to `activity`, which is the safe default —
 * it stays visible under "everything" and never silently claims to be governance.
 */
export const ACTION_GROUPS: Record<string, AuditGroup> = {
  // --- Access and identity ---------------------------------------------------
  USER_PROVISIONED: 'access',
  USER_ACTIVATION_REISSUED: 'access',
  USER_ROLE_ADD: 'access',
  USER_ROLE_REMOVE: 'access',
  USER_ROLE_CHANGE: 'access',
  USER_ROLES_SET_BY_PLATFORM: 'access',
  USER_STATUS_CHANGE: 'access',
  USER_STATUS_SET_BY_PLATFORM: 'access',
  USER_PASSWORD_RESET_ISSUED: 'access',
  USER_PASSWORD_SET_BY_ADMIN: 'access',
  USER_PASSWORD_CHANGE_REQUIRED: 'access',
  USER_PASSWORD_CHANGE_REQUIREMENT_CLEARED: 'access',
  USER_OAUTH_LINKED: 'access',
  TOKEN_REVEALED: 'access',

  // --- Organisation and department -------------------------------------------
  ORG_UNIT_CREATE: 'org',
  ORG_UNIT_RENAME: 'org',
  ORG_UNIT_MOVE: 'org',
  ORG_UNIT_DELETE: 'org',
  ORG_RESEARCH_AREAS_SET: 'org',
  ORG_HEAD_GRANT: 'org',
  ORG_HEAD_REVOKE: 'org',
  FUNDING_DEPT_MEMBER_ADD: 'org',
  FUNDING_DEPT_MEMBER_UPDATE: 'org',
  FUNDING_DEPT_MEMBER_REMOVE: 'org',
  FUNDING_DEPT_COVERAGE_SET: 'org',
  FUNDING_DEPT_DEPUTY_SET: 'org',
  FACULTY_IMPORT: 'org',

  // --- Teams and quotas ------------------------------------------------------
  TEAM_CREATE: 'teams',
  TEAM_DEACTIVATE: 'teams',
  TEAM_MEMBER_ADD: 'teams',
  TEAM_MEMBER_REMOVE: 'teams',
  TEAM_SERVICE_ACCESS_UPDATE: 'teams',
  USER_SERVICE_QUOTA_UPDATE: 'teams',

  // --- Tenancy and invitations -----------------------------------------------
  TENANT_CREATE: 'tenancy',
  TENANT_ADMIN_CHANGED: 'tenancy',
  TENANT_ADMIN_DEMOTED: 'tenancy',
  TENANT_ADMIN_INVITE_SENT: 'tenancy',
  TENANT_ENTITLEMENT_GRANT: 'tenancy',
  MEMBER_INVITE_SENT: 'tenancy',
  MEMBER_INVITE_REVOKED: 'tenancy',
  MEMBER_ACTIVATION_SENT: 'tenancy',
  ATI_ISSUE: 'tenancy',
  ATI_UPDATE: 'tenancy',
  ATI_REVOKE: 'tenancy',
  ATI_EXTEND: 'tenancy',
  ATI_MAX_USES_UPDATE: 'tenancy',

  // --- Platform configuration ------------------------------------------------
  PLATFORM_TEAM_ROLE_ASSIGNMENT_GRANT: 'platform',
  PLATFORM_TEAM_ROLE_ASSIGNMENT_REPLACE: 'platform',
  RUNTIME_SETTING_UPDATED: 'platform',
  USAGE_RESET: 'platform',

  // --- Sign-ins --------------------------------------------------------------
  USER_SIGNUP: 'sessions',
  USER_LOGIN: 'sessions',
  USER_LOGOUT: 'sessions',
  USER_LOGOUT_ALL: 'sessions',
  USER_FIRST_LOGIN_ACTIVATION: 'sessions',
  EVENT_ACCESS_EXPIRED: 'sessions',

  // --- Product activity ------------------------------------------------------
  SESSION_CREATED: 'activity',
  BLUEPRINT_GENERATED: 'activity',
  BLUEPRINT_UPDATED: 'activity',
  BLUEPRINT_FROZEN: 'activity',
  BLUEPRINT_UNFROZEN: 'activity',
  SECTION_GENERATED: 'activity',
  SECTIONS_BATCH_GENERATED: 'activity',
  SECTION_EDITED: 'activity',
  SECTION_APPROVED: 'activity',
  SEARCH_STRATEGY_GENERATED: 'activity',
  LITERATURE_SEARCH: 'activity',
  LITERATURE_AI_ANALYSIS: 'activity',
  LITERATURE_LIBRARY_PUSH: 'activity',
  CITATION_BLUEPRINT_MAPPING: 'activity',
  LIBRARY_RECONCILIATION_RUN: 'activity',
  LIBRARY_REFERENCE_AUTO_LINKED: 'activity',
  LIBRARY_REFERENCE_MANUAL_LINKED: 'activity',
  LIBRARY_REFERENCE_MANUAL_REJECTED: 'activity',
  LIBRARY_REFERENCE_LINK_ROLLBACK: 'activity',
  LIBRARY_REFERENCE_LINK_VERIFICATION_DETACHED: 'activity',
  RESEARCH_TOPIC_UPDATED: 'activity',
  RESEARCH_TOPIC_FILE_EXTRACTED: 'activity',
  PAPER_CREATED: 'activity',
  PAPER_SETTINGS_UPDATED: 'activity',
  PERSONA_CREATE: 'activity',
  PERSONA_COPY: 'activity',
  PERSONA_DELETE: 'activity',
  PERSONA_REACTIVATE: 'activity',
  SAMPLES_BULK_DELETE: 'activity',
  EXPORTED_TO_IDEA_BANK: 'activity',
}

export function groupForAction(action: string): AuditGroup {
  return ACTION_GROUPS[action] ?? 'activity'
}

export function actionsInGroups(groups: readonly AuditGroup[]): string[] {
  const wanted = new Set(groups)
  return Object.entries(ACTION_GROUPS)
    .filter(([, group]) => wanted.has(group))
    .map(([action]) => action)
}

/**
 * A readable sentence fragment for one action.
 *
 * Derived rather than hand-written for all ninety: the strings are already
 * consistent enough that lowercasing and de-underscoring reads correctly, and a
 * second hand-maintained table of ninety labels would fall behind the first.
 * The handful that read badly that way get an explicit entry.
 */
const ACTION_LABEL_OVERRIDES: Record<string, string> = {
  TOKEN_REVEALED: 'revealed an access token',
  USER_PASSWORD_SET_BY_ADMIN: 'set a password for the user',
  USER_PASSWORD_RESET_ISSUED: 'issued a password reset link',
  USER_PASSWORD_CHANGE_REQUIREMENT_CLEARED: 'cleared the forced password change',
  USER_ROLES_SET_BY_PLATFORM: 'set roles from the platform',
  USER_STATUS_SET_BY_PLATFORM: 'set the account status from the platform',
  FUNDING_DEPT_COVERAGE_SET: 'set funding-department school coverage',
  FUNDING_DEPT_DEPUTY_SET: 'set a funding-department deputy',
  ORG_HEAD_GRANT: 'made somebody head of a unit',
  ORG_HEAD_REVOKE: 'removed somebody as head of a unit',
  ATI_MAX_USES_UPDATE: 'changed how many times a token may be used',
  EVENT_ACCESS_EXPIRED: 'workshop access expired',
  USAGE_RESET: 'reset usage counters',
}

export function actionLabel(action: string): string {
  return ACTION_LABEL_OVERRIDES[action] ?? action.toLowerCase().replace(/_/g, ' ')
}

/**
 * Split the `resource` column, which every writer formats as `kind:id`.
 *
 * By convention only — `resource` is free text and nothing enforces it — so a
 * value that does not match comes back whole as the kind, with no id.
 */
export function parseResource(resource: string): { kind: string; id: string | null } {
  const at = resource.indexOf(':')
  if (at < 1) return { kind: resource, id: null }
  return { kind: resource.slice(0, at), id: resource.slice(at + 1) || null }
}
