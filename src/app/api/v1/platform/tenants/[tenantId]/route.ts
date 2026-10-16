import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePlatformScope } from '@/lib/middleware'
import { clearTenantLocaleCache, getTenantLocale, parseTenantLocalePatch } from '@/lib/tenant/locale'

/**
 * A customer tenant's regional settings, for the platform team.
 *
 * GET   - stored values (null = default) and what is in force. Viewers too.
 * PATCH - { currency, timezone, locale, countryCode }; null clears one back to
 *         the India default. Full SUPER_ADMIN only (requirePlatformScope
 *         refuses writes from viewers).
 */

async function settingsFor(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, atiId: true, default_currency: true, timezone: true, locale: true, country_code: true },
  })
  if (!tenant || tenant.atiId === 'PLATFORM') return null
  return {
    tenant: { id: tenant.id, name: tenant.name },
    stored: { currency: tenant.default_currency, timezone: tenant.timezone, locale: tenant.locale, countryCode: tenant.country_code },
    effective: await getTenantLocale(tenant.id),
  }
}

export async function GET(request: NextRequest, { params }: { params: { tenantId: string } }) {
  const scopeCheck = await requirePlatformScope()(request)
  if (scopeCheck) return scopeCheck
  const settings = await settingsFor(params.tenantId)
  if (!settings) return NextResponse.json({ code: 'INVALID_TENANT', message: 'Select a customer tenant' }, { status: 404 })
  return NextResponse.json(settings)
}

export async function PATCH(request: NextRequest, { params }: { params: { tenantId: string } }) {
  const scopeCheck = await requirePlatformScope()(request)
  if (scopeCheck) return scopeCheck
  if (!(await settingsFor(params.tenantId))) {
    return NextResponse.json({ code: 'INVALID_TENANT', message: 'Select a customer tenant' }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = parseTenantLocalePatch(body as Record<string, unknown>)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  await prisma.tenant.update({ where: { id: params.tenantId }, data: parsed.data })
  clearTenantLocaleCache(params.tenantId)
  return NextResponse.json(await settingsFor(params.tenantId))
}
