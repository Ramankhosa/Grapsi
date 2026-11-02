import { NextRequest, NextResponse } from 'next/server'
import { createEvent, plannerContext, plannerFailure } from '@/lib/personalGrants/server'
export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try { return NextResponse.json({ event: await createEvent(auth.owner, params.callId, await request.json()) }, { status: 201 }) } catch (error) { return plannerFailure(error) }
}
