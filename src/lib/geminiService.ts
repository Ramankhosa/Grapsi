// Load environment variables first
require('dotenv').config();

// Handle missing @google/generative-ai dependency gracefully
let GoogleGenerativeAI: any;
try {
  // Dynamic import to prevent build errors
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
  console.log('✅ @google/generative-ai package loaded successfully');
} catch (error) {
  console.warn('❌ Google Generative AI SDK not installed. Install with: npm install @google/generative-ai');
}

// Initialize Google AI client
const apiKey = process.env.GOOGLE_AI_API_KEY || '';
console.log('GOOGLE_AI_API_KEY length:', apiKey.length, 'First 5 chars:', apiKey.substring(0, 5));

let genAI: any = null;
try {
  if (GoogleGenerativeAI && apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log('✅ genAI client initialized successfully');
  } else {
    console.error('❌ Cannot initialize genAI client. API Key available:', !!apiKey, 'GoogleGenerativeAI available:', !!GoogleGenerativeAI);
  }
} catch (initError: any) {
  console.error('❌ Error initializing Gemini client:', initError?.message);
}

// Model name mapping to ensure correct format for API
const getGeminiModelName = (modelName: string): string => {
  // Map requested model name to API-compatible model name
  const modelMapping: {[key: string]: string} = {
    // Standard models
    'gemini-pro': 'gemini-pro',
    'gemini-pro-vision': 'gemini-pro-vision',
    
    // Gemini 1.5 models
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash', 
    'gemini-1.5-flash-lite': 'gemini-1.5-flash-lite',
    
    // Gemini 2.0 models
    'gemini-2.0-pro': 'gemini-2.0-pro',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
    
    // Gemini 2.5 models
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    
    // Preview models
    'gemini-2.5-pro-preview': 'gemini-2.5-pro-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
  };
  
  // Check if model exists in our mapping
  if (modelName in modelMapping) {
    return modelMapping[modelName];
  }
  
  // Default to gemini-2.5-pro if not found
  console.log(`Model ${modelName} not found in mapping, defaulting to gemini-2.5-pro`);
  return 'gemini-2.5-pro';
};

const getGeminiFallbackModel = (modelName: string): string => {
  const requestedModel = getGeminiModelName(modelName);

  if (requestedModel === 'gemini-3.1-pro-preview') {
    return 'gemini-3-pro-preview';
  }

  if (requestedModel.startsWith('gemini-3')) {
    return 'gemini-2.5-pro';
  }

  return 'gemini-2.0-flash';
};

/**
 * Generate content using Gemini models
 * @param prompt The prompt to send to Gemini
 * @param model The model to use (defaults to gemini-2.0-flash)
 * @returns Generated text
 */
export async function generateFromGemini(prompt: string, model: string = 'gemini-2.0-flash') {
  console.log(`📝 generateFromGemini called with model: ${model}, prompt length: ${prompt.length}`);
  try {
    // Check if Gemini SDK is available
    if (!genAI) {
      // Attempt to initialize again with fresh environment variables
      console.log('Attempting to initialize genAI client again...');
      require('dotenv').config();
      const freshApiKey = process.env.GOOGLE_AI_API_KEY || '';
      console.log('GOOGLE_AI_API_KEY length (fresh):', freshApiKey.length);
      
      if (freshApiKey && GoogleGenerativeAI) {
        console.log('Creating fresh genAI client...');
        genAI = new GoogleGenerativeAI(freshApiKey);
      }
      
      if (!genAI) {
        console.error('❌ Google Generative AI SDK not available');
        throw new Error('Google Generative AI SDK initialization failed. Check API key and dependencies.');
      }
    }

    // Verify API key
    if (!apiKey || apiKey.length < 10) {
      console.error('❌ Invalid API key format:', apiKey ? `Length: ${apiKey.length}` : 'Not provided');
      throw new Error('Invalid Google API key. Please check your environment variables.');
    } else {
      console.log('✅ API key validation passed');
    }

    // Prepare prompt - API expects plain text
    let modifiedPrompt = prompt;
    
    // Attempt to get the model, handling different model types appropriately
    let geminiModelName: string;
    
    // Handle all model variants
    try {
      // Get mapped model name
      geminiModelName = getGeminiModelName(model);
      console.log(`🚀 Using Gemini model: ${geminiModelName}`);
      
      // Create model instance
      const geminiModel = genAI.getGenerativeModel({ model: geminiModelName });
      console.log('✅ Model instance created successfully');
      
      // Generate content
      console.log('⏳ Calling Gemini API...');
      const result = await geminiModel.generateContent(modifiedPrompt);
      console.log('✅ Gemini API call succeeded');
      const response = result.response;
      const responseText = response.text();
      console.log(`✅ Response received, length: ${responseText.length}`);
      return responseText;
    } catch (error) {
      console.warn(`❌ Error with model ${model}:`, error);
      const fallbackModelName = getGeminiFallbackModel(model);
      console.log(`Falling back to ${fallbackModelName}`);
      
      // Fall back to a stable model when the requested preview model is unavailable.
      const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelName });
      const fallbackResult = await fallbackModel.generateContent(modifiedPrompt);
      const fallbackResponse = fallbackResult.response;
      const responseText = fallbackResponse.text();
      console.log(`✅ Fallback response received, length: ${responseText.length}`);
      return responseText;
    }
  } catch (error) {
    console.error('❌❌❌ Gemini API error:', error);
    throw error;
  }
} 

/**
 * Generate from Gemini with optional file parts (Google file ids)
 */
export async function generateFromGeminiWithFiles(
  textParts: string[],
  fileParts: { google_file_id: string, displayName?: string }[],
  model: string = 'gemini-2.5-pro'
) {
  try {
    if (!genAI) throw new Error('Gemini client not initialized');
    const geminiModelName = getGeminiModelName(model);
    const geminiModel = genAI.getGenerativeModel({ model: geminiModelName });
    const parts: any[] = [];
    for (const t of textParts) parts.push({ text: t });
    for (const f of fileParts) parts.push({ fileData: { fileUri: f.google_file_id, mimeType: undefined } });
    const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts }] });
    return result.response.text();
  } catch (e) {
    console.error('Gemini with files error', e);
    throw e;
  }
}

