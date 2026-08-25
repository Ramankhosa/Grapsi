import type { ZodTypeAny } from 'zod';

// Handle missing openai dependency gracefully
let OpenAI: any;
let zodTextFormat: any;
try {
  // Dynamic import to prevent build errors
  OpenAI = require('openai').default;
  zodTextFormat = require('openai/helpers/zod').zodTextFormat;
} catch (error) {
  console.warn('OpenAI SDK not installed. Install with: npm install openai');
}

// Initialize OpenAI client. Guarded: the SDK throws when constructed without
// an API key, and a missing key must surface as a failed call, not a crashed
// module import.
let openai: any = null;
try {
  if (OpenAI && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (initError: any) {
  console.warn('OpenAI client not initialized:', initError?.message);
}

/**
 * The OpenAI model used wherever the reviewer falls back to a direct OpenAI
 * call (gateway unavailable or misconfigured). Historically this was a
 * hardcoded 'gpt-4-turbo' at every call site — the most expensive model in the
 * catalogue, and one whose request shape breaks reasoning models entirely.
 */
export const DEFAULT_OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.2';

/** Reasoning models reject `max_tokens` and non-default sampling params. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

/**
 * Chat-completions request body for one prompt/system pair, shaped per model
 * family: reasoning models get `max_completion_tokens` and no sampling
 * parameters (they reject both `max_tokens` and non-default `temperature`),
 * legacy models keep the shape this service has always sent.
 */
export function buildOpenAIChatRequest(
  model: string,
  prompt: string,
  systemPrompt: string,
  options?: { maxOutputTokens?: number }
): Record<string, any> {
  const request: Record<string, any> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
  };

  if (isReasoningModel(model)) {
    request.max_completion_tokens = options?.maxOutputTokens || 4000;
  } else {
    request.max_tokens = options?.maxOutputTokens || 1500;
    request.temperature = 0.7;
    request.top_p = 1;
    request.frequency_penalty = 0;
    request.presence_penalty = 0;
  }

  // Check if this is a JSON request (by looking for JSON keywords in the prompt)
  const isJsonRequest = prompt.toLowerCase().includes('json') ||
                       prompt.toLowerCase().includes('format') ||
                       prompt.includes('{') ||
                       prompt.includes('}');

  if (isJsonRequest &&
      (model.startsWith('gpt-5') || model.includes('gpt-4') || model.includes('gpt-3.5-turbo'))) {
    request.response_format = { type: 'json_object' };
  }

  return request;
}

function isRetryableOpenAIError(error: any): boolean {
  const status = Number(error?.status ?? error?.response?.status);
  return status === 429 || (status >= 500 && status < 600);
}

export async function generateFromOpenAI(
  prompt: string,
  model: string = 'gpt-3.5-turbo',
  systemPrompt: string = 'You are an expert grant writer assistant, tasked with creating cohesive problem statements for grant applications.',
  options?: { maxOutputTokens?: number }
) {
  // Check if OpenAI SDK is available
  if (!openai) {
    throw new Error('OpenAI client unavailable: install the openai package and set OPENAI_API_KEY');
  }

  const requestOptions = buildOpenAIChatRequest(model, prompt, systemPrompt, options);

  const maxAttempts = 2;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await openai.chat.completions.create(requestOptions);
      return response.choices[0].message.content || '';
    } catch (error) {
      if (attempt < maxAttempts && isRetryableOpenAIError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      console.error('OpenAI API error:', error);
      throw error;
    }
  }
}

export async function parseStructuredFromOpenAI<T>(options: {
  prompt: string;
  model: string;
  systemPrompt: string;
  schema: ZodTypeAny;
  schemaName: string;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<{ parsed: T; responseId: string | null }> {
  try {
    if (!openai) {
      throw new Error('OpenAI SDK not installed. Install with: npm install openai');
    }

    if (!zodTextFormat) {
      throw new Error('OpenAI structured output helpers are not available');
    }

    const response = await openai.responses.parse({
      model: options.model,
      input: [
        { role: 'developer', content: options.systemPrompt },
        { role: 'user', content: options.prompt },
      ],
      text: {
        format: zodTextFormat(options.schema, options.schemaName),
      },
      max_output_tokens: options.maxOutputTokens || 4000,
      temperature: options.temperature ?? 0,
    });

    if (!response.output_parsed) {
      throw new Error(`OpenAI response ${response.id || 'unknown'} did not return parsed structured output`);
    }

    return {
      parsed: response.output_parsed as T,
      responseId: response.id || null,
    };
  } catch (error) {
    console.error('OpenAI structured API error:', error);
    throw error;
  }
}
