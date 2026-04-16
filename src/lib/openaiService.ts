// Handle missing openai dependency gracefully
let OpenAI: any;
try {
  // Dynamic import to prevent build errors
  OpenAI = require('openai').default;
} catch (error) {
  console.warn('OpenAI SDK not installed. Install with: npm install openai');
}

// Initialize OpenAI client
const openai = OpenAI ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

export async function generateFromOpenAI(prompt: string, model: string = 'gpt-3.5-turbo', systemPrompt: string = 'You are an expert grant writer assistant, tasked with creating cohesive problem statements for grant applications.') {
  try {
    // Check if OpenAI SDK is available
    if (!openai) {
      throw new Error('OpenAI SDK not installed. Install with: npm install openai');
    }

    // Check if this is a JSON request (by looking for JSON keywords in the prompt)
    const isJsonRequest = prompt.toLowerCase().includes('json') || 
                         prompt.toLowerCase().includes('format') ||
                         prompt.includes('{') || 
                         prompt.includes('}');
    
    const requestOptions: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };
    
    // Only add response_format for compatible models and when JSON is expected
    if (isJsonRequest && 
        (model.includes('gpt-4') || model.includes('gpt-3.5-turbo') || model.includes('gpt-4-turbo'))) {
      console.log(`Using JSON response format for model: ${model}`);
      requestOptions.response_format = { type: 'json_object' };
    }
    
    const response = await openai.chat.completions.create(requestOptions);
    
    return response.choices[0].message.content || '';
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
} 