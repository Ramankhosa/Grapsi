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

const DEFAULT_GEMINI_RETRY_ATTEMPTS = 3;
const DEFAULT_GEMINI_RETRY_BASE_DELAY_MS = 1500;
const DEFAULT_GEMINI_RETRY_MAX_DELAY_MS = 15000;
const DEFAULT_GEMINI_RATE_LIMIT_COOLDOWN_MS = 60000;

let GoogleGenerativeAI: any;
try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch (_error) {
  console.warn('Google Generative AI SDK not installed. Install with: npm install @google/generative-ai');
}

function getGoogleApiKey(): string {
  return process.env.GOOGLE_AI_API_KEY || '';
}

let genAI: any = null;
try {
  const configuredApiKey = getGoogleApiKey();
  if (GoogleGenerativeAI && configuredApiKey) {
    genAI = new GoogleGenerativeAI(configuredApiKey);
  } else {
    debugGemini('Gemini client not initialized at module load', {
      hasApiKey: Boolean(configuredApiKey),
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

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getGeminiRetryAttempts(): number {
  return readPositiveInt(process.env.GEMINI_RETRY_MAX_ATTEMPTS, DEFAULT_GEMINI_RETRY_ATTEMPTS);
}

function getGeminiRetryBaseDelayMs(): number {
  return readPositiveInt(process.env.GEMINI_RETRY_BASE_DELAY_MS, DEFAULT_GEMINI_RETRY_BASE_DELAY_MS);
}

function getGeminiRetryMaxDelayMs(): number {
  return readPositiveInt(process.env.GEMINI_RETRY_MAX_DELAY_MS, DEFAULT_GEMINI_RETRY_MAX_DELAY_MS);
}

function getGeminiRateLimitCooldownMs(): number {
  return readPositiveInt(process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS, DEFAULT_GEMINI_RATE_LIMIT_COOLDOWN_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  return String(error || 'Unknown Gemini error');
}

function readErrorStatus(error: unknown): number | undefined {
  const directStatus = Number((error as any)?.status);
  if (Number.isFinite(directStatus) && directStatus >= 100) {
    return directStatus;
  }

  const message = readErrorMessage(error);
  const bracketedStatus = message.match(/\[(\d{3}) [^\]]+\]/);
  if (bracketedStatus) {
    return Number(bracketedStatus[1]);
  }

  const httpStatus = message.match(/\b(\d{3})\s+(Too Many Requests|Bad Request|Unauthorized|Forbidden|Not Found|Request Timeout|Conflict|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i);
  if (httpStatus) {
    return Number(httpStatus[1]);
  }

  return undefined;
}

function readHeaderValue(headers: unknown, headerName: string): string | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  if (typeof (headers as { get?: (name: string) => string | null }).get === 'function') {
    return (headers as { get: (name: string) => string | null }).get(headerName);
  }

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? String(value[0]) : null;
    }

    return value == null ? null : String(value);
  }

  return null;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return undefined;
}

function getRetryAfterMsFromError(error: unknown): number | undefined {
  const directRetryAfterMs = Number((error as any)?.retryAfterMs);
  if (Number.isFinite(directRetryAfterMs) && directRetryAfterMs >= 0) {
    return directRetryAfterMs;
  }

  const headerValue =
    readHeaderValue((error as any)?.headers, 'retry-after')
    || readHeaderValue((error as any)?.response?.headers, 'retry-after');

  return parseRetryAfterMs(headerValue);
}

function isGeminiRateLimitError(error: unknown): boolean {
  const status = readErrorStatus(error);
  if (status === 429) {
    return true;
  }

  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes('resource exhausted')
    || message.includes('too many requests')
    || message.includes('rate limit')
    || message.includes('quota exceeded')
  );
}

function isRetryableGeminiError(error: unknown): boolean {
  if (isGeminiRateLimitError(error)) {
    return true;
  }

  const status = readErrorStatus(error);
  if (status && [408, 409, 425, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes('fetch failed')
    || message.includes('network')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('socket hang up')
    || message.includes('temporarily unavailable')
  );
}

function shouldTryFallbackModel(error: unknown): boolean {
  if (isGeminiRateLimitError(error)) {
    return false;
  }

  const status = readErrorStatus(error);
  if (status === 401 || status === 403) {
    return false;
  }

  const message = readErrorMessage(error).toLowerCase();
  if (message.includes('api key') || message.includes('permission denied') || message.includes('access denied')) {
    return false;
  }

  return true;
}

function formatRetryDelayForHumans(ms: number | undefined): string {
  if (!ms || ms <= 0) {
    return 'Retry shortly.';
  }

  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `Retry after about ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

class GeminiRequestError extends Error {
  code: string;
  model: string;
  attempts: number;
  status?: number;

  constructor(message: string, options: { model: string; attempts: number; status?: number; cause?: unknown }) {
    super(message);
    this.name = 'GeminiRequestError';
    this.code = 'GEMINI_REQUEST_FAILED';
    this.model = options.model;
    this.attempts = options.attempts;
    this.status = options.status;
    (this as any).cause = options.cause;
  }
}

class GeminiRateLimitError extends Error {
  code: string;
  model: string;
  attempts: number;
  status: number;
  retryAfterMs?: number;

  constructor(message: string, options: { model: string; attempts: number; retryAfterMs?: number; cause?: unknown }) {
    super(message);
    this.name = 'GeminiRateLimitError';
    this.code = 'GEMINI_RATE_LIMITED';
    this.model = options.model;
    this.attempts = options.attempts;
    this.status = 429;
    this.retryAfterMs = options.retryAfterMs;
    (this as any).cause = options.cause;
  }
}

let geminiRateLimitCooldownUntilMs = 0;

export function isGeminiRateLimitErrorLike(error: unknown): boolean {
  return (
    error instanceof GeminiRateLimitError
    || (error as { code?: unknown })?.code === 'GEMINI_RATE_LIMITED'
    || isGeminiRateLimitError(error)
  );
}

export function getGeminiRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof GeminiRateLimitError && typeof error.retryAfterMs === 'number') {
    return error.retryAfterMs;
  }

  return getRetryAfterMsFromError(error);
}

function getGeminiCooldownRemainingMs(): number {
  return Math.max(0, geminiRateLimitCooldownUntilMs - Date.now());
}

function rememberGeminiRateLimit(error: unknown) {
  const retryAfterMs = getGeminiRetryAfterMs(error);
  const cooldownMs = retryAfterMs && retryAfterMs > 0
    ? retryAfterMs
    : getGeminiRateLimitCooldownMs();
  geminiRateLimitCooldownUntilMs = Math.max(geminiRateLimitCooldownUntilMs, Date.now() + cooldownMs);
}

function wrapGeminiError(error: unknown, modelName: string, attempts: number): Error {
  if (error instanceof GeminiRequestError || error instanceof GeminiRateLimitError) {
    return error;
  }

  const retryAfterMs = getRetryAfterMsFromError(error);
  const status = readErrorStatus(error);
  const originalMessage = readErrorMessage(error);

  if (isGeminiRateLimitError(error)) {
    return new GeminiRateLimitError(
      `Gemini rate limit reached for ${modelName} after ${attempts} attempt${attempts === 1 ? '' : 's'}. ${formatRetryDelayForHumans(retryAfterMs)}`,
      {
        model: modelName,
        attempts,
        retryAfterMs,
        cause: error,
      }
    );
  }

  return new GeminiRequestError(
    `Gemini request failed for ${modelName}${attempts > 1 ? ` after ${attempts} attempts` : ''}: ${originalMessage}`,
    {
      model: modelName,
      attempts,
      status,
      cause: error,
    }
  );
}

function computeRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = getRetryAfterMsFromError(error);
  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, getGeminiRetryMaxDelayMs());
  }

  const baseDelayMs = getGeminiRetryBaseDelayMs();
  const jitterMs = Math.floor(Math.random() * 250);
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1) + jitterMs, getGeminiRetryMaxDelayMs());
}

function ensureGeminiClient() {
  if (genAI) {
    return genAI;
  }

  debugGemini('Attempting to initialize Gemini client again');
  require('dotenv').config({ quiet: true });
  const freshApiKey = getGoogleApiKey();

  if (freshApiKey && GoogleGenerativeAI) {
    debugGemini('Creating fresh Gemini client');
    genAI = new GoogleGenerativeAI(freshApiKey);
  }

  if (!genAI) {
    throw new Error('Google Generative AI SDK initialization failed. Check API key and dependencies.');
  }

  return genAI;
}

async function runGeminiTextRequest(
  modelName: string,
  requestFactory: (geminiModel: any) => Promise<string>
): Promise<string> {
  const client = ensureGeminiClient();
  const maxAttempts = getGeminiRetryAttempts();
  let lastError: unknown = null;
  const cooldownRemainingMs = getGeminiCooldownRemainingMs();

  if (cooldownRemainingMs > 0) {
    throw new GeminiRateLimitError(
      `Gemini is temporarily cooling down after a rate limit. ${formatRetryDelayForHumans(cooldownRemainingMs)}`,
      {
        model: modelName,
        attempts: 0,
        retryAfterMs: cooldownRemainingMs,
      }
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const geminiModel = client.getGenerativeModel({ model: modelName });
      debugGemini('Gemini model instance created', { modelName, attempt });
      const responseText = await requestFactory(geminiModel);
      debugGemini('Gemini response received', { modelName, responseLength: responseText.length, attempt });
      return responseText;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableGeminiError(error);
      const status = readErrorStatus(error);

      debugGemini(`Error with Gemini model ${modelName}`, { attempt, status, error });

      if (isGeminiRateLimitError(error)) {
        rememberGeminiRateLimit(error);
        throw wrapGeminiError(error, modelName, attempt);
      }

      if (!retryable || attempt >= maxAttempts) {
        throw wrapGeminiError(error, modelName, attempt);
      }

      const delayMs = computeRetryDelayMs(error, attempt);
      console.warn(
        `[Gemini] ${modelName} attempt ${attempt}/${maxAttempts} failed${status ? ` (status ${status})` : ''}. Retrying in ${delayMs}ms.`
      );
      await sleep(delayMs);
    }
  }

  throw wrapGeminiError(lastError, modelName, maxAttempts);
}

export async function generateFromGemini(prompt: string, model: string = 'gemini-2.0-flash') {
  debugGemini('generateFromGemini called', { model, promptLength: prompt.length });

  try {
    const configuredApiKey = getGoogleApiKey();
    if (!configuredApiKey || configuredApiKey.length < 10) {
      throw new Error('Invalid Google API key. Please check your environment variables.');
    }

    ensureGeminiClient();
    const geminiModelName = getGeminiModelName(model);
    const fallbackModelName = getGeminiFallbackModel(model);
    const candidateModels = Array.from(new Set([geminiModelName, fallbackModelName]));
    let lastError: unknown = null;

    for (let index = 0; index < candidateModels.length; index++) {
      const candidateModel = candidateModels[index];
      debugGemini('Using Gemini model', candidateModel);

      try {
        return await runGeminiTextRequest(candidateModel, async (geminiModel) => {
          const result = await geminiModel.generateContent(prompt);
          return result.response.text();
        });
      } catch (error) {
        lastError = error;
        const isLastModel = index === candidateModels.length - 1;
        if (isLastModel || !shouldTryFallbackModel(error)) {
          throw error;
        }

        console.warn(
          `[Gemini] Primary model ${candidateModel} failed. Trying fallback model ${candidateModels[index + 1]}.`
        );
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Gemini text generation failed');
  } catch (error) {
    if (isGeminiRateLimitErrorLike(error)) {
      console.warn('Gemini API rate limited:', error instanceof Error ? error.message : String(error));
    } else {
      console.error('Gemini API error:', error);
    }
    throw error;
  }
}

export async function generateFromGeminiWithFiles(
  textParts: string[],
  fileParts: { google_file_id: string; displayName?: string }[],
  model: string = 'gemini-2.5-pro'
) {
  try {
    ensureGeminiClient();
    const geminiModelName = getGeminiModelName(model);
    const parts: any[] = [];

    for (const textPart of textParts) {
      parts.push({ text: textPart });
    }

    for (const filePart of fileParts) {
      parts.push({ fileData: { fileUri: filePart.google_file_id, mimeType: undefined } });
    }

    return await runGeminiTextRequest(geminiModelName, async (geminiModel) => {
      const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts }],
      });
      return result.response.text();
    });
  } catch (error) {
    console.error('Gemini with files error', error);
    throw error;
  }
}
