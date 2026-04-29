// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';
import axios from 'axios';
import formidable from 'formidable';
import fs from 'fs/promises';

// Configure formidable to parse form data with files
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper function to parse form data
const parseFormData = async (req: NextApiRequest) => {
  const form = formidable({ keepExtensions: true });
  return new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve({ fields, files });
    });
  });
};

// Helper to extract text from files
const extractTextFromFile = async (filePath: string, fileType: string) => {
  const normalizedType = String(fileType || '').toLowerCase();

  // Simple text file - read directly
  if (normalizedType.endsWith('.txt')) {
    return fs.readFile(filePath, 'utf8');
  }
  
  // PDF extraction
  if (normalizedType.endsWith('.pdf')) {
    try {
      const pdfParse = require('pdf-parse-fork');
      const buffer = await fs.readFile(filePath);
      const parsed = await pdfParse(buffer);
      return parsed.text || '';
    } catch (err) {
      console.error('Error extracting text from PDF:', err);
      throw new Error('Failed to extract text from PDF file');
    }
  }

  if (normalizedType.endsWith('.docx')) {
    try {
      const mammoth = require('mammoth');
      const parsed = await mammoth.extractRawText({ path: filePath });
      return parsed.value || '';
    } catch (err) {
      console.error('Error extracting text from DOCX:', err);
      throw new Error('Failed to extract text from DOCX file');
    }
  }
  
  throw new Error(`Unsupported file type: ${fileType}`);
};

// Helper function to check if URL exists in database
const findExistingUrlCall = async (url: string) => {
  try {
    const existingCall = await prisma.reviewerCall.findFirst({
      where: {
        call_input_type: 'url',
        call_input_data: url,
        review_status: 'parsed', // Only use successfully parsed calls
      },
      orderBy: {
        updated_at: 'desc', // Get the most recent successful parsing
      },
      select: {
        id: true,
        parsed_json: true,
        raw_text_backup: true,
      }
    });
    
    return existingCall;
  } catch (error) {
    console.error('Error checking for existing URL:', error);
    return null; // Return null if there's an error, we'll proceed with normal processing
  }
};

// Helper function to fetch content from URL
const fetchUrlContent = async (url: string) => {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
    });
    
    // Check if the response is HTML
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('html')) {
      // Very simple HTML stripping - for production use a better HTML parser
      return response.data
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return response.data;
  } catch (error) {
    console.error('Error fetching URL:', error);
    throw new Error('Failed to fetch content from URL');
  }
};

// LLM processing function
const processWithLLM = async (text: string, modelType: 'gemini' | 'openai') => {
  // Preparing the prompt using the template from SRS
  const prompt = `
You are an expert funding call analyzer. Your task is to extract structured information from the provided funding call content.

Follow these rules:
- Only extract facts that are explicitly mentioned in the text.
- If any field is missing or unclear, set its value to "NA".
- Output must be a valid JSON object.

Extract the following fields:
- title
- agency_name
- budget_cap
- project_duration_limit
- submission_deadline
- eligibility_criteria
- thrust_areas
- evaluation_criteria
- dos
- donts
- mandatory_sections
- deliverables_expected
- funding_ratio
- IP_ownership_clause
- application_portal
- source_urls (if available)

Respond only with the JSON object.

Here is the funding call content:
${text.substring(0, 30000)} // Limit text length to avoid token limits
`;

  try {
    // Based on the model type, call the appropriate API
    if (modelType === 'openai') {
      // Call OpenAI API (implement actual API call)
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4', // or your preferred model
          messages: [
            { role: 'system', content: 'You are a helpful assistant that extracts structured data from funding calls.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return JSON.parse(response.data.choices[0].message.content.trim());
    } 
    // Default to Gemini
    else {
      // Check if API key is available
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      
      // Validate API key
      if (!apiKey || apiKey === 'undefined' || apiKey.length < 10) {
        console.error("GOOGLE_AI_API_KEY is missing or invalid");
        throw new Error("Failed to extract information from the funding call: API key missing");
      }
      
      console.log(`Using Gemini API key (first few chars): ${apiKey.substring(0, 4)}...`);
      
      // Call Gemini API using the same implementation as extract-call-details.ts
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4096,
              topP: 0.95,
              topK: 40
            },
            safetySettings: [
              {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
        
        // Check if response has the expected structure
        if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.error("Unexpected Gemini API response structure:", JSON.stringify(response.data).substring(0, 500));
          throw new Error("Invalid response from Gemini API");
        }
        
        // Parse the response
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        // Try multiple approaches to extract JSON from the text response
        let jsonStr = "";
        
        // Method 1: Check for JSON code blocks
        const jsonBlockMatch = textResponse.match(/```json([\s\S]*?)```/);
        
        if (jsonBlockMatch && jsonBlockMatch[1]) {
          jsonStr = jsonBlockMatch[1].trim();
        } else {
          // Method 2: Look for any JSON-like structure
          const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonStr = jsonMatch[0];
          } else {
            jsonStr = textResponse; // Last resort, try to parse the whole response
          }
        }
        
        try {
          return JSON.parse(jsonStr);
        } catch (parseError) {
          console.error("Error parsing Gemini response as JSON:", parseError);
          throw new Error("Failed to parse Gemini response as JSON");
        }
      } catch (error: any) {
        console.error("Gemini API call failed:", error.message);
        if (error.response) {
          console.error("Response status:", error.response.status);
          console.error("Response data:", JSON.stringify(error.response.data, null, 2));
        }
        throw error;
      }
    }
  } catch (error) {
    console.error('Error processing with LLM:', error);
    throw new Error('Failed to extract information from the funding call');
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check authentication
  const session = await getServerSession(req, res);
  
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  
  try {
    console.log("User authenticated with ID:", session.user.id);
    
    // Determine which LLM to use from .env.local
    const LLMModel = process.env.DEFAULT_REVIEWER_MODEL === 'O' ? 'openai' : 'gemini';
    
    let project_title: string = '';
    let agency_name: string = '';
    let call_input_type: string = '';
    let call_input_data: string = '';
    let rawTextContent: string = '';
    let existingParsedJson: any = null;
    let reusingExisting: boolean = false;
    
    // Handle different input types
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      // File upload case
      const { fields, files } = await parseFormData(req);
      
      // Safely extract fields with type checking
      if (fields && fields.project_title) {
        project_title = Array.isArray(fields.project_title) 
          ? fields.project_title[0] || '' 
          : fields.project_title || '';
      }
      
      if (fields && fields.agency_name) {
        agency_name = Array.isArray(fields.agency_name) 
          ? fields.agency_name[0] || '' 
          : fields.agency_name || '';
      }
      
      call_input_type = 'file';
      
      // Get the uploaded file
      const file = files.file as any;
      if (!file || Array.isArray(file)) {
        return res.status(400).json({ error: 'Invalid file upload' });
      }
      
      // Store the file path for text extraction
      const filePath = file.filepath as string;
      call_input_data = file.originalFilename as string || 'uploaded_file';
      
      // Extract text from the file
      rawTextContent = await extractTextFromFile(filePath, call_input_data);
    } else {
      // Parse JSON data for URL or text inputs
      // Need to manually parse the body since bodyParser is disabled
      let body = {};
      
      // Check if req.body already exists (might have been parsed by another middleware)
      if (req.body) {
        body = req.body;
      } else {
        // Parse the body as JSON
        try {
          const buffers = [];
          for await (const chunk of req) {
            buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const data = Buffer.concat(buffers).toString();
          body = JSON.parse(data);
        } catch (error) {
          console.error('Error parsing request body:', error);
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
      
      // Safely extract fields with type checking
      project_title = (body as any)?.project_title || '';
      agency_name = (body as any)?.agency_name || '';
      call_input_type = (body as any)?.call_input_type || '';
      call_input_data = (body as any)?.call_input_data || '';
      
      // Ensure project_title is not undefined before proceeding
      if (!project_title) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          details: { project_title: 'Missing project title' }
        });
      }
      
      // Check for existing URL results in database before fetching and processing
      if (call_input_type === 'url') {
        const existingCall = await findExistingUrlCall(call_input_data);
        
        if (existingCall && existingCall.parsed_json) {
          console.log(`Found existing parsed data for URL: ${call_input_data}`);
          existingParsedJson = existingCall.parsed_json;
          if (existingCall.raw_text_backup) {
            rawTextContent = existingCall.raw_text_backup;
            reusingExisting = true;
          }
        }
      }
      
      // Only fetch content if we don't have existing content
      if (!reusingExisting) {
        // Get the raw text content based on input type
        if (call_input_type === 'url') {
          rawTextContent = await fetchUrlContent(call_input_data);
        } else if (call_input_type === 'text') {
          rawTextContent = call_input_data;
        } else {
          return res.status(400).json({ error: 'Invalid input type' });
        }
      }
    }
    
    // Validate required fields
    if (!project_title || !agency_name || !call_input_type || !rawTextContent) {
      console.error("Missing required fields:", { 
        project_title, 
        agency_name, 
        call_input_type,
        rawTextContentLength: rawTextContent ? rawTextContent.length : 0 
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          project_title: !project_title ? 'Missing project title' : undefined,
          agency_name: !agency_name ? 'Missing agency name' : undefined,
          call_input_type: !call_input_type ? 'Missing input type' : undefined,
          rawTextContent: !rawTextContent ? 'Missing content' : undefined
        }
      });
    }
    
    // Process with the selected LLM
    // Set initial status to pending
    const callId = await prisma.reviewerCall.create({
      data: {
        user_id: session.user.id,
        project_title: project_title,
        agency_name: agency_name,
        call_input_type: call_input_type as any,
        call_input_data: call_input_data,
        parsed_json: existingParsedJson || {}, // Use existing parsed JSON if available
        raw_text_backup: rawTextContent,
        review_status: existingParsedJson ? 'parsed' : 'pending' as any, // Mark as parsed if we're reusing data
      },
      select: {
        id: true
      }
    });
     
    // Get the inserted ID from query result
    const callIdValue = callId.id;
     
    // Send initial response with the call ID
    res.status(200).json({ 
      call_id: callIdValue, 
      status: existingParsedJson ? 'completed' : 'processing',
      cached: existingParsedJson ? true : false 
    });
     
    // Process in background only if we don't have existing results
    if (!existingParsedJson) {
      (async () => {
        try {
          // Process with LLM
          const parsedJson = await processWithLLM(rawTextContent, LLMModel as any);
           
          // Update the database entry with processed data
          await prisma.reviewerCall.update({
            where: {
              id: callIdValue
            },
            data: {
              parsed_json: parsedJson,
              review_status: 'parsed' as any,
            }
          });
        } catch (error) {
          console.error('Error in background processing:', error);
           
          // Update the database to indicate failure
          await prisma.reviewerCall.update({
            where: {
              id: callIdValue
            },
            data: {
              review_status: 'failed' as any,
            }
          });
        }
      })();
    }
    
  } catch (error) {
    console.error('Error analyzing funding call:', error);
    res.status(500).json({ error: 'Failed to analyze funding call' });
  }
} 
