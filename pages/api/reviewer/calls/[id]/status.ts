import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Reviewer analyzer polling has been removed. Template-backed reviewer calls are ready immediately after creation.',
    code: 'REVIEWER_INGESTION_REMOVED',
  })
}
