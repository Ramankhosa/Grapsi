import type { NextApiRequest, NextApiResponse } from 'next'

import { getReviewerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api'
import prisma from '../../../lib/prisma'

type ReadinessTier = 'template_manual' | 'guideline_manual' | 'call_fields'

const READINESS_LABELS: Record<ReadinessTier, string> = {
  template_manual: 'Approved template',
  guideline_manual: 'Guideline pack',
  call_fields: 'Call record only',
}

const READINESS_RANK: Record<ReadinessTier, number> = {
  template_manual: 0,
  guideline_manual: 1,
  call_fields: 2,
}

/**
 * Funding calls the signed-in user can start a reviewer workspace from.
 *
 * Every accessible call is listed, not just template-approved ones: reviewer
 * context degrades from template rules to guideline rules to the call record's
 * own fields, so a call without an approved template is still a usable
 * starting point. `readiness` tells the UI how rich the rules will be.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  const session = await getReviewerSession(req, res)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  if (!(await requireGrantReviewFeature(session, res))) return

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  const take = Math.min(Math.max(Number.parseInt(String(req.query.limit || '100'), 10) || 100, 1), 200)

  const visibilityFilter = {
    OR: [
      { visibility: 'GLOBAL_PUBLISHED' as const },
      ...(session.user.tenantId ? [{ tenantId: session.user.tenantId }] : []),
    ],
  }

  const calls = await prisma.fundingCall.findMany({
    where: search
      ? {
          AND: [
            visibilityFilter,
            {
              OR: [
                { scheme_title: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                { agency_name: { contains: search, mode: 'insensitive' } },
                { agencyName: { contains: search, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : visibilityFilter,
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agency_name: true,
      agencyName: true,
      description: true,
      summary: true,
      close_date: true,
      deadlineAt: true,
      template_status: true,
      guideline_status: true,
      active_template_id: true,
      active_guideline_id: true,
      source_url: true,
      sourceUrl: true,
      active_template: { select: { status: true } },
      template: { select: { status: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take,
  })

  const options = calls
    .map((call) => {
      const hasApprovedTemplate =
        call.active_template?.status === 'approved' || call.template?.status === 'approved'
      const readiness: ReadinessTier = hasApprovedTemplate
        ? 'template_manual'
        : call.active_guideline_id
          ? 'guideline_manual'
          : 'call_fields'

      return {
        id: call.id,
        title: call.scheme_title || call.title || 'Untitled funding call',
        agencyName: call.agency_name || call.agencyName || null,
        summary: call.description || call.summary || null,
        deadlineAt: (call.close_date || call.deadlineAt)?.toISOString?.() || null,
        templateStatus: call.template_status,
        templateId: call.active_template_id,
        sourceUrl: call.source_url || call.sourceUrl || null,
        readiness,
        readinessLabel: READINESS_LABELS[readiness],
      }
    })
    .sort(
      (left, right) =>
        READINESS_RANK[left.readiness] - READINESS_RANK[right.readiness] ||
        left.title.localeCompare(right.title)
    )

  return res.status(200).json({ calls: options })
}
