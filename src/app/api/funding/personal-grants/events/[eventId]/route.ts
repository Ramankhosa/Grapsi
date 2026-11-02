import { NextRequest, NextResponse } from 'next/server'
import { changeEvent, plannerContext, plannerFailure } from '@/lib/personalGrants/server'
async function change(request: NextRequest, eventId: string, remove: boolean) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try { return NextResponse.json({ event: await changeEvent(auth.owner, eventId, await request.json(), remove) }) } catch (error) { return plannerFailure(error) }
}
export const PATCH = (request: NextRequest, { params }: { params: { eventId: string } }) => change(request, params.eventId, false)
export const DELETE = (request: NextRequest, { params }: { params: { eventId: string } }) => change(request, params.eventId, true)
