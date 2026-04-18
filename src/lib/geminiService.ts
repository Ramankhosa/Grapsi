const globalForGeminiEnv = globalThis as typeof globalThis & {
  __grapsiGeminiDotenvLoaded?: boolean;
};

if (!globalForGeminiEnv.__grapsiGeminiDotenvLoaded) {
  require('dotenv').config({ quiet: true });
  globalForGeminiEnv.__grapsiGeminiDotenvLoaded = true;
}

const GEMINI_DEBUG = process.env.DEBUG_GEMINI === 'true';

function debugGemini(...args: any[]) {
  if (GEMINI_DEBUG) {
    console.log(...args);
  }
}

let GoogleGenerativeAI: any;
try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch (_error) {
  console.warn('Google Generative AI SDK not installed. Install with: npm install @google/generative-ai');
}

const apiKey = process.env.GOOGLE_AI_API_KEY || '';

let genAI: any = null;
try {
  if (GoogleGenerativeAI && apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
  } else {
    debugGemini('Gemini client not initialized at module load', {
      hasApiKey: Boolean(apiKey),
      hasSdk: Boolean(GoogleGenerativeAI),
    });
  }
} catch (initError: any) {
  console.error('Error initializing Gemini client:', initError?.message);
}

const getGeminiModelName = (modelName: string): string => {
  const modelMapping: Record<string, string> = {
    'gemini-pro': 'gemini-pro',
    'gemini-pro-vision': 'gemini-pro-vision',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    'gemini-1.5-flash-lite': 'gemini-1.5-flash-lite',
    'gemini-2.0-pro': 'gemini-2.0-pro',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro-preview': 'gemini-2.5-pro-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
    'gemini-3-flash-preview': 'gemini-3-flash-preview',
  };

  if (modelName in modelMapping) {
    return modelMapping[modelName];
  }

  debugGemini(`Model ${modelName} not found in mapping, defaulting to gemini-2.5-pro`);
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

export async function generateFromGemini(prompt: string, model: string = 'gemini-2.0-flash') {
  debugGemini('generateFromGemini called', { model, promptLength: prompt.length });

  try {
    if (!genAI) {
      debugGemini('Attempting to initialize Gemini client again');
      require('dotenv').config({ quiet: true });
      const freshApiKey = process.env.GOOGLE_AI_API_KEY || '';

      if (freshApiKey && GoogleGenerativeAI) {
        debugGemini('Creating fresh Gemini client');
        genAI = new GoogleGenerativeAI(freshApiKey);
      }

      if (!genAI) {
        throw new Error('Google Generative AI SDK initialization failed. Check API key and dependencies.');
      }
    }

    if (!apiKey || apiKey.length < 10) {
      throw new Error('Invalid Google API key. Please check your environment variables.');
    }

    const geminiModelName = getGeminiModelName(model);
    debugGemini('Using Gemini model', geminiModelName);

    try {
      const geminiModel = genAI.getGenerativeModel({ model: geminiModelName });
      debugGemini('Gemini model instance created');

      const result = await geminiModel.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();

      debugGemini('Gemini response received', { responseLength: responseText.length });
      return responseText;
    } catch (error) {
      debugGemini(`Error with model ${model}`, error);
      const fallbackModelName = getGeminiFallbackModel(model);
      debugGemini('Falling back to model', fallbackModelName);

      const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelName });
      const fallbackResult = await fallbackModel.generateContent(prompt);
      const fallbackResponse = fallbackResult.response;
      const responseText = fallbackResponse.text();

      debugGemini('Fallback response received', { responseLength: responseText.length });
      return responseText;
    }
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

export async function generateFromGeminiWithFiles(
  textParts: string[],
  fileParts: { google_file_id: string; displayName?: string }[],
  model: string = 'gemini-2.5-pro'
) {
  try {
    if (!genAI) {
      throw new Error('Gemini client not initialized');
    }

    const geminiModelName = getGeminiModelName(model);
    const geminiModel = genAI.getGenerativeModel({ model: geminiModelName });
    const parts: any[] = [];

    for (const textPart of textParts) {
      parts.push({ text: textPart });
    }

    for (const filePart of fileParts) {
      parts.push({ fileData: { fileUri: filePart.google_file_id, mimeType: undefined } });
    }

    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts }],
    });

    return result.response.text();
  } catch (error) {
    console.error('Gemini with files error', error);
    throw error;
  }
}
