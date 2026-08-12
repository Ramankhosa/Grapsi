// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import crypto from 'crypto';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  
  // Get the user session
  const session = await getServerSession(req, res);
  
  // Check authentication
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!(await requireGrantReviewFeature(session, res))) return;
  
  // Get the call ID from the URL
  const callId = req.query.id as string;
  
  if (!callId) {
    return res.status(400).json({ error: 'Call ID is required' });
  }

  // Get display preferences from the request body
  const { displayMode, versionSelections } = req.body;

  try {
    // Verify the call belongs to the user
    const call = await prisma.reviewerCall.findUnique({
      where: {
        id: callId,
        user_id: session.user.id
      }
    });
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Parse the existing parsed_json to check if we need a new token
    let parsedJson = {};
    try {
      parsedJson = typeof call.parsed_json === 'string'
        ? JSON.parse(call.parsed_json || '{}')
        : (call.parsed_json || {});
    } catch (e) {
      console.error('Error parsing call JSON:', e);
    }
    
    // Rotate the token when the shared view changes, so an old link never
    // silently starts showing a different report. The `!call.share_token` arm
    // must be evaluated on its own: it used to sit behind `displayMode &&`, so
    // a share request that carried no display preference left the token null
    // and handed the user a link ending in "/null".
    const currentPreferences = parsedJson.report_preferences || {};
    const preferencesChanged = Boolean(displayMode) && (
      currentPreferences.displayMode !== displayMode ||
      JSON.stringify(currentPreferences.versionSelections) !== JSON.stringify(versionSelections)
    );
    const needsNewToken = !call.share_token || preferencesChanged;

    // Generate a unique share token
    let shareToken = call.share_token;
    if (needsNewToken) {
      // Generate a new token that includes the display mode as part of its generation
      const tokenSeed = `${callId}-${displayMode || 'single'}-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
      shareToken = crypto.createHash('sha256').update(tokenSeed).digest('hex');
    }

    // Update the report preferences
    if (displayMode) {
      parsedJson = {
        ...parsedJson,
        report_preferences: {
          ...(parsedJson.report_preferences || {}),
          displayMode,
          versionSelections: versionSelections || {},
          lastUpdated: new Date().toISOString(),
          shareToken // Store the token with the preferences
        }
      };
    }
    
    // Save the share token and updated preferences to the database
    await prisma.reviewerCall.update({
      where: { id: callId },
      data: { 
        share_token: shareToken,
        is_public: true,
        parsed_json: parsedJson
      }
    });
    
    // Prefer the deployment's configured origin, but fall back to the request's
    // own so a missing NEXTAUTH_URL yields a working relative-to-host link
    // rather than the bare "/shared-report/<token>" this used to return.
    const forwardedProto = Array.isArray(req.headers['x-forwarded-proto'])
      ? req.headers['x-forwarded-proto'][0]
      : req.headers['x-forwarded-proto'];
    const requestOrigin = req.headers.host
      ? `${forwardedProto || 'https'}://${req.headers.host}`
      : '';
    const origin = (process.env.NEXTAUTH_URL || requestOrigin).replace(/\/+$/, '');

    // Return the share token and URL
    return res.status(200).json({
      success: true,
      share_token: shareToken,
      share_url: `${origin}/shared-report/${shareToken}`
    });
    
  } catch (error) {
    console.error('Error generating share token:', error);
    return res.status(500).json({ error: 'Failed to generate share token' });
  }
} 