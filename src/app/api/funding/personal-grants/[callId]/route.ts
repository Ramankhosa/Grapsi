import { NextRequest, NextResponse } from 'next/server'
import { plannerContext, plannerFailure, readItem, saveItem } from '@/lib/personalGrants/server'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try { return NextResponse.json({ item: await readItem(auth.owner, params.callId) }, { headers: { 'Cache-Control': 'private, no-store' } }) } catch (error) { return plannerFailure(error) }
}
export async function PATCH(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try { return NextResponse.json({ item: await saveItem(auth.owner, params.callId, await request.json()) }) } catch (error) { return plannerFailure(error) }
}
