import crypto from 'crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type RuntimeSettingCacheEntry = {
  value: unknown;
  source: 'database' | 'fallback';
  expiresAt: number;
};

export interface BooleanRuntimeSetting {
  key: string;
  enabled: boolean;
  source: 'database' | 'fallback';
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULT_CACHE_MS = 5000;
const cache = new Map<string, RuntimeSettingCacheEntry>();

function cacheTtlMs() {
  const configured = Number(process.env.RUNTIME_SETTINGS_CACHE_MS || DEFAULT_CACHE_MS);
  return Number.isFinite(configured) ? Math.max(0, configured) : DEFAULT_CACHE_MS;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

export async function getBooleanRuntimeSetting(
  key: string,
  fallback: boolean
): Promise<BooleanRuntimeSetting> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      key,
      enabled: normalizeBoolean(cached.value, fallback),
      source: cached.source,
      updatedAt: null,
      updatedBy: null,
    };
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        value: Prisma.JsonValue;
        updated_at: Date | null;
        updated_by: string | null;
      }>
    >(Prisma.sql`
      SELECT value, updated_at, updated_by
      FROM app_runtime_settings
      WHERE key = ${key}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) {
      cache.set(key, { value: fallback, source: 'fallback', expiresAt: now + cacheTtlMs() });
      return { key, enabled: fallback, source: 'fallback', updatedAt: null, updatedBy: null };
    }

    const enabled = normalizeBoolean(row.value, fallback);
    cache.set(key, { value: enabled, source: 'database', expiresAt: now + cacheTtlMs() });
    return {
      key,
      enabled,
      source: 'database',
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
      updatedBy: row.updated_by,
    };
  } catch (error) {
    console.warn(`[RuntimeSettings] Falling back for ${key}:`, error instanceof Error ? error.message : error);
    cache.set(key, { value: fallback, source: 'fallback', expiresAt: now + cacheTtlMs() });
    return { key, enabled: fallback, source: 'fallback', updatedAt: null, updatedBy: null };
  }
}

export async function setBooleanRuntimeSetting(input: {
  key: string;
  enabled: boolean;
  description?: string;
  updatedBy?: string | null;
}) {
  const valueJson = JSON.stringify(input.enabled);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO app_runtime_settings (
      key,
      value,
      description,
      updated_by,
      created_at,
      updated_at
    ) VALUES (
      ${input.key},
      CAST(${valueJson} AS jsonb),
      ${input.description || null},
      ${input.updatedBy || null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (key)
    DO UPDATE SET
      value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, app_runtime_settings.description),
      updated_by = EXCLUDED.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `);

  cache.set(input.key, {
    value: input.enabled,
    source: 'database',
    expiresAt: Date.now() + cacheTtlMs(),
  });

  return getBooleanRuntimeSetting(input.key, input.enabled);
}

export async function writeRuntimeSettingAudit(input: {
  actorUserId?: string | null;
  key: string;
  enabled: boolean;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId || null,
        action: 'RUNTIME_SETTING_UPDATED',
        resource: `runtime_setting:${input.key}`,
        meta: {
          id: crypto.randomUUID(),
          key: input.key,
          enabled: input.enabled,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.warn('[RuntimeSettings] Failed to write audit log:', error instanceof Error ? error.message : error);
  }
}
