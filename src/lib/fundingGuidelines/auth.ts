// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFundingOperator } from '../fundingIntake/auth';

/**
 * V1 guideline management uses the same operator boundary as funding intake.
 * This keeps route handlers explicit and leaves room for a stricter capability
 * split later without rewriting the module surface.
 */
export async function requireFundingGuidelineManager(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return requireFundingOperator(req, res);
}
