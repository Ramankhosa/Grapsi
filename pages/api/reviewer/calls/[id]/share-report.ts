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
    
    // Check if we need to generate a new token based on display mode change
    const currentPreferences = parsedJson.report_preferences || {};
    const needsNewToken = displayMode && 
      (currentPreferences.displayMode !== displayMode || 
       !call.share_token || 
       JSON.stringify(currentPreferences.versionSelections) !== JSON.stringify(versionSelections));
    
    // Generate a unique share token
    let shareToken = call.share_token;
    if (needsNewToken) {
      // Generate a new token that includes the display mode as part of its generation
      const tokenSeed = `${callId}-${displayMode}-${Date.now()}`;
      shareToken = crypto.createHash('sha256').update(tokenSeed).digest('hex');
    }
    
    // Update the report preferences
    if (displayMode && versionSelections) {
      parsedJson = {
        ...parsedJson,
        report_preferences: {
          ...(parsedJson.report_preferences || {}),
          displayMode,
          versionSelections,
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
    
    // Return the share token and URL
    return res.status(200).json({ 
      success: true,
      share_token: shareToken,
      share_url: `${process.env.NEXTAUTH_URL || ''}/shared-report/${shareToken}`
    });
    
  } catch (error) {
    console.error('Error generating share token:', error);
    return res.status(500).json({ error: 'Failed to generate share token' });
  }
} 