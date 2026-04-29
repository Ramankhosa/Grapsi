// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import { prisma } from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check authentication
    const session = await getServerSession(req, res);
    
    if (!session || !session.user?.email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Restrict access to specific admin email
    if (session.user.email !== 'ramandeep.singh@lpu.co.in') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch all reviewer calls that have a completed final review
    const reviewerCalls = await prisma.reviewerCall.findMany({
      where: {
        // Only include calls that have a generated overall review
        overall_review_json: {
          not: null
        }
      },
      select: {
        id: true,
        project_title: true,
        agency_name: true,
        created_at: true,
        updated_at: true,
        overall_review_json: true,
        user_id: true,
        reviewer_sections: {
          select: {
            id: true,
            status: true
          }
        },
        user: {
          select: {
            email: true,
            name: true
          }
        }
      },
      orderBy: {
        updated_at: 'desc'
      }
    });

    // Process the data for the frontend
    const formattedReports = reviewerCalls.map(call => {
      // Count reviewed sections
      const reviewedSectionCount = call.reviewer_sections.filter(
        section => section.status === 'reviewed'
      ).length;

      return {
        id: call.id,
        project_title: call.project_title,
        agency_name: call.agency_name,
        created_at: call.created_at,
        updated_at: call.updated_at,
        user_id: call.user_id,
        user_email: call.user.email || 'Unknown',
        user_name: call.user.name || 'Unknown User',
        section_count: reviewedSectionCount,
        has_overall_review: !!call.overall_review_json
      };
    });

    return res.status(200).json({ 
      reports: formattedReports,
      count: formattedReports.length
    });
  } catch (error) {
    console.error('Error fetching reviewer reports:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch reviewer reports',
      details: error.message 
    });
  }
} 