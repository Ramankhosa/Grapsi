import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { proposalReachUnitIds } from '@/lib/proposals/access'
import {
  createProposal,
  getProposalDossier,
  listProposals,
  ProposalError,
} from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { PROPOSAL_STATUSES, type ProposalLens } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The proposal list, in two shapes from one query.
 *
 * `view=mine` is the researcher's own applications (as PI or as a named team
 * member). `view=register` is the department's book, clamped to the schools the
 * caller covers — an officer with no coverage sees nothing, not everything.
 */

const createSchema = z
  .object({
    assignmentId: z.string().trim().min(1).optional(),
    fundingCallId: z.string().trim().min(1).optional(),
    piUserId: z.string().trim().min(1).optional(),
    title: z.string().trim().max(500).optional(),
    adHoc: z
      .object({
        agencyName: z.string().trim().min(1, 'Name the funding agency').max(300),
        schemeTitle: z.string().trim().max(300).nullable().optional(),
        deadlineAt: z.string().trim().nullable().optional(),
      })
      .optional(),
  })
  .refine((value) => value.assignmentId || value.fundingCallId || value.adHoc, {
    message: 'Point the proposal at an assignment, a funding call, or give the agency details.',
  })

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const params = request.nextUrl.searchParams
  const view = params.get('view') === 'register' ? 'register' : 'mine'

  // The register serializes through a lens, so the lens is decided here rather
  // than inferred from the view: a Dean has schools in `managedUnitIds` and
  // would otherwise be served the department's officer view of them.
  let lens: ProposalLens = 'faculty'
  if (view === 'register') {
    if (context.isAdmin || context.scope.isTenantWide) {
      lens = 'admin'
    } else if (context.scope.fundingDept.isMember) {
      lens = 'officer'
    } else if (context.scope.isHead && context.scope.managedUnitIds.length > 0) {
      lens = 'head'
    } else {
      // Told plainly this is not their screen, rather than shown an empty
      // register that implies there is nothing in it.
      return NextResponse.json({ error: 'You do not cover any schools.' }, { status: 403 })
    }
  }

  const statuses = params
    .getAll('status')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toUpperCase())
    .filter((value) => (PROPOSAL_STATUSES as readonly string[]).includes(value))

  try {
    const result = await listProposals({
      tenantId: context.tenantId,
      view,
      lens,
      userId: context.user.id,
      reachUnitIds: view === 'register' ? proposalReachUnitIds(context) : null,
      status: statuses.length ? statuses : null,
      orgUnitId: params.get('orgUnitId'),
      agency: params.get('agency'),
      fundingCallId: params.get('callId'),
      piUserId: params.get('piUserId'),
      q: params.get('q'),
      window: params.get('window'),
      limit: Number(params.get('limit')) || undefined,
      offset: Number(params.get('offset')) || undefined,
    })

    return NextResponse.json({ view, ...result })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] list failed', error)
    return NextResponse.json({ error: 'Could not load proposals.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  let payload: z.infer<typeof createSchema>
  try {
    payload = createSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const isOfficer =
    context.isAdmin || context.scope.isTenantWide || context.scope.fundingDept.isMember

  // Some offices open every record themselves.
  const settings = await getProposalSettings(context.tenantId)
  if (!isOfficer && !settings.facultyMayOpenProposals) {
    return NextResponse.json(
      {
        error:
          'At this institution the funding department opens proposal records. Ask your funding officer to start one.',
        code: 'FEATURE_DISABLED',
      },
      { status: 403 }
    )
  }

  // An officer may open the record on a researcher's behalf; anyone else is
  // opening their own, whatever they put in the body.
  const piUserId = isOfficer && payload.piUserId ? payload.piUserId : context.user.id

  try {
    const proposal = await createProposal({
      tenantId: context.tenantId,
      actorUserId: context.user.id,
      piUserId,
      assignmentId: payload.assignmentId || null,
      fundingCallId: payload.fundingCallId || null,
      title: payload.title || null,
      adHoc: payload.adHoc
        ? {
            agencyName: payload.adHoc.agencyName,
            schemeTitle: payload.adHoc.schemeTitle ?? null,
            deadlineAt: parseDate(payload.adHoc.deadlineAt),
          }
        : null,
    })

    const dossier = await getProposalDossier(proposal.id, isOfficer ? 'officer' : 'faculty')
    return NextResponse.json(dossier, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] create failed', error)
    return NextResponse.json({ error: 'Could not create the proposal.' }, { status: 500 })
  }
}
