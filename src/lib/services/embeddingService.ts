import axios from 'axios';

interface EmbeddingResponse {
  embedding: number[];
  error?: string;
}

/**
 * Service to generate vector embeddings for text using Google's Embeddings API or alternatives
 */
export class EmbeddingService {
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
          }
        }
      );
      
      // Extract embedding from response
      const embedding = response.data?.embedding?.values || [];
      
      return { embedding };
    } catch (error) {
      console.error('Error generating embedding:', error);
      return { 
        embedding: [], 
        error: error instanceof Error ? error.message : String(error)
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
