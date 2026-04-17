import axios from 'axios';

interface EmbeddingResponse {
  embedding: number[];
  error?: string;
}

export interface EmbeddingServiceHealth {
  configured: boolean;
  circuitOpen: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  modelName: string;
  outputDimensionality: number;
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

  private apiKey: string;
  private apiUrl: string;
  private modelName: string;
  private outputDimensionality: number;
  
  constructor() {
    // Load from environment variables
    this.apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    this.apiUrl = process.env.GOOGLE_EMBEDDINGS_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
    this.modelName = process.env.GOOGLE_EMBEDDINGS_MODEL || 'gemini-embedding-001';
    this.outputDimensionality = Number(process.env.GOOGLE_EMBEDDINGS_DIMENSIONS || 768);
    
    if (!this.apiKey) {
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

  getHealth(): EmbeddingServiceHealth {
    const state = EmbeddingService.circuitState;
    return {
      configured: Boolean(this.apiKey),
      circuitOpen: this.isCircuitOpen(),
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
      nextRetryAt: state.openUntil ? new Date(state.openUntil).toISOString() : null,
      modelName: this.modelName,
      outputDimensionality: this.outputDimensionality,
    };
  }
  
  /**
   * Generate embeddings for the provided text
   * 
   * @param text - The text to generate embeddings for
   * @returns A promise resolving to the embedding vector
   */
  async generateEmbedding(text: string): Promise<EmbeddingResponse> {
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
    
    try {
      const response = await axios.post(
        `${this.apiUrl}/${this.modelName}:embedContent`,
        {
          content: {
            parts: [{ text }],
          },
          outputDimensionality: this.outputDimensionality,
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
      
      return { embedding };
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
  
  /**
   * Generate embeddings for a batch of texts (for efficiency)
   * 
   * @param texts - Array of texts to generate embeddings for
   * @returns A promise resolving to an array of embedding vectors
   */
  async generateBatchEmbeddings(texts: string[]): Promise<EmbeddingResponse[]> {
    return Promise.all(texts.map(text => this.generateEmbedding(text)));
  }
  
  /**
   * Generate concatenated embeddings for multiple fields
   * 
   * @param fields - Object containing different text fields to embed
   * @returns A promise resolving to the combined embedding
   */
  async generateFieldEmbeddings(fields: Record<string, string | string[]>): Promise<EmbeddingResponse> {
    // Concatenate fields into a single text with field markers
    let combinedText = '';
    
    for (const [field, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        combinedText += `${field}: ${value.join(', ')}\n`;
      } else if (value) {
        combinedText += `${field}: ${value}\n`;
      }
    }
    
    return this.generateEmbedding(combinedText);
  }
} 
