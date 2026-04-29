// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  const linkId = String(req.query.linkId || '');
  if (!linkId) return res.status(400).json({ error: 'linkId required' });

  if (req.method === 'PATCH') {
    const { attach_in_prompt, order } = req.body || {};
    try {
      const link = await prisma.reviewAssetLink.update({
        where: { id: linkId },
        data: {
          attach_in_prompt: typeof attach_in_prompt === 'boolean' ? attach_in_prompt : undefined,
          order: typeof order === 'number' ? order : undefined,
        },
      });
      return res.status(200).json({ link_id: link.id });
    } catch (e) {
      console.error('Update link error', e);
      return res.status(500).json({ error: 'Failed to update link' });
    }
  } else if (req.method === 'DELETE') {
    try {
      await prisma.reviewAssetLink.delete({ where: { id: linkId } });
      return res.status(204).end();
    } catch (e) {
      console.error('Delete link error', e);
      return res.status(500).json({ error: 'Failed to delete link' });
    }
  } else {
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}



