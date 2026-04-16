/**
 * Ideation Engine - Zod Schemas
 * 
 * JSON contracts for LLM interactions in the patent ideation engine.
 * All LLM calls must return ONLY valid JSON matching these schemas.
 */

import { z } from 'zod';

// =============================================================================
// ENUMS (matching Prisma enums)
// =============================================================================

export const InventionClassEnum = z.enum([
  'PRODUCT_DEVICE',
  'SYSTEM',
  'METHOD_PROCESS',
  'COMPOSITION',
  'SOFTWARE_ALGORITHM',
  'BIOTECH_PHARMA',
  'MANUFACTURING',
  'SERVICE_WORKFLOW',
  'HYBRID',
]);
export type InventionClass = z.infer<typeof InventionClassEnum>;

export const ArchetypeEnum = z.enum([
  'MECH',
  'ELEC',
  'SOFT',
  'CHEM',
  'BIO',
  'MIXED',
]);
export type Archetype = z.infer<typeof ArchetypeEnum>;

export const ForkModeEnum = z.enum(['SINGLE', 'FORK', 'MERGE']);
export type ForkMode = z.infer<typeof ForkModeEnum>;

export const MindMapNodeTypeEnum = z.enum([
  'SEED',
  'COMPONENT',
  'DIMENSION_FAMILY',
  'DIMENSION_OPTION',
  'OPERATOR',
  'CONSTRAINT',
  'IDEA_FRAME',
  'EVIDENCE_CLUSTER',
]);
export type MindMapNodeType = z.infer<typeof MindMapNodeTypeEnum>;

export const SaturationLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type SaturationLevel = z.infer<typeof SaturationLevelEnum>;

export const NoveltyActionEnum = z.enum([
  'KEEP',
  'MUTATE_OPERATOR',
  'MUTATE_DIMENSION',
  'NARROW_MICRO_PROBLEM',
  'ASK_USER_QUESTION',
]);
export type NoveltyAction = z.infer<typeof NoveltyActionEnum>;

export const RecipeIntentEnum = z.enum([
  'DIVERGENT',
  'CONVERGENT',
  'RISK_REDUCTION',
  'COST_REDUCTION',
]);
export type RecipeIntent = z.infer<typeof RecipeIntentEnum>;

// =============================================================================
// 3.1 INPUT NORMALIZATION JSON (Enhanced with Contradiction Extraction)
// =============================================================================

// Technical contradiction - core of inventive problem solving
export const TechnicalContradictionSchema = z.object({
  parameterToImprove: z.string().describe('What we want to improve'),
  parameterThatWorsens: z.string().describe('What gets worse when we improve the first'),
  conflictDescription: z.string().describe('Why these are in conflict'),
});
export type TechnicalContradiction = z.infer<typeof TechnicalContradictionSchema>;

export const InputNormalizationSchema = z.object({
  coreEntity: z.string().min(1).describe('The main invention/concept'),
  intentGoal: z.string().min(1).describe('What the user wants to achieve'),
  constraints: z.array(z.string()).default([]).describe('Hard constraints on the invention'),
  assumptions: z.array(z.string()).default([]).describe('Assumed context or conditions'),
  context: z.string().optional().describe('Domain or use setting'),
  negativeConstraints: z.array(z.string()).default([]).describe('Things user forbids, e.g., "no electronics"'),
  knownComponents: z.array(z.string()).default([]).describe('Parts/components user already mentioned'),
  unknownsToAsk: z.array(z.string()).default([]).describe('Questions to clarify with user'),
  // NEW: Contradiction extraction for inventive problem solving
  technicalContradictions: z.array(TechnicalContradictionSchema).default([]).describe('Underlying tradeoffs that drive invention'),
  unstatedAssumptions: z.array(z.string()).default([]).describe('Hidden assumptions that could be challenged'),
  secondOrderGoals: z.array(z.string()).default([]).describe('Goals that emerge from solving the primary goal'),
  patentableProblemStatement: z.string().optional().describe('Reframed problem in patent-worthy terms'),
});
export type InputNormalization = z.infer<typeof InputNormalizationSchema>;

// =============================================================================
// 3.1.5 CONTRADICTION MAPPING JSON (NEW STAGE)
// =============================================================================

export const ContradictionMappingSchema = z.object({
  contradictions: z.array(z.object({
    parameterToImprove: z.string(),
    parameterThatWorsens: z.string(),
    whyThisIsHard: z.string().describe('Why this tradeoff is difficult to resolve'),
    trizContradictionNumber: z.number().optional().describe('TRIZ contradiction matrix number if applicable'),
  })).min(1),
  secondOrderEffects: z.array(z.string()).default([]).describe('Side effects of solving each contradiction'),
  inventivePrinciples: z.array(z.string()).default([]).describe('TRIZ principles that could resolve these contradictions'),
  resolutionStrategies: z.array(z.object({
    strategy: z.enum(['SEPARATION_IN_TIME', 'SEPARATION_IN_SPACE', 'SEPARATION_ON_CONDITION', 'SEPARATION_BETWEEN_PARTS', 'INVERSION', 'SUBSTANCE_FIELD_SHIFT', 'DYNAMIZATION']),
    description: z.string(),
    applicableTo: z.string().describe('Which contradiction this resolves'),
  })).default([]),
});
export type ContradictionMapping = z.infer<typeof ContradictionMappingSchema>;

// =============================================================================
// 3.3.5 OBVIOUSNESS FILTER JSON (NEW STAGE)
// =============================================================================

export const ObviousnessFilterSchema = z.object({
  combinationNovelty: z.number().min(0).max(100).describe('How novel is this combination? 0=obvious, 100=highly inventive'),
  obviousnessFlags: z.array(z.enum([
    'COMBINATIONAL',      // Just adding known elements together
    'SAME_DOMAIN',        // All elements from same field
    'PARAMETER_TWEAK',    // Just changing values, not structure
    'OBVIOUS_SUBSTITUTION', // Replacing A with well-known alternative
    'PREDICTABLE_RESULT', // Outcome is expected
  ])).default([]),
  wildCardSuggestion: z.string().optional().describe('Suggestion to increase novelty'),
  dimensionQualityScores: z.array(z.object({
    dimensionId: z.string(),
    noveltyContribution: z.number().min(0).max(100),
    recommendation: z.enum(['KEEP', 'REPLACE', 'INVERT']),
  })).default([]),
  suggestedAnalogySources: z.array(z.string()).default([]).describe('Distant domains to draw analogies from'),
});
export type ObviousnessFilter = z.infer<typeof ObviousnessFilterSchema>;

// =============================================================================
// 3.2 CLASSIFICATION JSON
// =============================================================================

export const ClassificationLabelSchema = z.object({
  class: InventionClassEnum,
  weight: z.number().min(0).max(1).describe('Confidence weight 0-1'),
  rationaleShort: z.string().describe('Brief reason for this classification'),
});
export type ClassificationLabel = z.infer<typeof ClassificationLabelSchema>;

export const ClassificationSchema = z.object({
  labels: z.array(ClassificationLabelSchema).min(1).describe('Multi-label classification'),
  dominantClass: InventionClassEnum.describe('Primary classification'),
  forkMode: ForkModeEnum.describe('Whether to run multiple tracks'),
  archetype: ArchetypeEnum.describe('Technical archetype'),
});
export type Classification = z.infer<typeof ClassificationSchema>;

// =============================================================================
// 3.3 DIMENSION GRAPH JSON (Mind-map nodes + edges)
// =============================================================================

export const DimensionNodeSchema = z.object({
  id: z.string().min(1).describe('Unique node ID within the graph'),
  type: MindMapNodeTypeEnum,
  title: z.string().min(1),
  description: z.string().optional(),
  descriptionShort: z.string().optional(),
  family: z.string().optional().describe('Dimension family name'),
  selectable: z.boolean().default(true),
  defaultExpanded: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  parentId: z.string().optional().describe('Parent node ID for hierarchy'),
  positionX: z.number().optional().describe('X coordinate for React Flow positioning'),
  positionY: z.number().optional().describe('Y coordinate for React Flow positioning'),
  state: z.string().optional().describe('Node expansion state'),
  depth: z.number().optional().describe('Node depth in hierarchy'),
  payloadJson: z.any().optional().describe('Additional payload data'),
});
export type DimensionNode = z.infer<typeof DimensionNodeSchema>;

export const DimensionEdgeSchema = z.object({
  from: z.string().min(1).describe('Source node ID'),
  to: z.string().min(1).describe('Target node ID'),
  relation: z.string().min(1).describe('Relationship type: contains, enables, requires, produces, etc.'),
});
export type DimensionEdge = z.infer<typeof DimensionEdgeSchema>;

export const DimensionGraphSchema = z.object({
  nodes: z.array(DimensionNodeSchema).min(1),
  edges: z.array(DimensionEdgeSchema).default([]),
});
export type DimensionGraph = z.infer<typeof DimensionGraphSchema>;

// Extended node type that includes payloadJson for suggested moves
// This is a standalone interface that matches what we return from the service
// (compatible with both Prisma nulls and Zod undefineds)
export interface DimensionNodeWithPayload {
  id: string;
  type: z.infer<typeof MindMapNodeTypeEnum>;
  title: string;
  description?: string;
  descriptionShort?: string;
  family?: string;
  selectable: boolean;
  defaultExpanded: boolean;
  tags: string[];
  parentId?: string;
  positionX?: number | null;
  positionY?: number | null;
  state?: string | null;
  depth?: number | null;
  payloadJson?: SuggestedMovePayloadType | Record<string, unknown> | null;
}

// Payload structure for suggested moves
export interface SuggestedMovePayloadType {
  move: string;
  impact: string;
  leadsTo: string;
  tension?: string;
  challengesPrior?: boolean;
  modifies?: 'BEHAVIOR_OVER_TIME' | 'ARCHITECTURE_CONTROL_FLOW' | 'INTERFACE_BOUNDARY' | 'FAILURE_MODE_LIFECYCLE';
  isSuggestedMove: true;
}

// Extended graph type for expansion results that include payloadJson
export interface ExpandedDimensionGraph {
  nodes: DimensionNodeWithPayload[];
  edges: Array<{ from: string; to: string; relation: string }>;
}

// =============================================================================
// 3.3.1 SUGGESTED MOVE SCHEMA (Context-Aware Dimension Exploration)
// =============================================================================

/**
 * A SuggestedMove replaces abstract dimension options with actionable invention moves.
 * Each move must modify: behavior, architecture, interface boundary, OR failure mode.
 * Moves are generated dynamically with context from previously selected dimensions.
 */
export const SuggestedMoveSchema = z.object({
  id: z.string().min(1).describe('Unique move ID: move-{familyId}-{N}'),
  move: z.string().min(1).describe('What-if statement: "What if we <design action>?"'),
  impact: z.string().min(1).describe('Immediate behavioral/functional change'),
  leadsTo: z.string().min(1).describe('New constraint, problem, or opportunity this creates'),
  tension: z.string().optional().describe('What existing assumption this challenges'),
  challengesPrior: z.boolean().default(false).describe('True if this relaxes an assumption from prior selections'),
  // Made optional with default to handle LLM inconsistency - fallback to BEHAVIOR_OVER_TIME
  modifies: z.enum([
    'BEHAVIOR_OVER_TIME',
    'ARCHITECTURE_CONTROL_FLOW', 
    'INTERFACE_BOUNDARY',
    'FAILURE_MODE_LIFECYCLE'
  ]).optional().default('BEHAVIOR_OVER_TIME').describe('What structural aspect this move modifies'),
});
export type SuggestedMove = z.infer<typeof SuggestedMoveSchema>;

export const SuggestedMovesResponseSchema = z.object({
  // min(1) instead of min(3) to be lenient - LLMs sometimes return fewer moves
  // The prompt asks for 3-5, but we accept 1+ to avoid parsing failures
  moves: z.array(SuggestedMoveSchema).min(1).max(10),
  contextAcknowledged: z.boolean().default(false).describe('True if prior selections were considered'),
  priorSelectionsUsed: z.array(z.string()).default([]).describe('IDs of prior selections that influenced these moves'),
});
export type SuggestedMovesResponse = z.infer<typeof SuggestedMovesResponseSchema>;

// =============================================================================
// 3.4 COMBINE RECIPE JSON
// =============================================================================

export const CombineRecipeSchema = z.object({
  selectedComponents: z.array(z.string()).default([]).describe('IDs of selected component nodes'),
  selectedDimensions: z.array(z.string()).default([]).describe('IDs of selected dimension nodes'),
  selectedOperators: z.array(z.string()).default([]).describe('IDs of selected operator nodes'),
  recipeIntent: RecipeIntentEnum.default('DIVERGENT'),
  count: z.number().int().min(1).max(20).default(5).describe('Number of ideas to generate'),
  userGuidance: z.string().optional().describe('User-provided guidance for idea generation (HIGH PRIORITY)'),
});
export type CombineRecipe = z.infer<typeof CombineRecipeSchema>;

// =============================================================================
// 3.5 IDEA FRAME JSON (Core output - Enhanced with Inventive Logic)
// =============================================================================

export const IdeaVariantSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  differentiator: z.string().optional().describe('What makes this variant different'),
});
export type IdeaVariant = z.infer<typeof IdeaVariantSchema>;

export const IdeaFrameSchema = z.object({
  ideaId: z.string().min(1).describe('Unique ID for this idea'),
  title: z.string().min(1).max(200),
  // Allow any string labels - LLM may generate custom labels
  classLabels: z.array(z.string()).default([]).describe('Classification labels for the idea'),
  problem: z.string().min(1).describe('Problem being solved'),
  principle: z.string().min(1).max(500).describe('One-liner describing the core principle'),
  coreMechanism: z.string().optional().describe('A single sentence describing the ONE primary inventive mechanism'),
  components: z.array(z.string()).default([]).describe('List of components/parts'),
  mechanismSteps: z.array(z.string()).default([]).describe('How it works, step by step'),
  triggerCondition: z.string().optional().describe('What triggers the mechanism'),
  technicalEffect: z.string().min(1).describe('Technical outcome/benefit'),
  constraintsSatisfied: z.array(z.string()).default([]).describe('Which constraints this addresses'),
  operatorsUsed: z.array(z.string()).default([]).describe('TRIZ operators applied'),
  dimensionsUsed: z.array(z.string()).default([]).describe('Dimensions explored'),
  variants: z.array(IdeaVariantSchema).min(0).max(5).default([]).describe('Alternative embodiments'),
  claimHooks: z.array(z.string()).default([]).describe('Phrases to convert into claim elements'),
  riskNotes: z.array(z.string()).default([]).describe('Why this might fail or be challenged'),
  searchQueries: z.array(z.string()).default([]).describe('Queries for novelty search'),
  
  // NEW: Inventive Logic Fields (Patent-Worthy Enhancement)
  inventiveLeap: z.string().optional().describe('The non-obvious insight that makes this patentable'),
  whyNotObvious: z.string().optional().describe('Why a skilled person would NOT arrive at this solution'),
  analogySource: z.string().optional().describe('Distant domain this draws inspiration from (2+ hops away)'),
  eliminatedComponent: z.string().optional().describe('Traditional element removed or inverted'),
  secondOrderEffect: z.string().optional().describe('Unexpected benefit from the inventive approach'),
  contradictionResolved: z.string().optional().describe('Which technical contradiction this idea resolves'),
  resolutionStrategy: z.string().optional().describe('How the contradiction was resolved (separation, inversion, etc.)'),
});
export type IdeaFrame = z.infer<typeof IdeaFrameSchema>;

// =============================================================================
// 3.6 NOVELTY GATE JSON (Enhanced with Feedback Loop)
// =============================================================================

export const NoveltySearchResultSchema = z.object({
  source: z.string().describe('Where this result came from'),
  title: z.string(),
  snippet: z.string().optional(),
  url: z.string().optional(),
  publicationNumber: z.string().optional().describe('Patent publication number (e.g., US1234567B1)'),
  assignee: z.string().optional().describe('Patent assignee/owner'),
  filingDate: z.string().optional().describe('Patent filing date'),
  similarityScore: z.number().min(0).max(100).optional(),
  whyRelevant: z.string().describe('Why this result is relevant'),
});

// Schema for closest prior art patents identified by LLM
export const ClosestPriorArtSchema = z.object({
  publicationNumber: z.string().default('Unknown').describe('Patent publication number'),
  title: z.string().default('Unknown Patent').describe('Patent title'),
  relevanceScore: z.number().min(0).max(100).default(50).describe('How closely this matches the invention (0-100)'),
  overlappingFeatures: z.array(z.string()).default([]).describe('Features that overlap with the invention'),
  differentiatingFactors: z.array(z.string()).default([]).describe('How the invention differs from this patent'),
  remark: z.string().default('Requires manual review').describe('Brief analysis of this patent vs the invention'),
});
export type ClosestPriorArt = z.infer<typeof ClosestPriorArtSchema>;

// Mutation instructions for iterating weak ideas
export const MutationInstructionsSchema = z.object({
  action: z.enum(['MUTATE_DIMENSION', 'MUTATE_OPERATOR', 'ADD_ANALOGY', 'NARROW_PROBLEM', 'INVERT_APPROACH']),
  specifics: z.string().describe('Detailed instruction for mutation'),
  retainElements: z.array(z.string()).default([]).describe('Elements to keep from original idea'),
  suggestedAnalogy: z.string().optional().describe('Distant domain to draw from'),
  dimensionToReplace: z.string().optional(),
  replacementSuggestion: z.string().optional(),
});
export type MutationInstructions = z.infer<typeof MutationInstructionsSchema>;
export type NoveltySearchResult = z.infer<typeof NoveltySearchResultSchema>;

export const NoveltyGateSchema = z.object({
  query: z.string().describe('The search query used'),
  results: z.array(NoveltySearchResultSchema).default([]),
  conceptSaturation: SaturationLevelEnum.describe('How crowded is the concept space'),
  solutionSaturation: SaturationLevelEnum.describe('How crowded is this specific solution'),
  noveltyScore: z.number().int().min(0).max(100).describe('Overall novelty assessment 0-100'),
  recommendedAction: NoveltyActionEnum.describe('What to do next'),
  reasoning: z.string().optional().describe('Explanation of the assessment'),
  
  // Prior art analysis
  patentsAnalyzed: z.number().optional().describe('Total number of patents analyzed'),
  closestPriorArt: z.array(ClosestPriorArtSchema).default([]).describe('Top 3-5 most relevant prior art patents with analysis'),
  priorArtSummary: z.string().optional().describe('Brief summary of prior art landscape and how invention differentiates'),
  
  // Enhanced feedback loop fields
  obviousnessFlags: z.array(z.enum([
    'COMBINATIONAL',      // Just adding known elements together
    'SAME_DOMAIN',        // All elements from same field  
    'PARAMETER_TWEAK',    // Just changing values, not structure
    'OBVIOUS_SUBSTITUTION', // Replacing A with well-known alternative
    'PREDICTABLE_RESULT', // Outcome is expected
  ])).default([]),
  mutationInstructions: MutationInstructionsSchema.optional().describe('How to improve if novelty is low'),
  phositaTest: z.string().optional().describe('Why a Person Having Ordinary Skill In The Art would/would not find this obvious'),
  suggestedIterations: z.array(z.string()).default([]).describe('Specific suggestions to increase novelty'),
});
export type NoveltyGate = z.infer<typeof NoveltyGateSchema>;

// =============================================================================
// TRIZ OPERATORS (Pre-defined library)
// =============================================================================

export const TrizOperatorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  examples: z.array(z.string()).default([]),
  applicableTo: z.array(InventionClassEnum).default([]),
});
export type TrizOperator = z.infer<typeof TrizOperatorSchema>;

// Pre-defined TRIZ-lite operators
export const TRIZ_OPERATORS: TrizOperator[] = [
  {
    id: 'op-segmentation',
    name: 'Segmentation',
    description: 'Divide an object into independent parts; make it modular or sectional',
    examples: ['Modular furniture', 'Segmented plunger that snaps'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'MANUFACTURING'],
  },
  {
    id: 'op-extraction',
    name: 'Extraction',
    description: 'Remove or separate a disturbing part or property',
    examples: ['Remove heat with heat sink', 'Extract noise with dampeners'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'op-local-quality',
    name: 'Local Quality',
    description: 'Change uniform structure to non-uniform; make each part optimal for its function',
    examples: ['Variable thickness walls', 'Graded materials'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'MANUFACTURING'],
  },
  {
    id: 'op-asymmetry',
    name: 'Asymmetry',
    description: 'Replace symmetric forms with asymmetric ones',
    examples: ['Asymmetric tire treads', 'Off-center handles'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-merging',
    name: 'Merging',
    description: 'Combine identical or similar objects; unite operations in time',
    examples: ['Multi-blade razors', 'Combined washer-dryer'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'op-universality',
    name: 'Universality',
    description: 'Make an object perform multiple functions; eliminate need for other parts',
    examples: ['Swiss army knife', 'Smartphone'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'SOFTWARE_ALGORITHM'],
  },
  {
    id: 'op-nesting',
    name: 'Nesting',
    description: 'Place one object inside another; pass one through cavity of another',
    examples: ['Telescoping antenna', 'Nested containers'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-counterweight',
    name: 'Counterweight',
    description: 'Compensate weight with another weight; use aerodynamic/hydrodynamic forces',
    examples: ['Counterbalanced crane', 'Hydrofoils'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-prior-action',
    name: 'Prior Action',
    description: 'Perform required change before it is needed; pre-arrange objects',
    examples: ['Pre-stressed concrete', 'Pre-formatted forms'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING', 'SYSTEM'],
  },
  {
    id: 'op-prior-counteraction',
    name: 'Prior Counteraction',
    description: 'Create stresses in advance to oppose known undesirable stresses',
    examples: ['Pre-tensioned cables', 'Preventive medication'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING', 'BIOTECH_PHARMA'],
  },
  {
    id: 'op-equipotentiality',
    name: 'Equipotentiality',
    description: 'Eliminate need to raise or lower objects; change operating conditions',
    examples: ['Locks in canals', 'Pressure equalization'],
    applicableTo: ['SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'op-inversion',
    name: 'Inversion',
    description: 'Invert the action; make fixed parts movable and vice versa',
    examples: ['Inside-out umbrella', 'Rotating object vs rotating tool'],
    applicableTo: ['PRODUCT_DEVICE', 'METHOD_PROCESS', 'SYSTEM'],
  },
  {
    id: 'op-spheroidality',
    name: 'Spheroidality/Curvature',
    description: 'Replace linear parts with curved; use rollers, balls, spirals',
    examples: ['Ball bearings', 'Dome structures'],
    applicableTo: ['PRODUCT_DEVICE', 'MANUFACTURING'],
  },
  {
    id: 'op-dynamics',
    name: 'Dynamics',
    description: 'Allow characteristics to change; divide into parts that can move relative to each other',
    examples: ['Adjustable furniture', 'Flexible displays'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-partial-excessive',
    name: 'Partial or Excessive Action',
    description: 'If 100% is hard, do more or less; solve partial problem first',
    examples: ['Overfilling then removing excess', 'Quick approximation then refinement'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING', 'SOFTWARE_ALGORITHM'],
  },
  {
    id: 'op-dimension-change',
    name: 'Dimension Change',
    description: 'Move into another dimension; use multi-layer assembly; tilt or reorient',
    examples: ['3D printing', 'Multi-story buildings'],
    applicableTo: ['PRODUCT_DEVICE', 'MANUFACTURING', 'SYSTEM'],
  },
  {
    id: 'op-vibration',
    name: 'Mechanical Vibration',
    description: 'Use oscillation; increase frequency; use resonance',
    examples: ['Ultrasonic cleaning', 'Vibratory feeders'],
    applicableTo: ['PRODUCT_DEVICE', 'METHOD_PROCESS', 'MANUFACTURING'],
  },
  {
    id: 'op-periodic-action',
    name: 'Periodic Action',
    description: 'Replace continuous action with periodic; use pauses for other actions',
    examples: ['Pulsed lasers', 'Intermittent wipers'],
    applicableTo: ['METHOD_PROCESS', 'SYSTEM', 'SOFTWARE_ALGORITHM'],
  },
  {
    id: 'op-continuity',
    name: 'Continuity of Action',
    description: 'Carry out action continuously; eliminate idle motions',
    examples: ['Continuous casting', 'Conveyor systems'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING'],
  },
  {
    id: 'op-rushing-through',
    name: 'Rushing Through',
    description: 'Conduct harmful process at very high speed',
    examples: ['High-speed cutting through heat zone', 'Quick freeze'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING'],
  },
  {
    id: 'op-harm-to-benefit',
    name: 'Convert Harm to Benefit',
    description: 'Use harmful factors to achieve positive effect',
    examples: ['Using waste heat', 'Controlled explosions in mining'],
    applicableTo: ['METHOD_PROCESS', 'SYSTEM', 'MANUFACTURING'],
  },
  {
    id: 'op-feedback',
    name: 'Feedback',
    description: 'Introduce feedback; if feedback exists, change its magnitude or influence',
    examples: ['Thermostat', 'Auto-focus'],
    applicableTo: ['SYSTEM', 'SOFTWARE_ALGORITHM', 'PRODUCT_DEVICE'],
  },
  {
    id: 'op-intermediary',
    name: 'Intermediary',
    description: 'Use intermediate carrier or process',
    examples: ['Catalysts', 'Buffer zones'],
    applicableTo: ['METHOD_PROCESS', 'COMPOSITION', 'SYSTEM'],
  },
  {
    id: 'op-self-service',
    name: 'Self-Service',
    description: 'Make object serve itself; use waste resources',
    examples: ['Self-cleaning ovens', 'Regenerative braking'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-copying',
    name: 'Copying',
    description: 'Use simple and inexpensive copies; replace with optical copies or images',
    examples: ['Virtual prototypes', 'Digital twins'],
    applicableTo: ['METHOD_PROCESS', 'SOFTWARE_ALGORITHM', 'SYSTEM'],
  },
  {
    id: 'op-cheap-disposable',
    name: 'Cheap Short-Living',
    description: 'Replace expensive object with multiple cheap ones; accept shorter life',
    examples: ['Disposable medical devices', 'Single-use cameras'],
    applicableTo: ['PRODUCT_DEVICE', 'MANUFACTURING'],
  },
  {
    id: 'op-substitute-mechanical',
    name: 'Mechanical Substitution',
    description: 'Replace mechanical means with sensory, optical, acoustic',
    examples: ['Touch screens', 'Voice commands'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'SOFTWARE_ALGORITHM'],
  },
  {
    id: 'op-pneumatics-hydraulics',
    name: 'Pneumatics/Hydraulics',
    description: 'Use gas or liquid parts instead of solid; inflatable, fluid-filled',
    examples: ['Air cushions', 'Hydraulic lifts'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-flexible-membranes',
    name: 'Flexible Membranes',
    description: 'Use flexible shells and thin films; isolate with flexible membranes',
    examples: ['Shrink wrap', 'Membrane keyboards'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION'],
  },
  {
    id: 'op-porous-materials',
    name: 'Porous Materials',
    description: 'Make object porous; add porous elements; fill pores with useful substance',
    examples: ['Foam structures', 'Drug-eluting stents'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'BIOTECH_PHARMA'],
  },
  {
    id: 'op-color-change',
    name: 'Color Change',
    description: 'Change color or translucency; use additives to observe',
    examples: ['Temperature-indicating strips', 'UV-reactive materials'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'METHOD_PROCESS'],
  },
  {
    id: 'op-homogeneity',
    name: 'Homogeneity',
    description: 'Make objects interact with same material or matched properties',
    examples: ['Same-material joints', 'Matched thermal expansion'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'MANUFACTURING'],
  },
  {
    id: 'op-discarding-recovering',
    name: 'Discarding/Recovering',
    description: 'Make portions that have fulfilled function disappear or modify',
    examples: ['Dissolvable sutures', 'Rocket stage separation'],
    applicableTo: ['PRODUCT_DEVICE', 'BIOTECH_PHARMA', 'SYSTEM'],
  },
  {
    id: 'op-parameter-change',
    name: 'Parameter Change',
    description: 'Change physical/chemical parameters: concentration, flexibility, temperature',
    examples: ['Heat treatment', 'pH adjustment'],
    applicableTo: ['METHOD_PROCESS', 'COMPOSITION', 'MANUFACTURING'],
  },
  {
    id: 'op-phase-transition',
    name: 'Phase Transition',
    description: 'Use phase transition phenomena: volume changes, heat absorption',
    examples: ['Ice packs', 'Phase-change memory'],
    applicableTo: ['COMPOSITION', 'PRODUCT_DEVICE', 'METHOD_PROCESS'],
  },
  {
    id: 'op-thermal-expansion',
    name: 'Thermal Expansion',
    description: 'Use thermal expansion/contraction; use materials with different coefficients',
    examples: ['Bimetallic strips', 'Shrink-fit assemblies'],
    applicableTo: ['PRODUCT_DEVICE', 'MANUFACTURING'],
  },
  {
    id: 'op-oxidation',
    name: 'Strong Oxidizers',
    description: 'Replace normal air with oxygen-enriched; use ozone; use ionized oxygen',
    examples: ['Oxygen cutting', 'Ozone sterilization'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING', 'BIOTECH_PHARMA'],
  },
  {
    id: 'op-inert-atmosphere',
    name: 'Inert Atmosphere',
    description: 'Replace normal environment with inert; add neutral parts or inert additives',
    examples: ['Nitrogen packaging', 'Argon welding'],
    applicableTo: ['METHOD_PROCESS', 'MANUFACTURING', 'COMPOSITION'],
  },
  {
    id: 'op-composite',
    name: 'Composite Materials',
    description: 'Change from uniform to composite materials',
    examples: ['Carbon fiber composites', 'Reinforced concrete'],
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'MANUFACTURING'],
  },
];

// =============================================================================
// DIMENSION FAMILIES (Pre-defined categories)
// =============================================================================

export const DimensionFamilySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().optional(),
  applicableTo: z.array(InventionClassEnum).default([]),
});
export type DimensionFamily = z.infer<typeof DimensionFamilySchema>;

export const DIMENSION_FAMILIES: DimensionFamily[] = [
  {
    id: 'dim-mechanism',
    name: 'Mechanism',
    description: 'How the invention works: mechanical, electrical, chemical, biological',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-material',
    name: 'Material',
    description: 'What the invention is made of: metals, polymers, composites, bio-materials',
    applicableTo: ['PRODUCT_DEVICE', 'COMPOSITION', 'MANUFACTURING'],
  },
  {
    id: 'dim-structure',
    name: 'Structure',
    description: 'Physical arrangement: shape, geometry, layers, topology',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'COMPOSITION'],
  },
  {
    id: 'dim-lifecycle',
    name: 'Lifecycle',
    description: 'Stages of existence: manufacture, use, maintenance, disposal, recycling',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS', 'MANUFACTURING'],
  },
  {
    id: 'dim-interface',
    name: 'Interface',
    description: 'Connection points: user interface, system interfaces, APIs, physical connectors',
    applicableTo: ['SYSTEM', 'SOFTWARE_ALGORITHM', 'PRODUCT_DEVICE'],
  },
  {
    id: 'dim-control',
    name: 'Control',
    description: 'How behavior is regulated: feedback, feedforward, adaptive, manual',
    applicableTo: ['SYSTEM', 'SOFTWARE_ALGORITHM', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-energy',
    name: 'Energy',
    description: 'Power sources and consumption: electrical, thermal, kinetic, chemical',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-information',
    name: 'Information',
    description: 'Data aspects: sensing, processing, storage, transmission, display',
    applicableTo: ['SYSTEM', 'SOFTWARE_ALGORITHM', 'PRODUCT_DEVICE'],
  },
  {
    id: 'dim-environment',
    name: 'Environment',
    description: 'Operating context: temperature, humidity, pressure, contamination',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-risk',
    name: 'Risk/Failure',
    description: 'What could go wrong: misuse, wear, contamination, side effects',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS', 'BIOTECH_PHARMA'],
  },
  {
    id: 'dim-cost',
    name: 'Cost',
    description: 'Economic factors: material cost, manufacturing cost, maintenance, TCO',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'MANUFACTURING', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-scale',
    name: 'Scale',
    description: 'Size considerations: miniaturization, scaling up, batch vs continuous',
    applicableTo: ['PRODUCT_DEVICE', 'MANUFACTURING', 'METHOD_PROCESS'],
  },
  {
    id: 'dim-time',
    name: 'Time',
    description: 'Temporal aspects: speed, duration, sequencing, synchronization',
    applicableTo: ['METHOD_PROCESS', 'SYSTEM', 'SOFTWARE_ALGORITHM'],
  },
  {
    id: 'dim-user',
    name: 'User',
    description: 'Human factors: ergonomics, accessibility, training, safety',
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'SERVICE_WORKFLOW'],
  },
  {
    id: 'dim-regulatory',
    name: 'Regulatory',
    description: 'Compliance requirements: safety standards, certifications, patents',
    applicableTo: ['PRODUCT_DEVICE', 'BIOTECH_PHARMA', 'MANUFACTURING'],
  },
];

// =============================================================================
// LLM PROMPT HELPERS
// =============================================================================

/**
 * Get the JSON schema string for a given schema (for LLM prompts)
 */
export function getSchemaDescription(schemaName: string): string {
  const descriptions: Record<string, string> = {
    InputNormalization: `{
  "coreEntity": "string (main invention/concept)",
  "intentGoal": "string (what to achieve)",
  "constraints": ["string array of hard constraints"],
  "assumptions": ["string array of assumed conditions"],
  "context": "string (domain/use setting)",
  "negativeConstraints": ["things forbidden, e.g., 'no electronics'"],
  "knownComponents": ["parts already mentioned"],
  "unknownsToAsk": ["clarifying questions for user"]
}`,
    Classification: `{
  "labels": [{"class": "PRODUCT_DEVICE|SYSTEM|METHOD_PROCESS|...", "weight": 0.0-1.0, "rationaleShort": "reason"}],
  "dominantClass": "primary classification",
  "forkMode": "SINGLE|FORK|MERGE",
  "archetype": "MECH|ELEC|SOFT|CHEM|BIO|MIXED"
}`,
    DimensionGraph: `{
  "nodes": [{"id": "unique-id", "type": "SEED|COMPONENT|DIMENSION_FAMILY|...", "title": "name", "descriptionShort": "desc", "family": "dimension family", "selectable": true, "defaultExpanded": false, "tags": [], "parentId": "parent-id"}],
  "edges": [{"from": "source-id", "to": "target-id", "relation": "contains|enables|requires|..."}]
}`,
    IdeaFrame: `{
  "ideaId": "unique-id",
  "title": "invention title (max 200 chars)",
  "classLabels": ["PRODUCT_DEVICE", ...],
  "problem": "problem being solved",
  "principle": "one-liner core principle (max 300 chars)",
  "components": ["list of components"],
  "mechanismSteps": ["step 1", "step 2", ...],
  "triggerCondition": "what triggers the mechanism",
  "technicalEffect": "technical outcome/benefit",
  "constraintsSatisfied": ["constraints addressed"],
  "operatorsUsed": ["TRIZ operators applied"],
  "dimensionsUsed": ["dimensions explored"],
  "variants": [{"title": "variant", "description": "desc", "differentiator": "difference"}],
  "claimHooks": ["phrases for claim elements"],
  "riskNotes": ["potential challenges"],
  "searchQueries": ["novelty search queries"]
}`,
    NoveltyGate: `{
  "conceptSaturation": "LOW|MEDIUM|HIGH",
  "solutionSaturation": "LOW|MEDIUM|HIGH",
  "noveltyScore": 0-100,
  "recommendedAction": "KEEP|MUTATE_OPERATOR|MUTATE_DIMENSION|NARROW_MICRO_PROBLEM|ASK_USER_QUESTION",
  "reasoning": "explanation of assessment",
  "closestPriorArt": [
    {
      "publicationNumber": "patent number from search results",
      "title": "patent title",
      "relevanceScore": 0-100,
      "overlappingFeatures": ["features that overlap with invention"],
      "differentiatingFactors": ["how invention differs"],
      "remark": "1-2 sentence analysis"
    }
  ],
  "priorArtSummary": "2-3 sentence summary of prior art landscape and differentiation",
  "obviousnessFlags": ["COMBINATIONAL", "SAME_DOMAIN", "PARAMETER_TWEAK", "OBVIOUS_SUBSTITUTION", "PREDICTABLE_RESULT"],
  "phositaTest": "why PHOSITA would/wouldn't find this obvious",
  "suggestedIterations": ["suggestions to increase novelty"],
  "mutationInstructions": {"action": "MUTATE_DIMENSION|ADD_ANALOGY|etc", "specifics": "details", "retainElements": [], "suggestedAnalogy": "domain"}
}`,
    SuggestedMovesResponse: `{
  "moves": [
    {
      "id": "move-{familyId}-1",
      "move": "What if we <specific design action that changes structure/behavior>?",
      "impact": "<immediate behavioral or functional change>",
      "leadsTo": "<new constraint, problem, or opportunity this creates>",
      "tension": "<what existing assumption this challenges, if any>",
      "challengesPrior": true/false,
      "modifies": "BEHAVIOR_OVER_TIME|ARCHITECTURE_CONTROL_FLOW|INTERFACE_BOUNDARY|FAILURE_MODE_LIFECYCLE"
    }
  ],
  "contextAcknowledged": true/false,
  "priorSelectionsUsed": ["id-of-prior-selection", ...]
}`,
  };
  return descriptions[schemaName] || 'Schema not found';
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Safely parse JSON from LLM response with repair attempt
 */
export function safeParseJson<T>(
  jsonString: string,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    // Try to extract JSON from markdown code blocks
    let cleaned = jsonString.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      cleaned = jsonMatch[1].trim();
    }
    
    // Remove any leading/trailing text before/after JSON
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    
    const parsed = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { 
        success: false, 
        error: `Validation failed: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}` 
      };
    }
  } catch (e) {
    return { 
      success: false, 
      error: `JSON parse error: ${e instanceof Error ? e.message : 'Unknown error'}` 
    };
  }
}

/**
 * Validate an IdeaFrame array
 */
export function validateIdeaFrames(data: unknown): IdeaFrame[] {
  const arraySchema = z.array(IdeaFrameSchema);
  const result = arraySchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw new Error(`Invalid idea frames: ${result.error.message}`);
}

