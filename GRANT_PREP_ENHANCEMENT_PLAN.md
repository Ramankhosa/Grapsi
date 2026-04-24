# Grant Prep Chatbot Enhancement Plan: Proactive & Predictive Conversations

## Executive Summary

This plan outlines architectural enhancements to transform the grant prep chatbot from a reactive Q&A system into a proactive, predictive conversation partner that stays 2-3 steps ahead of the user. The goal is to minimize interaction count while maximizing stage coverage and detail gathering.

---

## 1. Current System Analysis

### 1.1 Current Limitations

| Aspect | Current Behavior | Target Behavior |
|--------|-----------------|-----------------|
| **Question Scope** | Single-point focus per turn | Multi-point cluster coverage |
| **Answer Options** | 2-3 options for current question only | Hierarchical options covering current + predicted needs |
| **Stage Awareness** | Current stage only with cross-stage context | Active preview of next 2 stages with dependencies |
| **Intention Prediction** | None - purely reactive | Predictive based on problem type, beneficiaries, methodology |
| **Progression** | 65% threshold auto-advance | Smart advance with preview of what's coming |
| **Follow-up Chips** | Generic suggestions | Contextual multi-branch suggestions |

### 1.2 Current Data Flow

```
User Message → Load Session → Build Prompt (current stage, 4-20 pending points) 
→ Gemini → Parse Marker → Apply to Stage States → Auto-advance at 65%
```

### 1.3 Stage Architecture (17 Stages)

```
FRAMING (4): problem_definition → root_cause → beneficiaries → fit_and_scope
ALIGNMENT (3): thrust_alignment → innovation
DESIGN (4): methodology → workplan → team_and_partnerships → evaluation
DELIVERY (5): outcomes → risk_and_ethics → budget_strategy → sustainability_and_scale → final_pitch
TERMINAL (2): handoff_ready → handoff_complete
```

---

## 2. Enhancement Strategy: The "Lookahead Conversation Model"

### 2.1 Core Concept

Transform the chatbot into a **Grant Preparation Navigator** that:

1. **Predicts User Intent** based on captured problem characteristics
2. **Pre-positions Discussion Points** from upcoming stages when relevant
3. **Offers Multi-Branch Options** that cover multiple dimensions per turn
4. **Surfaces Stage Previews** before auto-advancing
5. **Maintains Conversation State** that tracks not just what's captured, but what patterns are emerging

### 2.2 Predictive Dimensions

The chatbot will build a **Working Hypothesis** about the proposal that includes:

```typescript
interface ProposalHypothesis {
  // Problem characteristics drive predictions
  problemDomain: 'healthcare' | 'education' | 'technology' | 'agriculture' | 'environment' | 'social' | 'policy' | null;
  problemType: 'access' | 'quality' | 'efficiency' | 'equity' | 'innovation_gap' | null;
  targetScale: 'local' | 'regional' | 'national' | 'international' | null;
  
  // Beneficiary patterns predict methodology needs
  beneficiaryType: 'patients' | 'students' | 'communities' | 'organizations' | 'researchers' | null;
  beneficiaryAccessPath: 'digital' | 'physical' | 'institutional' | 'direct' | null;
  
  // Methodology signals predict team and risk patterns
  methodologyApproach: 'experimental' | 'quasi_experimental' | 'observational' | 'implementation' | 'development' | null;
  evidenceType: 'quantitative' | 'qualitative' | 'mixed' | 'participatory' | null;
  
  // Pattern confidence scores
  confidence: Record<string, number>;
  
  // Predicted needs for upcoming stages
  predictedNeeds: {
    stageKey: GrantPrepStageKey;
    likelyPoints: string[];
    riskIndicators: string[];
    suggestedApproach: string;
  }[];
}
```

---

## 3. Detailed Enhancement Areas

### 3.1 Multi-Point Cluster Questions (MPCQ)

**Current**: Each question targets one discussion point
**Enhanced**: Questions designed to capture 2-3 related points simultaneously

#### Implementation

```typescript
// New type for clustered discussion points
interface DiscussionPointCluster {
  clusterId: string;
  primaryPoint: GrantPrepPointState;
  relatedPoints: GrantPrepPointState[];
  clusterTheme: string;
  questionTemplate: string;
  expectedCoverage: 'single_answer' | 'multi_part' | 'branching';
}

// Clusters defined per stage
const STAGE_CLUSTERS: Record<GrantPrepStageKey, DiscussionPointCluster[]> = {
  problem_definition: [
    {
      clusterId: 'problem_core_scale',
      primaryPoint: 'problem_core',
      relatedPoints: ['problem_scale'],
      clusterTheme: 'Problem essence and urgency together',
      questionTemplate: 'What is the core problem you are solving, and what makes it urgent or timely now?',
      expectedCoverage: 'multi_part'
    },
    {
      clusterId: 'gap_evidence',
      primaryPoint: 'evidence_gap',
      relatedPoints: [],
      clusterTheme: 'Evidence and practice gap',
      questionTemplate: 'What evidence or practice gap does your project address? What is currently missing?',
      expectedCoverage: 'single_answer'
    }
  ],
  // ... other stages
};
```

#### Prompt Enhancement

Add to `promptComposer.ts`:

```typescript
function buildClusterAwarePrompt(
  stageKey: GrantPrepStageKey,
  pendingPoints: GrantPrepPointState[],
  hypothesis: ProposalHypothesis
): string {
  const clusters = identifyOptimalClusters(stageKey, pendingPoints, hypothesis);
  
  return [
    'CLUSTER APPROACH: This turn targets multiple related discussion points.',
    `Primary cluster: ${clusters[0].clusterTheme}`,
    `Points to cover: ${clusters[0].primaryPoint.label}${clusters[0].relatedPoints.map(p => ', ' + p.label).join('')}`,
    '',
    'Ask a question that naturally invites answers covering all these points.',
    'The user should be able to answer comprehensively in 2-4 sentences.',
  ].join('\n');
}
```

### 3.2 Predictive Answer Options (PAO)

**Current**: 2-3 options answering the current question only
**Enhanced**: Hierarchical options that branch across dimensions

#### New Answer Option Structure

```typescript
interface PredictiveAnswerOption {
  // Core option (as before)
  label: string;
  text: string;
  rationale?: string;
  
  // NEW: Predictive extensions
  extensions?: {
    // What answering this way implies for other stages
    impliesForStage: GrantPrepStageKey;
    suggestedCapture: string;
    confidence: number;
  }[];
  
  // NEW: Branch indicator - selecting this opens follow-up branches
  opensBranches?: {
    branchId: string;
    branchLabel: string;
    estimatedPoints: number;
  }[];
  
  // NEW: Pattern match score
  patternMatch?: {
    patternId: string;
    score: number;
    description: string;
  };
}

// Enhanced marker payload
interface EnhancedGrantPrepMarkerPayload extends GrantPrepMarkerPayload {
  // Original fields preserved...
  
  // NEW: Predictive suggestions
  predictiveOptions?: PredictiveAnswerOption[];
  
  // NEW: Branch suggestions that open based on selected option
  conditionalBranches?: {
    triggerOptionLabel: string;
    followUpQuestion: string;
    followUpOptions: GrantPrepSuggestedAnswer[];
  }[];
  
  // NEW: Cross-stage preview suggestions
  crossStagePreviews?: {
    stageKey: GrantPrepStageKey;
    relevanceScore: number;
    previewQuestion: string;
    whyRelevant: string;
  }[];
}
```

#### Example: Problem Definition with Predictive Options

**Current Options:**
- A: Rural pregnant women in Bihar lack access to quality antenatal care, leading to high maternal mortality.
- B: Healthcare access is a major challenge in developing regions, affecting millions of women.
- C: We aim to improve maternal health outcomes through innovative technology solutions.

**Enhanced Predictive Options:**

```
A. [ACCESS + DIGITAL] Rural pregnant women in Bihar face 3-hour travel times to clinics; 
   our mobile health platform connects them to remote consultations.
   → Opens: beneficiaries (digital literacy), methodology (tech implementation), 
      risks (connectivity, digital divide)

B. [QUALITY + INSTITUTIONAL] Frontline health workers lack diagnostic training; 
   our program upskills 500 ASHA workers with standardized protocols.
   → Opens: team (training capacity), workplan (phased rollout), 
      sustainability (institutionalization)

C. [EQUITY + HYBRID] Marginalized tribal communities receive substandard care; 
   our community health worker model combines home visits with telemedicine.
   → Opens: beneficiaries (tribal outreach), ethics (consent, cultural sensitivity), 
      evaluation (equity metrics)
```

### 3.3 Stage Progression Preview (SPP)

**Current**: Silent auto-advance at 65% readiness
**Enhanced**: Preview mode that shows what's coming and pre-positions relevant points

#### Implementation: Stage Transition Overlay

```typescript
interface StageTransitionPreview {
  currentStage: GrantPrepStageKey;
  nextStage: GrantPrepStageKey;
  readiness: number;
  
  // Preview of next stage based on current captures
  nextStagePreview: {
    title: string;
    keyPoints: string[];
    estimatedQuestions: number;
    
    // Pre-positioned points from next stage based on hypothesis
    prepositionedPoints: {
      pointKey: string;
      inferredContent: string;
      confidence: number;
      sourceCapture: string; // Which current-stage capture triggered this
    }[];
    
    // Dependencies from current stage that will be referenced
    inheritedFacts: {
      fromStage: GrantPrepStageKey;
      factBullets: string[];
    }[];
  };
  
  // Option to stay and deepen current stage
  stayOptions?: {
    label: string;
    action: 'deepen_current' | 'explore_alternative' | 'add_detail';
    estimatedValue: string;
  }[];
  
  // Option to preview-skip to a later stage
  skipPreview?: {
    canSkipTo: GrantPrepStageKey;
    skipRationale: string;
    capturedPrerequisites: string[];
  };
}
```

#### Prompt Enhancement for Pre-positioning

```typescript
function buildPrepositioningPrompt(
  currentStage: GrantPrepStageKey,
  nextStage: GrantPrepStageKey,
  currentCaptures: GrantPrepPointCapture[],
  hypothesis: ProposalHypothesis
): string {
  return [
    `As you approach completion of ${currentStage}, analyze the captured content.`,
    '',
    'PRE-POSITIONING TASK:',
    `Based on what has been captured, predict which points from ${nextStage} `,
    'will be most relevant and prepare a preview that:',
    '1. Shows the logical connection from current captures to next stage points',
    '2. Offers 1-2 inferred suggestions for next-stage content (with confidence)',
    '3. Asks if the user wants to validate these predictions or skip to specific points',
    '',
    'This creates a seamless bridge between stages rather than a hard transition.',
  ].join('\n');
}
```

### 3.4 Intention Prediction Engine (IPE)

**New Component**: A prediction layer that analyzes conversation patterns to anticipate user needs

#### Prediction Triggers

```typescript
interface PredictionTrigger {
  id: string;
  // What pattern triggers this prediction
  triggerPattern: {
    stageKey: GrantPrepStageKey;
    capturedKeywords: string[];
    captureText: string;
    confidence: number;
  };
  
  // What this predicts about the proposal
  prediction: {
    proposalHypothesis: Partial<ProposalHypothesis>;
    relevantFutureStages: GrantPrepStageKey[];
    likelyDiscussionPoints: string[];
    suggestedApproach: string;
  };
  
  // How to present this prediction to the user
  presentation: {
    type: 'subtle_hint' | 'explicit_suggestion' | 'option_branch' | 'auto_capture';
    messageTemplate: string;
    options?: GrantPrepSuggestedAnswer[];
  };
}

// Pattern library for prediction
const PREDICTION_PATTERNS: PredictionTrigger[] = [
  {
    id: 'healthcare_access_prediction',
    triggerPattern: {
      stageKey: 'problem_definition',
      capturedKeywords: ['healthcare', 'access', 'remote', 'rural', 'travel'],
      captureText: '*',
      confidence: 0.8
    },
    prediction: {
      proposalHypothesis: {
        problemDomain: 'healthcare',
        problemType: 'access',
        beneficiaryAccessPath: 'physical'
      },
      relevantFutureStages: ['methodology', 'team_and_partnerships', 'risk_and_ethics'],
      likelyDiscussionPoints: ['approach', 'team_roles', 'execution_risks'],
      suggestedApproach: 'Focus on geographic/physical barriers and infrastructure needs'
    },
    presentation: {
      type: 'option_branch',
      messageTemplate: 'I notice you are addressing healthcare access barriers. This typically involves infrastructure, workforce, or digital solutions. Which approach best describes your project?',
      options: [
        { label: 'A', text: 'Infrastructure-based: mobile clinics, transport solutions, facility upgrades' },
        { label: 'B', text: 'Workforce-based: community health workers, telemedicine, task-shifting' },
        { label: 'C', text: 'Digital/tech-based: apps, telehealth, AI-assisted diagnostics' }
      ]
    }
  },
  // ... more patterns
];
```

#### Prediction Confidence Scoring

```typescript
function calculatePredictionConfidence(
  captures: GrantPrepPointCapture[],
  currentStage: GrantPrepStageKey,
  pattern: PredictionTrigger
): number {
  let score = pattern.triggerPattern.confidence;
  
  // Boost if keywords match
  const keywordMatches = pattern.triggerPattern.capturedKeywords.filter(kw =>
    captures.some(c => c.keywords.includes(kw))
  ).length;
  score += (keywordMatches / pattern.triggerPattern.capturedKeywords.length) * 0.2;
  
  // Boost if stage matches exactly
  if (currentStage === pattern.triggerPattern.stageKey) {
    score += 0.1;
  }
  
  // Reduce if conflicting captures exist
  const conflictingCaptures = findConflictingCaptures(captures, pattern);
  score -= conflictingCaptures.length * 0.15;
  
  return Math.min(0.95, Math.max(0.3, score));
}
```

### 3.5 Smart Follow-Up Generation (SFUG)

**Current**: Generic follow-up chips
**Enhanced**: Context-aware, multi-dimensional follow-ups that open conversation branches

#### Enhanced Follow-Up Structure

```typescript
interface SmartFollowUp {
  id: string;
  label: string;
  
  // What this follow-up achieves
  intent: {
    type: 'deepen_current' | 'explore_branch' | 'validate_prediction' | 'preview_next' | 'capture_multiple';
    targetPoints: string[];
    estimatedCoverage: number; // How many points this might cover
  };
  
  // Conditional display rules
  displayCondition: {
    requiredCaptures: string[];
    excludedCaptures: string[];
    requiredStageProgress: number;
    maxUsagePerStage: number;
  };
  
  // What happens when selected
  onSelect: {
    questionTemplate: string;
    expectedCaptures: string[];
    mayAdvanceStage: boolean;
    opensPredictiveOptions: boolean;
  };
}

// Example smart follow-ups for problem_definition stage
const SMART_FOLLOWUPS: Record<GrantPrepStageKey, SmartFollowUp[]> = {
  problem_definition: [
    {
      id: 'quantify_scale',
      label: '📊 Add scale numbers',
      intent: {
        type: 'deepen_current',
        targetPoints: ['problem_scale'],
        estimatedCoverage: 1
      },
      displayCondition: {
        requiredCaptures: ['problem_core'],
        excludedCaptures: ['problem_scale'],
        requiredStageProgress: 0.3,
        maxUsagePerStage: 1
      },
      onSelect: {
        questionTemplate: 'What specific numbers define the scale of this problem? (e.g., affected population, economic cost, mortality rate)',
        expectedCaptures: ['problem_scale', 'evidence_gap'],
        mayAdvanceStage: true,
        opensPredictiveOptions: true
      }
    },
    {
      id: 'explore_urgency',
      label: '⏰ Why urgent now?',
      intent: {
        type: 'explore_branch',
        targetPoints: ['problem_scale', 'evidence_gap'],
        estimatedCoverage: 2
      },
      displayCondition: {
        requiredCaptures: ['problem_core'],
        excludedCaptures: [],
        requiredStageProgress: 0.2,
        maxUsagePerStage: 1
      },
      onSelect: {
        questionTemplate: 'What makes this problem urgent or timely to address now? Consider policy windows, emerging data, or recent events.',
        expectedCaptures: ['problem_scale', 'evidence_gap'],
        mayAdvanceStage: true,
        opensPredictiveOptions: false
      }
    },
    {
      id: 'preview_methodology',
      label: '🔮 How would you solve it?',
      intent: {
        type: 'preview_next',
        targetPoints: ['approach'],
        estimatedCoverage: 1
      },
      displayCondition: {
        requiredCaptures: ['problem_core', 'problem_scale'],
        excludedCaptures: [],
        requiredStageProgress: 0.6,
        maxUsagePerStage: 1
      },
      onSelect: {
        questionTemplate: 'Given the problem you have described, what approach are you considering? This will help me connect your problem to methodology.',
        expectedCaptures: ['approach'],
        mayAdvanceStage: false,
        opensPredictiveOptions: true
      }
    }
  ],
  // ... other stages
};
```

### 3.6 Cross-Stage Dependency Visualization

**New Feature**: Show the user how stages connect and what depends on current answers

#### Dependency Graph Component

```typescript
interface StageDependencyView {
  currentStage: GrantPrepStageKey;
  
  // What's feeding into current stage
  upstreamDependencies: {
    stageKey: GrantPrepStageKey;
    status: 'captured' | 'partial' | 'pending';
    relevantFacts: string[];
    contradictionWarnings?: string[];
  }[];
  
  // What current stage feeds into
  downstreamDependencies: {
    stageKey: GrantPrepStageKey;
    willInherit: string[];
    willNeed: string[];
    readiness: number;
  }[];
  
  // Suggested capture priorities based on dependency graph
  capturePriorities: {
    pointKey: string;
    priority: 'critical' | 'important' | 'optional';
    reason: string; // e.g., "Blocks 3 downstream stages"
  }[];
}
```

---

## 4. Enhanced Marker System

### 4.1 Extended Marker Payload

```typescript
interface EnhancedGrantPrepMarkerPayload {
  // === EXISTING FIELDS (preserved) ===
  version: 'brainstorm_marker_v2';
  stageKey: GrantPrepStageKey;
  readinessDelta?: number;
  pointsCovered?: GrantPrepMarkerPoint[];
  currentPoint?: string | null;
  suggestedFollowUps?: string[] | null;
  suggestedAnswers?: GrantPrepSuggestedAnswer[] | null;
  qualityAssessment?: 'strong' | 'adequate' | 'weak' | null;
  steeringEvents?: Array<{
    level: SteeringLevel;
    message: string;
    pointKey?: string | null;
  }>;
  compactUserFacingSummary?: string | null;
  
  // === NEW PREDICTIVE FIELDS ===
  
  // Multi-point cluster tracking
  clusterCoverage?: {
    clusterId: string;
    pointsInCluster: string[];
    coverageStatus: 'complete' | 'partial' | 'initiated';
  };
  
  // Predictive suggestions for upcoming stages
  predictivePreviews?: {
    stageKey: GrantPrepStageKey;
    relevanceScore: number;
    inferredPoints: {
      pointKey: string;
      inferredFrom: string; // Current stage point that triggered this
      suggestedContent: string;
      confidence: number;
    }[];
    suggestedQuestion: string;
  }[];
  
  // Conditional branches based on selected answer
  conditionalBranches?: {
    triggerAnswerLabel: string;
    branchId: string;
    branchLabel: string;
    followUpQuestion: string;
    followUpOptions: GrantPrepSuggestedAnswer[];
    estimatedPointsToCover: number;
  }[];
  
  // Cross-stage connections made
  crossStageConnections?: {
    fromStage: GrantPrepStageKey;
    fromPoint: string;
    toStage: GrantPrepStageKey;
    toPoint: string;
    connectionType: 'implies' | 'depends_on' | 'contradicts' | 'reinforces';
    connectionNote: string;
  }[];
  
  // Hypothesis updates
  proposalHypothesisSnapshot?: {
    domain: string | null;
    type: string | null;
    scale: string | null;
    beneficiaryType: string | null;
    methodologyApproach: string | null;
    confidence: number;
  };
  
  // Smart follow-up suggestions with metadata
  smartFollowUps?: {
    label: string;
    intent: 'deepen' | 'branch' | 'validate' | 'preview' | 'multi';
    targetPoints: string[];
    expectedCoverage: number;
  }[];
  
  // Stage transition recommendation
  stageTransition?: {
    canAdvance: boolean;
    recommendedAction: 'continue' | 'advance' | 'deepen_first' | 'preview_next';
    currentReadiness: number;
    nextStagePreview: {
      stageKey: GrantPrepStageKey;
      title: string;
      estimatedQuestions: number;
      prepositionedPoints: string[];
    };
  };
}
```

### 4.2 Marker Processing Enhancements

```typescript
// New processing pipeline
async function processEnhancedMarker(
  marker: EnhancedGrantPrepMarkerPayload,
  sessionContext: GrantPrepSessionContext,
  hypothesis: ProposalHypothesis
): Promise<{
  updatedStates: GrantPrepStageStates;
  updatedHypothesis: ProposalHypothesis;
  uiActions: UIAction[];
}> {
  // 1. Apply point captures (existing logic)
  const updatedStates = applyMarkerToStageStates(sessionContext.stageStates, marker);
  
  // 2. Update hypothesis based on captures
  const updatedHypothesis = updateProposalHypothesis(hypothesis, marker);
  
  // 3. Process predictive previews
  const uiActions: UIAction[] = [];
  
  if (marker.predictivePreviews) {
    for (const preview of marker.predictivePreviews) {
      if (preview.relevanceScore > 0.7) {
        uiActions.push({
          type: 'show_preview',
          stageKey: preview.stageKey,
          content: preview
        });
      }
    }
  }
  
  // 4. Process conditional branches
  if (marker.conditionalBranches) {
    uiActions.push({
      type: 'register_branches',
      branches: marker.conditionalBranches
    });
  }
  
  // 5. Process cross-stage connections
  if (marker.crossStageConnections) {
    for (const connection of marker.crossStageConnections) {
      // Store connection in session state
      await storeCrossStageConnection(sessionContext.sessionId, connection);
    }
  }
  
  return { updatedStates, updatedHypothesis, uiActions };
}
```

---

## 5. Prompt Architecture Enhancements

### 5.1 Enhanced System Role (Expert Mode)

```typescript
const ENHANCED_EXPERT_SYSTEM_ROLE = [
  'You are Grant Prep, a senior grant-writing advisor who has reviewed hundreds of funding proposals.',
  'You operate in PROACTIVE MODE: you anticipate user needs, pre-position upcoming stage content,',
  'and guide users through efficient multi-point captures while maintaining reviewer-level rigor.',
  '',
  '=== PROACTIVE CONVERSATION PRINCIPLES ===',
  '',
  '1. PREDICTIVE AWARENESS:',
  '   - Build a working hypothesis about the proposal type based on captured content',
  '   - Identify patterns (healthcare access, education equity, tech innovation, etc.)',
  '   - Use patterns to predict which upcoming stage points will be most relevant',
  '   - When confidence > 0.7, offer predictive preview of next stage',
  '',
  '2. MULTI-POINT CAPTURE (MPCQ):',
  '   - Design questions that naturally invite answers covering 2-3 related points',
  '   - Cluster: Core problem + Scale + Urgency can often be answered together',
  '   - Look for opportunities to capture multiple points in single turns',
  '   - Mark cluster coverage in the marker',
  '',
  '3. HIERARCHICAL ANSWER OPTIONS:',
  '   - Each option should imply different paths through upcoming stages',
  '   - Label options with their implied category: [ACCESS+DIGITAL], [QUALITY+INSTITUTIONAL], etc.',
  '   - Include "opens:" notes showing what stages/Points each option unlocks',
  '   - Options should be meaningfully different, not just variations',
  '',
  '4. STAGE TRANSITION PREVIEW:',
  '   - At 60%+ readiness, begin previewing the next stage',
  '   - Show logical connections: "Given your methodology, evaluation will focus on..."',
  '   - Offer prepositioned points: "Based on X, you will likely need to address Y"',
  '   - Let users validate predictions or choose different paths',
  '',
  '5. CONDITIONAL BRANCHING:',
  '   - Track which answer option was selected',
  '   - On next turn, open conditional follow-up branches',
  '   - Example: If user selects "digital solution" branch, pre-position team/tech questions',
  '',
  '6. CROSS-STAGE CONNECTION TRACKING:',
  '   - When a capture in Stage A implies something about Stage B, record the connection',
  '   - Use connections to build dependency visualization',
  '   - Alert users to contradictions between stages',
  '',
  '7. SMART FOLLOW-UP GENERATION:',
  '   - Generate follow-up chips based on coverage gaps and prediction patterns',
  '   - Prioritize follow-ups that cover multiple points',
  '   - Include "preview" type follow-ups that peek ahead',
  '',
  '=== RESPONSE STRUCTURE ===',
  '',
  'PROSE (90-140 words):',
  '   - Validate, challenge, differentiate as before',
  '   - Add: "Given what you have shared, I anticipate..." for predictions',
  '   - Connect current captures to upcoming stage needs',
  '',
  'QUESTION:',
  '   - Design for multi-point coverage where possible',
  '   - Frame: "Help me understand [A], [B], and how they relate to [C]"',
  '',
  'ANSWER OPTIONS (2-3):',
  '   - Label with implied pattern: [TYPE+APPROACH]',
  '   - Include brief "opens:" note showing stage implications',
  '   - Options should branch meaningfully, not just vary wording',
  '',
  'MARKER:',
  '   - Include cluster coverage tracking',
  '   - Include predictive previews for high-confidence predictions',
  '   - Include conditional branches if options have follow-up implications',
  '   - Include cross-stage connections discovered',
].join('\n');
```

### 5.2 Stage-Specific Enhancement Prompts

```typescript
const STAGE_ENHANCEMENT_PROMPTS: Record<GrantPrepStageKey, string> = {
  problem_definition: [
    'STAGE ENHANCEMENT: Problem Definition with Prediction Seeding',
    '',
    'As you capture problem definition content, simultaneously:',
    '1. Identify the problem domain (health, education, tech, etc.)',
    '2. Classify the problem type (access, quality, efficiency, equity)',
    '3. Note beneficiary characteristics that predict methodology needs',
    '4. If keywords indicate common patterns (e.g., "rural healthcare access"),',
    '   pre-position methodology suggestions and risk indicators',
    '',
    'In your marker, include proposalHypothesisSnapshot with your classification.',
  ].join('\n'),
  
  methodology: [
    'STAGE ENHANCEMENT: Methodology with Dependency Awareness',
    '',
    'This stage has rich upstream dependencies from problem, root cause, and beneficiaries.',
    '',
    '1. Before asking methodology questions, review inherited facts:',
    '   - Problem characteristics dictate evaluation approaches',
    '   - Root cause analysis suggests intervention points',
    '   - Beneficiary access paths constrain delivery methods',
    '',
    '2. Offer methodology options that:',
    '   - Are consistent with upstream captures',
    '   - Pre-position team needs (e.g., "mixed methods" implies data expertise)',
    '   - Surface risks tied to method choice',
    '',
    '3. In marker, record crossStageConnections showing how methodology',
    '   choices impact team, workplan, and risk stages.',
  ].join('\n'),
  
  // ... other stages
};
```

---

## 6. UI/UX Enhancements

### 6.1 Predictive Option Cards

```typescript
// Enhanced option display with prediction indicators
interface PredictiveOptionCardProps {
  option: PredictiveAnswerOption;
  onSelect: () => void;
  isExpanded: boolean;
}

// Visual hierarchy:
// ┌─────────────────────────────────────────────────────────┐
// │ [A]  Rural pregnant women in Bihar face...              │
// │      [ACCESS + DIGITAL]                                 │
// │                                                         │
// │      Opens:                                             │
// │      • Methodology: Tech implementation approach        │
// │      • Team: Digital health expertise needs             │
// │      • Risks: Connectivity, digital divide mitigation     │
// │                                                         │
// │      [Why this matters to reviewers: ...]               │
// └─────────────────────────────────────────────────────────┘
```

### 6.2 Stage Preview Overlay

```typescript
// Component triggered at 60%+ readiness
interface StagePreviewOverlayProps {
  currentStage: GrantPrepStageState;
  nextStagePreview: StageTransitionPreview['nextStagePreview'];
  onAction: (action: 'advance' | 'deepen' | 'skip_preview') => void;
}

// Visual:
// ┌─────────────────────────────────────────────────────────────┐
// │  🎉 You're almost done with Problem Definition!               │
// │                                                               │
// │  Based on what you've shared, here's what comes next:         │
// │                                                               │
// │  ┌─ METHODOLOGY ────────────────────────────────────────┐    │
// │  │                                                      │    │
// │  │  📍 Likely focus areas (from your problem):          │    │
// │  │     • Tech-based intervention (inferred)             │    │
// │  │     • Community delivery model (inferred)            │    │
// │  │                                                      │    │
// │  │  ❓ Expected questions: ~4-5                          │    │
// │  │                                                      │    │
// 1│  │  [Preview Methodology Stage]  [Stay & Deepen Current] │    │
// │  └──────────────────────────────────────────────────────┘    │
// │                                                               │
// │  Or jump ahead:                                               │
// │  [📊 Team & Partnerships]  [⚠️  Risk & Ethics]               │
// └─────────────────────────────────────────────────────────────┘
```

### 6.3 Cross-Stage Dependency Map

```typescript
// Sidebar component showing proposal connectivity
interface DependencyMapProps {
  stageStates: GrantPrepStageStates;
  crossStageConnections: CrossStageConnection[];
  activeStage: GrantPrepStageKey;
}

// Visual representation:
// PROBLEM_DEFINITION ──┬──► METHODOLOGY (inferred approach)
//       │              │
//       │              └──► BENEFICIARIES (access constraints)
//       │
//       └──► ROOT_CAUSE ──┬──► METHODOLOGY (intervention logic)
//                         │
//                         └──► RISK_AND_ETHICS (systemic risks)
```

### 6.4 Smart Follow-Up Chips with Metadata

```typescript
interface EnhancedFollowUpChipProps {
  followUp: SmartFollowUp;
  onClick: () => void;
}

// Visual:
// [📊 Add scale numbers]      [⚡ Why urgent now?]      [🔮 How solve it?]
//  covers 1 point              covers 2 points         previews next stage
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Goals**: Extend data models and marker system

- [ ] Extend `GrantPrepMarkerPayload` type with new fields
- [ ] Create `ProposalHypothesis` type and tracking
- [ ] Add `DiscussionPointCluster` definitions
- [ ] Create `PredictionTrigger` pattern library (10 initial patterns)
- [ ] Update marker parsing (`marker.ts`) to handle v2
- [ ] Add database migration for new fields
- [ ] Update session state to track hypothesis

**Files Modified**:
- `src/lib/grantPrep/types.ts`
- `src/lib/grantPrep/marker.ts`
- `src/lib/grantPrep/sessionState.ts`
- Prisma schema

### Phase 2: Prompt Enhancement (Weeks 3-4)

**Goals**: Enhance LLM prompts for proactive behavior

- [ ] Create enhanced system role with proactive principles
- [ ] Add stage-specific enhancement prompts
- [ ] Implement cluster-aware prompt building
- [ ] Add hypothesis tracking to prompt context
- [ ] Update `promptComposer.ts` with prepositioning logic
- [ ] A/B test enhanced prompts against baseline

**Files Modified**:
- `src/lib/grantPrep/promptComposer.ts`

### Phase 3: Prediction Engine (Weeks 5-6)

**Goals**: Build intention prediction and pattern matching

- [ ] Implement `calculatePredictionConfidence` function
- [ ] Create pattern matching engine
- [ ] Build hypothesis update logic
- [ ] Implement predictive preview generation
- [ ] Add cross-stage connection detection
- [ ] Create prediction quality tracking

**New Files**:
- `src/lib/grantPrep/predictionEngine.ts`
- `src/lib/grantPrep/predictionPatterns.ts`
- `src/lib/grantPrep/hypothesisTracker.ts`

### Phase 4: Multi-Point Capture (Weeks 7-8)

**Goals**: Implement clustered question flow

- [ ] Define clusters for all 15 pickable stages
- [ ] Implement cluster-aware question generation
- [ ] Add cluster coverage tracking to markers
- [ ] Update point status logic for multi-point captures
- [ ] Build cluster completion detection
- [ ] Test coverage efficiency vs. baseline

**Files Modified**:
- `src/lib/grantPrep/stageLibrary.ts` (cluster definitions)
- `src/lib/grantPrep/sessionState.ts` (cluster tracking)

### Phase 5: Smart UI Components (Weeks 9-10)

**Goals**: Build enhanced UI for proactive interactions

- [ ] Create `PredictiveOptionCard` component
- [ ] Build `StagePreviewOverlay` modal
- [ ] Implement `DependencyMap` sidebar component
- [ ] Enhance `GrantPrepChatPane` with new interactions
- [ ] Update follow-up chips with metadata display
- [ ] Add transition animations for stage changes

**New Files**:
- `src/components/grantPrep/PredictiveOptionCard.tsx`
- `src/components/grantPrep/StagePreviewOverlay.tsx`
- `src/components/grantPrep/DependencyMap.tsx`

**Modified Files**:
- `src/components/grantPrep/GrantPrepChatPane.tsx`

### Phase 6: Integration & Testing (Weeks 11-12)

**Goals**: Full integration and quality validation

- [ ] Wire prediction engine to message route
- [ ] Connect UI components to session state
- [ ] Implement conditional branch handling
- [ ] Add comprehensive logging for prediction accuracy
- [ ] Create test suite with 50+ conversation scenarios
- [ ] Measure: avg turns per stage, coverage quality, user satisfaction
- [ ] Fine-tune based on metrics

**Files Modified**:
- `src/app/api/grant-prep/sessions/[id]/message/route.ts`
- All component files for integration

---

## 8. Success Metrics

### Efficiency Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Avg turns per stage | 4-5 | 2-3 | Track message count / stage completions |
| Points captured per turn | 1.0 | 1.5+ | Marker analysis |
| Stage completion rate | 70% | 85% | Session status tracking |
| Auto-advance utilization | 30% | 60% | Transition method logging |

### Quality Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Handoff readiness score | 0.72 | 0.80+ | `overall_readiness` average |
| Prediction accuracy | N/A | 75%+ | Manual review of predictions |
| User correction rate | N/A | <20% | Track prediction override rate |
| Contradiction detection | 0 | 90%+ | Synthetic test cases |

### User Experience Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Session abandonment | 25% | <15% | Analytics tracking |
| Time to handoff | 45 min | 30 min | Session duration |
| User satisfaction | N/A | 4.2/5 | Post-session survey |
| Feature adoption | N/A | 70% use predictive options | UI interaction tracking |

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Overwhelming users with predictions | Confidence threshold (0.7+), progressive disclosure |
| Wrong predictions damage trust | Easy override, clear "this is a suggestion" framing |
| Multi-point questions confuse users | Fallback to single-point if parsing fails |
| UI clutter from new components | Collapsible sections, clean mode option |
| LLM ignores new prompt instructions | Few-shot examples, marker validation |
| Performance impact of prediction | Cache hypothesis, async pattern matching |

---

## 10. Future Extensions

### 10.1 Adaptive Difficulty
- Adjust question complexity based on user expertise signals
- Detect researcher vs. practitioner vs. administrator patterns

### 10.2 Learning from Corrections
- When users override predictions, store correction patterns
- Retrain/improve pattern library based on aggregate corrections

### 10.3 Collaborative Prediction
- Compare hypothesis against similar funded proposals
- Surface "proposals like yours typically address..." suggestions

### 10.4 Real-time Funder Intelligence
- Integrate funding call updates into live predictions
- Alert when new priorities emerge that match proposal pattern

---

## Appendix: Example Enhanced Conversation Flow

### Current Flow (Problem Definition)

```
AI: What problem are you addressing?
User: Rural maternal mortality in Bihar
AI: Can you be more specific about the scale?
User: 300 deaths per 100,000, mostly in remote areas
AI: What is the evidence gap?
User: ...
[4-5 turns to cover 3 points]
```

### Enhanced Flow (Problem Definition)

```
AI: What core problem are you addressing, and what makes it urgent 
    or timely to solve now?
    
    [Pattern detected: rural + healthcare + access → Predictive options]
    
    A. [ACCESS + DIGITAL] Rural pregnant women face 3-hour travel times 
       to clinics; we connect them via mobile health platform
       → Opens: tech methodology, digital literacy needs, connectivity risks
       
    B. [QUALITY + WORKFORCE] Frontline workers lack diagnostic training; 
       we upskill 500 ASHA workers with standardized protocols
       → Opens: training methodology, institutional partnerships, scale risks
       
    C. [EQUITY + HYBRID] Tribal communities receive substandard care; 
       our model combines home visits with telemedicine
       → Opens: community methodology, ethics considerations, equity metrics

User: [Selects A]

AI: Excellent. Captured: Problem (access barriers), Scale (3-hour travel), 
    Urgency (mortality rates). I anticipate you'll need digital infrastructure 
    expertise and connectivity mitigation—I'll pre-position these for later.
    
    [Smart follow-ups: 📊 Add specific numbers | ⏰ Policy window timing | 
     🔮 Preview methodology]

User: [Clicks 🔮 Preview methodology]

AI: Given your access problem, methodology will likely focus on:
    1. Platform design and user experience
    2. Provider network integration
    3. Connectivity solutions for low-bandwidth areas
    
    [Shows Methodology stage preview overlay with estimated 4-5 questions]
    
    Continue to Methodology now, or deepen Problem Definition first?
    
User: [Continues]

[2-3 turns to cover same ground + preview of next stage]
```

---

**End of Enhancement Plan**
