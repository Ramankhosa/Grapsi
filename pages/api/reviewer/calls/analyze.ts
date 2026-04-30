import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Reviewer call ingestion has been removed. Create reviewer calls from an approved funding template instead.',
    code: 'REVIEWER_INGESTION_REMOVED',
  })
}
