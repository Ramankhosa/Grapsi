import { NextRequest, NextResponse } from 'next/server'

import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { allCountryCodes } from '@/lib/geo/countries'
import { clearTenantLocaleCache, getTenantLocale, parseTenantLocalePatch } from '@/lib/tenant/locale'

export const dynamic = 'force-dynamic'

/**
 * The tenant's regional settings: currency, time zone, locale and country.
 *
 * GET - stored values (null = default) and what is in force.
 * PUT - set any of them; null clears one back to the default (INR,
 *       Asia/Kolkata, en-IN, India). Tenant owners and admins only: the time
 *       zone moves every deadline-day and reporting-week boundary the
 *       funding department sees.
 */

const SUGGESTED_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Africa/Nairobi',
  'Africa/Johannesburg', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York',
  'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'UTC',
]

function allTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone')
    if (supported && supported.length > 0) return supported
  } catch {
    // Older runtimes: the suggested list is still valid.
  }
  return SUGGESTED_TIMEZONES
}

async function settingsResponse(tenantId: string) {
  const [tenant, effective] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { default_currency: true, timezone: true, locale: true, country_code: true },
    }),
    getTenantLocale(tenantId),
  ])
  return NextResponse.json({
    stored: {
      currency: tenant?.default_currency ?? null,
      timezone: tenant?.timezone ?? null,
      locale: tenant?.locale ?? null,
      countryCode: tenant?.country_code ?? null,
    },
    effective,
    options: {
      suggestedTimezones: SUGGESTED_TIMEZONES,
      timezones: allTimeZones(),
      locales: ['en-IN', 'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-SG', 'en-ZA', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR'],
      countryCodes: allCountryCodes(),
    },
  })
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (auth.error) return auth.error
  const user = auth.user!
  if (!user.tenant_id) {
    return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
  }
  return settingsResponse(user.tenant_id)
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (auth.error) return auth.error
  const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
  if (roleCheck) return roleCheck
  const user = auth.user!
  if (!user.tenant_id) {
    return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = parseTenantLocalePatch(body as Record<string, unknown>)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const data = parsed.data

  await prisma.tenant.update({ where: { id: user.tenant_id }, data })
  clearTenantLocaleCache(user.tenant_id)
  return settingsResponse(user.tenant_id)
}
