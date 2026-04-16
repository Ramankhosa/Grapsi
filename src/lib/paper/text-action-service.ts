/**
 * Text Action Service for Paper Writing
 * Handles AI-powered text transformations: rewrite, expand, condense, formalize, simplify, create sections
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';
import { systemPromptTemplateService, TEMPLATE_KEYS } from '@/lib/services/system-prompt-template-service';

// ============================================================================
// Types
// ============================================================================

export type TextActionType = 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections';

export interface TextActionRequest {
  sessionId: string;
  userId: string;
  action: TextActionType;
  selectedText: string;
  context?: string; // Surrounding text for better understanding
  sectionKey?: string;
  customInstructions?: string;
}

export interface TextActionResponse {
  success: boolean;
  originalText: string;
  transformedText: string;
  action: TextActionType;
  tokenUsage?: {
    input: number;
    output: number;
  };
  error?: string;
}

// ============================================================================
// Citation Extraction & Preservation
// ============================================================================

// Regex patterns for common citation formats
const CITATION_PATTERNS = [
  /\[([^\]]+,\s*\d{4}[a-z]?)\]/g,           // [Author, 2023] or [Author, 2023a]
  /\[(\d+(?:,\s*\d+)*)\]/g,                  // [1] or [1, 2, 3]
  /\(([A-Z][a-z]+(?:\s+(?:et\s+al\.?|&|and)\s+[A-Z][a-z]+)?,\s*\d{4}[a-z]?)\)/g, // (Author et al., 2023)
  /\(([A-Z][a-z]+,\s*\d{4}[a-z]?)\)/g,      // (Author, 2023)
  /\[Figure\s+(\d+)\]/gi,                    // [Figure 1]
  /\[Table\s+(\d+)\]/gi,                     // [Table 1]
  /\[Equation\s+(\d+)\]/gi,                  // [Equation 1]
];

/**
 * Extract all citations from text
 */
function extractCitations(text: string): { citation: string; index: number }[] {
  const citations: { citation: string; index: number }[] = [];
  
  for (const pattern of CITATION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      citations.push({
        citation: match[0],
        index: match.index
      });
    }
  }
  
  // Sort by index and remove duplicates
  const unique = citations
    .sort((a, b) => a.index - b.index)
    .filter((item, idx, arr) => 
      idx === 0 || item.citation !== arr[idx - 1].citation || item.index !== arr[idx - 1].index
    );
  
  return unique;
}

/**
 * Verify citations are preserved in output, reinsert if missing
 */
function ensureCitationsPreserved(originalText: string, transformedText: string): string {
  const originalCitations = extractCitations(originalText);
  const transformedCitations = extractCitations(transformedText);
  
  // Find missing citations
  const transformedCitationStrings = new Set(transformedCitations.map(c => c.citation));
  const missingCitations = originalCitations.filter(c => !transformedCitationStrings.has(c.citation));
  
  if (missingCitations.length === 0) {
    return transformedText;
  }
  
  // Append missing citations at the end with a note
  let result = transformedText.trim();
  
  // If there are missing citations, try to insert them intelligently
  // or append them at the end of relevant sentences
  const missedList = missingCitations.map(c => c.citation).join(', ');
  
  // Add a subtle marker that citations were preserved
  // In most cases, we'll add them near the end of the text
  if (!result.endsWith('.')) {
    result += '.';
  }
  
  // Check if it's a short list of missing citations
  if (missingCitations.length <= 3) {
    // Insert before the final period
    const lastPeriodIdx = result.lastIndexOf('.');
    if (lastPeriodIdx > 0) {
      const beforePeriod = result.slice(0, lastPeriodIdx);
      const afterPeriod = result.slice(lastPeriodIdx);
      result = `${beforePeriod} ${missedList}${afterPeriod}`;
    }
  }
  
  return result;
}

/**
 * Build citation preservation instructions for LLM
 */
function buildCitationInstructions(text: string): string {
  const citations = extractCitations(text);
  
  if (citations.length === 0) {
    return '';
  }
  
  const citationList = [...new Set(citations.map(c => c.citation))].join(', ');
  
  return `
CRITICAL - CITATION PRESERVATION:
The following citations MUST be preserved EXACTLY as written in the output:
${citationList}

- Do NOT modify, remove, or rephrase any citation
- Do NOT change citation format (e.g., [Author, 2023] must remain [Author, 2023])
- Keep citations in their logical positions relative to the claims they support
- If restructuring sentences, ensure citations stay with their associated statements
`;
}

// ============================================================================
// System Prompts
// ============================================================================

const SYSTEM_PROMPTS: Record<TextActionType, string> = {
  rewrite: `You are an expert academic editor helping improve research paper text.
Your task is to REWRITE the selected text to improve:
- Clarity and readability
- Flow and transitions
- Precision of language
- Academic tone

RULES:
1. Maintain the same meaning and key information
2. Keep approximately the same length
3. Use appropriate academic vocabulary
4. CRITICALLY IMPORTANT: Preserve ALL citations and references EXACTLY as they appear (e.g., [Author, 2023], [1], (Smith et al., 2022))
5. Return ONLY the improved text, no explanations
6. Citations must remain with their associated claims/statements

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Preserve heading/list hierarchy if present
- Preserve citations exactly

OUTPUT: Return only the rewritten text, nothing else.`,

  expand: `You are an expert academic writer helping expand research paper content.
Your task is to EXPAND the selected text by:
- Adding more detail and depth
- Including supporting explanations
- Elaborating on key concepts
- Adding relevant context

RULES:
1. Maintain the original meaning and focus
2. Add approximately 50-100% more content
3. Keep academic tone and style
4. Ensure new content is relevant and substantive
5. CRITICALLY IMPORTANT: Preserve ALL existing citations EXACTLY as they appear - do not modify, remove, or change format
6. Return ONLY the expanded text, no explanations

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Preserve heading/list hierarchy if present
- Preserve citations exactly

OUTPUT: Return only the expanded text, nothing else.`,

  condense: `You are an expert academic editor helping condense research paper text.
Your task is to CONDENSE the selected text to:
- Remove redundancy
- Tighten prose
- Keep essential information only
- Improve conciseness

RULES:
1. Reduce length by approximately 30-50%
2. CRITICALLY IMPORTANT: Preserve ALL citations and references EXACTLY - these are non-negotiable and must remain
3. Maintain academic tone
4. Ensure nothing critical is lost including all citation markers
5. Return ONLY the condensed text, no explanations

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Preserve heading/list hierarchy if present
- Preserve citations exactly

OUTPUT: Return only the condensed text, nothing else.`,

  formal: `You are an expert academic editor helping formalize research paper text.
Your task is to make the text MORE FORMAL by:
- Using academic vocabulary
- Removing colloquialisms
- Adding scholarly hedging where appropriate
- Improving objectivity

RULES:
1. Maintain the same meaning and information
2. Use third person where possible
3. Replace informal phrases with academic equivalents
4. CRITICALLY IMPORTANT: Preserve ALL citations EXACTLY as written - do not modify citation format
4. Keep approximately the same length
5. Return ONLY the formalized text, no explanations

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Preserve heading/list hierarchy if present
- Preserve citations exactly

OUTPUT: Return only the formalized text, nothing else.`,

  simple: `You are an expert science communicator helping simplify research paper text.
Your task is to SIMPLIFY the text to:
- Use clearer, more accessible language
- Break down complex sentences
- Explain technical terms where used
- Improve readability

RULES:
1. Maintain scientific accuracy
2. Keep essential technical terms (with brief explanations if needed)
3. Target educated but non-specialist readers
4. Keep approximately the same length
5. CRITICALLY IMPORTANT: Preserve ALL citations EXACTLY as they appear - citations like [Author, 2023], [1], (Smith, 2022) must not be changed
6. Return ONLY the simplified text, no explanations

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Preserve heading/list hierarchy if present
- Preserve citations exactly

OUTPUT: Return only the simplified text, nothing else.`,

  create_sections: `You are an expert academic writing editor helping organize plain text into clear headed sections.
Your task is to RESTRUCTURE the selected text into well-organized section blocks by:
- Identifying major ideas in the selected text
- Creating concise, meaningful subsection headings
- Grouping related sentences under the right heading
- Improving flow between section blocks

RULES:
1. Preserve the original meaning, claims, and evidence
2. Do NOT invent facts, citations, data, or references
3. CRITICALLY IMPORTANT: Preserve ALL citations EXACTLY as written - do not modify citation format
4. Use Markdown subsection headings (### Heading) followed by body paragraphs
5. Keep the text academically coherent and publication-ready
6. Do not output bullets unless the source text clearly requires a list
7. Return ONLY the reorganized text, no explanations

OUTPUT FORMAT (MANDATORY):
- Return ONLY polished Markdown text (no JSON, no code fences, no explanations)
- Use multiple '###' headings where appropriate
- Preserve citations exactly

OUTPUT: Return only the reorganized text, nothing else.`
};

function getStageCodeForTextAction(action: TextActionType): string {
  if (action === 'create_sections') {
    return 'PAPER_CREATE_SECTIONS';
  }
  return 'PAPER_TEXT_ACTION';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the appropriate LLM model for text actions
 */
async function getTextActionModel(userId: string, action: TextActionType): Promise<{ modelCode: string; apiKey: string } | null> {
  try {
    const preferredStageCode = getStageCodeForTextAction(action);
    const stageCodes =
      preferredStageCode === 'PAPER_TEXT_ACTION'
        ? ['PAPER_TEXT_ACTION']
        : [preferredStageCode, 'PAPER_TEXT_ACTION'];

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true }
    });

    if (!user?.tenantId) {
      return {
        modelCode: 'gemini-2.0-flash',
        apiKey: process.env.GOOGLE_AI_API_KEY || ''
      };
    }

    const now = new Date();
    const tenantPlan = await prisma.tenantPlan.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        plan: {
          include: {
            stageModelConfigs: {
              where: {
                isActive: true,
                stage: { code: { in: stageCodes } }
              },
              orderBy: { priority: 'desc' },
              include: {
                model: true,
                stage: {
                  select: { code: true }
                }
              }
            }
          }
        }
      }
    });

    const stageConfigs = tenantPlan?.plan?.stageModelConfigs || [];
    const selectedConfig =
      stageConfigs.find((cfg) => cfg.stage?.code === preferredStageCode)
      || stageConfigs.find((cfg) => cfg.stage?.code === 'PAPER_TEXT_ACTION')
      || null;

    if (selectedConfig?.model?.code) {
      const modelCode = selectedConfig.model.code;
      return {
        modelCode,
        apiKey: process.env.GOOGLE_AI_API_KEY || ''
      };
    }

    // Fallback to default model
    return {
      modelCode: 'gemini-2.0-flash',
      apiKey: process.env.GOOGLE_AI_API_KEY || ''
    };
  } catch {
    return {
      modelCode: 'gemini-2.0-flash',
      apiKey: process.env.GOOGLE_AI_API_KEY || ''
    };
  }
}

/**
 * Build user prompt with context and citation preservation instructions
 */
function buildUserPrompt(request: TextActionRequest): string {
  let prompt = '';

  // Add citation preservation instructions if citations are present
  const citationInstructions = buildCitationInstructions(request.selectedText);
  if (citationInstructions) {
    prompt += citationInstructions + '\n';
  }

  // Add context if available
  if (request.context) {
    prompt += `CONTEXT (surrounding text for reference):\n${request.context}\n\n`;
  }

  // Add custom instructions if provided
  if (request.customInstructions) {
    prompt += `ADDITIONAL INSTRUCTIONS: ${request.customInstructions}\n\n`;
  }

  // Add section info if available
  if (request.sectionKey) {
    prompt += `SECTION: ${request.sectionKey}\n\n`;
  }

  // Add the text to transform
  prompt += `TEXT TO ${request.action.toUpperCase()}:\n${request.selectedText}`;

  return prompt;
}

async function resolveSystemPrompt(request: TextActionRequest): Promise<string> {
  const fallback = SYSTEM_PROMPTS[request.action];

  if (request.action !== 'create_sections') {
    return fallback;
  }

  const normalizedSection =
    request.sectionKey?.trim().toLowerCase().replace(/[\s-]+/g, '_') || '*';

  return systemPromptTemplateService.resolveWithFallback(
    {
      templateKey: TEMPLATE_KEYS.TEXT_ACTION_CREATE_SECTIONS,
      applicationMode: 'paper',
      sectionScope: normalizedSection,
    },
    fallback
  );
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Perform a text action using LLM
 */
export async function performTextAction(request: TextActionRequest): Promise<TextActionResponse> {
  const { action, selectedText, userId, sessionId } = request;

  // Validate input
  if (!selectedText?.trim()) {
    return {
      success: false,
      originalText: selectedText,
      transformedText: '',
      action,
      error: 'No text provided'
    };
  }

  if (selectedText.length > 5000) {
    return {
      success: false,
      originalText: selectedText,
      transformedText: '',
      action,
      error: 'Text too long. Please select less than 5000 characters.'
    };
  }

  try {
    // Get the appropriate model
    const modelConfig = await getTextActionModel(userId, action);
    if (!modelConfig?.apiKey) {
      throw new Error('No API key configured for text actions');
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(modelConfig.apiKey);
    const model = genAI.getGenerativeModel({ 
      model: modelConfig.modelCode,
      generationConfig: {
        temperature: 0.4, // Lower temperature for more consistent output
        maxOutputTokens: 8192,
        topP: 0.95,
      }
    });

    // Build prompts
    const systemPrompt = await resolveSystemPrompt(request);
    const userPrompt = buildUserPrompt(request);

    // Generate response
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt }
    ]);

    const response = result.response;
    let transformedText = response.text()?.trim();

    if (!transformedText) {
      throw new Error('No response generated');
    }

    // CRITICAL: Ensure citations are preserved
    // Check if any citations from original text are missing and reinsert them
    const originalCitations = extractCitations(selectedText);
    if (originalCitations.length > 0) {
      transformedText = ensureCitationsPreserved(selectedText, transformedText);
      
      // Log citation preservation status
      const finalCitations = extractCitations(transformedText);
      const preserved = originalCitations.every(oc => 
        finalCitations.some(fc => fc.citation === oc.citation)
      );
      
      if (!preserved) {
        console.warn(`Citation preservation warning: Some citations may not be fully preserved. Original: ${originalCitations.length}, Final: ${finalCitations.length}`);
      }
    }

    // Normalize markdown for submission-ready output across drafting modules.
    transformedText = polishDraftMarkdown(transformedText);
    if (originalCitations.length > 0) {
      transformedText = ensureCitationsPreserved(selectedText, transformedText);
    }

    // Get token usage if available
    const tokenUsage = response.usageMetadata ? {
      input: response.usageMetadata.promptTokenCount || 0,
      output: response.usageMetadata.candidatesTokenCount || 0
    } : undefined;

    // Log the action for analytics when legacy delegate is available.
    try {
      const legacyReportLog = (
        prisma as unknown as {
          aIReportLog?: {
            create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
          };
        }
      ).aIReportLog;
      if (legacyReportLog?.create) {
        await legacyReportLog.create({
          data: {
            sessionId,
            userId,
            reportType: `text_action_${action}`,
            inputSize: selectedText.length,
            outputSize: transformedText.length,
            modelUsed: modelConfig.modelCode,
            tokensUsed: tokenUsage?.input ? tokenUsage.input + tokenUsage.output : null,
            status: 'SUCCESS',
            createdAt: new Date()
          }
        });
      }
    } catch {
      // Non-critical - don't fail the action if logging fails
      console.warn('Failed to log text action');
    }

    return {
      success: true,
      originalText: selectedText,
      transformedText,
      action,
      tokenUsage
    };

  } catch (err) {
    console.error('Text action failed:', err);
    
    // Log the failure
    try {
      const legacyReportLog = (
        prisma as unknown as {
          aIReportLog?: {
            create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
          };
        }
      ).aIReportLog;
      if (legacyReportLog?.create) {
        await legacyReportLog.create({
          data: {
            sessionId,
            userId,
            reportType: `text_action_${action}`,
            inputSize: selectedText.length,
            outputSize: 0,
            status: 'FAILED',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
            createdAt: new Date()
          }
        });
      }
    } catch {
      // Ignore logging errors
    }

    return {
      success: false,
      originalText: selectedText,
      transformedText: '',
      action,
      error: err instanceof Error ? err.message : 'Text transformation failed'
    };
  }
}

/**
 * Get AI suggestions for the current section content
 */
export async function getContentSuggestions(
  sessionId: string,
  userId: string,
  sectionKey: string,
  content: string
): Promise<{
  suggestions: Array<{
    id: string;
    type: 'figure' | 'citation' | 'rewrite' | 'expand';
    title: string;
    description: string;
    actionLabel: string;
    relevance: number;
  }>;
}> {
  const suggestions: Array<{
    id: string;
    type: 'figure' | 'citation' | 'rewrite' | 'expand';
    title: string;
    description: string;
    actionLabel: string;
    relevance: number;
  }> = [];

  // Analyze content for suggestions
  const wordCount = content.split(/\s+/).length;
  const paragraphs = content.split(/\n\n+/);
  const sentences = content.split(/[.!?]+/);

  // Check for sections that could use figures
  const figureKeywords = ['data', 'results', 'comparison', 'analysis', 'distribution', 'relationship', 'trend', 'pattern'];
  const hasFigureOpportunity = figureKeywords.some(kw => content.toLowerCase().includes(kw));
  
  if (hasFigureOpportunity && wordCount > 150) {
    suggestions.push({
      id: `suggest-figure-${Date.now()}`,
      type: 'figure',
      title: 'Add a visualization',
      description: 'This section discusses data or relationships that could be illustrated with a chart or diagram.',
      actionLabel: 'Suggest Figure',
      relevance: 0.85
    });
  }

  // Check if expansion would help
  const sectionsThatNeedLength = ['methodology', 'methods', 'discussion', 'results', 'analysis'];
  if (sectionsThatNeedLength.some(s => sectionKey.toLowerCase().includes(s)) && wordCount < 300) {
    suggestions.push({
      id: `suggest-expand-${Date.now()}`,
      type: 'expand',
      title: 'Expand this section',
      description: `The ${sectionKey} section typically requires more detail. Consider expanding with methodology specifics or additional analysis.`,
      actionLabel: 'Expand Section',
      relevance: 0.75
    });
  }

  // Check for very long paragraphs
  const longParagraphs = paragraphs.filter(p => p.split(/\s+/).length > 150);
  if (longParagraphs.length > 0) {
    suggestions.push({
      id: `suggest-rewrite-${Date.now()}`,
      type: 'rewrite',
      title: 'Improve readability',
      description: 'Some paragraphs are quite long. Consider breaking them up for better flow.',
      actionLabel: 'Rewrite',
      relevance: 0.7
    });
  }

  // Check for citation opportunities
  const citationNeeds = ['according to', 'studies show', 'research indicates', 'it has been found', 'previous work'];
  const needsCitation = citationNeeds.some(phrase => 
    content.toLowerCase().includes(phrase) && 
    !content.includes('[') // No citation markers present
  );
  
  if (needsCitation) {
    suggestions.push({
      id: `suggest-citation-${Date.now()}`,
      type: 'citation',
      title: 'Add citations',
      description: 'Some statements could benefit from supporting citations.',
      actionLabel: 'Find Citations',
      relevance: 0.8
    });
  }

  // Sort by relevance
  suggestions.sort((a, b) => b.relevance - a.relevance);

  return { suggestions };
}

