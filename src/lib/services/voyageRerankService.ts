import axios from 'axios';

export interface VoyageRerankResult {
  index: number;
  relevanceScore: number;
}

const VOYAGE_RERANK_TIMEOUT_MS = Number(process.env.VOYAGE_RERANK_TIMEOUT_MS || 20000);

export class VoyageRerankService {
  private apiKey: string;
  private apiUrl: string;
  private modelName: string;

  constructor() {
    this.apiKey = process.env.VOYAGE_API_KEY || '';
    this.apiUrl = process.env.VOYAGE_RERANK_API_URL || 'https://api.voyageai.com/v1/rerank';
    this.modelName = process.env.VOYAGE_RERANK_MODEL || 'rerank-2.5-lite';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.modelName);
  }

  getModelName() {
    return this.modelName;
  }

  async rerank(input: {
    query: string;
    documents: string[];
    topK?: number;
  }): Promise<VoyageRerankResult[]> {
    if (!this.isConfigured() || input.documents.length === 0 || !input.query.trim()) {
      return [];
    }

    const response = await axios.post(
      this.apiUrl,
      {
        query: input.query,
        documents: input.documents,
        model: this.modelName,
        top_k: input.topK || input.documents.length,
        return_documents: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: VOYAGE_RERANK_TIMEOUT_MS,
      }
    );

    const rows = Array.isArray(response.data?.data)
      ? response.data.data
      : Array.isArray(response.data?.results)
        ? response.data.results
        : [];

    return rows
      .map((row: any) => ({
        index: Number(row.index),
        relevanceScore: Number(row.relevance_score ?? row.relevanceScore ?? row.score ?? 0),
      }))
      .filter((row: VoyageRerankResult) => Number.isInteger(row.index) && row.index >= 0);
  }
}

export const voyageRerankService = new VoyageRerankService();
