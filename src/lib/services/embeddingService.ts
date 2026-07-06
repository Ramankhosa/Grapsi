import axios from 'axios';
import {
  estimateTokensFromText,
  recordStandaloneLLMUsage,
} from '@/lib/metering/llm-usage';
import { getBooleanRuntimeSetting } from '@/lib/runtime-settings';

interface EmbeddingResponse {
  embedding: number[];
  error?: string;
  modelName?: string;
  outputDimensionality?: number;
  provider?: EmbeddingProvider;
}

export interface EmbeddingUsageContext {
  tenantId?: string | null;
  userId?: string | null;
  taskCode?: string | null;
  stageCode?: string | null;
  operation?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EmbeddingServiceHealth {
  provider: EmbeddingProvider;
  configured: boolean;
  circuitOpen: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  modelName: string;
  outputDimensionality: number;
}

export type EmbeddingTaskType =
  | 'TASK_TYPE_UNSPECIFIED'
  | 'RETRIEVAL_QUERY'
  | 'RETRIEVAL_DOCUMENT'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING';

export interface EmbeddingGenerationOptions {
  taskType?: EmbeddingTaskType;
  title?: string | null;
  modelName?: string;
  outputDimensionality?: number;
  inputType?: 'query' | 'document' | null;
}

type EmbeddingCircuitState = {
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: number | null;
  openUntil: number | null;
};

const EMBEDDING_FAILURE_THRESHOLD = Number(process.env.EMBEDDING_FAILURE_THRESHOLD || 3);
const EMBEDDING_COOLDOWN_MS = Number(process.env.EMBEDDING_COOLDOWN_MS || 120000);
const EMBEDDING_REQUEST_TIMEOUT_MS = Number(process.env.EMBEDDING_REQUEST_TIMEOUT_MS || 20000);
const EMBEDDING_MIN_INTERVAL_MS = Math.max(0, Number(process.env.EMBEDDING_MIN_INTERVAL_MS || 0));
const EMBEDDING_BATCH_CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.EMBEDDING_BATCH_CONCURRENCY || 1), 10)
);

type EmbeddingProvider = 'google' | 'voyage';

export const STORED_EMBEDDING_JOBS_SETTING_KEY = 'stored_embedding_jobs_enabled';

export async function getStoredEmbeddingJobsControl() {
  const fallback = process.env.STORED_EMBEDDING_JOBS_ENABLED !== 'false';
  const setting = await getBooleanRuntimeSetting(STORED_EMBEDDING_JOBS_SETTING_KEY, fallback);
  const hardDisabled =
    process.env.BACKGROUND_EMBEDDINGS_ENABLED === 'false' ||
    process.env.EMBEDDING_INDEXING_ENABLED === 'false';

  return {
    ...setting,
    enabled: setting.enabled && !hardDisabled,
    hardDisabled,
  };
}

export async function areStoredEmbeddingJobsEnabled() {
  const control = await getStoredEmbeddingJobsControl();
  return control.enabled;
}

/**
 * Service to generate vector embeddings for text using Google's Embeddings API or alternatives
 */
export class EmbeddingService {
  private static circuitState: EmbeddingCircuitState = {
    consecutiveFailures: 0,
    lastError: null,
    lastFailureAt: null,
    openUntil: null,
  };
  private static throttleQueue: Promise<void> = Promise.resolve();
  private static lastRequestStartedAt = 0;

  private apiKey: string;
  private apiUrl: string;
  private modelName: string;
  private outputDimensionality: number;
  private provider: EmbeddingProvider;
  private voyageApiKey: string;
  private voyageApiUrl: string;
  private voyageDocumentModel: string;
  private voyageQueryModel: string;
  private voyageDefaultModel: string;
  
  constructor() {
    this.provider = normalizeEmbeddingProvider(process.env.EMBEDDING_PROVIDER);

    // Google embeddings configuration.
    this.apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    this.apiUrl = process.env.GOOGLE_EMBEDDINGS_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
    this.modelName = process.env.GOOGLE_EMBEDDINGS_MODEL || 'gemini-embedding-001';
    this.outputDimensionality = Number(
      this.provider === 'voyage'
        ? process.env.VOYAGE_OUTPUT_DIMENSIONS || 1024
        : process.env.GOOGLE_EMBEDDINGS_DIMENSIONS || 768
    );

    // Voyage embeddings configuration. Voyage 4 models share an embedding space,
    // so high-quality document vectors and lightweight query vectors can be compared.
    this.voyageApiKey = process.env.VOYAGE_API_KEY || '';
    this.voyageApiUrl = process.env.VOYAGE_EMBEDDINGS_API_URL || 'https://api.voyageai.com/v1/embeddings';
    this.voyageDocumentModel = process.env.VOYAGE_DOCUMENT_MODEL || 'voyage-4-large';
    this.voyageQueryModel = process.env.VOYAGE_QUERY_MODEL || process.env.VOYAGE_CHAT_QUERY_MODEL || 'voyage-4-lite';
    this.voyageDefaultModel = process.env.VOYAGE_DEFAULT_MODEL || this.voyageDocumentModel;
    
    if (this.provider === 'voyage' && !this.voyageApiKey) {
      console.warn('Voyage API key not found. Vector embeddings will not work.');
    } else if (this.provider === 'google' && !this.apiKey) {
      console.warn('Google API key not found. Vector embeddings will not work.');
    }
  }

  private isCircuitOpen() {
    const openUntil = EmbeddingService.circuitState.openUntil;
    if (!openUntil) {
      return false;
    }

    if (Date.now() >= openUntil) {
      EmbeddingService.circuitState.openUntil = null;
      return false;
    }

    return true;
  }

  private registerSuccess() {
    EmbeddingService.circuitState = {
      consecutiveFailures: 0,
      lastError: null,
      lastFailureAt: null,
      openUntil: null,
    };
  }

  private registerFailure(message: string) {
    const nextFailures = EmbeddingService.circuitState.consecutiveFailures + 1;
    const now = Date.now();

    EmbeddingService.circuitState = {
      consecutiveFailures: nextFailures,
      lastError: message,
      lastFailureAt: now,
      openUntil: nextFailures >= EMBEDDING_FAILURE_THRESHOLD ? now + EMBEDDING_COOLDOWN_MS : null,
    };
  }

  private isGenerationDisabled() {
    return process.env.EMBEDDING_GENERATION_ENABLED === 'false';
  }

  private async waitForThrottleSlot() {
    if (EMBEDDING_MIN_INTERVAL_MS <= 0) {
      return;
    }

    const previous = EmbeddingService.throttleQueue;
    let releaseCurrent: () => void = () => {};
    EmbeddingService.throttleQueue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;

    const elapsed = Date.now() - EmbeddingService.lastRequestStartedAt;
    const delay = Math.max(0, EMBEDDING_MIN_INTERVAL_MS - elapsed);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    EmbeddingService.lastRequestStartedAt = Date.now();
    releaseCurrent();
  }

  getHealth(options: EmbeddingGenerationOptions = {}): EmbeddingServiceHealth {
    const state = EmbeddingService.circuitState;
    const modelName = this.resolveModelName(options);
    return {
      provider: this.provider,
      configured: !this.isGenerationDisabled() && (this.provider === 'voyage' ? Boolean(this.voyageApiKey) : Boolean(this.apiKey)),
      circuitOpen: this.isCircuitOpen(),
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
      nextRetryAt: state.openUntil ? new Date(state.openUntil).toISOString() : null,
      modelName,
      outputDimensionality: options.outputDimensionality || this.outputDimensionality,
    };
  }

  private resolveModelName(options: EmbeddingGenerationOptions = {}) {
    if (options.modelName) {
      return options.modelName;
    }

    if (this.provider === 'voyage') {
      const inputType = resolveVoyageInputType(options);
      if (inputType === 'query') {
        return process.env.VOYAGE_CHAT_QUERY_MODEL || this.voyageQueryModel;
      }
      if (inputType === 'document') {
        return this.voyageDocumentModel;
      }
      return this.voyageDefaultModel;
    }

    return this.modelName;
  }
  
  /**
   * Generate embeddings for the provided text
   * 
   * @param text - The text to generate embeddings for
   * @returns A promise resolving to the embedding vector
   */
  async generateEmbedding(
    text: string,
    usageContext?: EmbeddingUsageContext,
    options: EmbeddingGenerationOptions = {}
  ): Promise<EmbeddingResponse> {
    if (this.isGenerationDisabled()) {
      return {
        embedding: [],
        error: 'Embedding generation is disabled by EMBEDDING_GENERATION_ENABLED=false',
      };
    }

    if (this.provider === 'voyage') {
      return this.generateVoyageEmbedding(text, usageContext, options);
    }

    if (!this.apiKey) {
      return { 
        embedding: [], 
        error: 'API key not configured' 
      };
    }

    if (this.isCircuitOpen()) {
      return {
        embedding: [],
        error: 'Embedding provider circuit is temporarily open',
      };
    }
    
    const modelName = this.resolveModelName(options);
    const outputDimensionality = options.outputDimensionality || this.outputDimensionality;
    const taskType = options.taskType || 'TASK_TYPE_UNSPECIFIED';
    const title = taskType === 'RETRIEVAL_DOCUMENT' ? normalizeTitle(options.title) : '';

    try {
      await this.waitForThrottleSlot();
      const response = await axios.post(
        `${this.apiUrl}/${modelName}:embedContent`,
        {
          content: {
            parts: [{ text }],
          },
          ...(taskType !== 'TASK_TYPE_UNSPECIFIED' ? { taskType } : {}),
          ...(title ? { title } : {}),
          outputDimensionality,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
        }
      );
      
      // Extract embedding from response
      const embedding = response.data?.embedding?.values || [];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        const message = 'Embedding provider returned an empty embedding';
        this.registerFailure(message);
        return {
          embedding: [],
          error: message,
        };
      }

      this.registerSuccess();

      if (usageContext?.tenantId) {
        await recordStandaloneLLMUsage({
          tenantId: usageContext.tenantId,
          userId: usageContext.userId || undefined,
          featureCode: 'FUNDING_DISCOVERY',
          taskCode: usageContext.taskCode || 'FUNDING_CHAT',
          operation: usageContext.operation || 'embedding',
          stageCode: usageContext.stageCode || 'EMBEDDING',
          modelClass: modelName,
          inputTokens: estimateTokensFromText(text),
          outputTokens: 0,
          thoughtTokens: 0,
          metadata: {
            module: 'funding',
            action: usageContext.operation || 'embedding',
            embeddingTaskType: taskType,
            outputDimensionality,
            textLength: text.length,
            ...usageContext.metadata,
          },
        });
      }
      
      return { embedding, modelName, outputDimensionality, provider: this.provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.registerFailure(message);
      console.error('Error generating embedding:', error);
      return { 
        embedding: [], 
        error: message
      };
    }
  }

  private async generateVoyageEmbedding(
    text: string,
    usageContext?: EmbeddingUsageContext,
    options: EmbeddingGenerationOptions = {}
  ): Promise<EmbeddingResponse> {
    if (!this.voyageApiKey) {
      return {
        embedding: [],
        error: 'Voyage API key not configured',
        provider: 'voyage',
      };
    }

    if (this.isCircuitOpen()) {
      return {
        embedding: [],
        error: 'Embedding provider circuit is temporarily open',
        provider: 'voyage',
      };
    }

    const modelName = this.resolveModelName(options);
    const outputDimensionality = options.outputDimensionality || this.outputDimensionality;
    const inputType = resolveVoyageInputType(options);

    try {
      await this.waitForThrottleSlot();
      const response = await axios.post(
        this.voyageApiUrl,
        {
          input: text,
          model: modelName,
          ...(inputType ? { input_type: inputType } : {}),
          output_dimension: outputDimensionality,
          output_dtype: 'float',
          truncation: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.voyageApiKey}`,
          },
          timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
        }
      );

      const embedding =
        response.data?.data?.[0]?.embedding ||
        response.data?.embeddings?.[0] ||
        response.data?.embedding ||
        [];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        const message = 'Voyage embedding provider returned an empty embedding';
        this.registerFailure(message);
        return { embedding: [], error: message, provider: 'voyage' };
      }

      this.registerSuccess();

      if (usageContext?.tenantId) {
        await recordStandaloneLLMUsage({
          tenantId: usageContext.tenantId,
          userId: usageContext.userId || undefined,
          featureCode: 'FUNDING_DISCOVERY',
          taskCode: usageContext.taskCode || 'FUNDING_CHAT',
          operation: usageContext.operation || 'embedding',
          stageCode: usageContext.stageCode || 'EMBEDDING',
          modelClass: modelName,
          inputTokens: estimateTokensFromText(text),
          outputTokens: 0,
          thoughtTokens: 0,
          metadata: {
            module: 'funding',
            action: usageContext.operation || 'embedding',
            embeddingProvider: 'voyage',
            embeddingInputType: inputType,
            outputDimensionality,
            textLength: text.length,
            ...usageContext.metadata,
          },
        });
      }

      return { embedding, modelName, outputDimensionality, provider: 'voyage' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.registerFailure(message);
      console.error('Error generating Voyage embedding:', message);
      return {
        embedding: [],
        error: message,
        provider: 'voyage',
      };
    }
  }
  
  /**
   * Generate embeddings for a batch of texts (for efficiency)
   * 
   * @param texts - Array of texts to generate embeddings for
   * @returns A promise resolving to an array of embedding vectors
   */
  async generateBatchEmbeddings(
    texts: string[],
    usageContext?: EmbeddingUsageContext,
    options: EmbeddingGenerationOptions = {}
  ): Promise<EmbeddingResponse[]> {
    const results: EmbeddingResponse[] = new Array(texts.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(EMBEDDING_BATCH_CONCURRENCY, texts.length) }, async () => {
      while (cursor < texts.length) {
        const index = cursor++;
        results[index] = await this.generateEmbedding(texts[index], usageContext, options);
      }
    });

    await Promise.all(workers);
    return results;
  }
  
  /**
   * Generate concatenated embeddings for multiple fields
   * 
   * @param fields - Object containing different text fields to embed
   * @returns A promise resolving to the combined embedding
   */
  async generateFieldEmbeddings(
    fields: Record<string, string | string[]>,
    usageContext?: EmbeddingUsageContext,
    options: EmbeddingGenerationOptions = {}
  ): Promise<EmbeddingResponse> {
    // Concatenate fields into a single text with field markers
    let combinedText = '';
    
    for (const [field, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        combinedText += `${field}: ${value.join(', ')}\n`;
      } else if (value) {
        combinedText += `${field}: ${value}\n`;
      }
    }
    
    return this.generateEmbedding(combinedText, usageContext, options);
  }
} 

function normalizeTitle(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 256);
}

function normalizeEmbeddingProvider(value: string | undefined): EmbeddingProvider {
  return String(value || '').trim().toLowerCase() === 'voyage' ? 'voyage' : 'google';
}

function resolveVoyageInputType(options: EmbeddingGenerationOptions): 'query' | 'document' | null {
  if (options.inputType === 'query' || options.inputType === 'document') {
    return options.inputType;
  }
  if (options.taskType === 'RETRIEVAL_QUERY') {
    return 'query';
  }
  if (options.taskType === 'RETRIEVAL_DOCUMENT') {
    return 'document';
  }
  return null;
}
