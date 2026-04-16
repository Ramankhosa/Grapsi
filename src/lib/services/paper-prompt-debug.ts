/**
 * Paper Prompt Debug Utility
 * 
 * Provides detailed terminal output showing the full prompt hierarchy
 * and LLM cost information when generating paper sections.
 * 
 * Enable by setting environment variable: PAPER_PROMPT_DEBUG=true
 * Or by calling enableDebug() at runtime
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// Debug state
let debugEnabled = process.env.PAPER_PROMPT_DEBUG === 'true';

export function enableDebug() {
  debugEnabled = true;
  console.log(`${colors.bgGreen}${colors.bold} PAPER PROMPT DEBUG ENABLED ${colors.reset}`);
}

export function disableDebug() {
  debugEnabled = false;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

// ============================================================================
// Debug Interfaces
// ============================================================================

export interface PromptLayer {
  priority: number;
  name: string;
  source: string;
  content: string;
  charCount: number;
  tokenEstimate: number;
}

export interface PromptDebugInfo {
  sessionId: string;
  sectionKey: string;
  paperTypeCode: string;
  methodologyType: string | null;
  timestamp: Date;
  layers: PromptLayer[];
  totalPromptChars: number;
  totalPromptTokens: number;
  finalPrompt?: string;
}

export interface LLMDebugInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  totalCostUSD: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

export interface FullDebugReport {
  prompt: PromptDebugInfo;
  llm?: LLMDebugInfo;
  outputPreview?: string;
}

// ============================================================================
// Logging Functions
// ============================================================================

export function logPromptHierarchy(debug: PromptDebugInfo): void {
  if (!debugEnabled) return;

  const separator = '═'.repeat(80);
  const thinSeparator = '─'.repeat(80);

  console.log('\n');
  console.log(`${colors.bgBlue}${colors.bold}${colors.white} 📝 PAPER PROMPT DEBUG - ${debug.sectionKey.toUpperCase()} ${colors.reset}`);
  console.log(`${colors.blue}${separator}${colors.reset}`);
  
  // Metadata
  console.log(`${colors.cyan}Session:${colors.reset} ${debug.sessionId}`);
  console.log(`${colors.cyan}Paper Type:${colors.reset} ${debug.paperTypeCode}`);
  console.log(`${colors.cyan}Methodology:${colors.reset} ${debug.methodologyType || 'Not specified'}`);
  console.log(`${colors.cyan}Timestamp:${colors.reset} ${debug.timestamp.toISOString()}`);
  
  console.log(`\n${colors.yellow}${colors.bold}PROMPT LAYERS (Priority Order: Low → High)${colors.reset}`);
  console.log(`${colors.dim}${thinSeparator}${colors.reset}`);

  // Log each layer
  for (const layer of debug.layers) {
    const priorityColor = getPriorityColor(layer.priority);
    const hasContent = layer.content && layer.content.trim().length > 0;
    const status = hasContent ? `${colors.green}✓${colors.reset}` : `${colors.dim}○${colors.reset}`;
    
    console.log(`\n${status} ${priorityColor}[P${layer.priority}]${colors.reset} ${colors.bold}${layer.name}${colors.reset}`);
    console.log(`   ${colors.dim}Source:${colors.reset} ${layer.source}`);
    console.log(`   ${colors.dim}Size:${colors.reset} ${layer.charCount.toLocaleString()} chars (~${layer.tokenEstimate.toLocaleString()} tokens)`);
    
    if (hasContent) {
      // Show preview of content (first 200 chars)
      const preview = layer.content.substring(0, 200).replace(/\n/g, ' ');
      console.log(`   ${colors.dim}Preview:${colors.reset} ${preview}${layer.content.length > 200 ? '...' : ''}`);
    }
  }

  // Summary
  console.log(`\n${colors.yellow}${colors.bold}PROMPT SUMMARY${colors.reset}`);
  console.log(`${colors.dim}${thinSeparator}${colors.reset}`);
  console.log(`${colors.cyan}Total Characters:${colors.reset} ${debug.totalPromptChars.toLocaleString()}`);
  console.log(`${colors.cyan}Estimated Tokens:${colors.reset} ${debug.totalPromptTokens.toLocaleString()}`);
  console.log(`${colors.cyan}Active Layers:${colors.reset} ${debug.layers.filter(l => l.content.trim().length > 0).length}/${debug.layers.length}`);
}

export function logLLMResult(llm: LLMDebugInfo): void {
  if (!debugEnabled) return;

  const thinSeparator = '─'.repeat(80);

  console.log(`\n${colors.yellow}${colors.bold}LLM EXECUTION RESULT${colors.reset}`);
  console.log(`${colors.dim}${thinSeparator}${colors.reset}`);

  if (llm.success) {
    console.log(`${colors.green}✓ Success${colors.reset}`);
  } else {
    console.log(`${colors.red}✗ Failed: ${llm.errorMessage}${colors.reset}`);
  }

  console.log(`\n${colors.cyan}Model:${colors.reset} ${llm.model}`);
  console.log(`${colors.cyan}Latency:${colors.reset} ${llm.latencyMs.toLocaleString()}ms`);
  
  console.log(`\n${colors.magenta}${colors.bold}Token Usage:${colors.reset}`);
  console.log(`   Input:  ${llm.inputTokens.toLocaleString()} tokens`);
  console.log(`   Output: ${llm.outputTokens.toLocaleString()} tokens`);
  console.log(`   Total:  ${llm.totalTokens.toLocaleString()} tokens`);

  console.log(`\n${colors.green}${colors.bold}Cost Breakdown:${colors.reset}`);
  console.log(`   Input:  $${llm.inputCostUSD.toFixed(6)}`);
  console.log(`   Output: $${llm.outputCostUSD.toFixed(6)}`);
  console.log(`   ${colors.bold}Total:  $${llm.totalCostUSD.toFixed(6)}${colors.reset}`);
}

export function logFullReport(report: FullDebugReport): void {
  if (!debugEnabled) return;

  const separator = '═'.repeat(80);

  logPromptHierarchy(report.prompt);
  
  if (report.llm) {
    logLLMResult(report.llm);
  }

  if (report.outputPreview) {
    console.log(`\n${colors.yellow}${colors.bold}OUTPUT PREVIEW${colors.reset}`);
    console.log(`${colors.dim}${'─'.repeat(80)}${colors.reset}`);
    console.log(`${colors.dim}${report.outputPreview.substring(0, 500)}${report.outputPreview.length > 500 ? '...' : ''}${colors.reset}`);
  }

  console.log(`\n${colors.blue}${separator}${colors.reset}`);
  console.log(`${colors.bgBlue}${colors.white} END DEBUG - ${report.prompt.sectionKey.toUpperCase()} ${colors.reset}\n`);
}

// ============================================================================
// Helper Functions
// ============================================================================

function getPriorityColor(priority: number): string {
  switch (priority) {
    case 1: return colors.dim;
    case 2: return colors.blue;
    case 3: return colors.cyan;
    case 4: return colors.green;
    case 5: return colors.yellow;
    case 6: return colors.magenta;
    case 7: return colors.red + colors.bold;
    default: return colors.white;
  }
}

/**
 * Estimate token count from character count (rough approximation)
 * Average English text: ~4 characters per token
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * Create a prompt layer object
 */
export function createPromptLayer(
  priority: number,
  name: string,
  source: string,
  content: string
): PromptLayer {
  return {
    priority,
    name,
    source,
    content: content || '',
    charCount: (content || '').length,
    tokenEstimate: estimateTokens(content || '')
  };
}

/**
 * Build debug info from prompt components
 */
export function buildPromptDebugInfo(
  sessionId: string,
  sectionKey: string,
  paperTypeCode: string,
  methodologyType: string | null,
  components: {
    basePrompt: string;
    paperTypeOverride?: string;
    methodologyConstraints?: string;
    blueprintContext?: string;
    figureGrounding?: string;
    previousMemories?: string;
    preferredTerms?: string;
    writingPersona?: string;
    userInstructions?: string;
  },
  finalPrompt?: string
): PromptDebugInfo {
  const layers: PromptLayer[] = [
    createPromptLayer(1, 'BASE PROMPT', `PaperSupersetSection.${sectionKey}`, components.basePrompt),
    createPromptLayer(2, 'PAPER TYPE OVERRIDE (Pass 2 only)', `PaperTypeSectionPrompt.${paperTypeCode} → deferred to polish pipeline`, components.paperTypeOverride || ''),
    createPromptLayer(3, 'METHODOLOGY CONSTRAINTS', `methodology-constraints.ts / ${methodologyType || 'none'}`, components.methodologyConstraints || ''),
    createPromptLayer(4, 'BLUEPRINT CONTEXT', `PaperBlueprint (frozen plan)`, components.blueprintContext || ''),
    createPromptLayer(4, 'FIGURE GROUNDING', `FigurePlan / stored figure metadata`, components.figureGrounding || ''),
    createPromptLayer(4, 'PREVIOUS SECTIONS MEMORY', `PaperSection.memory (accumulated)`, components.previousMemories || ''),
    createPromptLayer(4, 'PREFERRED TERMS', `Blueprint.preferredTerms`, components.preferredTerms || ''),
    createPromptLayer(6, 'WRITING PERSONA', `PaperWritingSample (user style)`, components.writingPersona || ''),
    createPromptLayer(7, 'USER INSTRUCTIONS', `UserSectionInstruction (HIGHEST PRIORITY)`, components.userInstructions || ''),
  ];

  const totalChars = layers.reduce((sum, l) => sum + l.charCount, 0);
  const totalTokens = layers.reduce((sum, l) => sum + l.tokenEstimate, 0);

  return {
    sessionId,
    sectionKey,
    paperTypeCode,
    methodologyType,
    timestamp: new Date(),
    layers,
    totalPromptChars: totalChars,
    totalPromptTokens: totalTokens,
    finalPrompt
  };
}

/**
 * Build LLM debug info from execution result
 */
export function buildLLMDebugInfo(
  model: string,
  inputTokens: number,
  outputTokens: number,
  inputCostPer1M: number,
  outputCostPer1M: number,
  latencyMs: number,
  success: boolean,
  errorMessage?: string
): LLMDebugInfo {
  const inputCostUSD = (inputTokens / 1_000_000) * inputCostPer1M;
  const outputCostUSD = (outputTokens / 1_000_000) * outputCostPer1M;

  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCostUSD,
    outputCostUSD,
    totalCostUSD: inputCostUSD + outputCostUSD,
    latencyMs,
    success,
    errorMessage
  };
}

// Export a singleton for convenience
export const paperPromptDebug = {
  enable: enableDebug,
  disable: disableDebug,
  isEnabled: isDebugEnabled,
  logPromptHierarchy,
  logLLMResult,
  logFullReport,
  buildPromptDebugInfo,
  buildLLMDebugInfo,
  createPromptLayer,
  estimateTokens
};

export default paperPromptDebug;

