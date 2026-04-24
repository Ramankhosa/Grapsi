import { afterEach, describe, expect, it, vi } from 'vitest';

type MockCall = {
  model: string;
  attempt: number;
};

type MockBehavior = (call: MockCall) => Promise<Response>;

function buildSuccessResponse(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function buildRateLimitResponse() {
  return new Response(
    JSON.stringify({
      error: {
        message: 'Resource exhausted',
      },
    }),
    {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '1',
      },
    }
  );
}

async function loadGeminiService(behavior: MockBehavior) {
  vi.resetModules();

  process.env.GOOGLE_AI_API_KEY = 'test-google-api-key-12345';
  process.env.GEMINI_RETRY_MAX_ATTEMPTS = '2';
  process.env.GEMINI_RETRY_BASE_DELAY_MS = '1';
  process.env.GEMINI_RETRY_MAX_DELAY_MS = '1';

  const calls: MockCall[] = [];

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const modelMatch = url.match(/models\/([^:]+):generateContent/);
    const model = modelMatch ? decodeURIComponent(modelMatch[1]) : 'unknown-model';
    const attempt = calls.filter((call) => call.model === model).length + 1;
    const call = { model, attempt };
    calls.push(call);
    return behavior(call);
  }));

  const geminiModule = await import('@/lib/geminiService');
  return { generateFromGemini: geminiModule.generateFromGemini, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();

  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GEMINI_RETRY_MAX_ATTEMPTS;
  delete process.env.GEMINI_RETRY_BASE_DELAY_MS;
  delete process.env.GEMINI_RETRY_MAX_DELAY_MS;
});

describe('generateFromGemini', () => {
  it('retries a rate-limited primary model before succeeding', async () => {
    const { generateFromGemini, calls } = await loadGeminiService(async ({ model, attempt }) => {
      if (model === 'gemini-2.0-flash' && attempt === 1) {
        return buildRateLimitResponse();
      }

      return buildSuccessResponse(`ok:${model}:${attempt}`);
    });

    await expect(generateFromGemini('test prompt', 'gemini-2.0-flash')).resolves.toBe('ok:gemini-2.0-flash:2');
    expect(calls.map((call) => `${call.model}:${call.attempt}`)).toEqual([
      'gemini-2.0-flash:1',
      'gemini-2.0-flash:2',
    ]);
  });

  it('falls back to the secondary model after exhausting primary retries', async () => {
    const { generateFromGemini, calls } = await loadGeminiService(async ({ model }) => {
      if (model === 'gemini-2.5-pro') {
        return buildRateLimitResponse();
      }

      return buildSuccessResponse('fallback-ok');
    });

    await expect(generateFromGemini('test prompt', 'gemini-2.5-pro')).resolves.toBe('fallback-ok');
    expect(calls.map((call) => `${call.model}:${call.attempt}`)).toEqual([
      'gemini-2.5-pro:1',
      'gemini-2.5-pro:2',
      'gemini-2.0-flash:1',
    ]);
  });

  it('throws a GeminiRateLimitError after all candidate models are rate limited', async () => {
    const { generateFromGemini } = await loadGeminiService(async () => {
      return buildRateLimitResponse();
    });

    await expect(generateFromGemini('test prompt', 'gemini-2.5-pro')).rejects.toMatchObject({
      name: 'GeminiRateLimitError',
      code: 'GEMINI_RATE_LIMITED',
    });
  });
});
