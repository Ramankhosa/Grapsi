/**
 * Ideation Engine Service
 * 
 * Backend service for the mind-map patent ideation engine.
 * Handles session management, LLM calls, novelty searches, and idea generation.
 */

import { prisma } from '@/lib/prisma';
import { serpApiProvider } from '@/lib/serpapi-provider';
import { z } from 'zod';
import {
  InputNormalizationSchema,
  ClassificationSchema,
  DimensionGraphSchema,
  IdeaFrameSchema,
  NoveltyGateSchema,
  ContradictionMappingSchema,
  ObviousnessFilterSchema,
  SuggestedMovesResponseSchema,
  SuggestedMoveSchema,
  safeParseJson,
  getSchemaDescription,
  TRIZ_OPERATORS,
  DIMENSION_FAMILIES,
  type InputNormalization,
  type Classification,
  type DimensionGraph,
  type DimensionNode,
  type IdeaFrame,
  type NoveltyGate,
  type CombineRecipe,
  type InventionClass,
  type TrizOperator,
  type DimensionFamily,
  type ContradictionMapping,
  type ObviousnessFilter,
  type SuggestedMove,
  type SuggestedMovesResponse,
  type ExpandedDimensionGraph,
  type SuggestedMovePayloadType,
} from './schemas';
import type { 
  IdeationSession, 
  MindMapNode, 
  IdeaFrame as PrismaIdeaFrame,
  Prisma,
} from '@prisma/client';
import crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  seedText: string;
  seedGoal?: string;
  seedConstraints?: string[];
  budgetCap?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ExpandNodeInput {
  sessionId: string;
  nodeId: string;
  depth?: number;
  requestHeaders: Record<string, string>;
  userInput?: string;  // User's specific direction/thought to explore
}

export interface GenerateIdeasInput {
  sessionId: string;
  recipe: CombineRecipe;
  requestHeaders: Record<string, string>;
  userGuidance?: string;  // User's guidance for how to approach idea generation
}

export interface NoveltyCheckInput {
  sessionId: string;
  ideaFrameId: string;
  requestHeaders: Record<string, string>;
}

export interface ExportToIdeaBankInput {
  sessionId: string;
  ideaFrameIds: string[];
  userId: string;
  tenantId: string;
}

// Import the LLM Gateway for proper API key handling
import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'

// =============================================================================
// LLM INTEGRATION (Using existing LLM Gateway)
// =============================================================================

/**
 * Call LLM through the existing gateway infrastructure
 * This ensures proper API key handling, rate limiting, and cost tracking
 * 
 * Model Resolution:
 * The gateway uses stageCode to resolve the model configured by Super Admin
 * for each ideation stage (IDEATION_NORMALIZE, IDEATION_CLASSIFY, etc.)
 */
async function callLLM(
  prompt: string,
  taskCode: string,
  sessionId: string,
  requestHeaders: Record<string, string>,
): Promise<{ response: string; tokensUsed: number; model: string }> {
  try {
    // Use the existing LLM gateway which handles API keys properly
    // stageCode enables Super Admin to configure which model to use for each ideation stage
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders },
      {
        taskCode: taskCode as TaskCode,
        stageCode: taskCode, // Use taskCode as stageCode for model resolution (e.g., IDEATION_NORMALIZE)
        prompt,
        parameters: {
          temperature: 0.7,
        },
        idempotencyKey: `ideation-${sessionId}-${taskCode}-${Date.now()}`,
        metadata: {
          sessionId,
          module: 'ideation',
        }
      }
    );

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'LLM call failed');
    }

    const response = result.response.output;
    const tokensUsed = result.response.outputTokens || 0;
    const model = result.response.modelClass || 'unknown';

    // Log the LLM call - get session for userId
    const session = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    await prisma.ideationHistory.create({
      data: {
        sessionId,
        action: `LLM_CALL_${taskCode}`,
        stage: taskCode,
        inputJson: { prompt: prompt.slice(0, 1000) }, // Truncate for storage
        outputJson: { response: response.slice(0, 1000) },
        userId: session?.userId || 'unknown',
        tokensUsed,
        modelUsed: model,
      },
    });

    return { response, tokensUsed, model };
  } catch (error) {
    console.error(`LLM call failed for ${taskCode}:`, error);
    throw error;
  }
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Create a new ideation session
 */
export async function createSession(input: CreateSessionInput): Promise<IdeationSession> {
  const session = await prisma.ideationSession.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      seedText: input.seedText,
      seedGoal: input.seedGoal,
      seedConstraints: input.seedConstraints || [],
      budgetCap: input.budgetCap || 'MEDIUM',
      status: 'SEED_INPUT',
    },
  });

  // Create the seed node (positioned at left for left-to-right flow)
  await prisma.mindMapNode.create({
    data: {
      sessionId: session.id,
      nodeId: 'seed-root',
      type: 'SEED',
      title: input.seedText.slice(0, 100),
      description: input.seedText,
      state: 'EXPANDED',
      selectable: false,
      defaultExpanded: true,
      depth: 0,
      positionX: 50,
      positionY: 200,
    },
  });

  // Log session creation
  await prisma.ideationHistory.create({
    data: {
      sessionId: session.id,
      action: 'SESSION_CREATED',
      stage: 'SEED_INPUT',
      inputJson: { seedText: input.seedText },
      userId: input.userId,
    },
  });

  return session;
}

/**
 * Get session with all related data
 */
export async function getSession(sessionId: string) {
  return prisma.ideationSession.findUnique({
    where: { id: sessionId },
    include: {
      nodes: { orderBy: { createdAt: 'asc' } },
      edges: true,
      combineTray: true,
      ideaFrames: { orderBy: { createdAt: 'desc' } },
      evidenceResults: true,
    },
  });
}

/**
 * List sessions for a user
 */
export async function listSessions(userId: string, tenantId: string) {
  return prisma.ideationSession.findMany({
    where: { userId, tenantId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: { ideaFrames: true, nodes: true },
      },
    },
  });
}

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize the seed input using LLM
 * @param sessionId - The ideation session ID
 * @param requestHeaders - HTTP headers from the API request (must include Authorization)
 */
export async function normalizeSeed(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<InputNormalization> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const prompt = `You are a patent ideation assistant specializing in extracting INVENTIVE problems. Analyze the following invention idea and extract structured information, focusing on underlying CONTRADICTIONS that drive innovation.

INPUT IDEA:
"""
${session.seedText}
"""

${session.seedGoal ? `STATED GOAL: ${session.seedGoal}` : ''}
${session.seedConstraints.length > 0 ? `USER CONSTRAINTS: ${session.seedConstraints.join(', ')}` : ''}

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('InputNormalization')}

CRITICAL RULES:
- coreEntity: The main physical or conceptual thing being invented
- intentGoal: What the user wants to achieve or solve
- constraints: Hard limits mentioned (cost, size, no electronics, etc.)
- negativeConstraints: Things explicitly forbidden
- unknownsToAsk: Questions that would help clarify the invention (max 3)

CONTRADICTION EXTRACTION (Most Important):
- technicalContradictions: Identify 1-3 underlying tradeoffs where improving one parameter worsens another
  * Example: "lightweight" vs "durable" - making it lighter makes it weaker
  * If not explicit, INFER from goal vs constraint conflict
- unstatedAssumptions: Hidden assumptions in the problem that could be challenged (e.g., "must be single-piece")
- secondOrderGoals: Goals that emerge from solving the primary goal
- patentableProblemStatement: Reframe the problem in inventive terms (focus on the CONTRADICTION, not just the wish)

Example contradiction format:
{
  "parameterToImprove": "comfort (soft material)",
  "parameterThatWorsens": "safety (rigidity)",
  "conflictDescription": "Softer materials increase comfort but reduce protective capability"
}

Do NOT invent facts; derive contradictions from the stated context.`;

  const { response, tokensUsed, model } = await callLLM(
    prompt,
    'IDEATION_NORMALIZE',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, InputNormalizationSchema);
  
  if (!parsed.success) {
    throw new Error(`Normalization failed: ${parsed.error}`);
  }

  // Update session with normalization
  // Ensure all required fields have defaults
  const normalizedData: InputNormalization = {
    coreEntity: parsed.data.coreEntity,
    intentGoal: parsed.data.intentGoal,
    constraints: parsed.data.constraints ?? [],
    assumptions: parsed.data.assumptions ?? [],
    negativeConstraints: parsed.data.negativeConstraints ?? [],
    knownComponents: parsed.data.knownComponents ?? [],
    unknownsToAsk: parsed.data.unknownsToAsk ?? [],
    context: parsed.data.context,
    // NEW: Contradiction extraction fields
    technicalContradictions: parsed.data.technicalContradictions ?? [],
    unstatedAssumptions: parsed.data.unstatedAssumptions ?? [],
    secondOrderGoals: parsed.data.secondOrderGoals ?? [],
    patentableProblemStatement: parsed.data.patentableProblemStatement,
  };

  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      normalizationJson: normalizedData as any,
      status: normalizedData.unknownsToAsk.length > 0 ? 'CLARIFYING' : 'CLASSIFYING',
    },
  });

  return normalizedData;
}

// =============================================================================
// CLASSIFICATION
// =============================================================================

/**
 * Classify the normalized invention
 * @param sessionId - The ideation session ID
 * @param requestHeaders - HTTP headers from the API request (must include Authorization)
 */
export async function classifyInvention(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<Classification> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must be normalized before classification');
  }

  const normalization = session.normalizationJson as InputNormalization;

  const prompt = `You are a patent classification expert. Classify the following invention into appropriate categories.

INVENTION:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Components: ${normalization.knownComponents?.join(', ') || 'Not specified'}
- Context: ${normalization.context || 'General'}
- Constraints: ${normalization.constraints?.join(', ') || 'None'}

AVAILABLE CLASSES:
- PRODUCT_DEVICE: Physical objects (syringe, umbrella, shoe)
- SYSTEM: Multiple interacting components (often software + hardware)
- METHOD_PROCESS: Steps/procedures (manufacturing, operating, analysis)
- COMPOSITION: Chemical, materials, mixtures
- SOFTWARE_ALGORITHM: Pure logic/data processing
- BIOTECH_PHARMA: Biological materials, treatments
- MANUFACTURING: Process + tooling + QA
- SERVICE_WORKFLOW: Human-centered operational methods
- HYBRID: When multiple classes are equally strong

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('Classification')}

Rules:
- Assign weights that sum to ~1.0 across top labels
- If top-2 weights are within 0.15, set forkMode to "FORK"
- archetype should reflect the dominant technical domain`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_CLASSIFY',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ClassificationSchema);
  
  if (!parsed.success) {
    throw new Error(`Classification failed: ${parsed.error}`);
  }

  // Update session
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      classificationJson: parsed.data as any,
      status: 'EXPANDING',
      activeTracks: parsed.data.forkMode === 'FORK' 
        ? parsed.data.labels.slice(0, 2).map(l => l.class)
        : [parsed.data.dominantClass],
    },
  });

  return parsed.data;
}

// =============================================================================
// STAGE 2.5: CONTRADICTION MAPPING (NEW)
// =============================================================================

/**
 * Map contradictions to TRIZ principles and resolution strategies
 * This makes contradictions first-class citizens in the ideation process
 */
export async function mapContradictions(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<ContradictionMapping> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must be normalized before contradiction mapping');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const existingContradictions = normalization.technicalContradictions || [];

  const prompt = `You are a TRIZ expert and patent strategist. Analyze the contradictions in this invention and map them to resolution strategies.

INVENTION CONTEXT:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Constraints: ${normalization.constraints?.join(', ') || 'None'}
- Forbidden: ${normalization.negativeConstraints?.join(', ') || 'None'}

IDENTIFIED CONTRADICTIONS:
${existingContradictions.length > 0 
  ? existingContradictions.map((c, i) => `${i + 1}. Improve "${c.parameterToImprove}" → Worsens "${c.parameterThatWorsens}": ${c.conflictDescription}`).join('\n')
  : 'None explicitly identified - you must infer them from the goal vs constraints'
}

Return ONLY valid JSON:
${getSchemaDescription('ContradictionMapping')}

RULES:
1. If no contradictions were identified, INFER them from goal vs constraint conflicts
2. For each contradiction, explain WHY it's hard to solve (not just what it is)
3. Map to TRIZ inventive principles that could resolve each contradiction
4. Suggest resolution strategies:
   - SEPARATION_IN_TIME: Do X at time T1, Y at time T2
   - SEPARATION_IN_SPACE: X happens in region A, Y in region B
   - SEPARATION_ON_CONDITION: X when condition C, Y when not C
   - SEPARATION_BETWEEN_PARTS: Part A does X, Part B does Y
   - INVERSION: Instead of X, do opposite of X
   - SUBSTANCE_FIELD_SHIFT: Change the field/energy type
   - DYNAMIZATION: Make static parts dynamic
5. Identify second-order effects (solving contradiction A may create B)

Example inventive principles: Segmentation, Extraction, Local Quality, Asymmetry, Merging, Universality, Nesting, Anti-weight, Prior Counteraction, Prior Action, Cushion in Advance, Equipotentiality, Inversion, Spheroidality, Dynamics, Partial/Excessive Action`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_CONTRADICTION_MAPPING',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ContradictionMappingSchema);
  
  if (!parsed.success) {
    // Return minimal valid structure on parse failure
    const fallback: ContradictionMapping = {
      contradictions: existingContradictions.map(c => ({
        parameterToImprove: c.parameterToImprove,
        parameterThatWorsens: c.parameterThatWorsens,
        whyThisIsHard: 'Auto-derived from normalization',
      })),
      secondOrderEffects: [],
      inventivePrinciples: [],
      resolutionStrategies: [],
    };
    return fallback;
  }

  // Ensure all fields have proper defaults
  const result: ContradictionMapping = {
    contradictions: parsed.data.contradictions,
    secondOrderEffects: parsed.data.secondOrderEffects ?? [],
    inventivePrinciples: parsed.data.inventivePrinciples ?? [],
    resolutionStrategies: parsed.data.resolutionStrategies ?? [],
  };

  // Store contradiction mapping in session
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      normalizationJson: {
        ...(session.normalizationJson as object),
        contradictionMapping: result,
      },
    },
  });

  return result;
}

// =============================================================================
// STAGE 3.5: OBVIOUSNESS FILTER (NEW)
// =============================================================================

/**
 * Score selected dimensions for novelty BEFORE idea generation
 * Prevents wasting LLM calls on obvious combinations
 */
export async function checkObviousness(
  sessionId: string,
  selectedDimensions: string[],
  requestHeaders: Record<string, string>
): Promise<ObviousnessFilter> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { nodes: true },
  });

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;
  
  // Get dimension details
  const dimensionNodes = session.nodes.filter(n => selectedDimensions.includes(n.nodeId));
  const dimensionDetails = dimensionNodes.map(n => `${n.family}: ${n.title} (${n.description || 'no desc'})`);

  const prompt = `You are a patent examiner assessing obviousness. Would a person having ordinary skill in the art (PHOSITA) find this combination obvious?

INVENTION:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Domain: ${classification.archetype}

SELECTED DIMENSIONS FOR COMBINATION:
${dimensionDetails.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY valid JSON:
${getSchemaDescription('ObviousnessFilter')}

ASSESSMENT CRITERIA:
1. combinationNovelty (0-100):
   - 0-30: Obvious - known combination in the field
   - 31-50: Marginal - somewhat predictable
   - 51-70: Non-obvious - unexpected combination
   - 71-100: Highly inventive - cross-domain leap

2. obviousnessFlags - mark ALL that apply:
   - COMBINATIONAL: Just adding known elements (A + B)
   - SAME_DOMAIN: All elements from same technical field
   - PARAMETER_TWEAK: Only changing values, not structure
   - OBVIOUS_SUBSTITUTION: Well-known material/component swap
   - PREDICTABLE_RESULT: Expected outcome from this combo

3. If combinationNovelty < 40:
   - Suggest a "wildCardSuggestion" - an unexpected dimension from a DISTANT domain
   - Example: For mechanical problem, suggest biological analogy

4. dimensionQualityScores: Rate each dimension's novelty contribution
   - KEEP: Contributes to novelty
   - REPLACE: Too obvious, suggest replacement
   - INVERT: Try the opposite approach

5. suggestedAnalogySources: List 2-3 distant domains to draw from
   - Should be 2+ conceptual hops away from ${classification.archetype}`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_OBVIOUSNESS_FILTER',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ObviousnessFilterSchema);
  
  if (!parsed.success) {
    // Return default moderate score on failure
    const fallback: ObviousnessFilter = {
      combinationNovelty: 50,
      obviousnessFlags: [],
      dimensionQualityScores: [],
      suggestedAnalogySources: [],
    };
    return fallback;
  }

  return parsed.data as ObviousnessFilter;
}

// =============================================================================
// DIMENSION EXPANSION
// =============================================================================

/**
 * Get applicable dimension families based on classification
 */
export function getApplicableDimensions(classification: Classification): DimensionFamily[] {
  return DIMENSION_FAMILIES.filter(dim => 
    dim.applicableTo.length === 0 || 
    dim.applicableTo.includes(classification.dominantClass)
  );
}

/**
 * Get applicable TRIZ operators based on classification
 */
export function getApplicableOperators(classification: Classification): TrizOperator[] {
  return TRIZ_OPERATORS.filter(op =>
    op.applicableTo.length === 0 ||
    op.applicableTo.includes(classification.dominantClass)
  );
}

/**
 * Initialize dimension families in the mind map
 */
export async function initializeDimensions(sessionId: string): Promise<MindMapNode[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { nodes: true },
  });

  if (!session.classificationJson) {
    throw new Error('Session must be classified before dimension expansion');
  }

  const classification = session.classificationJson as Classification;
  const applicableDimensions = getApplicableDimensions(classification);
  const applicableOperators = getApplicableOperators(classification);

  const nodesToCreate: Prisma.MindMapNodeCreateManyInput[] = [];
  const edgesToCreate: Prisma.MindMapEdgeCreateManyInput[] = [];

  // Layout constants for left-to-right tree with generous spacing
  const LEVEL_WIDTH = 480;  // Horizontal spacing between levels
  const NODE_HEIGHT = 200;  // Vertical spacing between dimension family nodes
  const START_X = 100;      // Starting X position (seed is at left)
  const START_Y = 100;      // Starting Y position

  // Calculate seed node Y position based on number of dimensions (centered)
  const seedY = START_Y + (applicableDimensions.length * NODE_HEIGHT) / 2;

  // Update existing seed node with normalized title and proper position
  await prisma.mindMapNode.update({
    where: {
      sessionId_nodeId: {
        sessionId,
        nodeId: 'seed-root',
      },
    },
    data: {
      title: (session.normalizationJson as any)?.coreEntity || 'Seed Idea',
      positionX: START_X,
      positionY: seedY,
    },
  });

  // Create dimension family nodes at level 1 (to the right of seed)
  const totalDimensions = applicableDimensions.length;
  applicableDimensions.forEach((dim, idx) => {
    const yPos = START_Y + (idx * NODE_HEIGHT);
    
    nodesToCreate.push({
      sessionId,
      nodeId: dim.id,
      type: 'DIMENSION_FAMILY',
      title: dim.name,
      description: dim.description,
      family: dim.name,
      state: 'COLLAPSED',
      selectable: false,
      defaultExpanded: false,
      depth: 1,
      parentNodeId: 'seed-root',
      positionX: START_X + LEVEL_WIDTH,
      positionY: yPos,
    });

    edgesToCreate.push({
      sessionId,
      fromNodeId: 'seed-root',
      toNodeId: dim.id,
      relation: 'has_dimension',
    });
  });

  // NOTE: Operators are NOT added to the mind map anymore
  // They are shown in the Combine Tray after user selects dimensions
  // Store applicable operators in session metadata for the tray
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      // Store operators as JSON for retrieval by the frontend
      classificationJson: {
        ...(session.classificationJson as object),
        applicableOperators: applicableOperators.map(op => ({
          id: op.id,
          name: op.name,
          description: op.description,
          examples: op.examples,
        })),
      },
    },
  });

  // Batch create with skipDuplicates to handle re-initialization
  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  // Update session status
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: { status: 'EXPLORING' },
  });

  return prisma.mindMapNode.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get previously selected dimensions for context-aware expansion
 */
async function getSelectedDimensionsContext(sessionId: string): Promise<{
  selectedMoves: Array<{ id: string; title: string; impact: string; family: string }>;
  hasContext: boolean;
}> {
  // Get the combine tray to find selected dimensions
  const combineTray = await prisma.combineTray.findUnique({
    where: { sessionId },
  });

  // Safely handle missing combineTray or empty/undefined selectedDimensions
  const selectedDimensionIds = combineTray?.selectedDimensions ?? [];
  if (!combineTray || selectedDimensionIds.length === 0) {
    return { selectedMoves: [], hasContext: false };
  }

  // Get the selected dimension nodes with their payloads
  const selectedNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId,
      nodeId: { in: selectedDimensionIds },
    },
  });

  const selectedMoves = selectedNodes.map(n => ({
    id: n.nodeId,
    title: n.title,
    impact: (n.payloadJson as any)?.impact || n.description || '',
    family: n.family || '',
  }));

  return { selectedMoves, hasContext: selectedMoves.length > 0 };
}

/**
 * Expand a dimension family with context-aware suggested moves
 * 
 * This function generates actionable invention moves instead of abstract options.
 * Each move includes: What-If statement, Impact, and Leads-To consequence.
 * Moves are context-aware, considering previously selected dimensions.
 */
export async function expandDimensionNode(input: ExpandNodeInput): Promise<DimensionGraph> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true },
  });

  const node = session.nodes.find(n => n.nodeId === input.nodeId);
  if (!node) {
    throw new Error(`Node ${input.nodeId} not found`);
  }

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;

  // Get context from previously selected dimensions
  const { selectedMoves, hasContext } = await getSelectedDimensionsContext(input.sessionId);

  // Build context section for prompt
  const contextSection = hasContext 
    ? `
═══════════════════════════════════════════════════════════════
PREVIOUSLY SELECTED MOVES (Consider these for context-awareness)
═══════════════════════════════════════════════════════════════
${selectedMoves.map((m, i) => `${i + 1}. [${m.family}] ${m.title}
   → Impact: ${m.impact}`).join('\n')}

CONTEXT INSTRUCTIONS:
- Reference prior selections when suggesting synergies or tensions
- At least ONE move MUST challenge or relax an assumption from prior selections
- Use phrasing like: "Given your selection of X, this becomes interesting..."
- If a move conflicts with prior choices, explicitly frame the tradeoff
`
    : `
═══════════════════════════════════════════════════════════════
NO PRIOR SELECTIONS
═══════════════════════════════════════════════════════════════
This is the first dimension being explored. Generate foundational moves.
`;

  // Build user input section (HIGH PRIORITY) for prompt
  const userInputSection = input.userInput?.trim() 
    ? `
═══════════════════════════════════════════════════════════════
⚡ USER DIRECTION (HIGH PRIORITY - MUST ADDRESS)
═══════════════════════════════════════════════════════════════
The user wants to explore THIS specific direction:
"${input.userInput.trim()}"

MANDATORY REQUIREMENTS:
- You MUST generate at least 2 moves that DIRECTLY address the user's direction
- Frame moves that build upon or extend the user's thinking
- If the user's idea has merit, explore its variations and implications
- If the user's direction conflicts with prior context, acknowledge the tradeoff
- Place user-directed moves FIRST in the output list
`
    : '';

  const prompt = `You are a PATENT INVENTION ADVISOR generating context-aware SUGGESTED MOVES for mind-map exploration.

═══════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Archetype: ${classification.archetype}
- Constraints: ${normalization.constraints?.join(', ') || 'None specified'}
${(normalization.technicalContradictions && normalization.technicalContradictions.length > 0 && normalization.technicalContradictions[0])
  ? `- Key Contradiction: "${normalization.technicalContradictions[0].parameterToImprove}" vs "${normalization.technicalContradictions[0].parameterThatWorsens}"`
  : ''}

═══════════════════════════════════════════════════════════════
DIMENSION FAMILY TO EXPLORE: ${node.title}
═══════════════════════════════════════════════════════════════
Description: ${node.description || 'No description'}
${userInputSection}${contextSection}
═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════

Generate 3-5 SUGGESTED MOVES. Each move must:

1. Be phrased as: "What if we <specific design action>?"
2. Specify IMPACT: The immediate behavioral/functional change
3. Specify LEADS TO: The new constraint, problem, or opportunity created
4. Modify at least ONE of:
   - BEHAVIOR_OVER_TIME (how system acts across time)
   - ARCHITECTURE_CONTROL_FLOW (structure or control logic)
   - INTERFACE_BOUNDARY (connection points or APIs)
   - FAILURE_MODE_LIFECYCLE (error handling or lifecycle stage)

FORBIDDEN PATTERNS (reject these):
❌ "Optimize X" or "Improve Y" without structural change
❌ "Add AI/ML" or "Use cloud" (buzzwords)
❌ "Make it faster/better/cheaper" (vague)
❌ Pure feature additions without behavior change

${hasContext ? `MANDATORY: At least 1 move must challenge an implicit assumption from prior selections.` : ''}

Return ONLY valid JSON matching this schema:
${getSchemaDescription('SuggestedMovesResponse')}

Example move format:
{
  "id": "move-${input.nodeId}-1",
  "move": "What if the system operates only on threshold events instead of continuously?",
  "impact": "Reduces energy consumption by 90% during idle periods",
  "leadsTo": "Need for reliable event detection and state persistence",
  "tension": "Challenges assumption of real-time responsiveness",
  "challengesPrior": true,
  "modifies": "BEHAVIOR_OVER_TIME"
}`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_EXPAND',
    input.sessionId,
    input.requestHeaders,
  );

  // Parse the new SuggestedMovesResponse format
  let parsed = safeParseJson(response, SuggestedMovesResponseSchema);
  
  if (!parsed.success) {
    // Fallback 1: Try parsing as raw array of moves (LLM sometimes omits wrapper)
    const rawArraySchema = z.array(SuggestedMoveSchema).min(1);
    const rawArrayParsed = safeParseJson(response, rawArraySchema);
    if (rawArrayParsed.success) {
      console.log('LLM returned raw moves array, wrapping in response object');
      parsed = { 
        success: true, 
        data: { 
          moves: rawArrayParsed.data, 
          contextAcknowledged: false, 
          priorSelectionsUsed: [] 
        } 
      };
    } else {
      console.warn('Failed to parse SuggestedMovesResponse, falling back to legacy parsing:', parsed.error);
      // Fallback 2: Attempt legacy DimensionGraph parsing
      const legacyParsed = safeParseJson(response, DimensionGraphSchema);
      if (!legacyParsed.success) {
        throw new Error(`Expansion failed: ${parsed.error}`);
      }
      // Convert legacy format to new format (fallback path)
      // Ensure nodes have required fields with defaults applied
      const normalizedLegacyData: DimensionGraph = {
        nodes: legacyParsed.data.nodes.map(n => ({
          ...n,
          tags: n.tags ?? [],
          selectable: n.selectable ?? true,
          defaultExpanded: n.defaultExpanded ?? false,
        })),
        edges: legacyParsed.data.edges ?? [],
      };
      return await processLegacyExpansion(input, session, node, normalizedLegacyData);
    }
  }

  // Process the new moves format
  // Generate unique IDs to prevent collisions across multiple expansions
  // LLM-generated IDs (move-{familyId}-{N}) can collide when expanding different nodes from same family
  // Use parent nodeId + timestamp suffix for guaranteed uniqueness
  const parentSlug = input.nodeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
  const uniqueSuffix = Date.now().toString(36); // Base36 timestamp for shorter unique suffix
  
  const moves = parsed.data.moves.map((m, idx) => ({
    ...m,
    // Override LLM-generated ID with a unique one that includes parent nodeId
    id: `${parentSlug}-${uniqueSuffix}-${idx}`,
  }));
  
  const existingNodeIds = session.nodes.map(n => n.nodeId);
  const newMoves = moves.filter(m => !existingNodeIds.includes(m.id));

  // Layout constants
  const LEVEL_WIDTH = 480;
  const NODE_WIDTH = 340; // Card width in pixels
  const CHARS_PER_LINE = 42; // Approximate chars that fit per line
  const LINE_HEIGHT = 16; // Pixels per line of text
  const BASE_NODE_HEIGHT = 120; // Base height for padding, borders, tags
  const SECTION_PADDING = 28; // Padding per section (Impact, LeadsTo, Tension)
  const VERTICAL_GAP = 40; // Gap between nodes
  
  // Calculate estimated height for each move based on content
  const calculateNodeHeight = (m: typeof moves[0]) => {
    const moveLines = Math.ceil((m.move?.length || 0) / CHARS_PER_LINE);
    const impactLines = Math.ceil((m.impact?.length || 0) / CHARS_PER_LINE);
    const leadsToLines = Math.ceil((m.leadsTo?.length || 0) / CHARS_PER_LINE);
    const tensionLines = m.tension ? Math.ceil(m.tension.length / CHARS_PER_LINE) : 0;
    
    let height = BASE_NODE_HEIGHT;
    height += moveLines * LINE_HEIGHT; // Title
    height += SECTION_PADDING + (impactLines * LINE_HEIGHT); // Impact section
    height += SECTION_PADDING + (leadsToLines * LINE_HEIGHT); // LeadsTo section
    if (m.tension) {
      height += SECTION_PADDING + (tensionLines * LINE_HEIGHT); // Tension section
    }
    
    return Math.max(height, 180); // Minimum height
  };
  
  const parentX = node.positionX || 50;
  const parentY = node.positionY || 200;
  const parentDepth = node.depth || 0;
  
  // Calculate cumulative Y positions based on each node's estimated height
  const nodeHeights = newMoves.map(m => calculateNodeHeight(m));
  const totalHeight = nodeHeights.reduce((sum, h) => sum + h + VERTICAL_GAP, 0) - VERTICAL_GAP;
  let currentY = parentY - (totalHeight / 2);

  // Convert moves to nodes for storage with adaptive positioning
  const nodesToCreate = newMoves.map((m, i) => {
    const nodeY = currentY;
    currentY += nodeHeights[i] + VERTICAL_GAP; // Move to next position
    
    return {
      sessionId: input.sessionId,
      nodeId: m.id,
      type: 'DIMENSION_OPTION' as const,
      title: m.move, // The "What if..." statement becomes the title
      description: m.impact, // Impact becomes the short description
      family: node.family || node.title,
      tags: [m.modifies || 'BEHAVIOR_OVER_TIME', m.challengesPrior ? 'CHALLENGES_PRIOR' : 'BUILDS_ON_PRIOR'].filter((t): t is string => !!t),
      state: 'COLLAPSED' as const,
      selectable: true,
      defaultExpanded: false,
      depth: parentDepth + 1,
      parentNodeId: input.nodeId,
      positionX: parentX + LEVEL_WIDTH,
      positionY: nodeY,
      // Store full move data in payloadJson for frontend rendering
      payloadJson: {
        move: m.move,
        impact: m.impact,
        leadsTo: m.leadsTo,
        tension: m.tension,
        challengesPrior: m.challengesPrior,
        modifies: m.modifies,
        isSuggestedMove: true, // Flag to identify new format
      },
    };
  });

  const edgesToCreate = newMoves.map(m => ({
    sessionId: input.sessionId,
    fromNodeId: input.nodeId,
    toNodeId: m.id,
    relation: 'suggests_move',
  }));

  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  // Update parent node state
  await prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state: 'EXPANDED' },
  });

  // Fetch and return ALL children of this node (including both new and existing)
  // This handles the case where a node is re-expanded (e.g., after page refresh)
  const allChildNodeIds = newMoves.length > 0 
    ? newMoves.map(m => m.id) 
    : moves.map(m => m.id);
    
  const createdNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId: input.sessionId,
      OR: [
        { nodeId: { in: allChildNodeIds } },
        { parentNodeId: input.nodeId }, // Also get any existing children
      ],
    },
  });

  const createdEdges = await prisma.mindMapEdge.findMany({
    where: {
      sessionId: input.sessionId,
      fromNodeId: input.nodeId,
    },
  });

  const result: ExpandedDimensionGraph = {
    nodes: createdNodes.map(n => ({
      id: n.nodeId,
      type: n.type,
      title: n.title,
      descriptionShort: n.description || undefined,
      family: n.family || undefined,
      selectable: n.selectable,
      defaultExpanded: n.defaultExpanded,
      tags: n.tags,
      parentId: n.parentNodeId || undefined,
      positionX: n.positionX,
      positionY: n.positionY,
      state: n.state,
      depth: n.depth,
      payloadJson: n.payloadJson as SuggestedMovePayloadType | Record<string, unknown> | undefined,
    })),
    edges: createdEdges.map(e => ({
      from: e.fromNodeId,
      to: e.toNodeId,
      relation: e.relation || 'suggests_move',
    })),
  };
  return result as DimensionGraph;
}

/**
 * Fallback processor for legacy DimensionGraph format
 * Used when LLM returns old format instead of SuggestedMovesResponse
 */
async function processLegacyExpansion(
  input: ExpandNodeInput,
  session: any,
  node: any,
  data: DimensionGraph
): Promise<DimensionGraph> {
  // Generate unique IDs to prevent collisions from LLM-generated IDs
  // Use parent nodeId + timestamp suffix for guaranteed uniqueness
  const parentSlug = input.nodeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
  const uniqueSuffix = Date.now().toString(36); // Base36 timestamp for shorter unique suffix
  
  // Override LLM-generated IDs with unique ones
  const nodesWithUniqueIds = data.nodes.map((n, idx) => ({
    ...n,
    id: `${parentSlug}-leg-${uniqueSuffix}-${idx}`,
  }));
  
  const existingNodeIds = session.nodes.map((n: any) => n.nodeId);
  const newNodes = nodesWithUniqueIds.filter(n => !existingNodeIds.includes(n.id));

  const LEVEL_WIDTH = 480;
  const NODE_HEIGHT = 450; // Same generous spacing as new format
  
  const parentX = node.positionX || 50;
  const parentY = node.positionY || 200;
  const parentDepth = node.depth || 0;
  
  const totalChildren = newNodes.length;
  const totalHeight = (totalChildren - 1) * NODE_HEIGHT;
  const startY = parentY - (totalHeight / 2);

  const nodesToCreate = newNodes.map((n, i) => ({
    sessionId: input.sessionId,
    nodeId: n.id,
    type: n.type as any,
    title: n.title,
    description: n.descriptionShort || null,
    family: n.family || node.family,
    tags: n.tags || [],
    state: 'COLLAPSED' as const,
    selectable: n.selectable !== false,
    defaultExpanded: n.defaultExpanded || false,
    depth: parentDepth + 1,
    parentNodeId: input.nodeId,
    positionX: parentX + LEVEL_WIDTH,
    positionY: startY + (i * NODE_HEIGHT),
  }));

  const edgesToCreate = newNodes.map(n => ({
    sessionId: input.sessionId,
    fromNodeId: input.nodeId,
    toNodeId: n.id,
    relation: 'contains',
  }));

  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  await prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state: 'EXPANDED' },
  });

  const createdNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId: input.sessionId,
      nodeId: { in: newNodes.map(n => n.id) },
    },
  });

  const createdEdges = await prisma.mindMapEdge.findMany({
    where: {
      sessionId: input.sessionId,
      fromNodeId: input.nodeId,
    },
  });

  return {
    nodes: createdNodes.map(n => ({
      id: n.nodeId,
      type: n.type,
      title: n.title,
      descriptionShort: n.description || undefined,
      family: n.family || undefined,
      selectable: n.selectable,
      defaultExpanded: n.defaultExpanded,
      tags: n.tags,
      parentId: n.parentNodeId || undefined,
      positionX: n.positionX,
      positionY: n.positionY,
      state: n.state,
      depth: n.depth,
      payloadJson: n.payloadJson, // Include for consistency (may be null for legacy nodes)
    })),
    edges: createdEdges.map(e => ({
      from: e.fromNodeId,
      to: e.toNodeId,
      relation: e.relation || 'contains',
    })),
  } as any;
}

// =============================================================================
// COMBINE TRAY & IDEA GENERATION
// =============================================================================

/**
 * Update the combine tray with selected nodes
 */
export async function updateCombineTray(
  sessionId: string,
  components: string[],
  dimensions: string[],
  operators: string[],
  intent: string = 'DIVERGENT',
  count: number = 5
) {
  const recipe = {
    selectedComponents: components,
    selectedDimensions: dimensions,
    selectedOperators: operators,
    recipeIntent: intent,
    count,
  };

  return prisma.combineTray.upsert({
    where: { sessionId },
    create: {
      sessionId,
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
    update: {
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
  });
}

/**
 * Generate idea frames from the combine tray
 */
export async function generateIdeas(input: GenerateIdeasInput): Promise<IdeaFrame[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true, combineTray: true },
  });

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;

  // Get selected node details
  const selectedNodes = session.nodes.filter(n => 
    input.recipe.selectedComponents.includes(n.nodeId) ||
    input.recipe.selectedDimensions.includes(n.nodeId) ||
    input.recipe.selectedOperators.includes(n.nodeId)
  );

  const componentDetails = selectedNodes.filter(n => 
    input.recipe.selectedComponents.includes(n.nodeId)
  ).map(n => n.title);

  const dimensionDetails = selectedNodes.filter(n => 
    input.recipe.selectedDimensions.includes(n.nodeId)
  ).map(n => `${n.family}: ${n.title}`);

  const operatorDetails = selectedNodes.filter(n => 
    input.recipe.selectedOperators.includes(n.nodeId)
  ).map(n => `${n.title}: ${n.description}`);

  // Extract contradiction info if available
  const contradictionMapping = (normalization as any).contradictionMapping;
  const contradictions = normalization.technicalContradictions || [];
  const inventivePrinciples = contradictionMapping?.inventivePrinciples || [];
  const resolutionStrategies = contradictionMapping?.resolutionStrategies || [];

  const prompt = `You are a PATENT INVENTION GENERATOR. Your task is to create ${input.recipe.count} PATENT-WORTHY inventions that are NON-OBVIOUS and resolve technical contradictions.

═══════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Archetype: ${classification.archetype}
- Constraints: ${normalization.constraints?.join(', ') || 'None'}
- Forbidden: ${normalization.negativeConstraints?.join(', ') || 'None'}
${normalization.patentableProblemStatement ? `- Patentable Problem: ${normalization.patentableProblemStatement}` : ''}

═══════════════════════════════════════════════════════════════
TECHNICAL CONTRADICTIONS TO RESOLVE
═══════════════════════════════════════════════════════════════
${contradictions.length > 0 
  ? contradictions.map((c, i) => `${i + 1}. "${c.parameterToImprove}" ↔ "${c.parameterThatWorsens}": ${c.conflictDescription}`).join('\n')
  : 'None identified - YOU must find the underlying tradeoff'
}

${inventivePrinciples.length > 0 ? `SUGGESTED TRIZ PRINCIPLES: ${inventivePrinciples.join(', ')}` : ''}
${resolutionStrategies.length > 0 ? `RESOLUTION STRATEGIES: ${resolutionStrategies.map((s: { strategy: string }) => s.strategy).join(', ')}` : ''}

═══════════════════════════════════════════════════════════════
SELECTED BUILDING BLOCKS
═══════════════════════════════════════════════════════════════
COMPONENTS: ${componentDetails.join(', ') || 'Use your judgment'}
DIMENSIONS: ${dimensionDetails.join('; ') || 'Explore broadly'}
OPERATORS: ${operatorDetails.join('; ') || 'Apply appropriate operators'}

═══════════════════════════════════════════════════════════════
GENERATION INTENT: ${input.recipe.recipeIntent}
═══════════════════════════════════════════════════════════════
${input.recipe.recipeIntent === 'DIVERGENT' ? '→ Generate diverse, creative ideas with cross-domain analogies' : ''}
${input.recipe.recipeIntent === 'CONVERGENT' ? '→ Focus on practical, implementable ideas' : ''}
${input.recipe.recipeIntent === 'RISK_REDUCTION' ? '→ Focus on safety and reliability improvements' : ''}
${input.recipe.recipeIntent === 'COST_REDUCTION' ? '→ Focus on cost-effective solutions' : ''}
${input.userGuidance?.trim() ? `
═══════════════════════════════════════════════════════════════
⚡ USER GUIDANCE (HIGH PRIORITY - MUST HONOR)
═══════════════════════════════════════════════════════════════
The user has provided specific guidance for idea generation:
"${input.userGuidance.trim()}"

MANDATORY REQUIREMENTS:
- You MUST incorporate the user's guidance into ALL generated ideas
- If user mentions a specific approach, analogy, or constraint, apply it directly
- User guidance takes precedence over other generation parameters
- Frame ideas that explicitly address what the user asked for
- If user guidance conflicts with selected dimensions, find creative resolutions
` : ''}

═══════════════════════════════════════════════════════════════
SCOPE CONTROL (CRITICAL)
═══════════════════════════════════════════════════════════════
Each invention MUST be centered around exactly ONE primary inventive mechanism.
- One mechanism = one physical principle, material behavior, structural configuration, or signal pathway.
- Additional elements (feedback, control, adaptation, UX, algorithms) may be included ONLY if they directly support the primary mechanism.
- Any feedback, haptics, UI, skill inference, or algorithmic adaptation MUST be framed as a dependent or optional feature and MUST NOT appear as a primary claim hook.
- If an idea contains multiple independent inventive mechanisms, REDUCE it to the strongest one and demote others to optional or dependent aspects.
═══════════════════════════════════════════════════════════════
MANDATORY REQUIREMENTS FOR PATENT-WORTHY IDEAS
═══════════════════════════════════════════════════════════════
Each idea MUST include:

0. coreMechanism: A single sentence describing the ONE primary inventive mechanism.
   - All other fields (inventiveLeap, eliminatedComponent, claimHooks, etc.) must directly relate to this coreMechanism.
1. inventiveLeap: The non-obvious insight (what would surprise an expert)
2. whyNotObvious: Why a skilled person would NOT arrive at this solution
3. analogySource:
   - A distant domain that INSPIRED the idea
   - The analogy must map to a specific FUNCTION or MECHANISM
   - Do NOT rely on analogy alone for novelty; structural or functional differences must be explicit
   - Bad: "using steel instead of aluminum" (same domain)
   - Good: "using biological cell division patterns for manufacturing"
4. eliminatedComponent: What traditional element is REMOVED or INVERTED
5. contradictionResolved: Which tradeoff this solves
6. resolutionStrategy: HOW the contradiction is resolved (separation, inversion, etc.)

═══════════════════════════════════════════════════════════════
FORBIDDEN PATTERNS (Ideas with these will be rejected)
═══════════════════════════════════════════════════════════════
❌ ADDITIVE COMBINATIONS: "Add sensor + AI + cloud" (just stacking)
❌ PARAMETER TWEAKS: "Make it bigger/smaller/faster" (no structure change)
❌ OBVIOUS SUBSTITUTIONS: "Use plastic instead of metal" (known swap)
❌ SAME-DOMAIN COMBINATIONS: All elements from one field
❌ PREDICTABLE OUTCOMES: Results anyone would expect

═══════════════════════════════════════════════════════════════
CLAIM HOOK FORMAT
═══════════════════════════════════════════════════════════════
✅ USE: "configured to [function] by [unexpected mechanism]"
✅ USE: "wherein [component] achieves [result] through [novel approach]"
❌ AVOID: "includes A and B" (just listing elements)
❌ AVOID: "comprises" without functional language

LIMIT: Provide at most 2–3 claim hooks per idea.
The first claim hook must correspond to the primary inventive mechanism.
Additional claim hooks must be clearly dependent or optional.

Generate exactly ${input.recipe.count} invention ideas as a JSON array.
Schema: ${getSchemaDescription('IdeaFrame')}

Return ONLY the JSON array (no other text):
[{idea1}, {idea2}, ...]`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_GENERATE',
    input.sessionId,
    input.requestHeaders,
  );

  // Parse the array of ideas
  let ideas: IdeaFrame[];
  try {
    const cleaned = response.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : cleaned;
    
    // Find array bounds
    const firstBracket = jsonStr.indexOf('[');
    const lastBracket = jsonStr.lastIndexOf(']');
    const arrayStr = jsonStr.slice(firstBracket, lastBracket + 1);
    
    const parsed = JSON.parse(arrayStr);
    ideas = parsed.map((idea: any) => IdeaFrameSchema.parse(idea));
  } catch (e) {
    console.error('Failed to parse ideas:', e);
    throw new Error('Failed to generate valid ideas');
  }

  // Store ideas in database
  const createdFrames = await Promise.all(
    ideas.map(async (idea) => {
      return prisma.ideaFrame.create({
        data: {
          sessionId: input.sessionId,
          ideaFrameJson: idea as any,
          title: idea.title,
          problem: idea.problem,
          principle: idea.principle,
          technicalEffect: idea.technicalEffect,
          classLabels: idea.classLabels,
          operatorsUsed: idea.operatorsUsed,
          dimensionsUsed: idea.dimensionsUsed,
          componentsUsed: idea.components,
          status: 'DRAFT',
        },
      });
    })
  );

  // Update session status
  await prisma.ideationSession.update({
    where: { id: input.sessionId },
    data: { status: 'REVIEWING' },
  });

  return ideas;
}

// =============================================================================
// NOVELTY SEARCH & PRESSURE GATE
// =============================================================================

/**
 * Generate cache key for search query
 */
function getSearchCacheKey(query: string, provider: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${provider}:${normalized}`).digest('hex');
}

/**
 * Check novelty for an idea frame
 */
export async function checkNovelty(input: NoveltyCheckInput): Promise<NoveltyGate> {
  const ideaFrame = await prisma.ideaFrame.findUniqueOrThrow({
    where: { id: input.ideaFrameId },
    include: { session: true },
  });

  const idea = ideaFrame.ideaFrameJson as IdeaFrame;
  const queries = (idea.searchQueries || []).slice(0, 3); // Limit to 3 queries for cost

  // Check cache first
  const results: NoveltyGate['results'] = [];
  
  // Handle case with no search queries
  if (queries.length === 0) {
    console.warn('No search queries available for novelty check');
  }
  
  for (const query of queries) {
    const cacheKey = getSearchCacheKey(query, 'serpapi_patents');
    
    // Check cache
    const cached = await prisma.ideationSearchCache.findUnique({
      where: { cacheKey },
    });

    if (cached && new Date(cached.expiresAt) > new Date()) {
      // Use cached results - ensure it's an array
      const cachedResults = Array.isArray(cached.resultJson) ? cached.resultJson : [];
      if (cachedResults.length > 0) {
        results.push(...cachedResults.slice(0, 5).map((r: any) => ({
          source: 'Google Patents (cached)',
          title: r?.title || 'Unknown',
          snippet: r?.snippet || undefined,
          url: r?.link || undefined,
          publicationNumber: r?.publication_number || r?.patent_id || undefined,
          assignee: r?.assignee || undefined,
          filingDate: r?.filing_date || r?.priority_date || undefined,
          similarityScore: undefined,
          whyRelevant: 'Matched search query',
        })));
      }
      
      // Update hit count
      await prisma.ideationSearchCache.update({
        where: { cacheKey },
        data: { hitCount: { increment: 1 } },
      });
    } else {
      // Perform search
      try {
        const searchResult = await serpApiProvider.searchPatents({
          q: query,
          num: 10,
        });

        if (searchResult.organic_results) {
          // Cache results
          await prisma.ideationSearchCache.upsert({
            where: { cacheKey },
            create: {
              cacheKey,
              provider: 'serpapi_patents',
              resultJson: searchResult.organic_results,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
            update: {
              resultJson: searchResult.organic_results,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });

          const organicResults = Array.isArray(searchResult.organic_results) ? searchResult.organic_results : [];
          results.push(...organicResults.slice(0, 5).map((r: any) => ({
            source: 'Google Patents',
            title: r?.title || 'Unknown',
            snippet: r?.snippet || undefined,
            url: r?.link || undefined,
            publicationNumber: r?.publication_number || r?.patent_id || undefined,
            assignee: r?.assignee || undefined,
            filingDate: r?.filing_date || r?.priority_date || undefined,
            similarityScore: undefined,
            whyRelevant: 'Matched search query',
          })));
        }

        // Store evidence
        await prisma.evidenceResult.create({
          data: {
            sessionId: input.sessionId,
            ideaFrameId: input.ideaFrameId,
            provider: 'serpapi_patents',
            query,
            queryHash: cacheKey,
            rawJson: searchResult as any,
            parsedJson: results as any,
            resultCount: results.length,
          },
        });
      } catch (e) {
        console.error('Search failed:', e);
      }
    }
  }

  // Use LLM to assess novelty with enhanced feedback loop
  const session = ideaFrame.session;
  const prompt = `You are a PATENT EXAMINER conducting a novelty and non-obviousness assessment. Your goal is to determine if this invention would survive USPTO examination.

═══════════════════════════════════════════════════════════════
INVENTION UNDER REVIEW
═══════════════════════════════════════════════════════════════
- Title: ${idea.title}
- Problem: ${idea.problem}
- Principle: ${idea.principle}
- Technical Effect: ${idea.technicalEffect}
${idea.inventiveLeap ? `- Claimed Inventive Leap: ${idea.inventiveLeap}` : ''}
${idea.whyNotObvious ? `- Why Not Obvious: ${idea.whyNotObvious}` : ''}
${idea.analogySource ? `- Analogy Source: ${idea.analogySource}` : ''}
${idea.eliminatedComponent ? `- Eliminated Component: ${idea.eliminatedComponent}` : ''}

═══════════════════════════════════════════════════════════════
PRIOR ART SEARCH RESULTS (${results.length} patents analyzed)
═══════════════════════════════════════════════════════════════
${results.map((r, i) => `${i + 1}. [${r.publicationNumber || 'Unknown'}] ${r.title}${r.assignee ? ` (${r.assignee})` : ''}\n   ${r.snippet || 'No snippet'}`).join('\n\n')}

Return ONLY valid JSON:
${getSchemaDescription('NoveltyGate')}

═══════════════════════════════════════════════════════════════
ASSESSMENT CRITERIA
═══════════════════════════════════════════════════════════════

1. noveltyScore (0-100):
   - 0-30: OBVIOUS - A PHOSITA would arrive at this with routine experimentation
   - 31-50: MARGINAL - Some prior art teaches this, needs differentiation
   - 51-70: NON-OBVIOUS - Unexpected combination or result
   - 71-100: HIGHLY INVENTIVE - Clear inventive leap, distant analogy

2. obviousnessFlags - Mark ALL that apply:
   - COMBINATIONAL: Just adding known elements without synergy
   - SAME_DOMAIN: All prior art from same technical field
   - PARAMETER_TWEAK: Only changing values, not structure
   - OBVIOUS_SUBSTITUTION: Well-known material/component swap
   - PREDICTABLE_RESULT: Expected outcome from this combination

3. phositaTest: Write a sentence explaining why a Person Having Ordinary Skill In The Art would or would NOT find this obvious
   - Example: "A mechanical engineer in 2024 would NOT think to use origami folding for crash absorption because..."

4. IF noveltyScore < 60, MUST provide mutationInstructions:
   - action: What type of change to make (MUTATE_DIMENSION, ADD_ANALOGY, INVERT_APPROACH, etc.)
   - specifics: Detailed instruction (e.g., "Replace material dimension with quantum superposition analogy")
   - retainElements: What's worth keeping from the original idea
   - suggestedAnalogy: A DISTANT domain to draw from (biology, economics, game theory, etc.)

5. suggestedIterations: List 2-3 specific ways to increase novelty:
   - "Invert the [X] to achieve opposite effect"
   - "Apply [biological process] analogy to [mechanism]"
   - "Eliminate [traditional component] entirely"

6. closestPriorArt (REQUIRED): Identify 2-4 most relevant patents from the search results:
   - publicationNumber: The patent number (e.g., "US1234567B1")
   - title: Patent title
   - relevanceScore: 0-100 how closely it matches the invention
   - overlappingFeatures: Array of features that overlap
   - differentiatingFactors: Array of how the invention differs
   - remark: Brief 1-2 sentence analysis

7. priorArtSummary (REQUIRED): A 2-3 sentence summary explaining:
   - The general landscape of prior art found
   - Key differentiating factors of the invention
   - Why it is/isn't novel compared to existing patents

8. patentsAnalyzed: Set to ${results.length}

═══════════════════════════════════════════════════════════════
RECOMMENDED ACTIONS
═══════════════════════════════════════════════════════════════
- KEEP: noveltyScore ≥ 60, proceed to patent drafting
- MUTATE_OPERATOR: Try different TRIZ operator
- MUTATE_DIMENSION: Explore different dimension family
- NARROW_MICRO_PROBLEM: Focus on more specific sub-problem
- ASK_USER_QUESTION: Need clarification to differentiate`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_NOVELTY',
    session.id,
    input.requestHeaders,
  );

  const parsed = safeParseJson(response, NoveltyGateSchema);
  
  console.log('📊 Novelty assessment - LLM response parsed:', parsed.success ? 'SUCCESS' : 'FAILED');
  if (!parsed.success) {
    console.log('⚠️ Parse error details:', (parsed as any).error);
  }
  
  if (!parsed.success) {
    // Return default assessment with all required fields
    const fallback: NoveltyGate = {
      query: queries.join(' | '),
      results: results,
      conceptSaturation: 'MEDIUM',
      solutionSaturation: results.length > 5 ? 'HIGH' : 'LOW',
      noveltyScore: results.length > 5 ? 40 : 70,
      recommendedAction: results.length > 5 ? 'MUTATE_OPERATOR' : 'KEEP',
      reasoning: 'Auto-assessed based on result count',
      // Prior art analysis
      patentsAnalyzed: results.length,
      closestPriorArt: results.length > 0 
        ? results.slice(0, 3).map(r => ({
            publicationNumber: r.publicationNumber || 'Unknown',
            title: r.title || 'Unknown Patent',
            relevanceScore: 50,
            overlappingFeatures: ['Technical domain match'],
            differentiatingFactors: ['Specific implementation may differ'],
            remark: 'Potentially relevant based on title/snippet match. Manual review recommended.',
          }))
        : [],
      priorArtSummary: results.length > 0
        ? `Analyzed ${results.length} patents from patent databases. The search returned results in similar technical domains. Further detailed analysis recommended to confirm novelty.`
        : 'No prior art patents found in the search. This could indicate high novelty or may require alternative search terms.',
      // Enhanced feedback loop fields
      obviousnessFlags: results.length > 5 ? ['SAME_DOMAIN'] : [],
      suggestedIterations: results.length > 5 
        ? ['Try a more distant analogy', 'Eliminate a traditional component', 'Invert the approach']
        : [],
    };
    
    // IMPORTANT: Save fallback to database too!
    console.log('🔄 Using fallback novelty assessment (LLM parse failed):', parsed.success === false ? 'parse error' : 'validation error');
    await prisma.ideaFrame.update({
      where: { id: input.ideaFrameId },
      data: {
        noveltyScore: fallback.noveltyScore,
        noveltySummaryJson: fallback as any,
        conceptSaturation: fallback.conceptSaturation,
        solutionSaturation: fallback.solutionSaturation,
      },
    });
    
    return fallback;
  }

  // Merge LLM response with search results (LLM won't return the full results array)
  const finalResult: NoveltyGate = {
    // Include required fields from parsed data
    query: queries.join(' | '),
    noveltyScore: parsed.data.noveltyScore,
    conceptSaturation: parsed.data.conceptSaturation,
    solutionSaturation: parsed.data.solutionSaturation,
    recommendedAction: parsed.data.recommendedAction,

    // Include optional fields with fallbacks
    reasoning: parsed.data.reasoning,
    patentsAnalyzed: results.length,
    priorArtSummary: parsed.data.priorArtSummary || (results.length > 0
      ? `Analyzed ${results.length} patents from patent databases. ${parsed.data.reasoning || 'Further review recommended.'}`
      : 'No prior art patents found in the search.'),
    mutationInstructions: parsed.data.mutationInstructions ? {
      ...parsed.data.mutationInstructions,
      retainElements: parsed.data.mutationInstructions.retainElements || [],
    } : undefined,
    phositaTest: parsed.data.phositaTest,

    // Always include the actual search results
    results: results,

    // Ensure closestPriorArt is always an array with required fields
    closestPriorArt: parsed.data.closestPriorArt && parsed.data.closestPriorArt.length > 0
      ? parsed.data.closestPriorArt.map(item => ({
          publicationNumber: item.publicationNumber || 'Unknown',
          title: item.title || 'Unknown Patent',
          relevanceScore: item.relevanceScore || 50,
          overlappingFeatures: item.overlappingFeatures || ['Technical domain match'],
          differentiatingFactors: item.differentiatingFactors || ['Specific implementation may differ'],
          remark: item.remark || 'Requires manual review',
        }))
      : results.length > 0
        ? results.slice(0, 3).map(r => ({
            publicationNumber: r.publicationNumber || 'Unknown',
            title: r.title || 'Unknown Patent',
            relevanceScore: 50,
            overlappingFeatures: ['Technical domain match'],
            differentiatingFactors: ['Specific implementation may differ'],
            remark: 'Potentially relevant based on title/snippet match. Manual review recommended.',
          }))
        : [],

    // Ensure obviousnessFlags is always an array
    obviousnessFlags: parsed.data.obviousnessFlags || [],

    // Ensure suggestedIterations is always an array
    suggestedIterations: parsed.data.suggestedIterations || [],
  };

  // Update idea frame with novelty info
  console.log('💾 Saving novelty assessment to database...', {
    ideaFrameId: input.ideaFrameId,
    noveltyScore: finalResult.noveltyScore,
    patentsAnalyzed: finalResult.patentsAnalyzed,
    closestPriorArtCount: finalResult.closestPriorArt?.length || 0,
    hasPriorArtSummary: !!finalResult.priorArtSummary,
  });
  
  await prisma.ideaFrame.update({
    where: { id: input.ideaFrameId },
    data: {
      noveltyScore: finalResult.noveltyScore,
      noveltySummaryJson: finalResult as any,
      conceptSaturation: finalResult.conceptSaturation,
      solutionSaturation: finalResult.solutionSaturation,
    },
  });

  console.log('✅ Novelty assessment saved successfully');
  return finalResult;
}

// =============================================================================
// EXPORT TO IDEA BANK
// =============================================================================

/**
 * Export selected idea frames to the Idea Bank
 */
export async function exportToIdeaBank(input: ExportToIdeaBankInput): Promise<string[]> {
  const ideaFrames = await prisma.ideaFrame.findMany({
    where: {
      id: { in: input.ideaFrameIds },
      sessionId: { not: undefined },
    },
    include: { session: true },
  });

  const createdIds: string[] = [];

  for (const frame of ideaFrames) {
    const idea = frame.ideaFrameJson as IdeaFrame;

    // Create IdeaBankIdea
    const ideaBankIdea = await prisma.ideaBankIdea.create({
      data: {
        title: idea.title,
        description: `${idea.problem}\n\n${idea.principle}`,
        abstract: idea.technicalEffect,
        domainTags: idea.classLabels,
        technicalField: frame.classLabels[0] || 'General',
        noveltyScore: frame.noveltyScore ? frame.noveltyScore / 100 : null,
        status: 'PUBLIC',
        generatedBy: 'ideation-engine',
        keyFeatures: idea.components,
        potentialApplications: idea.variants.map(v => v.title),
        createdBy: input.userId,
        tenantId: input.tenantId,
        publishedAt: new Date(),
      },
    });

    createdIds.push(ideaBankIdea.id);

    // Update idea frame with export info
    await prisma.ideaFrame.update({
      where: { id: frame.id },
      data: {
        status: 'EXPORTED',
        exportedToIdeaId: ideaBankIdea.id,
        exportedAt: new Date(),
      },
    });
  }

  // Log export
  if (ideaFrames.length > 0) {
    await prisma.ideationHistory.create({
      data: {
        sessionId: ideaFrames[0].sessionId,
        action: 'EXPORTED_TO_IDEA_BANK',
        outputJson: { exportedIds: createdIds },
        userId: input.userId,
      },
    });
  }

  return createdIds;
}

// =============================================================================
// NODE OPERATIONS
// =============================================================================

/**
 * Update node state (expand/collapse/hide/select)
 */
export async function updateNodeState(
  sessionId: string,
  nodeId: string,
  state: 'EXPANDED' | 'COLLAPSED' | 'HIDDEN' | 'REMOVED' | 'SELECTED'
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state },
  });
}

/**
 * Update node position (for React Flow drag)
 */
export async function updateNodePosition(
  sessionId: string,
  nodeId: string,
  x: number,
  y: number
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { positionX: x, positionY: y },
  });
}

/**
 * Undo last hidden/removed nodes
 */
export async function undoNodeChanges(sessionId: string) {
  // Get recently hidden/removed nodes
  const hiddenNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId,
      state: { in: ['HIDDEN', 'REMOVED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  // Restore them to collapsed state
  await prisma.mindMapNode.updateMany({
    where: {
      id: { in: hiddenNodes.map(n => n.id) },
    },
    data: { state: 'COLLAPSED' },
  });

  return hiddenNodes.length;
}

// =============================================================================
// IDEA FRAME OPERATIONS
// =============================================================================

/**
 * Update idea frame status
 */
export async function updateIdeaStatus(
  ideaFrameId: string,
  status: 'DRAFT' | 'SHORTLISTED' | 'REJECTED' | 'ARCHIVED',
  notes?: string
) {
  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: {
      status,
      userNotes: notes,
    },
  });
}

/**
 * Rate an idea frame
 */
export async function rateIdea(ideaFrameId: string, rating: number) {
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: { userRating: rating },
  });
}

// =============================================================================
// SESSION CLEANUP
// =============================================================================

/**
 * Archive a session
 */
export async function archiveSession(sessionId: string) {
  return prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      status: 'ARCHIVED',
      completedAt: new Date(),
    },
  });
}

/**
 * Delete a session and all related data
 */
export async function deleteSession(sessionId: string) {
  // Cascade delete handles related records
  return prisma.ideationSession.delete({
    where: { id: sessionId },
  });
}

