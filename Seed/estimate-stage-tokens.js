/**
 * Token Estimation Script for Workflow Stages
 * 
 * This script estimates the required input and output token limits for each
 * workflow stage based on the context being passed to it.
 * 
 * Usage:
 *   node Seed/estimate-stage-tokens.js            # Dry run: report + SQL only (no DB writes)
 *   node Seed/estimate-stage-tokens.js --apply    # Apply recommended limits to DB for all plans
 * 
 * You can still use the printed SQL to fine‑tune values or run them manually
 * if needed from a SQL client.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// CLI options
const args = process.argv.slice(2);
const APPLY_TO_DB = args.includes('--apply') || args.includes('--update-db');

// ============================================================================
// Token Estimation Constants
// ============================================================================

// Average tokens per character (English text averages ~4 chars per token)
const CHARS_PER_TOKEN = 4;

// Rough token estimates for various context elements
const CONTEXT_TOKEN_ESTIMATES = {
  // Base prompt overhead (instructions, formatting, etc.)
  BASE_PROMPT_OVERHEAD: 500,
  
  // Invention context (from normalizeIdea)
  NORMALIZED_IDEA_JSON: 1500,          // The JSON object from idea normalization
  RAW_IDEA_TEXT_SHORT: 500,            // Short invention descriptions
  RAW_IDEA_TEXT_MEDIUM: 1500,          // Medium invention descriptions
  RAW_IDEA_TEXT_LONG: 3000,            // Long/detailed invention descriptions
  
  // Component data
  COMPONENT_SINGLE: 100,               // Single component description
  COMPONENT_HIERARCHY_SMALL: 500,      // 5-8 components
  COMPONENT_HIERARCHY_MEDIUM: 1000,    // 8-15 components
  COMPONENT_HIERARCHY_LARGE: 2000,     // 15+ components
  
  // Claims context
  CLAIMS_SIMPLE: 400,                  // Simple claims set (3-5 claims)
  CLAIMS_STANDARD: 800,                // Standard claims set (10-15 claims)
  CLAIMS_COMPLEX: 1500,                // Complex claims set (20+ claims)
  
  // Prior art context
  PRIOR_ART_SUMMARY_SINGLE: 300,       // Single prior art reference summary
  PRIOR_ART_SUMMARY_BATCH: 1500,       // Batch of 5-10 prior art summaries
  PRIOR_ART_DETAILED: 3000,            // Detailed prior art analysis
  
  // Figures context
  FIGURE_DESCRIPTION_SINGLE: 150,      // Single figure description
  FIGURE_DESCRIPTIONS_BATCH: 800,      // Batch of 5-8 figures
  FIGURE_DESCRIPTIONS_LARGE: 1500,     // Large set of figures (10+)
  
  // Section-specific prompts
  SECTION_PROMPT_TEMPLATE: 400,        // Base section prompt template
  JURISDICTION_RULES: 300,             // Jurisdiction-specific rules
  LANGUAGE_INSTRUCTIONS: 200,          // Language/translation instructions
  
  // Reference draft sections (for context in later sections)
  PREVIOUS_SECTION_SHORT: 300,         // Short section (title, field)
  PREVIOUS_SECTION_MEDIUM: 800,        // Medium section (background, summary)
  PREVIOUS_SECTION_LONG: 2000,         // Long section (detailed description)
};

// ============================================================================
// Stage Token Estimation Rules
// ============================================================================

const STAGE_TOKEN_RULES = {
  // === IDEA ENTRY & NORMALIZATION ===
  'DRAFT_IDEA_ENTRY': {
    description: 'Normalizes raw idea into structured JSON',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Raw idea text (varies)', tokens: CONTEXT_TOKEN_ESTIMATES.RAW_IDEA_TEXT_MEDIUM, variableMax: CONTEXT_TOKEN_ESTIMATES.RAW_IDEA_TEXT_LONG },
      { name: 'Title', tokens: 50 },
    ],
    expectedOutputTokens: 2000,  // JSON output with components, problem, objectives, etc.
    notes: 'Input highly variable based on user idea length. Consider 4000+ for safety.',
    recommendedMaxIn: 5000,
    recommendedMaxOut: 3000,
  },
  
  // === CLAIM GENERATION ===
  'DRAFT_CLAIM_GENERATION': {
    description: 'Generates initial patent claims from normalized idea',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea JSON', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Components hierarchy', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
    ],
    expectedOutputTokens: 2500,  // Full claim set
    notes: 'Output varies significantly based on invention complexity.',
    recommendedMaxIn: 4000,
    recommendedMaxOut: 4000,
  },
  
  // === PRIOR ART ANALYSIS ===
  'DRAFT_PRIOR_ART_ANALYSIS': {
    description: 'Analyzes prior art relevance to invention',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Prior art summaries', tokens: CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_SUMMARY_BATCH, variableMax: CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_DETAILED },
      { name: 'Claims', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
    ],
    expectedOutputTokens: 2000,
    notes: 'Prior art context can be very large if many references found.',
    recommendedMaxIn: 8000,
    recommendedMaxOut: 3000,
  },
  
  // === CLAIM REFINEMENT ===
  'DRAFT_CLAIM_REFINEMENT': {
    description: 'Refines claims based on prior art analysis',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Original claims', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
      { name: 'Prior art analysis', tokens: CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_SUMMARY_BATCH },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
    ],
    expectedOutputTokens: 3000,
    notes: 'Needs both original claims and analysis context.',
    recommendedMaxIn: 6000,
    recommendedMaxOut: 4000,
  },
  
  // === FIGURE PLANNER ===
  'DRAFT_FIGURE_PLANNER': {
    description: 'Plans figures/diagrams for the patent',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Components', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
    ],
    expectedOutputTokens: 1500,
    recommendedMaxIn: 4000,
    recommendedMaxOut: 2500,
  },
  
  // === DIAGRAM GENERATION ===
  'DRAFT_DIAGRAM_GENERATION': {
    description: 'Generates PlantUML/technical diagrams',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Figure plan', tokens: 300 },
      { name: 'Components subset', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_SINGLE * 5 },
    ],
    expectedOutputTokens: 2000,  // PlantUML code can be lengthy
    recommendedMaxIn: 3000,
    recommendedMaxOut: 3000,
  },
  
  // === SKETCH GENERATION ===
  'DRAFT_SKETCH_GENERATION': {
    description: 'Generates patent sketches using image model',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Figure description', tokens: CONTEXT_TOKEN_ESTIMATES.FIGURE_DESCRIPTION_SINGLE },
      { name: 'Technical context', tokens: 500 },
    ],
    expectedOutputTokens: 500,  // Image generation prompt
    notes: 'Primarily triggers image generation, not text output.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 1000,
  },
  
  // === SECTION DRAFTING STAGES ===
  // These follow the superset section pattern
  
  'DRAFT_ANNEXURE_TITLE': {
    description: 'Drafts patent title',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea (summary)', tokens: 500 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 100,
    notes: 'Short output - title only.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 500,
  },
  
  'DRAFT_ANNEXURE_PREAMBLE': {
    description: 'Drafts legal preamble (IN, PK, BD style)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Title', tokens: 50 },
      { name: 'Applicant info', tokens: 200 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 400,
    recommendedMaxIn: 2000,
    recommendedMaxOut: 1000,
  },
  
  'DRAFT_ANNEXURE_FIELD': {
    description: 'Drafts field of invention section',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea (field info)', tokens: 300 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 300,
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 1000,
  },
  
  'DRAFT_ANNEXURE_BACKGROUND': {
    description: 'Drafts background/prior art section',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Prior art summaries (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_SUMMARY_BATCH },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 1500,
    notes: 'Requires PRIOR ART context injection.',
    recommendedMaxIn: 5000,
    recommendedMaxOut: 2500,
  },
  
  'DRAFT_ANNEXURE_OBJECTS': {
    description: 'Drafts objects of invention',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: 800 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 600,
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2500,
    recommendedMaxOut: 1500,
  },
  
  'DRAFT_ANNEXURE_SUMMARY': {
    description: 'Drafts invention summary',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Claims (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 1200,
    notes: 'Requires CLAIMS context injection.',
    recommendedMaxIn: 4500,
    recommendedMaxOut: 2000,
  },
  
  'DRAFT_ANNEXURE_TECHNICAL_PROBLEM': {
    description: 'Drafts technical problem statement (EP/JP style)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: 800 },
      { name: 'Prior art summaries (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_SUMMARY_BATCH },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 800,
    notes: 'Requires PRIOR ART context injection.',
    recommendedMaxIn: 4000,
    recommendedMaxOut: 1500,
  },
  
  'DRAFT_ANNEXURE_TECHNICAL_SOLUTION': {
    description: 'Drafts technical solution (EP/JP style)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Claims (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 1000,
    notes: 'Requires CLAIMS context injection.',
    recommendedMaxIn: 4500,
    recommendedMaxOut: 2000,
  },
  
  'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS': {
    description: 'Drafts advantageous effects (JP/CN style)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: 800 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 600,
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2500,
    recommendedMaxOut: 1500,
  },
  
  'DRAFT_ANNEXURE_DRAWINGS': {
    description: 'Drafts brief description of drawings',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Figure list (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.FIGURE_DESCRIPTIONS_BATCH },
      { name: 'Components (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 1200,
    notes: 'Requires FIGURES + COMPONENTS context injection.',
    recommendedMaxIn: 4000,
    recommendedMaxOut: 2000,
  },
  
  'DRAFT_ANNEXURE_DESCRIPTION': {
    description: 'Drafts detailed description (LARGEST SECTION)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Components (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_LARGE },
      { name: 'Figure descriptions (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.FIGURE_DESCRIPTIONS_BATCH },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
      { name: 'Language instructions', tokens: CONTEXT_TOKEN_ESTIMATES.LANGUAGE_INSTRUCTIONS },
    ],
    expectedOutputTokens: 6000,  // Largest output section
    notes: 'CRITICAL: Requires FIGURES + COMPONENTS. Largest input/output stage.',
    recommendedMaxIn: 8000,
    recommendedMaxOut: 10000,
  },
  
  'DRAFT_ANNEXURE_BEST_MODE': {
    description: 'Drafts best mode description (US requirement)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Components (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
      { name: 'Figure descriptions (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.FIGURE_DESCRIPTIONS_BATCH },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 2000,
    notes: 'Requires FIGURES + COMPONENTS context injection.',
    recommendedMaxIn: 5000,
    recommendedMaxOut: 3000,
  },
  
  'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY': {
    description: 'Drafts industrial applicability (PCT/non-US)',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: 600 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 500,
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 1000,
  },
  
  'DRAFT_ANNEXURE_CLAIMS': {
    description: 'Drafts final patent claims',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Components (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
      { name: 'Refined claims reference', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 3000,
    notes: 'Requires COMPONENTS context injection. High output for full claim set.',
    recommendedMaxIn: 5000,
    recommendedMaxOut: 5000,
  },
  
  'DRAFT_ANNEXURE_ABSTRACT': {
    description: 'Drafts patent abstract',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: 800 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 300,  // Abstracts are typically <150 words
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 500,
  },
  
  'DRAFT_ANNEXURE_NUMERALS': {
    description: 'Drafts list of reference numerals',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Components (INJECTED)', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM },
      { name: 'Figure references', tokens: 400 },
    ],
    expectedOutputTokens: 800,
    notes: 'Requires COMPONENTS context injection.',
    recommendedMaxIn: 3000,
    recommendedMaxOut: 1500,
  },
  
  'DRAFT_ANNEXURE_CROSS_REFERENCE': {
    description: 'Drafts cross-reference to related applications',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Application data', tokens: 300 },
      { name: 'Jurisdiction rules', tokens: CONTEXT_TOKEN_ESTIMATES.JURISDICTION_RULES },
    ],
    expectedOutputTokens: 300,
    notes: 'Standalone section - no context injection needed.',
    recommendedMaxIn: 2000,
    recommendedMaxOut: 500,
  },
  
  'DRAFT_REVIEW': {
    description: 'AI-powered patent review and suggestions',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Full draft sections', tokens: 8000, variableMax: 15000 },
      { name: 'Claims', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
    ],
    expectedOutputTokens: 3000,
    notes: 'VERY LARGE INPUT - may need entire draft for review.',
    recommendedMaxIn: 20000,
    recommendedMaxOut: 5000,
  },
  
  // === NOVELTY SEARCH STAGES ===
  'NOVELTY_QUERY_GENERATION': {
    description: 'Generates search queries from idea',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Normalized idea', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
    ],
    expectedOutputTokens: 500,
    recommendedMaxIn: 3000,
    recommendedMaxOut: 1000,
  },
  
  'NOVELTY_RELEVANCE_SCORING': {
    description: 'Scores patent relevance',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Invention summary', tokens: 800 },
      { name: 'Patent to score', tokens: 1000 },
    ],
    expectedOutputTokens: 500,
    recommendedMaxIn: 3000,
    recommendedMaxOut: 1000,
  },
  
  'NOVELTY_FEATURE_ANALYSIS': {
    description: 'Analyzes feature overlap',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Invention features', tokens: CONTEXT_TOKEN_ESTIMATES.NORMALIZED_IDEA_JSON },
      { name: 'Prior art features', tokens: 2000 },
    ],
    expectedOutputTokens: 2000,
    recommendedMaxIn: 5000,
    recommendedMaxOut: 3000,
  },
  
  'NOVELTY_COMPARISON': {
    description: 'Detailed comparison with prior art',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Claims', tokens: CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD },
      { name: 'Prior art details', tokens: 3000 },
    ],
    expectedOutputTokens: 2500,
    recommendedMaxIn: 6000,
    recommendedMaxOut: 4000,
  },
  
  'NOVELTY_REPORT_GENERATION': {
    description: 'Generates novelty report',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Analysis results', tokens: 3000 },
      { name: 'Invention summary', tokens: 1000 },
    ],
    expectedOutputTokens: 3000,
    recommendedMaxIn: 6000,
    recommendedMaxOut: 5000,
  },
  
  // === IDEA BANK STAGES ===
  'IDEA_BANK_NORMALIZE': {
    description: 'Normalizes and structures idea for bank',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Raw idea', tokens: CONTEXT_TOKEN_ESTIMATES.RAW_IDEA_TEXT_MEDIUM },
    ],
    expectedOutputTokens: 1000,
    recommendedMaxIn: 3000,
    recommendedMaxOut: 1500,
  },
  
  'IDEA_BANK_SEARCH': {
    description: 'Searches for similar ideas',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Query idea', tokens: 500 },
    ],
    expectedOutputTokens: 800,
    recommendedMaxIn: 2000,
    recommendedMaxOut: 1500,
  },
  
  // === DIAGRAM STAGES ===
  'DIAGRAM_PLANTUML': {
    description: 'Generates PlantUML code',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Diagram spec', tokens: 500 },
      { name: 'Components', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_SMALL },
    ],
    expectedOutputTokens: 2000,
    recommendedMaxIn: 3000,
    recommendedMaxOut: 3000,
  },
  
  'DIAGRAM_FLOWCHART': {
    description: 'Generates flowcharts',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Process description', tokens: 600 },
    ],
    expectedOutputTokens: 1500,
    recommendedMaxIn: 2500,
    recommendedMaxOut: 2500,
  },
  
  'DIAGRAM_SEQUENCE': {
    description: 'Generates sequence diagrams',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'Interaction description', tokens: 600 },
    ],
    expectedOutputTokens: 1500,
    recommendedMaxIn: 2500,
    recommendedMaxOut: 2500,
  },
  
  'DIAGRAM_BLOCK': {
    description: 'Generates block diagrams',
    inputComponents: [
      { name: 'Base prompt', tokens: CONTEXT_TOKEN_ESTIMATES.BASE_PROMPT_OVERHEAD },
      { name: 'System description', tokens: 600 },
      { name: 'Components', tokens: CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_SMALL },
    ],
    expectedOutputTokens: 1500,
    recommendedMaxIn: 2500,
    recommendedMaxOut: 2500,
  },
};

// ============================================================================
// Context Injection Summary
// ============================================================================

const CONTEXT_INJECTION_MATRIX = {
  // Sections that need PRIOR ART
  requiresPriorArt: ['background', 'technicalProblem'],
  
  // Sections that need CLAIMS
  requiresClaims: ['summary', 'technicalSolution'],
  
  // Sections that need FIGURES + COMPONENTS
  requiresFiguresAndComponents: ['briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod'],
  
  // Sections that need COMPONENTS only
  requiresComponents: ['claims', 'listOfNumerals'],
  
  // Standalone sections (no context injection)
  standalone: ['title', 'preamble', 'fieldOfInvention', 'objectsOfInvention', 
               'advantageousEffects', 'industrialApplicability', 'abstract', 'crossReference']
};

// ============================================================================
// Main Estimation Function
// ============================================================================

async function estimateTokens() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           TOKEN ESTIMATION REPORT FOR WORKFLOW STAGES                          ║');
  console.log('║                                                                                ║');
  console.log('║  Use these estimates to configure maxTokensIn/maxTokensOut in Super Admin     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Fetch current configurations from database
  let dbStages = [];
  let dbConfigs = [];
  try {
    dbStages = await prisma.workflowStage.findMany({
      orderBy: [{ featureCode: 'asc' }, { sortOrder: 'asc' }]
    });
    dbConfigs = await prisma.planStageModelConfig.findMany({
      include: { stage: true, plan: true }
    });
  } catch (err) {
    console.log('⚠️  Could not fetch database configs (tables may not exist yet)');
  }
  
  // Group stages by feature and build lookup by code
  const stagesByFeature = {};
  const stagesByCode = {};
  for (const stage of dbStages) {
    stagesByCode[stage.code] = stage;
    if (!stagesByFeature[stage.featureCode]) {
      stagesByFeature[stage.featureCode] = [];
    }
    stagesByFeature[stage.featureCode].push(stage);
  }
  
  // Print execution mode
  if (APPLY_TO_DB) {
    console.log('Mode: APPLY — recommended maxTokensIn/maxTokensOut will be written to the database.\n');
  } else {
    console.log('Mode: DRY RUN — no database changes will be made. Pass --apply to write limits to the database.\n');
  }
  
  // Print estimation for each feature
  const features = ['PATENT_DRAFTING', 'PRIOR_ART_SEARCH', 'IDEA_BANK', 'DIAGRAM_GENERATION'];
  
  for (const feature of features) {
    console.log('');
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    console.log(`  FEATURE: ${feature}`);
    console.log(`═══════════════════════════════════════════════════════════════════════`);
    
    const featureStages = stagesByFeature[feature] || [];
    
    for (const stage of featureStages) {
      const rules = STAGE_TOKEN_RULES[stage.code];
      
      if (!rules) {
        console.log(`\n  ⚠️  ${stage.displayName} (${stage.code})`);
        console.log(`      No estimation rules defined - likely a non-LLM stage`);
        continue;
      }
      
      // Calculate totals
      const baseInputTokens = rules.inputComponents.reduce((sum, c) => sum + c.tokens, 0);
      const maxInputTokens = rules.inputComponents.reduce((sum, c) => sum + (c.variableMax || c.tokens), 0);
      
      console.log('');
      console.log(`  ┌─────────────────────────────────────────────────────────────────────`);
      console.log(`  │ ${stage.displayName}`);
      console.log(`  │ Stage Code: ${stage.code}`);
      console.log(`  ├─────────────────────────────────────────────────────────────────────`);
      console.log(`  │ ${rules.description}`);
      console.log(`  │`);
      console.log(`  │ INPUT COMPONENTS:`);
      
      for (const comp of rules.inputComponents) {
        const variableNote = comp.variableMax ? ` (up to ${comp.variableMax})` : '';
        const injectedNote = comp.name.includes('INJECTED') ? ' ⚡' : '';
        console.log(`  │   • ${comp.name}: ~${comp.tokens} tokens${variableNote}${injectedNote}`);
      }
      
      console.log(`  │`);
      console.log(`  │ ESTIMATED TOTALS:`);
      console.log(`  │   📥 Input (typical):  ${baseInputTokens.toLocaleString()} tokens`);
      console.log(`  │   📥 Input (max):      ${maxInputTokens.toLocaleString()} tokens`);
      console.log(`  │   📤 Output (expected): ${rules.expectedOutputTokens.toLocaleString()} tokens`);
      console.log(`  │`);
      console.log(`  │ RECOMMENDED LIMITS (with safety margin):`);
      console.log(`  │   ✅ maxTokensIn:  ${rules.recommendedMaxIn.toLocaleString()}`);
      console.log(`  │   ✅ maxTokensOut: ${rules.recommendedMaxOut.toLocaleString()}`);
      
      if (rules.notes) {
        console.log(`  │`);
        console.log(`  │ 📝 ${rules.notes}`);
      }
      
      // Check current DB config
      const existingConfig = dbConfigs.find(c => c.stage?.code === stage.code);
      if (existingConfig) {
        console.log(`  │`);
        console.log(`  │ CURRENT DB CONFIG (${existingConfig.plan?.code || 'unknown plan'}):`);
        console.log(`  │   maxTokensIn:  ${existingConfig.maxTokensIn || 'not set'}`);
        console.log(`  │   maxTokensOut: ${existingConfig.maxTokensOut || 'not set'}`);
        
        // Warn if current config is too low
        if (existingConfig.maxTokensIn && existingConfig.maxTokensIn < baseInputTokens) {
          console.log(`  │   ⚠️  WARNING: Current maxTokensIn (${existingConfig.maxTokensIn}) < estimated input (${baseInputTokens})`);
        }
      }
      
      console.log(`  └─────────────────────────────────────────────────────────────────────`);
    }
  }
  
  // If requested, apply recommendations to the database
  if (APPLY_TO_DB) {
    console.log('');
    console.log('Applying recommended token limits to plan_stage_model_configs...\n');

    let totalUpdated = 0;

    for (const [stageCode, rules] of Object.entries(STAGE_TOKEN_RULES)) {
      const stage = stagesByCode[stageCode];
      if (!stage) {
        continue;
      }

      const result = await prisma.planStageModelConfig.updateMany({
        where: { stageId: stage.id },
        data: {
          maxTokensIn: rules.recommendedMaxIn,
          maxTokensOut: rules.recommendedMaxOut,
        },
      });

      if (result.count > 0) {
        totalUpdated += result.count;
        console.log(
          `  - ${stageCode}: updated ${result.count} config(s) to maxTokensIn=${rules.recommendedMaxIn}, maxTokensOut=${rules.recommendedMaxOut}`
        );
      }
    }

    if (totalUpdated === 0) {
      console.log('  No PlanStageModelConfig rows were updated (none found for the known stages).');
    } else {
      console.log(`\nTotal PlanStageModelConfig rows updated: ${totalUpdated}`);
    }

    console.log('');
  }
  
  // Print context injection summary
  console.log('');
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    CONTEXT INJECTION REFERENCE                                  ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ ⚡ Context injection adds significant tokens to prompts. Plan accordingly!     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('Sections requiring PRIOR ART injection:');
  console.log(`  ${CONTEXT_INJECTION_MATRIX.requiresPriorArt.join(', ')}`);
  console.log(`  → Adds ~${CONTEXT_TOKEN_ESTIMATES.PRIOR_ART_SUMMARY_BATCH} tokens typically`);
  console.log('');
  
  console.log('Sections requiring CLAIMS injection:');
  console.log(`  ${CONTEXT_INJECTION_MATRIX.requiresClaims.join(', ')}`);
  console.log(`  → Adds ~${CONTEXT_TOKEN_ESTIMATES.CLAIMS_STANDARD} tokens typically`);
  console.log('');
  
  console.log('Sections requiring FIGURES + COMPONENTS injection:');
  console.log(`  ${CONTEXT_INJECTION_MATRIX.requiresFiguresAndComponents.join(', ')}`);
  console.log(`  → Adds ~${CONTEXT_TOKEN_ESTIMATES.FIGURE_DESCRIPTIONS_BATCH + CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM} tokens typically`);
  console.log('');
  
  console.log('Sections requiring COMPONENTS only:');
  console.log(`  ${CONTEXT_INJECTION_MATRIX.requiresComponents.join(', ')}`);
  console.log(`  → Adds ~${CONTEXT_TOKEN_ESTIMATES.COMPONENT_HIERARCHY_MEDIUM} tokens typically`);
  console.log('');
  
  console.log('Standalone sections (no injection):');
  console.log(`  ${CONTEXT_INJECTION_MATRIX.standalone.join(', ')}`);
  console.log('');
  
  // Print SQL update commands
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    SQL COMMANDS TO UPDATE LIMITS                               ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ Run these in your database to set recommended token limits:                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('-- Update DRAFT_IDEA_ENTRY to allow larger inputs');
  console.log(`UPDATE "plan_stage_model_configs"`);
  console.log(`SET "maxTokensIn" = 5000, "maxTokensOut" = 3000`);
  console.log(`WHERE "stageId" IN (SELECT id FROM "workflow_stages" WHERE code = 'DRAFT_IDEA_ENTRY');`);
  console.log('');
  
  console.log('-- Update DRAFT_ANNEXURE_DESCRIPTION (largest section)');
  console.log(`UPDATE "plan_stage_model_configs"`);
  console.log(`SET "maxTokensIn" = 8000, "maxTokensOut" = 10000`);
  console.log(`WHERE "stageId" IN (SELECT id FROM "workflow_stages" WHERE code = 'DRAFT_ANNEXURE_DESCRIPTION');`);
  console.log('');
  
  console.log('-- Update all stages with sensible defaults');
  console.log('-- (Run individual updates above for critical stages first)');
  console.log('');
  
  // Generate SQL for all stages
  for (const [stageCode, rules] of Object.entries(STAGE_TOKEN_RULES)) {
    console.log(`-- ${stageCode}`);
    console.log(`UPDATE "plan_stage_model_configs" SET "maxTokensIn" = ${rules.recommendedMaxIn}, "maxTokensOut" = ${rules.recommendedMaxOut} WHERE "stageId" IN (SELECT id FROM "workflow_stages" WHERE code = '${stageCode}');`);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('Done! Use Super Admin > LLM Config to adjust limits per plan.');
  console.log('═══════════════════════════════════════════════════════════════════════');
  
  await prisma.$disconnect();
}

// ============================================================================
// Run
// ============================================================================

estimateTokens()
  .catch(err => {
    console.error('Error:', err);
    prisma.$disconnect();
    process.exit(1);
  });






























