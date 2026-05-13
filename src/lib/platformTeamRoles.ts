export const PLATFORM_PERMISSION_DEFINITIONS = [
  { code: 'funding.operations.write', label: 'Funding operations write' },
  { code: 'funding.publisher.write', label: 'Funding publishing write' },
  { code: 'tenant.manage', label: 'Tenant management' },
  { code: 'platform.config.manage', label: 'Platform configuration management' },
  { code: 'ai.model.manage', label: 'AI model and cost management' },
  { code: 'trial_campaign.manage', label: 'Trial campaign management' },
  { code: 'usage.analytics.read', label: 'Usage and analytics read' },
  { code: 'platform.support.read', label: 'Platform support read' },
] as const;

export type PlatformPermissionCode = typeof PLATFORM_PERMISSION_DEFINITIONS[number]['code'];

export const PLATFORM_ROLE_DEFINITIONS = [
  {
    code: 'FUNDING_OPERATIONS_MANAGER',
    label: 'Funding Operations Manager',
    description: 'Can ingest calls, upload/tag research taxonomy, and manage funding templates and guidelines.',
    permissions: ['funding.operations.write', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'FUNDING_PUBLISHER',
    label: 'Funding Publisher',
    description: 'Can publish, archive, and reject funding calls.',
    permissions: ['funding.publisher.write', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'TENANT_MANAGER',
    label: 'Tenant Manager',
    description: 'Can manage tenants, ATI tokens, and tenant/user support visibility.',
    permissions: ['tenant.manage', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'PLATFORM_CONFIG_MANAGER',
    label: 'Platform Config Manager',
    description: 'Can manage countries, jurisdiction settings, prompts, paper types, and platform writing configuration.',
    permissions: ['platform.config.manage', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'AI_MODEL_MANAGER',
    label: 'AI Model Manager',
    description: 'Can manage LLM configuration, model costs, service control, and quota-controller settings.',
    permissions: ['ai.model.manage', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'TRIAL_CAMPAIGN_MANAGER',
    label: 'Trial Campaign Manager',
    description: 'Can manage trial campaigns, invites, and campaign analytics.',
    permissions: ['trial_campaign.manage', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'USAGE_ANALYTICS_MANAGER',
    label: 'Usage Analytics Manager',
    description: 'Can view usage, costs, platform analytics, and user-service usage.',
    permissions: ['usage.analytics.read', 'platform.support.read'] satisfies PlatformPermissionCode[],
  },
  {
    code: 'PLATFORM_SUPPORT_VIEWER',
    label: 'Platform Support Viewer',
    description: 'Read-only support access across tenants, users, funding records, and diagnostics.',
    permissions: ['platform.support.read'] satisfies PlatformPermissionCode[],
  },
] as const;

export type PlatformRoleCode = typeof PLATFORM_ROLE_DEFINITIONS[number]['code'];

export const PLATFORM_ROLE_CODES = PLATFORM_ROLE_DEFINITIONS.map((role) => role.code) as PlatformRoleCode[];
export const PLATFORM_PERMISSION_CODES = PLATFORM_PERMISSION_DEFINITIONS.map((permission) => permission.code) as PlatformPermissionCode[];

const roleDefinitionByCode = new Map(PLATFORM_ROLE_DEFINITIONS.map((role) => [role.code, role]));
const permissionDefinitionByCode = new Map(PLATFORM_PERMISSION_DEFINITIONS.map((permission) => [permission.code, permission]));

export function isPlatformRoleCode(value: string): value is PlatformRoleCode {
  return roleDefinitionByCode.has(value as PlatformRoleCode);
}

export function isPlatformPermissionCode(value: string): value is PlatformPermissionCode {
  return permissionDefinitionByCode.has(value as PlatformPermissionCode);
}

export function getPlatformRoleDefinition(roleCode: string) {
  return roleDefinitionByCode.get(roleCode as PlatformRoleCode) || null;
}

export function getPermissionsForRoleCodes(roleCodes: string[]): PlatformPermissionCode[] {
  const permissions = new Set<PlatformPermissionCode>();
  roleCodes.forEach((roleCode) => {
    const definition = getPlatformRoleDefinition(roleCode);
    definition?.permissions.forEach((permission) => permissions.add(permission));
  });
  return Array.from(permissions);
}
