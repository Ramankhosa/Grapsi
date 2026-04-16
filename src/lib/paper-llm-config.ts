/**
 * Paper LLM Configuration Utilities
 * 
 * Maps paper sections to the 4 generic workflow stages:
 * - PAPER_ABSTRACT_TITLE: Titles, abstracts, keywords
 * - PAPER_CONTENT_GENERATION: All main sections
 * - PAPER_CITATION_FORMATTING: References & bibliography
 * - PAPER_LITERATURE_ANALYSIS: Literature review & analysis
 * 
 * This allows a single set of LLM configurations to serve ALL paper types.
 */

// Paper workflow stage codes
export const PAPER_STAGES = {
  ABSTRACT_TITLE: 'PAPER_ABSTRACT_TITLE',
  CONTENT_GENERATION: 'PAPER_CONTENT_GENERATION',
  CITATION_FORMATTING: 'PAPER_CITATION_FORMATTING',
  LITERATURE_ANALYSIS: 'PAPER_LITERATURE_ANALYSIS',
} as const;

export type PaperStageCode = typeof PAPER_STAGES[keyof typeof PAPER_STAGES];

// Stage metadata for display and configuration
export const PAPER_STAGE_INFO: Record<PaperStageCode, {
  displayName: string;
  icon: string;
  description: string;
  tip: string;
  defaultTemperature: number;
}> = {
  [PAPER_STAGES.ABSTRACT_TITLE]: {
    displayName: 'Abstract & Title Generation',
    icon: '📝',
    description: 'Titles, abstracts, and keywords',
    tip: 'Short-form content requiring precision. Higher quality models improve clarity and impact.',
    defaultTemperature: 0.5,
  },
  [PAPER_STAGES.CONTENT_GENERATION]: {
    displayName: 'Section Content Generation',
    icon: '📄',
    description: 'All main sections (Introduction, Methods, Results, Discussion, etc.)',
    tip: 'Long-form academic writing. Benefit from models with strong reasoning and writing capabilities.',
    defaultTemperature: 0.7,
  },
  [PAPER_STAGES.CITATION_FORMATTING]: {
    displayName: 'Citation & References',
    icon: '📚',
    description: 'References, bibliography, and in-text citations',
    tip: 'Structured output requiring consistency. Cost-effective models work well here.',
    defaultTemperature: 0.3,
  },
  [PAPER_STAGES.LITERATURE_ANALYSIS]: {
    displayName: 'Literature Analysis',
    icon: '🔍',
    description: 'Literature review, related work synthesis',
    tip: 'Requires large context windows for analyzing multiple sources. Pro models recommended.',
    defaultTemperature: 0.5,
  },
};

// Maps paper section codes to workflow stages
// This is the canonical mapping used by the paper generation service
const SECTION_TO_STAGE_MAP: Record<string, PaperStageCode> = {
  // Abstract & Title stage - short-form, high-precision content
  'TITLE': PAPER_STAGES.ABSTRACT_TITLE,
  'ABSTRACT': PAPER_STAGES.ABSTRACT_TITLE,
  'KEYWORDS': PAPER_STAGES.ABSTRACT_TITLE,
  
  // Content Generation stage - all main sections
  'INTRODUCTION': PAPER_STAGES.CONTENT_GENERATION,
  'BACKGROUND': PAPER_STAGES.CONTENT_GENERATION,
  'METHODOLOGY': PAPER_STAGES.CONTENT_GENERATION,
  'METHODS': PAPER_STAGES.CONTENT_GENERATION,
  'MATERIALS_AND_METHODS': PAPER_STAGES.CONTENT_GENERATION,
  'EXPERIMENTAL': PAPER_STAGES.CONTENT_GENERATION,
  'RESULTS': PAPER_STAGES.CONTENT_GENERATION,
  'FINDINGS': PAPER_STAGES.CONTENT_GENERATION,
  'DISCUSSION': PAPER_STAGES.CONTENT_GENERATION,
  'ANALYSIS': PAPER_STAGES.CONTENT_GENERATION,
  'CONCLUSION': PAPER_STAGES.CONTENT_GENERATION,
  'CONCLUSIONS': PAPER_STAGES.CONTENT_GENERATION,
  'SUMMARY': PAPER_STAGES.CONTENT_GENERATION,
  'THEORETICAL_FRAMEWORK': PAPER_STAGES.CONTENT_GENERATION,
  'CONCEPTUAL_FRAMEWORK': PAPER_STAGES.CONTENT_GENERATION,
  'CASE_STUDY': PAPER_STAGES.CONTENT_GENERATION,
  'CASE_STUDIES': PAPER_STAGES.CONTENT_GENERATION,
  'IMPLICATIONS': PAPER_STAGES.CONTENT_GENERATION,
  'PRACTICAL_IMPLICATIONS': PAPER_STAGES.CONTENT_GENERATION,
  'LIMITATIONS': PAPER_STAGES.CONTENT_GENERATION,
  'FUTURE_WORK': PAPER_STAGES.CONTENT_GENERATION,
  'FUTURE_RESEARCH': PAPER_STAGES.CONTENT_GENERATION,
  'RECOMMENDATIONS': PAPER_STAGES.CONTENT_GENERATION,
  'ACKNOWLEDGMENTS': PAPER_STAGES.CONTENT_GENERATION,
  'ACKNOWLEDGEMENTS': PAPER_STAGES.CONTENT_GENERATION,
  'APPENDIX': PAPER_STAGES.CONTENT_GENERATION,
  'APPENDICES': PAPER_STAGES.CONTENT_GENERATION,
  'DATA_ANALYSIS': PAPER_STAGES.CONTENT_GENERATION,
  'STATISTICAL_ANALYSIS': PAPER_STAGES.CONTENT_GENERATION,
  
  // Literature Analysis stage - for synthesizing sources
  'LITERATURE_REVIEW': PAPER_STAGES.LITERATURE_ANALYSIS,
  'RELATED_WORK': PAPER_STAGES.LITERATURE_ANALYSIS,
  'RELATED_WORKS': PAPER_STAGES.LITERATURE_ANALYSIS,
  'STATE_OF_THE_ART': PAPER_STAGES.LITERATURE_ANALYSIS,
  'PRIOR_WORK': PAPER_STAGES.LITERATURE_ANALYSIS,
  'PREVIOUS_WORK': PAPER_STAGES.LITERATURE_ANALYSIS,
  'REVIEW_OF_LITERATURE': PAPER_STAGES.LITERATURE_ANALYSIS,
  'THEORETICAL_BACKGROUND': PAPER_STAGES.LITERATURE_ANALYSIS,
  
  // Citation & References stage - bibliography handling
  'REFERENCES': PAPER_STAGES.CITATION_FORMATTING,
  'BIBLIOGRAPHY': PAPER_STAGES.CITATION_FORMATTING,
  'CITATIONS': PAPER_STAGES.CITATION_FORMATTING,
  'WORKS_CITED': PAPER_STAGES.CITATION_FORMATTING,
};

/**
 * Get the workflow stage code for a paper section
 * 
 * @param sectionCode - The section code (e.g., 'INTRODUCTION', 'introduction', 'Introduction')
 * @returns The corresponding workflow stage code
 * 
 * @example
 * getPaperStageForSection('INTRODUCTION') // => 'PAPER_CONTENT_GENERATION'
 * getPaperStageForSection('abstract') // => 'PAPER_ABSTRACT_TITLE'
 * getPaperStageForSection('Literature Review') // => 'PAPER_LITERATURE_ANALYSIS'
 */
export function getPaperStageForSection(sectionCode: string): PaperStageCode {
  // Normalize: uppercase, replace spaces and hyphens with underscores
  const normalized = sectionCode
    .toUpperCase()
    .replace(/[-\s]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
  
  return SECTION_TO_STAGE_MAP[normalized] || PAPER_STAGES.CONTENT_GENERATION;
}

/**
 * Get stage info for display purposes
 */
export function getPaperStageInfo(stageCode: PaperStageCode) {
  return PAPER_STAGE_INFO[stageCode];
}

/**
 * Get all paper stage codes
 */
export function getAllPaperStageCodes(): PaperStageCode[] {
  return Object.values(PAPER_STAGES);
}

/**
 * Check if a stage code is a paper stage
 */
export function isPaperStage(stageCode: string): stageCode is PaperStageCode {
  return Object.values(PAPER_STAGES).includes(stageCode as PaperStageCode);
}

// Default token limits per plan (generous for academic writing)
export const PAPER_TOKEN_LIMITS: Record<string, Record<PaperStageCode, { maxTokensIn: number; maxTokensOut: number }>> = {
  'FREE_PLAN': {
    [PAPER_STAGES.ABSTRACT_TITLE]: { maxTokensIn: 8000, maxTokensOut: 2000 },
    [PAPER_STAGES.CONTENT_GENERATION]: { maxTokensIn: 16000, maxTokensOut: 8000 },
    [PAPER_STAGES.CITATION_FORMATTING]: { maxTokensIn: 8000, maxTokensOut: 4000 },
    [PAPER_STAGES.LITERATURE_ANALYSIS]: { maxTokensIn: 32000, maxTokensOut: 6000 },
  },
  'PRO_PLAN': {
    [PAPER_STAGES.ABSTRACT_TITLE]: { maxTokensIn: 16000, maxTokensOut: 3000 },
    [PAPER_STAGES.CONTENT_GENERATION]: { maxTokensIn: 64000, maxTokensOut: 16000 },
    [PAPER_STAGES.CITATION_FORMATTING]: { maxTokensIn: 16000, maxTokensOut: 8000 },
    [PAPER_STAGES.LITERATURE_ANALYSIS]: { maxTokensIn: 100000, maxTokensOut: 12000 },
  },
  'ENTERPRISE_PLAN': {
    [PAPER_STAGES.ABSTRACT_TITLE]: { maxTokensIn: 32000, maxTokensOut: 4000 },
    [PAPER_STAGES.CONTENT_GENERATION]: { maxTokensIn: 128000, maxTokensOut: 32000 },
    [PAPER_STAGES.CITATION_FORMATTING]: { maxTokensIn: 32000, maxTokensOut: 16000 },
    [PAPER_STAGES.LITERATURE_ANALYSIS]: { maxTokensIn: 200000, maxTokensOut: 24000 },
  },
};

