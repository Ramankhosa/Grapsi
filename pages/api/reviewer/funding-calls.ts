import type { NextApiRequest, NextApiResponse } from 'next'

import { getReviewerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api'
import prisma from '../../../lib/prisma'

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

  const calls = await prisma.fundingCall.findMany({
    where: {
      template_status: 'approved',
      OR: [
        { visibility: 'GLOBAL_PUBLISHED' },
        ...(session.user.tenantId ? [{ tenantId: session.user.tenantId }] : []),
      ],
    },
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
      active_template_id: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 100,
  })

  return res.status(200).json({
    calls: calls.map((call) => ({
      id: call.id,
      title: call.scheme_title || call.title || 'Untitled funding call',
      agencyName: call.agency_name || call.agencyName || null,
      summary: call.description || call.summary || null,
      deadlineAt: (call.close_date || call.deadlineAt)?.toISOString?.() || null,
      templateStatus: call.template_status,
      templateId: call.active_template_id,
    })),
  })
}
