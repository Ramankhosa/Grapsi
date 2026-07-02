import { FundingCall } from './fundingCallsService';
import { fillPromptTemplate } from '../promptTemplates';
import {
  FUNDING_CHAT_NARRATIVE_STAGE_CODE,
  FUNDING_CHAT_TASK_CODE,
  runFundingGatewayText,
  type FundingLlmRoutingContext,
} from '../funding/llmRouting';

/**
 * Interface for search result enrichment
 */
export interface EnrichedSearchResult {
  fundingCall: FundingCall;
  relevanceScore: number;
  analysisPoints?: string[];
  eligibilityScore?: number;
  deadlineStatus?: string;
  keyHighlights?: string[];
}

/**
 * Options for LLM analysis
 */
export interface LLMAnalysisOptions {
  userResearchInterests?: string[];
  userInstitutionType?: string;
  userCountry?: string;
  maxResultsToAnalyze?: number;
  detailedAnalysis?: boolean;
  llmContext?: FundingLlmRoutingContext | null;
  documentEvidence?: Array<{
    sectionTitle: string | null;
    sectionType: string;
    pageStart: number;
    pageEnd: number;
    documentVersion: number;
    text: string;
  }>;
  documentQualityWarnings?: string[];
}

/**
 * Service for connecting SQL search results to LLM for processing
 */
export class SQLToLLMConnector {
  private async generateFundingAnalysisText(
    prompt: string,
    action: string,
    context?: FundingLlmRoutingContext | null
  ): Promise<string> {
    const result = await runFundingGatewayText({
      taskCode: FUNDING_CHAT_TASK_CODE,
      stageCode: FUNDING_CHAT_NARRATIVE_STAGE_CODE,
      prompt,
      context,
      temperature: 0.2,
      maxTokensOut: 2200,
      metadata: {
        purpose: `funding_sql_llm_${action}`,
        legacyService: 'SQLToLLMConnector',
      },
    });

    if (!result?.rawText) {
      throw new Error('No LLM provider configured for funding result analysis');
    }

    return result.rawText;
  }

  /**
   * Format funding calls for LLM consumption
   */
  private formatFundingCallsForLLM(fundingCalls: FundingCall[], similarities?: number[]): string {
    return fundingCalls.map((call, index) => {
      const similarity = similarities && similarities[index] 
        ? `Relevance Score: ${(similarities[index] * 100).toFixed(1)}%` 
        : '';
        
      return `
FUNDING OPPORTUNITY ${index + 1}:
Title: ${call.schemeTitle}
Agency: ${call.agencyName}
Description: ${call.description}
Deadline: ${call.deadline ? new Date(call.deadline).toLocaleDateString() : 'Not specified'}
Funding Amount: ${call.fundingAmount || 'Not specified'}
Eligibility: ${call.eligibility || 'Not specified'}
Research Areas: ${call.researchAreas.join(', ')}
Applicant Types: ${call.applicantTypes.join(', ')}
Grant Types: ${call.grantTypes.join(', ')}
Countries: ${call.countryAvailability.join(', ')}
URLs: ${call.urls.join(', ')}
Call URL: ${call.callUrl || 'Not specified'}
Attachment: ${call.attachmentFile ? 'Available' : 'Not available'}
${similarity}
`;
    }).join('\n');
  }
  
  /**
   * Enrich search results with LLM analysis
   */
  async enrichSearchResults(
    fundingCalls: FundingCall[],
    similarities: number[],
    userQuery: string,
    options: LLMAnalysisOptions = {}
  ): Promise<EnrichedSearchResult[]> {
    try {
      // Limit the number of results to analyze
      const maxResults = options.maxResultsToAnalyze || 5;
      const callsToAnalyze = fundingCalls.slice(0, maxResults);
      const relevantSimilarities = similarities.slice(0, maxResults);
      
      // Format calls for the LLM
      const formattedCalls = this.formatFundingCallsForLLM(callsToAnalyze, relevantSimilarities);
      
      // Create context information about the user
      const userContext = [
        options.userResearchInterests?.length 
          ? `User Research Interests: ${options.userResearchInterests.join(', ')}` 
          : '',
        options.userInstitutionType 
          ? `User Institution Type: ${options.userInstitutionType}` 
          : '',
        options.userCountry 
          ? `User Country: ${options.userCountry}` 
          : ''
      ].filter(Boolean).join('\n');
      
      // Generate a system prompt that instructs the LLM to analyze the results
      const { systemPrompt, userPrompt } = fillPromptTemplate('fundingSearch', {
        query: userQuery,
        subjects: options.userResearchInterests?.join(', ') || '',
        country: options.userCountry || '',
        orgType: options.userInstitutionType || '',
        grantType: ''
      });
      
      // Create an analysis prompt
      const analysisPrompt = `
${systemPrompt}

I have searched for funding opportunities based on the user's query: "${userQuery}"

Here are the search results from the database:
${formattedCalls}

${userContext}

For each funding opportunity, provide:
1. A brief analysis of why it might be suitable for the user
2. Key eligibility points relevant to the user
3. Any deadline considerations
4. Specific aspects that match the user's query

Format each analysis with clear headings and bullet points.
`;

      // Get LLM analysis
      const llmResponse = await this.generateFundingAnalysisText(
        analysisPrompt,
        'enrich_search_results',
        options.llmContext
      );
      
      // Process LLM response to extract structured data
      // This is a simplified version; in a real implementation, we would parse the response more carefully
      const enrichedResults: EnrichedSearchResult[] = callsToAnalyze.map((call, index) => {
        return {
          fundingCall: call,
          relevanceScore: relevantSimilarities[index],
          // These fields would normally be parsed from the LLM response
          analysisPoints: [
            "This is a placeholder for LLM-generated analysis"
          ],
          eligibilityScore: 0.8, // Placeholder
          deadlineStatus: call.deadline ? "Upcoming" : "Open",
          keyHighlights: [
            "This is a placeholder for LLM-generated highlights"
          ]
        };
      });
      
      return enrichedResults;
    } catch (error) {
      console.error('Error enriching search results:', error);
      
      // Return basic results without LLM enrichment
      return fundingCalls.slice(0, options.maxResultsToAnalyze || 5).map((call, index) => ({
        fundingCall: call,
        relevanceScore: similarities[index]
      }));
    }
  }
  
  /**
   * Generate a user-friendly response based on funding calls and user query
   */
  async generateSearchResponse(
    fundingCalls: FundingCall[],
    similarities: number[],
    userQuery: string,
    options: LLMAnalysisOptions = {}
  ): Promise<string> {
    try {
      // Format calls for LLM
      const formattedCalls = this.formatFundingCallsForLLM(
        fundingCalls.slice(0, options.maxResultsToAnalyze || 5), 
        similarities.slice(0, options.maxResultsToAnalyze || 5)
      );
      
      // Create context information about the user
      const userContext = [
        options.userResearchInterests?.length 
          ? `User Research Interests: ${options.userResearchInterests.join(', ')}` 
          : '',
        options.userInstitutionType 
          ? `User Institution Type: ${options.userInstitutionType}` 
          : '',
        options.userCountry 
          ? `User Country: ${options.userCountry}` 
          : ''
      ].filter(Boolean).join('\n');
      
      // Generate a response prompt
      const responsePrompt = `
You are an AI funding advisor analyzing search results for a user query.

User Query: "${userQuery}"

${userContext}

Here are the funding opportunities that match the query:

${formattedCalls}

Provide a helpful, conversational response to the user that:
1. Acknowledges their query
2. Summarizes the most relevant funding opportunities found
3. Highlights key details for each (deadline, eligibility, funding amount)
4. Offers specific advice for the most promising opportunities
5. Suggests next steps

Format your response in a clear, conversational way that helps the user understand their options.
`;

      // Get LLM response
      return await this.generateFundingAnalysisText(
        responsePrompt,
        'generate_search_response',
        options.llmContext
      );
    } catch (error) {
      console.error('Error generating search response:', error);
      return `I found some funding opportunities that might match your query, but I'm having trouble analyzing them in detail. Here are the basic results:\n\n${fundingCalls.slice(0, 3).map(call => `- ${call.schemeTitle} (${call.agencyName})`).join('\n')}`;
    }
  }
  
  /**
   * Analyze a specific funding opportunity in detail
   */
  async analyzeFundingOpportunity(
    fundingCall: FundingCall,
    userQuery: string,
    options: LLMAnalysisOptions = {}
  ): Promise<string> {
    try {
      // Format the funding call
      const formattedCall = this.formatFundingCallsForLLM([fundingCall]);
      
      // Create context information about the user
      const userContext = [
        options.userResearchInterests?.length 
          ? `User Research Interests: ${options.userResearchInterests.join(', ')}` 
          : '',
        options.userInstitutionType 
          ? `User Institution Type: ${options.userInstitutionType}` 
          : '',
        options.userCountry 
          ? `User Country: ${options.userCountry}` 
          : ''
      ].filter(Boolean).join('\n');
      
      // Generate an analysis prompt
      const analysisPrompt = `
You are an AI funding advisor providing detailed analysis of a specific funding opportunity.

User query or interest: "${userQuery}"

${userContext}

Please analyze the following funding opportunity in detail:

${formattedCall}

Document evidence supplied by retrieval:
${options.documentEvidence?.length ? JSON.stringify(options.documentEvidence, null, 2) : 'No document evidence supplied.'}

Document quality warnings:
${options.documentQualityWarnings?.length ? options.documentQualityWarnings.join('\n') : 'None supplied.'}

Provide a detailed analysis that covers:
1. Overall suitability for the user's interests/background
2. Detailed eligibility analysis - does the user qualify?
3. Funding amount evaluation - is it appropriate for the likely project scope?
4. Timeline considerations - is the deadline manageable?
5. Application strategy recommendations - what should the user emphasize?
6. Potential challenges or competition concerns
7. Alternative funding sources if this one isn't ideal

Format your analysis with clear headings and bullet points where appropriate. When document evidence is supplied, include "Recommended because", "Evidence", and "Risks" sections. Cite only supplied section/page/version metadata, and mark document-derived claims as requiring verification when structured fields are missing or quality warnings are present.
`;

      // Get LLM analysis
      return await this.generateFundingAnalysisText(
        analysisPrompt,
        'analyze_funding_opportunity',
        options.llmContext
      );
    } catch (error) {
      console.error('Error analyzing funding opportunity:', error);
      return `I found the funding opportunity "${fundingCall.schemeTitle}" from ${fundingCall.agencyName}, but I'm having trouble analyzing it in detail.`;
    }
  }
}
