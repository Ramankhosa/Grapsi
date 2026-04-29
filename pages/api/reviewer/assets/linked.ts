// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const session = await getServerSession(req, res);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  const review_version_id = String(req.query.review_version_id || '');
  if (!review_version_id) return res.status(400).json({ error: 'review_version_id is required' });

  try {
    const links = await prisma.reviewAssetLink.findMany({
      where: { review_version_id },
      orderBy: { order: 'asc' },
    });

    const assetIds = links.map(l => l.asset_id);
    const assets = await prisma.reviewAsset.findMany({ where: { id: { in: assetIds } } });
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const grouped: Record<string, any[]> = { METHODOLOGY: [], TIMELINE: [], BUDGET_JUSTIFICATION: [] };
    for (const link of links) {
      const asset = assetMap.get(link.asset_id);
      if (!asset) continue;
      grouped[link.section_type] = grouped[link.section_type] || [];
      grouped[link.section_type].push({
        link_id: link.id,
        asset_id: asset.id,
        mime: asset.mime,
        preview_url: asset.gcs_preview_uri || asset.gcs_uri,
        order: link.order,
        attach_in_prompt: link.attach_in_prompt,
      });
    }

    return res.status(200).json(grouped);
  } catch (e) {
    console.error('List linked assets error', e);
    return res.status(500).json({ error: 'Failed to list linked assets' });
  }
}



