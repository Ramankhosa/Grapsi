// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import axios from 'axios';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check authentication
  const session = await getServerSession(req, res);
  
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Handle POST request
  if (req.method === 'POST') {
    try {
      const { url } = req.body;
      
      // Basic URL validation
      if (!url) {
        return res.status(400).json({ valid: false, message: 'URL is required' });
      }
      
      // Validate URL format using URL constructor
      try {
        new URL(url);
      } catch (e) {
        return res.status(400).json({ valid: false, message: 'Invalid URL format' });
      }
      
      // Check if URL is reachable with a HEAD request
      try {
        // Set a timeout to avoid long-running requests - increased from 5s to 15s
        const response = await axios.head(url, {
          timeout: 15000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500, // Accept even if 404, we'll handle it
        });
        
        // Check for successful status code (2xx)
        if (response.status >= 200 && response.status < 300) {
          return res.status(200).json({ valid: true });
        } 
        // Handle 404 errors
        else if (response.status === 404) {
          return res.status(400).json({ valid: false, message: 'URL not found (404)' });
        } 
        // Handle other HTTP errors
        else {
          return res.status(400).json({ valid: false, message: `URL returned status code: ${response.status}` });
        }
      } catch (error) {
        console.error('Error validating URL:', error);
        
        // Check if it's a timeout
        if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
          // Accept the URL even with timeout - some valid sites may be slow to respond
          console.log('URL validation timed out, but accepting as valid:', url);
          return res.status(200).json({ 
            valid: true, 
            warning: 'URL connection timed out, but accepted as valid. The site may be slow to respond.'
          });
        }
        // Handle HTTP parsing errors (malformed responses)
        else if (
          axios.isAxiosError(error) && 
          (error.code === 'HPE_CLOSED_CONNECTION' || 
           (error.cause as any)?.code === 'HPE_CLOSED_CONNECTION')
        ) {
          // Some servers send malformed HTTP responses but might still be valid sources
          console.log('URL validation encountered malformed HTTP response, but accepting as valid:', url);
          return res.status(200).json({
            valid: true,
            warning: 'The URL returned a malformed response but was accepted as valid.'
          });
        }
        // Network errors
        else if (axios.isAxiosError(error) && !error.response) {
          return res.status(400).json({ valid: false, message: 'Cannot connect to URL' });
        }
        // For other errors
        else {
          return res.status(400).json({ valid: false, message: 'Failed to validate URL' });
        }
      }
    } catch (error) {
      console.error('Error in URL validation:', error);
      return res.status(500).json({ valid: false, message: 'Server error during URL validation' });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 