// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const session = await getServerSession(req, res);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  if (!(await requireGrantReviewFeature(session, res))) return;

  const { review_version_id, section_type, asset_id, order } = req.body || {};
  if (!review_version_id || !section_type || !asset_id) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const count = await prisma.reviewAssetLink.count({ where: { review_version_id, section_type } });
    if (count >= 3) return res.status(409).json({ error: 'Max 3 assets per section' });

    const link = await prisma.reviewAssetLink.create({ data: { review_version_id, section_type, asset_id, order: order ?? count } });
    return res.status(201).json({ link_id: link.id });
  } catch (e) {
    console.error('Link asset error', e);
    return res.status(500).json({ error: 'Failed to link asset' });
  }
}



