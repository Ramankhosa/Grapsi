// @ts-nocheck
import crypto from 'crypto';

import { llmGateway } from '@/lib/metering/gateway';
import { extractMeaningfulText, hasMeaningfulSectionContent } from '@/lib/reviewer/content';
import { DEFAULT_OPENAI_FALLBACK_MODEL, generateFromOpenAI } from '../openaiService';
import { generateFromGemini } from '../geminiService';

const GRANT_REVIEWER_CONTEXT_SUMMARY_STAGE = 'GRANT_REVIEWER_CONTEXT_SUMMARY';
const GRANT_REVIEWER_CONTEXT_SUMMARY_FALLBACK_MODEL = 'gemini-2.5-flash';
const CONTEXT_SUMMARY_MAX_CHARS = 1600;
// A summary distils a section's key facts; past this much source text the
// tail adds cost without changing the extractable facts.
const CONTEXT_SUMMARY_INPUT_MAX_CHARS =
  Number(process.env.CONTEXT_SUMMARY_INPUT_MAX_CHARS) || 20_000;

function normalizeRequestHeaders(headers?: Record<string, string | string[] | undefined>) {
  if (!headers) return null;
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === 'string' || Array.isArray(value))
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value as string])
  );
}

/**
 * Service for generating and managing context summaries for proposal sections
 */
export class ContextSummaryService {
  private options: {
    requestHeaders?: Record<string, string | string[] | undefined>;
    tenantContext?: any;
    stageCode?: string;
    fallbackModelCode?: string;
  };

  constructor(options: {
    requestHeaders?: Record<string, string | string[] | undefined>;
    tenantContext?: any;
    stageCode?: string;
    fallbackModelCode?: string;
  } = {}) {
    this.options = options;
  }

  /**
   * Generate a condensed context summary for a section
   * This summary is intended for LLM consumption, not human reading
   */
  async generateContextSummary(
    sectionTitle: string,
    sectionContent: string,
    modelType: 'O' | 'G' = 'G' // Default to Gemini
  ): Promise<string> {
    if (!hasMeaningfulSectionContent(sectionContent)) {
      throw new Error('Section has no meaningful content for context summary generation');
    }

    // Choose the appropriate summary generator based on section title
    const normalizedTitle = sectionTitle.trim().toLowerCase();
    
    if (normalizedTitle.includes('abstract')) {
      return this.generateAbstractContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('introduction')) {
      return this.generateIntroductionContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('objective')) {
      return this.generateObjectivesContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('literature') || normalizedTitle.includes('review')) {
      return this.generateLiteratureReviewContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('method')) {
      return this.generateMethodologyContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('timeline') || normalizedTitle.includes('schedule')) {
      return this.generateTimelineContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('budget')) {
      return this.generateBudgetContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('team') || normalizedTitle.includes('expertise')) {
      return this.generateTeamContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('outcome') || normalizedTitle.includes('result')) {
      return this.generateOutcomesContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('impact') || normalizedTitle.includes('societal')) {
      return this.generateImpactContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('sustain')) {
      return this.generateSustainabilityContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('risk')) {
      return this.generateRiskContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('ip') || normalizedTitle.includes('commerc') || normalizedTitle.includes('intellect')) {
      return this.generateIPContextSummary(sectionContent, modelType);
    } else if (normalizedTitle.includes('conclu')) {
      return this.generateConclusionContextSummary(sectionContent, modelType);
    } else {
      // Default generic summary for unrecognized section types
      return this.generateGenericContextSummary(sectionContent, modelType);
    }
  }

  /**
   * Generate context summary for Abstract section
   */
  private async generateAbstractContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Abstract of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Abstract:
- Core problem statement
- Primary research aim
- Key methodology approach
- Expected significance/impact
- Alignment with funding priorities

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Introduction section
   */
  private async generateIntroductionContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Introduction of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Introduction:
- Research gap/problem identification
- Background context (key facts/stats)
- Significance/urgency of addressing problem
- Theoretical framework/approach
- Project scope boundaries

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Objectives section
   */
  private async generateObjectivesContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Objectives section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Objectives section:
- Primary goal/aim
- Specific objectives (numbered if possible)
- Success metrics/indicators
- Timeline targets
- Scope limitations

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Literature Review section
   */
  private async generateLiteratureReviewContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Literature Review section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Literature Review:
- Key research gaps identified
- Major theories/frameworks referenced
- Seminal works/authors cited
- Current state of knowledge
- How proposal extends existing research

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Methodology section
   */
  private async generateMethodologyContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Methodology section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Methodology section:
- Research design type
- Data collection methods
- Analysis techniques
- Sample/population details
- Key tools/instruments
- Validation approaches

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Project Timeline section
   */
  private async generateTimelineContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Project Timeline section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Timeline section:
- Project duration
- Key milestones with timeframes
- Critical dependencies between tasks
- Resource allocation periods
- Deliverable deadlines

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Budget Justification section
   */
  private async generateBudgetContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Budget Justification section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Budget section:
- Total budget amount
- Major cost categories with allocations
- Personnel costs and FTEs
- Equipment/resources requested
- Cost efficiency measures
- Match funding (if any)

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Team Expertise section
   */
  private async generateTeamContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Team Expertise section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Team Expertise section:
- Key team members and roles
- Relevant qualifications/experience
- Previous related projects/grants
- Technical capabilities
- Collaborative arrangements
- Management structure

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Expected Outcomes section
   */
  private async generateOutcomesContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Expected Outcomes section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Outcomes section:
- Primary deliverables
- Anticipated results
- Success metrics
- Knowledge contributions
- Practical applications
- Dissemination plans

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Societal Impact section
   */
  private async generateImpactContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Societal Impact section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Impact section:
- Beneficiary groups/stakeholders
- Scale of potential impact
- Short vs. long-term impacts
- Societal problems addressed
- Economic/social benefits
- Policy implications

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Sustainability section
   */
  private async generateSustainabilityContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Sustainability section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Sustainability section:
- Long-term viability plans
- Funding continuation strategies
- Resource maintenance approach
- Environmental considerations
- Institutional support mechanisms
- Knowledge transfer plans

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Risk & Mitigation section
   */
  private async generateRiskContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Risk & Mitigation section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Risk section:
- Major identified risks
- Probability/impact assessments
- Mitigation strategies
- Contingency plans
- Risk monitoring approach
- Ethical considerations

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for IP & Commercialization section
   */
  private async generateIPContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the IP & Commercialization section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this IP section:
- Intellectual property strategy
- Patentable innovations
- Commercialization pathways
- Industry partnerships
- Market potential
- Technology transfer plans

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generate context summary for Conclusion section
   */
  private async generateConclusionContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from the Conclusion section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this Conclusion section:
- Key project value proposition
- Innovation highlights
- Main expected contributions
- Alignment with funding priorities
- Future research directions
- Final impact statement

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  /**
   * Generic context summary for unrecognized section types
   */
  private async generateGenericContextSummary(
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    const systemPrompt = `You are extracting key information from a section of a grant proposal for LLM consumption.`;

    const userPrompt = `Extract from this section:
- Main purpose/focus
- Key claims/arguments
- Critical data points
- Methodological elements
- Connections to other proposal sections
- Distinctive features

Format as a condensed, keyword-rich summary (<200 tokens) optimized for LLM consumption, not human reading. Use minimal connecting words, focus on technical terms and key concepts. No need for complete sentences.`;

    return this.executeContextSummaryGeneration(systemPrompt, userPrompt, sectionContent, modelType);
  }

  private async executeViaConfiguredStage(prompt: string): Promise<string | null> {
    const request = this.options.tenantContext
      ? { tenantContext: this.options.tenantContext }
      : this.options.requestHeaders
        ? { headers: normalizeRequestHeaders(this.options.requestHeaders) || {} }
        : null;

    if (!request) return null;

    const result = await llmGateway.executeLLMOperation(request, {
      taskCode: 'GRANT_SECTION_GENERATE',
      stageCode: this.options.stageCode || GRANT_REVIEWER_CONTEXT_SUMMARY_STAGE,
      prompt,
      inputTokens: Math.ceil(prompt.length / 4),
      parameters: { temperature: 0.2 },
      metadata: {
        skipFeaturePolicy: true,
        operation: 'grant_reviewer_context_summary',
      },
      idempotencyKey: `grant-reviewer-context-summary-${crypto.randomUUID()}`,
    });

    if (!result.success || !result.response?.output) {
      console.warn('Configured context summary model failed; falling back to direct Gemini call:', result.error);
      return null;
    }

    return result.response.output;
  }

  /**
   * Common execution function for all context summary generators
   */
  private async executeContextSummaryGeneration(
    systemPrompt: string,
    userPrompt: string,
    sectionContent: string,
    modelType: 'O' | 'G'
  ): Promise<string> {
    // Add the section content to the user prompt
    const fullUserPrompt = `${userPrompt}

Universal constraints for this context summary:
- Purpose: provide non-scoring continuity context for later section reviews.
- Extract only facts, commitments, numbers, names, methods, deliverables, dependencies, and constraints explicitly present in the section.
- Do not infer missing proposal content. Do not add generic grant advice. Do not critique, score, or recommend changes.
- Do not include attachment, signature, portal upload, CV, ethics approval, or budget workbook reminders unless the section text itself explicitly states them.
- Mark important uncertain items as "not stated" only when they are directly relevant to later sections; do not create a long missing-information checklist.
- Preserve concrete amounts, dates, durations, sample sizes, named methods, named partners, and deliverables.
- Keep the summary under 220 tokens and ${CONTEXT_SUMMARY_MAX_CHARS} characters.

Return exactly these compact labeled lines, omitting a line if there is no explicit information for it:
Facts: ...
Commitments: ...
Dependencies: ...
Open assumptions: ...

Section Content:
${extractMeaningfulText(sectionContent).slice(0, CONTEXT_SUMMARY_INPUT_MAX_CHARS)}

Return only the context summary.`;

    let responseText: string;
    
    try {
      const gatewayPrompt = `${systemPrompt}\n\n${fullUserPrompt}`;
      responseText = await this.executeViaConfiguredStage(gatewayPrompt);

      if (!responseText && modelType === 'O') {
        // Use OpenAI
        try {
          responseText = await generateFromOpenAI(fullUserPrompt, DEFAULT_OPENAI_FALLBACK_MODEL, systemPrompt);
        } catch (openAiError) {
          console.warn('Error using OpenAI model, falling back to Gemini:', openAiError);
          responseText = await generateFromGemini(
            systemPrompt + '\n\n' + fullUserPrompt,
            this.options.fallbackModelCode || GRANT_REVIEWER_CONTEXT_SUMMARY_FALLBACK_MODEL
          );
        }
      } else if (!responseText) {
        responseText = await generateFromGemini(
          systemPrompt + '\n\n' + fullUserPrompt,
          this.options.fallbackModelCode || GRANT_REVIEWER_CONTEXT_SUMMARY_FALLBACK_MODEL
        );
      }
      
      if (!responseText || !responseText.trim()) {
        throw new Error('Context summary model returned an empty response');
      }

      // Clean up the response text
      // Remove any markdown formatting that might be present
      const cleanedText = responseText
        .replace(/```(json|markdown)?\s*/g, '') // Remove code block markers
        .replace(/```\s*$/g, '')             // Remove ending code block marker
        .replace(/^context_summary:?\s*/i, '') // Remove any "context_summary:" prefix
        .trim();

      if (!cleanedText) {
        throw new Error('Context summary model returned an empty summary');
      }

      const boundedText = cleanedText.length > CONTEXT_SUMMARY_MAX_CHARS
        ? `${cleanedText.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 3).trim()}...`
        : cleanedText;
      
      // Log the context summary for debugging
      console.log(`Generated context summary: ${boundedText.substring(0, 50)}...`);
      
      return boundedText;
    } catch (error) {
      console.error('Error generating context summary:', error);
      throw error;
    }
  }
}
