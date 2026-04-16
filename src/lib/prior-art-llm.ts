import { llmGateway } from './metering/gateway';

// LLM Prompt Specification - Ultra Concise for Gemini token limits
export const PRIOR_ART_LLM_PROMPT = `Generate patent search JSON from this brief. Output ONLY valid JSON.

BRIEF:
{invention_brief}

OUTPUT FORMAT:
{
  "source_summary": {"title": "brief title", "problem": "main problem", "solution": "key solution"},
  "core_concepts": ["concept1", "concept2"],
  "technical_features": ["feature1", "feature2"],
  "synonym_groups": [["term", "synonym1", "synonym2"]],
  "cpc_candidates": ["C01A", "G06F"],
  "ipc_candidates": ["G06F001/00", "H04L"],
  "exclude_terms": ["generic", "obvious"],
  "query_variants": [
    {"label": "broad", "q": "boolean query with synonyms", "notes": "strategy"},
    {"label": "baseline", "q": "boolean query with features", "notes": "strategy"},
    {"label": "narrow", "q": "boolean query core concepts", "notes": "strategy"}
  ]
}`;

export interface PriorArtLLMRequest {
  inventionBrief: string;
  jwtToken: string;
  patentId: string;
}

export interface PriorArtLLMResponse {
  success: boolean;
  bundle?: any;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    modelClass: string;
  };
}

export class PriorArtLLMService {
  static async generateBundle(request: PriorArtLLMRequest): Promise<PriorArtLLMResponse> {
    try {
      // Prepare LLM request
      const prompt = PRIOR_ART_LLM_PROMPT.replace('{invention_brief}', request.inventionBrief);

      const llmRequest = {
        taskCode: 'LLM1_PRIOR_ART' as const,
        stageCode: 'NOVELTY_QUERY_GENERATION', // Use admin-configured model/limits
        prompt,
        inputTokens: Math.ceil(prompt.length / 4), // Rough estimate
        idempotencyKey: `prior-art-${request.patentId}-${Date.now()}`
      };

      // Execute LLM call through gateway (handles policy checks internally)
      const headers = {
        'authorization': `Bearer ${request.jwtToken}`
      };

      const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'LLM request failed'
        };
      }

      // Parse and validate JSON response
      let bundle;
      try {
        console.log('🔍 Raw LLM response:', result.response.output);
        console.log('🔍 Response finish reason:', result.response.metadata?.finishReason);

        // Check if response is empty
        if (!result.response.output || result.response.output.trim().length === 0) {
          return {
            success: false,
            error: 'LLM returned empty response'
          };
        }

        // Check if response was cut off due to token limits
        if (result.response.metadata?.finishReason === 'MAX_TOKENS') {
          console.warn('⚠️ LLM response was truncated due to token limits - attempting to process partial response');

          // If we have some output content, try to process it anyway
          if (result.response.output && result.response.output.trim().length > 100) {
            console.log('📝 Attempting to process partial response...');
            // Continue with processing - the JSON parsing might still work
          } else {
            return {
              success: false,
              error: 'LLM response was truncated due to token limits. Please try with a shorter invention brief.'
            };
          }
        }

        let jsonText = result.response.output.trim();

        // Try to extract JSON from markdown code blocks
        const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
        const match = jsonText.match(jsonBlockRegex);
        if (match) {
          jsonText = match[1].trim();
          console.log('📝 Extracted JSON from code block:', jsonText);
        }

        // Remove any leading/trailing text that might not be JSON
        // Look for the first '{' and last '}'
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');

        if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
          jsonText = jsonText.substring(startBrace, lastBrace + 1);
          console.log('✂️ Extracted JSON between braces:', jsonText);
        }

        // Additional cleanup: remove trailing commas and fix common JSON issues
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
        jsonText = jsonText.replace(/,(\s*),/g, ','); // Remove double commas
        jsonText = jsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Quote unquoted keys

        bundle = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('❌ JSON parse error:', parseError);
        console.error('❌ Raw response that failed:', result.response.output);
        return {
          success: false,
          error: `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        };
      }

      // Validate essential fields from LLM
      if (!bundle.source_summary || !bundle.core_concepts || !bundle.technical_features ||
          !bundle.synonym_groups || !bundle.cpc_candidates || !bundle.ipc_candidates ||
          !bundle.query_variants || bundle.exclude_terms === undefined) {
        return {
          success: false,
          error: 'LLM response missing required fields'
        };
      }

      if (!Array.isArray(bundle.query_variants) || bundle.query_variants.length !== 3) {
        return {
          success: false,
          error: 'LLM must generate exactly 3 query variants'
        };
      }

      // Ensure exactly 3 variants with correct labels
      const requiredLabels = ['broad', 'baseline', 'narrow'];
      const actualLabels = bundle.query_variants.map((v: any) => v.label).sort();
      const sortedRequiredLabels = [...requiredLabels].sort();

      console.log('🔍 Required labels (original):', requiredLabels);
      console.log('🔍 Required labels (sorted):', sortedRequiredLabels);
      console.log('🔍 Actual labels (sorted):', actualLabels);
      console.log('🔍 Label types:', actualLabels.map((l: any) => typeof l));

      if (JSON.stringify(actualLabels) !== JSON.stringify(sortedRequiredLabels)) {
        console.error('❌ Label mismatch - required (sorted):', sortedRequiredLabels, 'actual (sorted):', actualLabels);
        return {
          success: false,
          error: 'LLM did not generate required query variants'
        };
      }

      // Add default values for fields not generated by LLM
      bundle = {
        ...bundle,
        phrases: [], // User can add in advanced settings
        exclude_terms: [], // User can add exclusions
        spec_limits: [], // Usually empty for patents
        domain_tags: [], // Can be auto-detected from technical_features
        date_window: null, // No date restrictions by default
        jurisdictions_preference: [], // Global search by default
        ambiguous_terms: [], // Usually empty
        sensitive_tokens: [], // Usually empty
        serpapi_defaults: {
          engine: undefined, // Default to both patents and scholar
          hl: 'en',
          no_cache: false
        },
        fields_for_details: ['title', 'abstract', 'claims', 'classifications', 'publication_date'],
        detail_priority_rules: 'Prioritize recent publications with high citation counts'
      };

      // Add default num and page to query variants
      bundle.query_variants = bundle.query_variants.map((variant: any) => ({
        ...variant,
        num: 20, // Default results per page
        page: 1  // Start from first page
      }));

      return {
        success: true,
        bundle,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4), // Estimate from prompt length
          outputTokens: result.response.outputTokens,
          modelClass: result.response.modelClass
        }
      };

    } catch (error) {
      console.error('Prior Art LLM generation error:', error);
      return {
        success: false,
        error: 'Failed to generate prior art bundle'
      };
    }
  }

  static validateLLMOutput(bundle: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields check
    const requiredFields = [
      'source_summary', 'core_concepts', 'query_variants', 'serpapi_defaults'
    ];

    for (const field of requiredFields) {
      if (!(field in bundle)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Query variants validation
    if (bundle.query_variants) {
      if (!Array.isArray(bundle.query_variants) || bundle.query_variants.length !== 3) {
        errors.push('Must have exactly 3 query variants');
      } else {
        const labels = bundle.query_variants.map((v: any) => v.label);
        const requiredLabels = ['broad', 'baseline', 'narrow'];
        const missingLabels = requiredLabels.filter(label => !labels.includes(label));
        if (missingLabels.length > 0) {
          errors.push(`Missing query variants: ${missingLabels.join(', ')}`);
        }
      }
    }

    // SerpAPI defaults validation
    if (bundle.serpapi_defaults?.engine !== undefined &&
        !['google_patents', 'google_scholar'].includes(bundle.serpapi_defaults.engine)) {
      errors.push('serpapi_defaults.engine must be "google_patents", "google_scholar", or undefined (for both)');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
