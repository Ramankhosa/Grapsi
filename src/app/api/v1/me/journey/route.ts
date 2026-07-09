import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/middleware'
import { dismissTour, getJourneySnapshot, setChecklistDone } from '@/lib/journey/journeyService'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { user, error } = await authenticateRequest(request)
  if (error) return error

  try {
    const snapshot = await getJourneySnapshot(user!.sub, user!.tenant_id, user!.roles || [])
    return NextResponse.json(snapshot)
  } catch (err) {
    console.error('Journey snapshot error:', err)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to load journey state' },
      { status: 500 }
    )
  }
}

const patchSchema = z.object({
  dismiss_tour: z.string().min(1).max(100).optional(),
  checklist_done: z.boolean().optional()
})

export async function PATCH(request: NextRequest) {
  const { user, error } = await authenticateRequest(request)
  if (error) return error

  try {
    const body = patchSchema.parse(await request.json())

    if (body.dismiss_tour) {
      await dismissTour(user!.sub, body.dismiss_tour)
    }
    if (typeof body.checklist_done === 'boolean') {
      await setChecklistDone(user!.sub, body.checklist_done)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: err.errors },
        { status: 400 }
      )
    }
    console.error('Journey update error:', err)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to update journey state' },
      { status: 500 }
    )
  }
}
