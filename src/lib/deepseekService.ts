let OpenAI: any;
try {
  OpenAI = require('openai').default || require('openai');
} catch (error) {
  console.warn('OpenAI-compatible SDK not installed. Install with: npm install openai');
}

function getDeepSeekClient() {
  if (!OpenAI) {
    throw new Error('OpenAI-compatible SDK is required for DeepSeek calls');
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required for DeepSeek extraction');
  }

  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  });
}

export async function generateJsonFromDeepSeek(options: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ model: string; rawText: string }> {
  const model = options.model || 'deepseek-v4-pro';
  const client = getDeepSeekClient();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: options.systemPrompt || 'Return strict JSON only.',
      },
      {
        role: 'user',
        content: options.prompt,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: options.maxTokens || 12000,
    temperature: options.temperature ?? 0,
  });

  const rawText = response.choices?.[0]?.message?.content || '';
  if (!rawText.trim()) {
    throw new Error('DeepSeek returned an empty response');
  }

  return { model, rawText };
}

export async function generateFromDeepSeek(options: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ model: string; rawText: string }> {
  const model = options.model || 'deepseek-v4-pro';
  const client = getDeepSeekClient();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: options.systemPrompt || 'You are a precise extraction assistant.',
      },
      {
        role: 'user',
        content: options.prompt,
      },
    ],
    max_tokens: options.maxTokens || 12000,
    temperature: options.temperature ?? 0,
  });

  const rawText = response.choices?.[0]?.message?.content || '';
  if (!rawText.trim()) {
    throw new Error('DeepSeek returned an empty response');
  }

  return { model, rawText };
}
