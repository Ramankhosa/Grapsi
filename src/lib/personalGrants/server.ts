import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireFundingActor } from '@/lib/funding/access'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { localToUtc } from './dates'

export class PlannerError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
export async function plannerContext(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, strictEntitlement: true })
  if ('response' in auth) return auth
  if (!auth.actor.tenantId) return { response: NextResponse.json({ message: 'A personal tenant account is required.' }, { status: 403 }) }
  return { owner: { tenant_id: auth.actor.tenantId, user_id: auth.actor.id } }
}
export type Owner = { tenant_id: string; user_id: string }
export const eventSelect = {
  id: true, title: true, event_at: true, timezone: true, reminder_at: true,
  reminder_state: true, sent_at: true, revision: true,
} as const
export const itemInclude = {
  events: { select: eventSelect, orderBy: { event_at: 'asc' as const } },
  funding_call: { select: { id: true, title: true, scheme_title: true, agencyName: true, agency_name: true, deadlineAt: true, close_date: true } },
} as const
export const accessibleCall = (owner: Owner) => visibleFundingCallWhere(owner.tenant_id, { includeCatalog: true })
export async function requireCall(owner: Owner, callId: string) {
  if (!await prisma.fundingCall.findFirst({ where: { AND: [{ id: callId }, accessibleCall(owner)] }, select: { id: true } })) throw new PlannerError('This grant is unavailable.', 404)
}
export function itemKey(owner: Owner, callId: string) { return { tenant_id_user_id_funding_call_id: { ...owner, funding_call_id: callId } } }
export async function ensureItem(owner: Owner, callId: string) {
  await requireCall(owner, callId)
  return prisma.personalGrant.upsert({ where: itemKey(owner, callId), create: { ...owner, funding_call_id: callId }, update: {} })
}
export async function readItem(owner: Owner, callId: string) {
  await requireCall(owner, callId)
  return prisma.personalGrant.findUnique({ where: itemKey(owner, callId), include: itemInclude })
}
const itemPatch = z.object({
  is_favourite: z.boolean().optional(), notes: z.string().max(10000).optional(), notes_revision: z.number().int().nonnegative().optional(),
}).strict().refine(v => v.is_favourite !== undefined || v.notes !== undefined, 'Choose a change to save.')
  .refine(v => v.notes === undefined || v.notes_revision !== undefined, 'Reload your notes before saving.')

export async function saveItem(owner: Owner, callId: string, body: unknown) {
  const patch = itemPatch.parse(body)
  const item = await ensureItem(owner, callId)
  const updated = await prisma.personalGrant.updateMany({
    where: { id: item.id, ...owner, ...(patch.notes !== undefined ? { notes_revision: patch.notes_revision } : {}) },
    data: { is_favourite: patch.is_favourite, notes: patch.notes, ...(patch.notes !== undefined ? { notes_revision: { increment: 1 } } : {}) },
  })
  if (updated.count !== 1) throw new PlannerError('Your notes changed in another tab. Copy your draft, then reload the saved notes.', 409)
  return prisma.personalGrant.findUnique({ where: itemKey(owner, callId), include: itemInclude })
}

const eventBody = z.object({
  title: z.string().trim().min(1).max(160), local_event_at: z.string().max(16), timezone: z.string().min(1).max(100),
  reminder_local_at: z.string().max(16).nullable(), revision: z.number().int().nonnegative().optional(),
}).strict()
export function parseEvent(body: unknown, now = new Date(), requireFutureReminder = true) {
  const data = eventBody.parse(body)
  let event_at: Date, reminder_at: Date | null
  try {
    event_at = localToUtc(data.local_event_at, data.timezone)
    reminder_at = data.reminder_local_at ? localToUtc(data.reminder_local_at, data.timezone) : null
  } catch (error) { throw new PlannerError(error instanceof Error ? error.message : 'Invalid calendar time.') }
  if (requireFutureReminder && reminder_at && reminder_at <= now) throw new PlannerError('Choose a reminder time in the future.')
  if (reminder_at && reminder_at > event_at) throw new PlannerError('The reminder must be on or before the calendar entry.')
  return { title: data.title, event_at, timezone: data.timezone, reminder_at, revision: data.revision }
}
export async function createEvent(owner: Owner, callId: string, body: unknown) {
  const data = parseEvent(body)
  const item = await ensureItem(owner, callId)
  return prisma.$transaction(async tx => {
    // Serialize creation for this grant so the event limit cannot be raced.
    await tx.personalGrant.update({ where: { id: item.id }, data: { updated_at: new Date() } })
    if (await tx.personalGrantEvent.count({ where: { personal_grant_id: item.id } }) >= 100) throw new PlannerError('This grant has 100 calendar entries. Remove an old entry first.')
    return tx.personalGrantEvent.create({ data: { ...data, revision: 0, personal_grant_id: item.id, reminder_state: data.reminder_at ? 'PENDING' : 'NONE', retry_at: data.reminder_at }, select: eventSelect })
  })
}
export async function changeEvent(owner: Owner, eventId: string, body: unknown, remove = false) {
  const data = remove ? null : parseEvent(body, new Date(), false)
  const revision = remove ? z.object({ revision: z.number().int().nonnegative() }).strict().parse(body).revision : data?.revision
  if (revision === undefined) throw new PlannerError('Reload this calendar entry before editing.')
  const event = await prisma.personalGrantEvent.findFirst({ where: { id: eventId, personal_grant: owner } })
  if (!event) throw new PlannerError('Calendar entry not found.', 404)
  const where = { id: eventId, revision, reminder_state: { not: 'SENDING' as const }, personal_grant: owner }
  if (remove) {
    if ((await prisma.personalGrantEvent.deleteMany({ where })).count !== 1) throw new PlannerError('This entry changed or its email is being sent. Reload and try again.', 409)
    return null
  }
  const item = await prisma.personalGrant.findUniqueOrThrow({ where: { id: event.personal_grant_id }, select: { funding_call_id: true } })
  await requireCall(owner, item.funding_call_id)
  // Editing the calendar title/time alone must not resend an already delivered email.
  const reminderChanged = event.reminder_at?.getTime() !== data!.reminder_at?.getTime()
  if (reminderChanged && data!.reminder_at && data!.reminder_at <= new Date()) throw new PlannerError('Choose a reminder time in the future.')
  const result = await prisma.personalGrantEvent.updateMany({ where, data: {
    title: data!.title, event_at: data!.event_at, timezone: data!.timezone, reminder_at: data!.reminder_at, revision: { increment: 1 },
    ...(reminderChanged ? { reminder_state: data!.reminder_at ? 'PENDING' as const : 'NONE' as const, retry_at: data!.reminder_at, attempts: 0, sent_at: null, claim_token: null, claimed_at: null, last_error: null } : {}),
  } })
  if (result.count !== 1) throw new PlannerError('This entry changed or its email is being sent. Reload and try again.', 409)
  return prisma.personalGrantEvent.findUnique({ where: { id: eventId }, select: eventSelect })
}

export function plannerFailure(error: unknown) {
  if (error instanceof SyntaxError) return NextResponse.json({ message: 'Enter a valid request.' }, { status: 400 })
  if (error instanceof z.ZodError) return NextResponse.json({ message: error.errors[0]?.message || 'Invalid request.' }, { status: 400 })
  if (error instanceof PlannerError) return NextResponse.json({ message: error.message }, { status: error.status })
  console.error('[Personal grants] Request failed', error)
  return NextResponse.json({ message: 'Could not save or load your grants. Please try again.' }, { status: 500 })
}
