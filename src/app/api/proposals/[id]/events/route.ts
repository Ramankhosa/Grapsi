import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { listProposalEvents } from '@/lib/proposals/events'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { addProposalNote } from '@/lib/proposals/statusService'

export const dynamic = 'force-dynamic'

/**
 * The proposal's history, filtered by lens: the applicant sees what was done to
 * their application, the department sees that plus its own working notes.
 */

const postSchema = z.object({
  note: z.string().trim().min(1, 'Add a note').max(5000),
  /** Officers choose; for a faculty note this is ignored and forced true. */
  visibleToFaculty: z.boolean().default(true),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  const limit = Number(request.nextUrl.searchParams.get('limit')) || 100
  return NextResponse.json({ events: await listProposalEvents(params.id, access.lens, { limit }) })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (access.lens === 'head') {
    return NextResponse.json({ error: 'This view is read-only.' }, { status: 403 })
  }

  let payload: z.infer<typeof postSchema>
  try {
    payload = postSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    await addProposalNote({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      lens: access.lens,
      note: payload.note,
      visibleToFaculty: payload.visibleToFaculty,
    })
    return NextResponse.json({ events: await listProposalEvents(params.id, access.lens) }, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] note failed', error)
    return NextResponse.json({ error: 'Could not save the note.' }, { status: 500 })
  }
}
