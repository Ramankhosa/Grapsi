import { NextRequest, NextResponse } from 'next/server'

import {
  FUNDED_PROJECT_RAW_SOURCE_NAMES,
  ingestFundedProjectRawSources,
  type FundedProjectRawSourceName,
} from '@/lib/fundedProjects/rawIngestion'
import { prisma } from '@/lib/prisma'
import { requirePublicProjectReadRequest, requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SOURCE_METADATA: Record<
  FundedProjectRawSourceName,
  { label: string; country: string; agency: string }
> = {
  NIH_REPORTER: {
    label: 'NIH RePORTER',
    country: 'United States',
    agency: 'NIH',
  },
  NSF_AWARD_SEARCH: {
    label: 'NSF Award Search',
    country: 'United States',
    agency: 'NSF',
  },
  CORDIS: {
    label: 'EU CORDIS Projects',
    country: 'European Union',
    agency: 'European Commission',
  },
  UKRI_GTR: {
    label: 'UKRI Gateway to Research',
    country: 'United Kingdom',
    agency: 'UKRI',
  },
  NWO_NWOPEN: {
    label: 'NWO NWOpen API',
    country: 'Netherlands',
    agency: 'NWO',
  },
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback
}

function validSources(value: unknown): FundedProjectRawSourceName[] {
  const requested = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const normalized = requested
    .map((source) => String(source).trim().toUpperCase())
    .filter(Boolean)

  const valid = normalized.filter((source): source is FundedProjectRawSourceName =>
    FUNDED_PROJECT_RAW_SOURCE_NAMES.includes(source as FundedProjectRawSourceName)
  )

  return valid.length ? [...new Set(valid)] : [...FUNDED_PROJECT_RAW_SOURCE_NAMES]
}

async function sourceStats() {
  const grouped = await prisma.fundedProjectRawSource.groupBy({
    by: ['sourceName'],
    _count: { _all: true },
    _min: { firstSeenAt: true },
    _max: { lastSeenAt: true, fiscalYear: true },
  })

  const bySource = new Map(grouped.map((row) => [row.sourceName, row]))

  return FUNDED_PROJECT_RAW_SOURCE_NAMES.map((sourceName) => {
    const row = bySource.get(sourceName)
    return {
      sourceName,
      ...SOURCE_METADATA[sourceName],
      count: row?._count._all ?? 0,
      firstSeenAt: row?._min.firstSeenAt ?? null,
      lastSeenAt: row?._max.lastSeenAt ?? null,
      latestFiscalYear: row?._max.fiscalYear ?? null,
    }
  })
}

export async function GET(request: NextRequest) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    return NextResponse.json({
      sources: await sourceStats(),
      defaults: {
        fromYear: 2015,
        pageSize: 25,
        timeoutMs: 30000,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funded project raw source stats' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePublicProjectWriteRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const sources = validSources(body.sources)
    const maxRecordsPerSource = boundedInteger(body.maxRecordsPerSource, 100, 1, 100000)

    if (maxRecordsPerSource > 1000 && body.confirmFullProduction !== true) {
      return NextResponse.json(
        { message: 'Large raw ingestion runs require confirmFullProduction=true' },
        { status: 400 }
      )
    }

    const result = await ingestFundedProjectRawSources({
      sources,
      fromYear: boundedInteger(body.fromYear ?? body.sinceYear, 2015, 1970, new Date().getUTCFullYear() + 1),
      toYear: body.toYear ? boundedInteger(body.toYear, new Date().getUTCFullYear(), 1970, 2100) : undefined,
      maxRecordsPerSource,
      pageSize: boundedInteger(body.pageSize, 25, 1, 500),
      requestTimeoutMs: boundedInteger(body.timeoutMs ?? body.requestTimeoutMs, 30000, 1000, 120000),
    })

    return NextResponse.json({
      result,
      sources: await sourceStats(),
    })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to run funded project raw ingestion' },
      { status: 500 }
    )
  }
}
