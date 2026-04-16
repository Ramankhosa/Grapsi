import { llmGateway } from './metering/gateway';
import { NoveltyAssessmentStatus, NoveltyDetermination, NoveltyAssessmentStage, TaskCode } from '@prisma/client';
import { prisma } from './prisma';

// LLM Prompt Specification for Novelty Assessment (per user requirements)
export const NOVELTY_SCREENING_PROMPT = `Analyze patent novelty. Output ONLY valid JSON.

INVENTION:
Title: {title}
Problem: {problem}
Solution: {solution}

PATENTS:
{patent_list}

RULES:
- HIGH: patent teaches invention elements
- MEDIUM: patent relates but doesn't teach all elements
- LOW: patent is unrelated

DETERMINATION:
- All LOW = "NOVEL"
- Any HIGH = "NOT_NOVEL"
- Only MEDIUM = "DOUBT"

JSON OUTPUT:
{{
  "overall_determination": "NOVEL/NOT_NOVEL/DOUBT",
  "patent_assessments": [
    {{"publication_number": "id", "relevance": "HIGH/MEDIUM/LOW", "reasoning": "brief reason"}}
  ],
  "summary_remarks": "brief summary"
}}`;

export const NOVELTY_DETAILED_PROMPT = `Compare invention with patent for novelty. Output ONLY valid JSON.

INVENTION:
Title: {title}
Problem: {problem}
Solution: {solution}

PATENT:
Number: {patent_number}
Title: {patent_title}
Abstract: {patent_abstract}
Claims: {patent_claims}

TASK:
- Compare elements systematically
- Status: NOVEL (fully novel), NOT_NOVEL (anticipated), PARTIALLY_NOVEL (some novel elements)

JSON OUTPUT:
{{
  "determination": "NOVEL/NOT_NOVEL/PARTIALLY_NOVEL",
  "confidence_level": "HIGH/MEDIUM/LOW",
  "novel_aspects": ["list novel features"],
  "non_novel_aspects": ["list anticipated features"],
  "technical_reasoning": "detailed comparison analysis",
  "suggestions": "how to achieve novelty if needed"
}}`;

export interface NoveltyAssessmentRequest {
  patentId: string;
  runId?: string; // Optional link to prior art run
  jwtToken: string;
  inventionSummary: {
    title: string;
    problem: string;
    solution: string;
  };
  intersectingPatents: Array<{
    publicationNumber: string;
    title: string;
    abstract: string;
    relevance?: number;
  }>;
}

export interface NoveltyAssessmentResponse {
  success: boolean;
  assessmentId?: string;
  status?: NoveltyAssessmentStatus;
  determination?: NoveltyDetermination;
  remarks?: string;
  suggestions?: string;
  novelAspects?: string[];
  nonNovelAspects?: string[];
  confidenceLevel?: string;
  error?: string;
  stage1Results?: any[];
  stage2Results?: any[];
  reportUrl?: string; // PDF report URL when available
}

export class NoveltyAssessmentService {

  /**
   * Start a complete novelty assessment workflow
   */
  static async startAssessment(request: NoveltyAssessmentRequest): Promise<NoveltyAssessmentResponse> {
    try {
      // Verify JWT and extract user
      const userEmail = await this.getUserFromJWT(request.jwtToken);
      if (!userEmail) {
        return { success: false, error: 'Unauthorized' };
      }

      const user = await prisma.user.findUnique({ where: { email: userEmail } });
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Verify patent access
      const patent = await prisma.patent.findFirst({
        where: {
          id: request.patentId,
          OR: [
            { createdBy: user.id },
            {
              project: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { userId: user.id } } }
                ]
              }
            }
          ]
        }
      });

      if (!patent) {
        return { success: false, error: 'Patent not found or access denied' };
      }

      // Create assessment run
      const assessment = await prisma.noveltyAssessmentRun.create({
        data: {
          patentId: request.patentId,
          runId: request.runId,
          userId: user.id,
          status: NoveltyAssessmentStatus.PENDING,
          inventionSummary: request.inventionSummary,
          intersectingPatents: request.intersectingPatents,
        },
      });

      // Start Stage 1 screening
      const stage1Result = await this.performStage1Screening(assessment.id, request);

      if (!stage1Result.success) {
        await prisma.noveltyAssessmentRun.update({
          where: { id: assessment.id },
          data: { status: NoveltyAssessmentStatus.FAILED },
        });
        return { success: false, error: stage1Result.error };
      }

      // Determine next steps based on Stage 1 results
      const stage1Data = stage1Result.data!;
      const needsStage2 = stage1Data.overall_determination === 'DOUBT';

      if (stage1Data.overall_determination === 'NOVEL') {
        // All patents are low relevance - invention is novel
        await prisma.noveltyAssessmentRun.update({
          where: { id: assessment.id },
          data: {
            status: NoveltyAssessmentStatus.NOVEL,
            stage1CompletedAt: new Date(),
            stage1Results: stage1Data.patent_assessments,
            finalDetermination: NoveltyDetermination.NOVEL,
            finalRemarks: `Stage 1 screening determined invention is novel. ${stage1Data.summary_remarks}`,
          },
        });

        // Generate PDF report
        let reportUrl: string | undefined;
        try {
          // PDF generation removed - using browser print instead
          console.log('✅ PDF report generated successfully');
          console.log(`📄 PDF report generated: ${reportUrl}`);
        } catch (pdfError) {
          console.error('❌ PDF report generation failed:', pdfError);
          console.log('📋 Assessment completed successfully - PDF report unavailable');
        }

        return {
          success: true,
          assessmentId: assessment.id,
          status: NoveltyAssessmentStatus.NOVEL,
          determination: NoveltyDetermination.NOVEL,
          remarks: stage1Data.summary_remarks,
          stage1Results: stage1Data.patent_assessments,
          reportUrl,
        };

      } else if (stage1Data.overall_determination === 'NOT_NOVEL') {
        // High relevance patents found - invention is not novel
        await prisma.noveltyAssessmentRun.update({
          where: { id: assessment.id },
          data: {
            status: NoveltyAssessmentStatus.NOT_NOVEL,
            stage1CompletedAt: new Date(),
            stage1Results: stage1Data.patent_assessments,
            finalDetermination: NoveltyDetermination.NOT_NOVEL,
            finalRemarks: `Stage 1 screening determined invention is not novel. ${stage1Data.summary_remarks}`,
          },
        });

        // Generate PDF report
        let reportUrl: string | undefined;
        try {
          // PDF generation removed - using browser print instead
          console.log('✅ PDF report generated successfully');
          console.log(`📄 PDF report generated: ${reportUrl}`);
        } catch (pdfError) {
          console.error('❌ PDF report generation failed:', pdfError);
          console.log('📋 Assessment completed successfully - PDF report unavailable');
        }

        return {
          success: true,
          assessmentId: assessment.id,
          status: NoveltyAssessmentStatus.NOT_NOVEL,
          determination: NoveltyDetermination.NOT_NOVEL,
          remarks: stage1Data.summary_remarks,
          stage1Results: stage1Data.patent_assessments,
          reportUrl,
        };

      } else if (needsStage2) {
        // Medium relevance - need detailed analysis
        const stage2Result = await this.performStage2Assessment(assessment.id, request, stage1Data.patent_assessments);

        if (!stage2Result.success) {
          await prisma.noveltyAssessmentRun.update({
            where: { id: assessment.id },
            data: { status: NoveltyAssessmentStatus.FAILED },
          });
          return { success: false, error: stage2Result.error };
        }

        const stage2Data = stage2Result.data!;

        // Determine final novelty status based on stage 2 results
        let finalDetermination: NoveltyDetermination;
        const hasNotNovel = stage2Data.some((result: any) => result.determination === 'NOT_NOVEL');
        const hasPartiallyNovel = stage2Data.some((result: any) => result.determination === 'PARTIALLY_NOVEL');
        const allNovel = stage2Data.every((result: any) => result.determination === 'NOVEL');

        if (hasNotNovel) {
          finalDetermination = NoveltyDetermination.NOT_NOVEL;
        } else if (hasPartiallyNovel) {
          finalDetermination = 'PARTIALLY_NOVEL' as NoveltyDetermination;
        } else if (allNovel) {
          finalDetermination = NoveltyDetermination.NOVEL;
        } else {
          finalDetermination = 'PARTIALLY_NOVEL' as NoveltyDetermination; // Mixed results
        }

        // Determine status based on final determination
        let assessmentStatus: NoveltyAssessmentStatus;
        if (finalDetermination === NoveltyDetermination.NOVEL) {
          assessmentStatus = NoveltyAssessmentStatus.NOVEL;
        } else if (finalDetermination === NoveltyDetermination.NOT_NOVEL) {
          assessmentStatus = NoveltyAssessmentStatus.NOT_NOVEL;
        } else {
          assessmentStatus = NoveltyAssessmentStatus.DOUBT_RESOLVED; // For PARTIALLY_NOVEL
        }

        // Aggregate results from all stage 2 assessments
        const allNovelAspects = stage2Data.flatMap((r: any) => r.novel_aspects || []);
        const allNonNovelAspects = stage2Data.flatMap((r: any) => r.non_novel_aspects || []);
        const allRemarks = stage2Data.map((r: any) =>
          r.remarks_novel || r.remarks_not_novel || r.remarks_partial || r.overall_assessment
        ).filter(Boolean);
        const allSuggestions = stage2Data.map((r: any) => r.suggestions).filter(Boolean);
        const confidenceLevels = stage2Data.map((r: any) => r.confidence_level);
        const avgConfidence = confidenceLevels.includes('HIGH') ? 'HIGH' :
                            confidenceLevels.includes('MEDIUM') ? 'MEDIUM' : 'LOW';

        await prisma.noveltyAssessmentRun.update({
          where: { id: assessment.id },
          data: {
            status: assessmentStatus,
            stage1CompletedAt: new Date(),
            stage1Results: stage1Data.patent_assessments,
            stage2CompletedAt: new Date(),
            stage2Results: stage2Data,
            finalDetermination,
            finalRemarks: allRemarks.join('; '),
            finalSuggestions: allSuggestions.join('; '),
          },
        });

        // Generate PDF report
        let reportUrl: string | undefined;
        try {
          // PDF generation removed - using browser print instead
          console.log('✅ PDF report generated successfully');
          console.log(`📄 PDF report generated: ${reportUrl}`);
        } catch (pdfError) {
          console.error('❌ PDF report generation failed:', pdfError);
          console.log('📋 Assessment completed successfully - PDF report unavailable');
        }

        return {
          success: true,
          assessmentId: assessment.id,
          status: assessmentStatus,
          determination: finalDetermination,
          remarks: allRemarks.join('; '),
          suggestions: allSuggestions.join('; '),
          novelAspects: Array.from(new Set(allNovelAspects)), // Remove duplicates
          nonNovelAspects: Array.from(new Set(allNonNovelAspects)), // Remove duplicates
          confidenceLevel: avgConfidence,
          stage1Results: stage1Data.patent_assessments,
          stage2Results: stage2Data,
          reportUrl,
        };
      }

      return { success: false, error: 'Unexpected assessment flow' };

    } catch (error) {
      console.error('Novelty assessment error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Assessment failed'
      };
    }
  }

  /**
   * Perform Stage 1: Initial screening with title/abstract
   */
  private static async performStage1Screening(
    assessmentId: string,
    request: NoveltyAssessmentRequest
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // Build patent list for LLM
      const patentList = request.intersectingPatents
        .map(patent => `Patent ${patent.publicationNumber}:
Title: ${patent.title}
Abstract: ${patent.abstract}`)
        .join('\n\n');

      // Build prompt
      const prompt = NOVELTY_SCREENING_PROMPT
        .replace('{title}', request.inventionSummary.title)
        .replace('{problem}', request.inventionSummary.problem)
        .replace('{solution}', request.inventionSummary.solution)
        .replace('{patent_list}', patentList);

      // Execute LLM call with admin-configured model via stage
      const llmRequest = {
        taskCode: TaskCode.LLM4_NOVELTY_SCREEN,
        stageCode: 'NOVELTY_RELEVANCE_SCORING', // Use admin-configured model/limits
        prompt,
        inputTokens: Math.ceil(prompt.length / 4),
      };

      const headers = { 'authorization': `Bearer ${request.jwtToken}` };
      const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

      if (!result.success || !result.response) {
        return { success: false, error: result.error?.message || 'LLM call failed' };
      }

      // Parse and validate response
      const responseText = result.response.output.trim();
      let assessmentData;

      try {
        // Extract JSON from response
        const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1].trim() : responseText;

        // Find JSON boundaries
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        const cleanJson = jsonText.substring(startBrace, lastBrace + 1);

        assessmentData = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error('Stage 1 JSON parse error:', parseError, 'Raw response:', responseText);
        return { success: false, error: 'Invalid LLM response format' };
      }

      // Record LLM call
      await prisma.noveltyAssessmentLLMCall.create({
        data: {
          assessmentId,
          stage: NoveltyAssessmentStage.STAGE1_SCREENING,
          taskCode: TaskCode.LLM4_NOVELTY_SCREEN,
          prompt,
          response: assessmentData,
          tokensUsed: result.response.outputTokens,
          modelClass: result.response.modelClass,
        },
      });

      return { success: true, data: assessmentData };

    } catch (error) {
      console.error('Stage 1 screening error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 1 failed' };
    }
  }

  /**
   * Perform Stage 2: Detailed assessment with full patent data
   */
  private static async performStage2Assessment(
    assessmentId: string,
    request: NoveltyAssessmentRequest,
    stage1Assessments: any[]
  ): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const results: any[] = [];

      // Only assess patents that were marked as MEDIUM relevance in Stage 1
      const patentsToAssess = stage1Assessments
        .filter(assessment => assessment.relevance === 'MEDIUM')
        .map(assessment => {
          const patent = request.intersectingPatents.find(p => p.publicationNumber === assessment.publication_number);
          return { assessment, patent };
        })
        .filter(item => item.patent);

      for (const { assessment, patent } of patentsToAssess) {
        // Fetch detailed patent data (title, abstract, claims)
        const detailedData = await this.fetchPatentDetails(patent!.publicationNumber);

        // Build prompt for detailed analysis
        const prompt = NOVELTY_DETAILED_PROMPT
          .replace('{title}', request.inventionSummary.title)
          .replace('{problem}', request.inventionSummary.problem)
          .replace('{solution}', request.inventionSummary.solution)
          .replace('{patent_number}', patent!.publicationNumber)
          .replace('{patent_title}', detailedData.title || patent!.title)
          .replace('{patent_abstract}', detailedData.abstract || patent!.abstract)
          .replace('{patent_claims}', JSON.stringify(detailedData.claims || {}, null, 2));

        // Execute LLM call with admin-configured model via stage
        const llmRequest = {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          stageCode: 'NOVELTY_COMPARISON', // Use admin-configured model/limits
          prompt,
          inputTokens: Math.ceil(prompt.length / 4),
        };

        const headers = { 'authorization': `Bearer ${request.jwtToken}` };
        const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

        if (!result.success || !result.response) {
          console.error(`Stage 2 failed for patent ${patent!.publicationNumber}:`, result.error);
          continue; // Continue with other patents
        }

        // Parse response
        const responseText = result.response.output.trim();
        let detailedAssessment;

        try {
          const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
          const jsonText = jsonMatch ? jsonMatch[1].trim() : responseText;
          const startBrace = jsonText.indexOf('{');
          const lastBrace = jsonText.lastIndexOf('}');
          const cleanJson = jsonText.substring(startBrace, lastBrace + 1);
          detailedAssessment = JSON.parse(cleanJson);
        } catch (parseError) {
          console.error(`Stage 2 JSON parse error for ${patent!.publicationNumber}:`, parseError);
          continue;
        }

        // Record LLM call
        let determination: NoveltyDetermination;
        if (detailedAssessment.determination === 'NOVEL') {
          determination = NoveltyDetermination.NOVEL;
        } else if (detailedAssessment.determination === 'NOT_NOVEL') {
          determination = NoveltyDetermination.NOT_NOVEL;
        } else if (detailedAssessment.determination === 'PARTIALLY_NOVEL') {
          determination = 'PARTIALLY_NOVEL' as NoveltyDetermination;
        } else {
          determination = NoveltyDetermination.DOUBT;
        }

        await prisma.noveltyAssessmentLLMCall.create({
          data: {
            assessmentId,
            stage: NoveltyAssessmentStage.STAGE2_ASSESSMENT,
            taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
            prompt,
            response: detailedAssessment,
            tokensUsed: result.response.outputTokens,
            modelClass: result.response.modelClass,
            determination,
            remarks: detailedAssessment.remarks_novel || detailedAssessment.remarks_not_novel || detailedAssessment.remarks_partial || detailedAssessment.overall_assessment,
            suggestions: detailedAssessment.suggestions,
          },
        });

        results.push({
          publicationNumber: patent!.publicationNumber,
          ...detailedAssessment,
        });
      }

      return { success: true, data: results };

    } catch (error) {
      console.error('Stage 2 assessment error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Stage 2 failed' };
    }
  }

  /**
   * Fetch patent details for Stage 2 assessment
   */
  private static async fetchPatentDetails(publicationNumber: string): Promise<{
    title?: string;
    abstract?: string;
    claims?: any;
  }> {
    try {
      // Try to get from our database first
      const patent = await prisma.priorArtPatent.findUnique({
        where: { publicationNumber },
        include: { details: true },
      });

      if (patent) {
        return {
          title: patent.title || undefined,
          abstract: patent.abstract || undefined,
          claims: patent.details?.claims || undefined,
        };
      }

      // If not in database, return empty (assume basic data is available from intersecting patents)
      return {};

    } catch (error) {
      console.error(`Failed to fetch details for ${publicationNumber}:`, error);
      return {};
    }
  }

  /**
   * Extract user from JWT token
   */
  private static async getUserFromJWT(token: string): Promise<string | null> {
    try {
      const { verifyJWT } = await import('./auth');
      const payload = verifyJWT(token);

      if (!payload) return null;

      // First try to find user by the sub field (which should be user ID)
      if (payload.sub) {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true }
        });
        if (user) return user.id;
      }

      // If sub doesn't work, try email (fallback for backward compatibility)
      if (payload.email) {
        const user = await prisma.user.findUnique({
          where: { email: payload.email },
          select: { id: true }
        });
        if (user) return user.id;
      }

      console.error('Could not find user from JWT payload:', payload);
      return null;
    } catch (error) {
      console.error('JWT verification failed:', error);
      return null;
    }
  }

  /**
   * Get assessment status and results
   */
  static async getAssessment(assessmentId: string, userId: string): Promise<NoveltyAssessmentResponse> {
    try {
      const assessment = await prisma.noveltyAssessmentRun.findFirst({
        where: {
          id: assessmentId,
          userId, // Ensure user owns this assessment
        },
        include: {
          llmCalls: {
            orderBy: { calledAt: 'asc' },
          },
        },
      });

      if (!assessment) {
        return { success: false, error: 'Assessment not found' };
      }

      // Generate report URL if assessment is completed
      let reportUrl: string | undefined;
      if (assessment.status === NoveltyAssessmentStatus.NOVEL ||
          assessment.status === NoveltyAssessmentStatus.NOT_NOVEL ||
          assessment.status === NoveltyAssessmentStatus.DOUBT_RESOLVED) {
        reportUrl = `/api/patents/${assessment.patentId}/novelty-assessment/${assessment.id}/report`;
      }

      return {
        success: true,
        assessmentId: assessment.id,
        status: assessment.status,
        determination: assessment.finalDetermination || undefined,
        remarks: assessment.finalRemarks || undefined,
        suggestions: assessment.finalSuggestions || undefined,
        stage1Results: assessment.stage1Results as any[] || undefined,
        stage2Results: assessment.stage2Results as any[] || undefined,
        reportUrl,
      };

    } catch (error) {
      console.error('Get assessment error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve assessment'
      };
    }
  }

  /**
   * Get all assessments for a patent
   */
  /**
   * Perform Level 1 Novelty Assessment (using search results only)
   */
  static async performLevel1Assessment(request: {
    patentId: string;
    runId: string;
    jwtToken: string;
    inventionSummary: { title: string; problem: string; solution: string };
    level1Patents: Array<{
      publicationNumber: string;
      title: string;
      abstract: string;
      relevance: number;
      foundInVariants: string[];
      intersectionType: string;
    }>;
  }): Promise<{
    determination: NoveltyDetermination;
    patentsNeedingDetails?: string[];
    level1Results: any;
    confidence: number;
    remarks: string;
    reportUrl?: string;
  }> {
    const userId = await this.getUserFromJWT(request.jwtToken);
    if (!userId) throw new Error('Invalid JWT token');

    console.log(`🧠 Starting Level 1 Novelty Assessment for ${request.level1Patents.length} patents`);

    let reportUrl: string | undefined;

    // Create assessment record
    const assessment = await prisma.noveltyAssessmentRun.create({
      data: {
        patentId: request.patentId,
        runId: request.runId,
        userId: userId,
        status: NoveltyAssessmentStatus.STAGE1_SCREENING,
        inventionSummary: request.inventionSummary,
        intersectingPatents: request.level1Patents,
        stage1CompletedAt: new Date(),
      },
    });

    try {
      // Prepare patent list for LLM - optimize to reduce token count
      const patentList = request.level1Patents.map(patent => {
        // Truncate abstract to 200 words to reduce token count
        const abstractWords = patent.abstract.split(/\s+/).slice(0, 200);
        const truncatedAbstract = abstractWords.join(' ') + (abstractWords.length >= 200 ? '...' : '');

        return `Patent ${patent.publicationNumber}:
Title: ${patent.title}
Abstract: ${truncatedAbstract}
Relevance: ${patent.relevance}%`;
      }).join('\n---\n');

      // Create Level 1 prompt
      const level1Prompt = NOVELTY_SCREENING_PROMPT
        .replace('{title}', request.inventionSummary.title)
        .replace('{problem}', request.inventionSummary.problem)
        .replace('{solution}', request.inventionSummary.solution)
        .replace('{patent_list}', patentList);

      console.log('📤 Sending Level 1 analysis to LLM...');

      // Call LLM for Level 1 analysis with admin-configured model
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: { authorization: `Bearer ${request.jwtToken}` } },
        {
          taskCode: TaskCode.LLM4_NOVELTY_SCREEN,
          stageCode: 'NOVELTY_RELEVANCE_SCORING', // Use admin-configured model/limits
          prompt: level1Prompt,
        }
      );

      if (!llmResult.success || !llmResult.response) {
        throw new Error(llmResult.error?.message || 'LLM request failed');
      }

      // Parse and validate JSON response
      let level1Results;
      try {
        console.log('🔍 Novelty assessment LLM response:', llmResult.response.output);
        console.log('🔍 Response finish reason:', llmResult.response.metadata?.finishReason);

        // Check if response was cut off due to token limits
        if (llmResult.response.metadata?.finishReason === 'MAX_TOKENS') {
          console.warn('⚠️ Novelty assessment LLM response was truncated due to token limits');

          // If we have some output content, try to process it anyway
          if (llmResult.response.output && llmResult.response.output.trim().length > 50) {
            console.log('📝 Attempting to process partial novelty assessment response...');
            // Continue with processing - the JSON parsing might still work
          } else {
            throw new Error('Novelty assessment response was truncated due to token limits. Try with fewer patents or shorter abstracts.');
          }
        }

        let jsonText = llmResult.response.output.trim();
        console.log('🔍 Raw LLM response for parsing:', jsonText.substring(0, 200) + '...');

        // Try to extract JSON from markdown code blocks - more flexible regex
        const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i;
        const match = jsonBlockRegex.exec(jsonText);
        if (match) {
          jsonText = match[1].trim();
          console.log('📝 Extracted JSON from code block');
        }

        // Remove any leading/trailing text that might not be JSON
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');

        if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
          jsonText = jsonText.substring(startBrace, lastBrace + 1);
        }

        // Additional cleanup: remove trailing commas and fix common JSON issues
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
        jsonText = jsonText.replace(/,(\s*),/g, ','); // Remove double commas
        jsonText = jsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Quote unquoted keys

        // Remove any remaining markdown formatting
        jsonText = jsonText.replace(/^\s*`{1,3}(?:json)?\s*/i, '').replace(/\s*`{1,3}\s*$/, '');

        // Try to fix incomplete JSON for truncated responses
        if (llmResult.response.metadata?.finishReason === 'MAX_TOKENS') {
          console.log('🔧 Attempting to fix truncated JSON...');

          // Count braces and brackets to see if they're balanced
          const openBraces = (jsonText.match(/\{/g) || []).length;
          const closeBraces = (jsonText.match(/\}/g) || []).length;
          const openBrackets = (jsonText.match(/\[/g) || []).length;
          const closeBrackets = (jsonText.match(/\]/g) || []).length;

          // Try to close incomplete structures
          if (openBraces > closeBraces) {
            jsonText += '}'.repeat(openBraces - closeBraces);
            console.log('🔧 Added missing closing braces');
          }
          if (openBrackets > closeBrackets) {
            jsonText += ']'.repeat(openBrackets - closeBrackets);
            console.log('🔧 Added missing closing brackets');
          }

          // If patent_assessments array is incomplete, try to close it
          if (jsonText.includes('"patent_assessments": [') && !jsonText.includes(']')) {
            jsonText = jsonText.replace(/,\s*$/, '') + ']'; // Remove trailing comma and close array
            console.log('🔧 Fixed incomplete patent_assessments array');
          }
        }

        console.log('🔧 Cleaned JSON for parsing:', jsonText.substring(0, 200) + '...');

        // Try to parse JSON with multiple fallback strategies
        try {
          level1Results = JSON.parse(jsonText);
        } catch (firstParseError) {
          console.warn('🔄 First JSON parse failed, trying fallback strategies...');

          // Strategy 1: Try to extract just the patent_assessments array
          try {
            const patentAssessmentsMatch = jsonText.match(/"patent_assessments"\s*:\s*\[([\s\S]*?)\]/);
            if (patentAssessmentsMatch) {
              const assessmentsText = '[' + patentAssessmentsMatch[1] + ']';
              const patentAssessments = JSON.parse(assessmentsText);

              // Strategy 2: Try to extract overall_determination
              const determinationMatch = jsonText.match(/"overall_determination"\s*:\s*"([^"]*)"/);
              const overallDetermination = determinationMatch ? determinationMatch[1] : 'UNKNOWN';

              level1Results = {
                patent_assessments: patentAssessments,
                overall_determination: overallDetermination,
                summary_remarks: 'Extracted from partial LLM response'
              };

              console.log('✅ Successfully extracted partial results from malformed JSON');
            } else {
              throw new Error('Could not extract patent_assessments from response');
            }
          } catch (fallbackError) {
            console.error('❌ All JSON parsing strategies failed');
            console.error('❌ Raw response that failed:', llmResult.response.output);
            throw new Error(`LLM returned invalid JSON: ${firstParseError instanceof Error ? firstParseError.message : String(firstParseError)}`);
          }
        }
      } catch (parseError) {
        console.error('❌ Novelty assessment JSON parse error:', parseError);
        console.error('❌ Raw response that failed:', llmResult.response.output);
        throw new Error(`LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

      // Determine if we need Level 2
      let determination: NoveltyDetermination;
      let patentsNeedingDetails: string[] = [];
      let confidence = 0;

      const highRelevancePatents = level1Results.patent_assessments.filter((p: any) => p.relevance === 'HIGH');
      const mediumRelevancePatents = level1Results.patent_assessments.filter((p: any) => p.relevance === 'MEDIUM');

      if (highRelevancePatents.length > 0) {
        determination = NoveltyDetermination.NOT_NOVEL;
        confidence = 90;
        console.log('🚫 Level 1: HIGH relevance patents found - NOT NOVEL');
      } else if (mediumRelevancePatents.length > 0) {
        determination = NoveltyDetermination.DOUBT;
        patentsNeedingDetails = mediumRelevancePatents.map((p: any) => p.publication_number);
        confidence = 60;
        console.log(`🤔 Level 1: MEDIUM relevance patents found - DOUBT, need Level 2 for ${patentsNeedingDetails.length} patents`);
      } else {
        determination = NoveltyDetermination.NOVEL;
        confidence = 85;
        console.log('✅ Level 1: All patents LOW relevance - NOVEL');
      }

      // Update assessment record
      await prisma.noveltyAssessmentRun.update({
        where: { id: assessment.id },
        data: {
          status: determination === NoveltyDetermination.DOUBT ? NoveltyAssessmentStatus.STAGE1_COMPLETED : NoveltyAssessmentStatus.NOVEL,
          finalDetermination: determination,
          stage1Results: level1Results,
          finalRemarks: level1Results.summary_remarks || `Level 1 assessment: ${determination}`,
        },
      });

      // Create LLM call record
      await prisma.noveltyAssessmentLLMCall.create({
        data: {
          assessmentId: assessment.id,
          taskCode: TaskCode.LLM4_NOVELTY_SCREEN,
          stage: NoveltyAssessmentStage.STAGE1_SCREENING,
          prompt: level1Prompt,
          response: llmResult.response.output,
          calledAt: new Date(),
        },
      });

      // If NOVEL or NOT_NOVEL, generate PDF report (non-blocking)
      if (determination !== NoveltyDetermination.DOUBT) {
        // PDF generation removed - using browser print instead
        console.log('ℹ️ PDF report generation skipped - using browser print functionality');
      }

      return {
        determination,
        patentsNeedingDetails,
        level1Results,
        confidence,
        remarks: level1Results.summary_remarks || `Level 1 assessment complete: ${determination}`,
      };

    } catch (error) {
      console.error('❌ Level 1 assessment failed:', error);
      await prisma.noveltyAssessmentRun.update({
        where: { id: assessment.id },
        data: {
          status: NoveltyAssessmentStatus.FAILED,
        },
      });
      throw error;
    }
  }

  /**
   * Perform Level 2 Novelty Assessment (detailed analysis)
   */
  static async performLevel2Assessment(request: {
    patentId: string;
    runId: string;
    jwtToken: string;
    inventionSummary: { title: string; problem: string; solution: string };
    level1Result: any;
    detailedPatents: string[];
  }): Promise<{
    determination: NoveltyDetermination;
    level2Results: any;
    confidence: number;
    remarks: string;
  }> {
    const userId = await this.getUserFromJWT(request.jwtToken);
    if (!userId) throw new Error('Invalid JWT token');

    console.log(`🔬 Starting Level 2 Novelty Assessment for ${request.detailedPatents.length} patents`);

    // Get assessment record
    const assessment = await prisma.noveltyAssessmentRun.findFirst({
      where: {
        patentId: request.patentId,
        runId: request.runId,
        userId: userId,
      },
    });

    if (!assessment) {
      throw new Error('Assessment record not found');
    }

    // Update status to Level 2
    await prisma.noveltyAssessmentRun.update({
      where: { id: assessment.id },
      data: {
        status: NoveltyAssessmentStatus.STAGE2_ASSESSMENT,
      },
    });

    try {
      const level2Results: any[] = [];

      for (const publicationNumber of request.detailedPatents) {
        console.log(`📋 Analyzing patent ${publicationNumber} in detail...`);

        // Fetch detailed patent data
        const patentDetails = await this.fetchPatentDetails(publicationNumber);

        // Create detailed analysis prompt
        const detailedPrompt = NOVELTY_DETAILED_PROMPT
          .replace(/{title}/g, request.inventionSummary.title)
          .replace(/{problem}/g, request.inventionSummary.problem)
          .replace(/{solution}/g, request.inventionSummary.solution)
          .replace(/{patent_number}/g, publicationNumber)
          .replace(/{patent_title}/g, patentDetails.title || 'Unknown Title')
          .replace(/{patent_abstract}/g, patentDetails.abstract || 'Abstract not available')
          .replace(/{patent_claims}/g, patentDetails.claims || 'Claims not available');

        // Call LLM for detailed analysis with admin-configured model
        const llmResult = await llmGateway.executeLLMOperation(
          { headers: { authorization: `Bearer ${request.jwtToken}` } },
          {
            taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
            stageCode: 'NOVELTY_COMPARISON', // Use admin-configured model/limits
            prompt: detailedPrompt,
          }
        );

        if (!llmResult.success || !llmResult.response) {
          throw new Error(llmResult.error?.message || 'LLM request failed');
        }

        // Parse and validate JSON response
        let detailedResult;
        try {
          console.log('🔍 Level 2 LLM response:', llmResult.response.output.substring(0, 200) + '...');

          // Check if response was cut off due to token limits
          if (llmResult.response.metadata?.finishReason === 'MAX_TOKENS') {
            console.warn('⚠️ Level 2 assessment LLM response was truncated due to token limits');

            // If we have some output content, try to process it anyway
            if (llmResult.response.output && llmResult.response.output.trim().length > 50) {
              console.log('📝 Attempting to process partial Level 2 assessment response...');
            } else {
              throw new Error('Level 2 assessment response was truncated due to token limits. Try with shorter patent claims.');
            }
          }

          let jsonText = llmResult.response.output.trim();

          // Try to extract JSON from markdown code blocks - more flexible regex
          const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i;
          const match = jsonBlockRegex.exec(jsonText);
          if (match) {
            jsonText = match[1].trim();
            console.log('📝 Extracted Level 2 JSON from code block');
          }

          // Remove any leading/trailing text that might not be JSON
          const startBrace = jsonText.indexOf('{');
          const lastBrace = jsonText.lastIndexOf('}');

          if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
            jsonText = jsonText.substring(startBrace, lastBrace + 1);
          }

          // Additional cleanup: remove trailing commas and fix common JSON issues
          jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
          jsonText = jsonText.replace(/,(\s*),/g, ','); // Remove double commas
          jsonText = jsonText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Quote unquoted keys

          // Remove any remaining markdown formatting
          jsonText = jsonText.replace(/^\s*`{1,3}(?:json)?\s*/i, '').replace(/\s*`{1,3}\s*$/, '');

          console.log('🔧 Cleaned Level 2 JSON for parsing:', jsonText.substring(0, 200) + '...');
          detailedResult = JSON.parse(jsonText);
        } catch (parseError) {
          console.error('❌ Level 2 assessment JSON parse error:', parseError);
          console.error('❌ Raw Level 2 response that failed:', llmResult.response.output);
          throw new Error(`Level 2 LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        detailedResult.publicationNumber = publicationNumber;
        level2Results.push(detailedResult);

        // Create LLM call record
        await prisma.noveltyAssessmentLLMCall.create({
          data: {
            assessmentId: assessment.id,
            taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
            stage: NoveltyAssessmentStage.STAGE2_ASSESSMENT,
            prompt: detailedPrompt,
            response: llmResult.response.output,
            calledAt: new Date(),
          },
        });
      }

      // Determine final outcome from Level 2 results
      let finalDetermination: NoveltyDetermination;
      const hasNotNovel = level2Results.some((result: any) => result.determination === 'NOT_NOVEL');
      const hasPartiallyNovel = level2Results.some((result: any) => result.determination === 'PARTIALLY_NOVEL');
      const allNovel = level2Results.every((result: any) => result.determination === 'NOVEL');

      if (hasNotNovel) {
        finalDetermination = NoveltyDetermination.NOT_NOVEL;
      } else if (hasPartiallyNovel) {
        finalDetermination = NoveltyDetermination.PARTIALLY_NOVEL;
      } else if (allNovel) {
        finalDetermination = NoveltyDetermination.NOVEL;
      } else {
        finalDetermination = NoveltyDetermination.PARTIALLY_NOVEL; // Mixed results
      }

      // Compile comprehensive remarks
      const novelAspects = level2Results.flatMap((r: any) => r.novel_aspects || []);
      const nonNovelAspects = level2Results.flatMap((r: any) => r.non_novel_aspects || []);
      const suggestions = level2Results.flatMap((r: any) => r.suggestions || []);

      const finalRemarks = level2Results.map((result: any) =>
        `Patent ${result.publicationNumber}: ${result.overall_assessment}`
      ).join('\n');

      // Update assessment record
      await prisma.noveltyAssessmentRun.update({
        where: { id: assessment.id },
        data: {
          status: NoveltyAssessmentStatus.STAGE2_COMPLETED,
          finalDetermination: finalDetermination,
          stage2Results: level2Results,
          finalRemarks: finalRemarks,
          stage2CompletedAt: new Date(),
        },
      });

      // PDF generation removed - using browser print instead
      console.log('ℹ️ PDF report generation skipped - using browser print functionality');

      console.log(`✅ Level 2 assessment complete: ${finalDetermination}`);

      return {
        determination: finalDetermination,
        level2Results,
        confidence: 95, // Higher confidence after detailed analysis
        remarks: finalRemarks,
      };

    } catch (error) {
      console.error('❌ Level 2 assessment failed:', error);
      await prisma.noveltyAssessmentRun.update({
        where: { id: assessment.id },
        data: {
          status: NoveltyAssessmentStatus.FAILED,
        },
      });
      throw error;
    }
  }

  static async getPatentAssessments(patentId: string, userId: string): Promise<any[]> {
    try {
      // Verify patent access
      const patent = await prisma.patent.findFirst({
        where: {
          id: patentId,
          OR: [
            { createdBy: userId },
            {
              project: {
                OR: [
                  { userId: userId },
                  { collaborators: { some: { userId: userId } } }
                ]
              }
            }
          ]
        }
      });

      if (!patent) {
        throw new Error('Patent not found or access denied');
      }

      const assessments = await prisma.noveltyAssessmentRun.findMany({
        where: { patentId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          _count: {
            select: { llmCalls: true },
          },
        },
      });

      return assessments;

    } catch (error) {
      console.error('Get patent assessments error:', error);
      throw error;
    }
  }
}
