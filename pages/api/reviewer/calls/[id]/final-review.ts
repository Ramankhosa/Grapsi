// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { ReviewerService, ReviewSummary } from '../../../../../lib/services/reviewerService';
import { hasMeaningfulSectionContent, normalizeStringArray } from '@/lib/reviewer/content';

function isScorableReviewedSection(section: any) {
  if (section.status !== 'reviewed' || !hasMeaningfulSectionContent(section.user_input)) return false;
  const mappingJson = section.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
  const linksDeclareWorkflow = linkedSections.some((link: any) => typeof link.workflowMode === 'string');
  return !linksDeclareWorkflow || linkedSections.some((link: any) => String(link.workflowMode || '') === 'app_draft');
}

// Define types for the review JSON structure
interface ReviewJson {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions?: string[];
  recommendations?: string[];
}

interface OverallReviewJson {
  overall_score: number;
  executive_summary: string;
  major_strengths: string[];
  major_weaknesses: string[];
  cross_sectional_recommendations: string[];
  supplementary_materials?: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the id from the URL
  const { id } = req.query;
  
  // Check for valid ID
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid call ID' });
  }
  
  // Get the user session
  const session = await getSession({ req });
  
  // Check authentication
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if the call exists and belongs to the user
  try {
    const call = await prisma.reviewerCall.findUnique({
      where: { id },
      select: {
        user_id: true,
        project_title: true,
        overall_review_json: true,
        parsed_json: true,
        LLM_model_used: true,
        review_status: true
      }
    });
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    const callAccess = await requireReviewerCallAccess(id, session, res, req.method === 'GET' ? 'read' : 'editContent');
    if (!callAccess) return;

    // Handle GET request - return existing final review
    if (req.method === 'GET') {
      try {
        // Fetch all sections with their latest reviews
        const sections = await prisma.reviewerSection.findMany({
          where: { call_id: id },
        });

        // Map sections to include their latest review
        const sectionsWithLatestReview = sections.map(section => {
          return {
            ...section,
            ai_review_json: section.ai_review_json || null,
            version: section.version || 0,
          };
        });

        // Add safety to review processing in the GET handler
        // Ensure we have proper structure for ai_review_json
        const normalizedSections = sectionsWithLatestReview.map(section => {
          // Ensure ai_review_json exists and has all required fields
          const safeReviewJson: ReviewJson = {
            score: 0,
            summary: '',
            strengths: [],
            weaknesses: [],
            suggestions: [],
            recommendations: [],
            ...(section.ai_review_json as any || {})
          };
          
          // Ensure all arrays are actual arrays
          if (!Array.isArray(safeReviewJson.strengths)) safeReviewJson.strengths = [];
          if (!Array.isArray(safeReviewJson.weaknesses)) safeReviewJson.weaknesses = [];
          if (safeReviewJson.suggestions && !Array.isArray(safeReviewJson.suggestions)) safeReviewJson.suggestions = [];
          if (safeReviewJson.recommendations && !Array.isArray(safeReviewJson.recommendations)) safeReviewJson.recommendations = [];
          
          return {
            ...section,
            ai_review_json: safeReviewJson
          };
        });

        // Process the overall review JSON to ensure it has the correct structure
        const defaultOverallReview: OverallReviewJson = {
          overall_score: 0,
          executive_summary: '',
          major_strengths: [],
          major_weaknesses: [],
          cross_sectional_recommendations: [],
          supplementary_materials: []
        };
        
        let safeOverallReview: OverallReviewJson = defaultOverallReview;
        
        // Try to parse the overall_review_json if it exists
        if (call.overall_review_json) {
          try {
            // Cast to any first to handle the type conversion
            const reviewJson = call.overall_review_json as any;
            
            safeOverallReview = {
              overall_score: typeof reviewJson.overall_score === 'number' ? reviewJson.overall_score : 
                            typeof reviewJson.overall_score === 'string' ? parseFloat(reviewJson.overall_score) : 0,
              executive_summary: typeof reviewJson.executive_summary === 'string' ? reviewJson.executive_summary : '',
              major_strengths: Array.isArray(reviewJson.major_strengths) ? reviewJson.major_strengths : [],
              major_weaknesses: Array.isArray(reviewJson.major_weaknesses) ? reviewJson.major_weaknesses : [],
              cross_sectional_recommendations: Array.isArray(reviewJson.cross_sectional_recommendations) ? 
                                             reviewJson.cross_sectional_recommendations : [],
              supplementary_materials: normalizeStringArray(reviewJson.supplementary_materials)
            };
          } catch (e) {
            console.error('Error parsing overall review JSON:', e);
            safeOverallReview = defaultOverallReview;
          }
        }

        return res.status(200).json({
          call: {
            ...call,
            overall_review_json: safeOverallReview
          },
          sections: normalizedSections,
        });
      } catch (error) {
        console.error('Error in GET handler:', error);
        return res.status(500).json({ 
          error: 'Failed to fetch review data',
          details: error.message
        });
      }
    }

    // Handle POST request - generate new final review
    if (req.method === 'POST') {
      try {
        // Fetch all sections
        const sections = await prisma.reviewerSection.findMany({
          where: { call_id: id },
        });

        // Filter to only include reviewed sections
        const reviewedSections = sections.filter(isScorableReviewedSection);

        // Check if we have reviewed sections
        if (reviewedSections.length === 0) {
          return res.status(400).json({ 
            error: 'No reviewed sections found for this call. Please review at least one section before generating a final review.' 
          });
        }

        // Prepare section summaries for the overall review
        const sectionSummaries = reviewedSections.map(section => {
          const reviewJson = section.ai_review_json as any || {
            score: 0,
            summary: 'No review available',
            strengths: [],
            weaknesses: [],
            recommendations: []
          };
          
          return {
            title: section.section_title,
            version: section.version || 0,
            content: section.user_input || '',
            context_summary: section.context_summary || '',
            review_json: reviewJson
          };
        });

        // Get LLM preference from call or default to Gemini
        const modelType = call.LLM_model_used === 'OPENAI' ? 'O' : 'G';
        
        // Extract description from parsed_json
        let description = '';
        if (call.parsed_json && typeof call.parsed_json === 'object') {
          const parsedJson = call.parsed_json as any;
          description = parsedJson.reviewer_context_text || parsedJson.description || parsedJson.call_summary || '';
        }

        // Generate the overall review
        const reviewerService = new ReviewerService();
        
        try {
          console.log('⭐ Starting final review generation for call:', id);
          console.log('Using model type:', modelType);
          console.log('Number of reviewed sections:', reviewedSections.length);
          
          const overallReview = await reviewerService.generateOverallReview(
            call.project_title,
            description,
            sectionSummaries,
            modelType as 'O' | 'G'
          );
          
          console.log('✅ Final review generated successfully:', !!overallReview);

          // Update the call with the overall review
          const updatedCall = await prisma.reviewerCall.update({
            where: { id },
            data: {
              overall_review_json: overallReview as any,
              updated_at: new Date()
            },
          });
          
          console.log('✅ Call updated successfully with overall review');

          // Process the overall review to ensure it has the correct structure
          const safeOverallReview: OverallReviewJson = {
            overall_score: typeof overallReview.overall_score === 'number' ? overallReview.overall_score : 
                          typeof overallReview.overall_score === 'string' ? parseFloat(overallReview.overall_score) : 0,
            executive_summary: typeof overallReview.executive_summary === 'string' ? overallReview.executive_summary : '',
            major_strengths: Array.isArray(overallReview.major_strengths) ? overallReview.major_strengths : [],
            major_weaknesses: Array.isArray(overallReview.major_weaknesses) ? overallReview.major_weaknesses : [],
            cross_sectional_recommendations: Array.isArray(overallReview.cross_sectional_recommendations) ? 
                                           overallReview.cross_sectional_recommendations : [],
            supplementary_materials: normalizeStringArray(overallReview.supplementary_materials)
          };

          return res.status(200).json({
            call: {
              ...updatedCall,
              overall_review_json: safeOverallReview
            },
            sections: sections.map(section => ({
              ...section,
              ai_review_json: section.ai_review_json || null,
              version: section.version || 0,
            })),
          });
        } catch (error) {
          console.error('Error generating overall review:', error);
          return res.status(500).json({ 
            error: 'Failed to generate the final review. There may be an issue with the AI model. Please try again.',
            details: error.message
          });
        }
      } catch (error) {
        console.error('Error in POST handler:', error);
        return res.status(500).json({ 
          error: 'Failed to generate review',
          details: error.message
        });
      }
    }
    
    // Return method not allowed for other HTTP methods
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    
  } catch (error) {
    console.error('Error in handler:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred',
      details: error.message
    });
  }
} 
