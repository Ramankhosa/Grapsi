import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Reviewer URL ingestion has been removed. Select an approved funding template instead.',
    code: 'REVIEWER_INGESTION_REMOVED',
  })
}
