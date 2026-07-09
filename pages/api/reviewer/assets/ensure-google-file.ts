// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';

// Placeholder for Google file upload, wire to Vertex/Gemini Files API later
async function uploadToGoogleFiles(localPath: string, mime: string): Promise<string> {
  // TODO: integrate official Google Files API and return file id
  // For now, return a deterministic fake id to allow UI wiring
  return `google_${Buffer.from(localPath).toString('base64').slice(0,16)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const session = await getServerSession(req, res);
  if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  if (!(await requireGrantReviewFeature(session, res))) return;

  const { asset_id } = req.body || {};
  if (!asset_id) return res.status(400).json({ error: 'asset_id is required' });

  try {
    const asset = await prisma.reviewAsset.findUnique({ where: { id: asset_id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // Refresh if missing or outdated (simple policy: refresh if no id)
    if (!asset.google_file_id) {
      // Our storage path is under /public; convert to fs path
      const localPath = asset.gcs_uri.startsWith('/') ? asset.gcs_uri.slice(1) : asset.gcs_uri;
      const googleId = await uploadToGoogleFiles(localPath, asset.mime);
      const updated = await prisma.reviewAsset.update({ where: { id: asset.id }, data: { google_file_id: googleId, google_file_updated_at: new Date() } });
      return res.status(200).json({ asset_id: updated.id, google_file_id: updated.google_file_id });
    }

    return res.status(200).json({ asset_id: asset.id, google_file_id: asset.google_file_id });
  } catch (e) {
    console.error('Ensure google file error', e);
    return res.status(500).json({ error: 'Failed to ensure google file id' });
  }
}



