// Prior Art Search Bundle Interface (per SRS §6)
export interface PriorArtBundle {
  source_summary: {
    title: string;
    problem_statement: string;
    solution_summary: string;
  };
  core_concepts: string[];
  synonym_groups: string[][];
  phrases: string[];
  exclude_terms: string[];
  technical_features: string[];
  spec_limits: Array<{
    quantity: string;
    operator: '>' | '>=' | '<' | '<=' | '=';
    value: number;
    unit: string;
  }>;
  cpc_candidates: string[];
  ipc_candidates: string[];
  domain_tags: string[];
  date_window: {
    from: string;
    to: string | null;
  } | null;
  jurisdictions_preference: string[];
  ambiguous_terms: string[];
  sensitive_tokens: string[];
  query_variants: Array<{
    label: 'broad' | 'baseline' | 'narrow';
    q: string;
    num: number;
    page: number;
    notes: string;
  }>;
  serpapi_defaults: {
    engine: 'google_patents';
    hl: string;
    no_cache: boolean;
  };
  fields_for_details: string[];
  detail_priority_rules: string;
}

// Validation helper functions
export class PriorArtValidation {
  static validateBundle(data: any): { isValid: boolean; errors?: string[] } {
    // This will be implemented with AJV validation
    // For now, return basic structure validation
    const errors: string[] = [];

    // Check essential required fields (others get defaults)
    const essentialFields = [
      'source_summary', 'core_concepts', 'technical_features', 'synonym_groups',
      'cpc_candidates', 'ipc_candidates', 'query_variants'
    ];

    for (const field of essentialFields) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check that other expected fields exist (they should be added by defaults)
    const expectedFields = [
      'phrases', 'exclude_terms', 'spec_limits', 'domain_tags', 'date_window',
      'jurisdictions_preference', 'ambiguous_terms', 'sensitive_tokens', 'serpapi_defaults',
      'fields_for_details', 'detail_priority_rules'
    ];

    for (const field of expectedFields) {
      if (!(field in data)) {
        // These are warnings, not errors, as they get defaulted
        console.warn(`Field '${field}' missing from bundle, will use default`);
      }
    }

    // Check query variants
    if (data.query_variants) {
      if (!Array.isArray(data.query_variants) || data.query_variants.length !== 3) {
        errors.push('query_variants must be an array of exactly 3 items');
      } else {
        const labels = ['broad', 'baseline', 'narrow'];
        const foundLabels = new Set();

        for (let i = 0; i < data.query_variants.length; i++) {
          const variant = data.query_variants[i];
          if (!variant || typeof variant !== 'object') {
            errors.push(`query_variants[${i}] must be an object`);
            continue;
          }

          if (!labels.includes(variant.label)) {
            errors.push(`query_variants[${i}].label must be one of: ${labels.join(', ')}`);
          } else if (foundLabels.has(variant.label)) {
            errors.push(`Duplicate label '${variant.label}' in query_variants`);
          } else {
            foundLabels.add(variant.label);
          }

          if (typeof variant.q !== 'string' || variant.q.length === 0) {
            errors.push(`query_variants[${i}].q must be a non-empty string`);
          } else if (variant.q.length > 300) {
            errors.push(`query_variants[${i}].q exceeds maximum length of 300 characters`);
          }

          if (typeof variant.num !== 'number' || variant.num < 1 || variant.num > 50) {
            errors.push(`query_variants[${i}].num must be between 1 and 50`);
          }

          if (typeof variant.page !== 'number' || variant.page < 1 || variant.page > 20) {
            errors.push(`query_variants[${i}].page must be between 1 and 20`);
          }
        }
      }
    }

    // Check serpapi_defaults
    if (data.serpapi_defaults) {
      const engine = data.serpapi_defaults.engine;
      if (engine !== undefined && typeof engine === 'string' && engine.trim() !== '' && !['google_patents', 'google_scholar'].includes(engine)) {
        errors.push('serpapi_defaults.engine must be "google_patents", "google_scholar", or undefined (for both)');
      }
    }

    // Check sensitive tokens
    if (data.sensitive_tokens && Array.isArray(data.sensitive_tokens) && data.sensitive_tokens.length > 0) {
      errors.push('sensitive_tokens must be empty for approval');
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  static applyGuardrails(data: PriorArtBundle): { isValid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check query length limits
    data.query_variants.forEach((variant, index) => {
      if (variant.q.length > 300) {
        warnings.push(`Query variant ${variant.label} exceeds 300 character limit`);
      }
    });

    // Check phrase limits (max 2 quoted phrases per variant)
    data.query_variants.forEach((variant, index) => {
      const quotedPhrases = (variant.q.match(/"[^"]*"/g) || []);
      if (quotedPhrases.length > 2) {
        warnings.push(`Query variant ${variant.label} has ${quotedPhrases.length} quoted phrases (max 2 allowed)`);
      }
    });

    // Check synonym groups (prefer at least 2 OR-groups)
    let orGroupCount = 0;
    data.query_variants.forEach(variant => {
      orGroupCount += (variant.q.match(/\([^)]*\)/g) || []).length;
    });
    if (orGroupCount < 2) {
      warnings.push('Consider adding more OR-groups for better recall');
    }

    // Check for context terms near ambiguous terms
    if (data.ambiguous_terms.length > 0) {
      const contextTerms = [...data.core_concepts, ...data.technical_features];
      data.ambiguous_terms.forEach(ambiguous => {
        let hasContext = false;
        data.query_variants.forEach(variant => {
          if (variant.q.toLowerCase().includes(ambiguous.toLowerCase())) {
            // Check if any context term is nearby
            contextTerms.forEach(context => {
              if (variant.q.toLowerCase().includes(context.toLowerCase())) {
                hasContext = true;
              }
            });
          }
        });
        if (!hasContext) {
          warnings.push(`Ambiguous term "${ambiguous}" may need context terms for disambiguation`);
        }
      });
    }

    return {
      isValid: warnings.length === 0,
      warnings
    };
  }
}
