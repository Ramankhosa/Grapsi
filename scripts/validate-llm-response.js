#!/usr/bin/env node

/**
 * Test validation of the actual LLM response
 */

const data = {
  "source_summary": {
    "title": "System for Monitoring, Recording and Notifying the Package Handling Events during Transit",
    "problem_statement": "Costly or delicate items are often mishandled during transit, leading to damage, with no accountability for these events.",
    "solution_summary": "A system using sensors and a microcontroller to monitor, log, and notify stakeholders of package mishandling events."
  },
  "core_concepts": ["package handling", "sensor monitoring"],
  "synonym_groups": [["sensor", "detector"], ["package", "parcel"]],
  "phrases": ["package handling"],
  "exclude_terms": [],
  "technical_features": ["movement sensor", "fall sensor", "acceleration sensor", "GPS", "microcontroller"],
  "spec_limits": [],
  "cpc_candidates": [],
  "ipc_candidates": [],
  "domain_tags": ["logistics"],
  "date_window": null,
  "jurisdictions_preference": [],
  "ambiguous_terms": [],
  "sensitive_tokens": [],
  "query_variants": [
    {
      "label": "broad",
      "q": "(sensor OR detector) AND (package OR parcel) AND monitoring AND GPS",
      "num": 20,
      "page": 1,
      "notes": "Covers broad aspects of sensors and monitoring systems for packages, aiming to capture a wide range of related technologies."
    },
    {
      "label": "baseline",
      "q": "\"package handling\" AND sensor AND GPS AND microcontroller",
      "num": 20,
      "page": 1,
      "notes": "Targets specific components of the invention, ensuring that the essential features like handling, sensors, and GPS are present."
    },
    {
      "label": "narrow",
      "q": "\"package handling\" AND \"acceleration sensor\" AND GPS AND microcontroller",
      "num": 20,
      "page": 1,
      "notes": "Focuses on the precise technical configuration described, useful for pinpointing closely related prior art."
    }
  ],
  "serpapi_defaults": {
    "engine": "google_patents",
    "hl": "en",
    "no_cache": false
  },
  "fields_for_details": ["title", "abstract", "claims", "classifications", "publication_date"],
  "detail_priority_rules": "Prioritize recent publications with high citation counts"
};

// Simulate validation logic
const errors = [];

// Check required fields
const requiredFields = [
  'source_summary', 'core_concepts', 'synonym_groups', 'phrases',
  'exclude_terms', 'technical_features', 'spec_limits', 'cpc_candidates',
  'ipc_candidates', 'domain_tags', 'date_window', 'jurisdictions_preference',
  'ambiguous_terms', 'sensitive_tokens', 'query_variants', 'serpapi_defaults',
  'fields_for_details', 'detail_priority_rules'
];

for (const field of requiredFields) {
  if (!(field in data)) {
    errors.push(`Missing required field: ${field}`);
  }
}

console.log('✅ Required fields check passed');

// Check query variants
if (data.query_variants) {
  if (!Array.isArray(data.query_variants) || data.query_variants.length !== 3) {
    errors.push('query_variants must be an array of exactly 3 items');
  } else {
    const labels = ['broad', 'baseline', 'narrow'];
    const foundLabels = new Set();

    console.log('🔍 Checking query variants...');

    for (let i = 0; i < data.query_variants.length; i++) {
      const variant = data.query_variants[i];
      console.log(`Variant ${i}: label=${variant.label}, q length=${variant.q.length}`);

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
  if (data.serpapi_defaults.engine !== 'google_patents') {
    errors.push('serpapi_defaults.engine must be "google_patents"');
  }
}

// Check sensitive tokens
if (data.sensitive_tokens && Array.isArray(data.sensitive_tokens) && data.sensitive_tokens.length > 0) {
  errors.push('sensitive_tokens must be empty for approval');
}

console.log('\n📊 Validation Results:');
console.log('Errors found:', errors.length);
if (errors.length > 0) {
  errors.forEach((error, i) => {
    console.log(`${i + 1}. ${error}`);
  });
} else {
  console.log('✅ All validation checks passed!');
}

console.log('\nIs valid:', errors.length === 0);
