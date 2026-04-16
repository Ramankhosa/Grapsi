// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFundingOperator } from '../fundingIntake/auth';

/**
 * V1 template management uses the same operator roles as funding intake.
 * This helper keeps the permission boundary explicit so a finer capability
 * model can replace it later without changing route handlers.
 */
export async function requireFundingTemplateManager(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return requireFundingOperator(req, res);
}
