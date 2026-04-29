// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the user session
  const session = await getServerSession(req, res);
  
  // Check authentication
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id } = req.query;
  
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ error: 'Invalid call ID' });
  }

  // Check if the call belongs to the logged-in user
  const callExists = await prisma.reviewerCall.findFirst({
    where: {
      id: id as string,
      user_id: session.user.id,
    },
  });
  
  if (!callExists) {
    return res.status(404).json({ error: 'Call not found or you don\'t have permission' });
  }

  // Handle different HTTP methods
  if (req.method === 'GET') {
    try {
      const call = await prisma.reviewerCall.findUnique({
        where: { id: id as string },
      });

      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      res.status(200).json({ call });
    } catch (error) {
      console.error('Error fetching call details:', error);
      res.status(500).json({ error: 'Failed to fetch call details' });
    }
  } 
  else if (req.method === 'PUT') {
    try {
      const { project_title, agency_name, call_input_data } = req.body;
      
      // Validate the request body
      if (!project_title && !agency_name && !call_input_data) {
        return res.status(400).json({ error: 'At least one field must be provided for update' });
      }
      
      // Prepare update data
      const updateData: any = {};
      if (project_title) updateData.project_title = project_title;
      if (agency_name) updateData.agency_name = agency_name;
      if (call_input_data) updateData.call_input_data = call_input_data;
      
      // Update the call
      const updatedCall = await prisma.reviewerCall.update({
        where: { id: id as string },
        data: updateData
      });
      
      return res.status(200).json({ 
        message: 'Project details updated successfully',
        call: updatedCall 
      });
    } catch (error) {
      console.error('Error updating call details:', error);
      return res.status(500).json({ error: 'Failed to update call details' });
    }
  }
  else if (req.method === 'DELETE') {
    try {
      // First delete any related sections
      await prisma.reviewerSection.deleteMany({
        where: { call_id: id as string }
      });
      
      // Then delete the call itself
      await prisma.reviewerCall.delete({
        where: { id: id as string }
      });
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error deleting call:', error);
      res.status(500).json({ error: 'Failed to delete call' });
    }
  } 
  else {
    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 