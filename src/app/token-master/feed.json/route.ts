import { NextResponse } from 'next/server'
import { getTokenMasterSponsorFeed } from '@/lib/tokenMasterSponsorFeed'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0'
}

export async function GET() {
  return NextResponse.json(getTokenMasterSponsorFeed(), {
    headers: responseHeaders
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders
  })
}
