import { FundingCall } from './fundingCallsService';

/**
 * Types of response formats
 */
export enum ResponseFormatType {
  TEXT = 'text',
  MARKDOWN = 'markdown',
  JSON = 'json',
  HTML = 'html'
}

/**
 * Interface for response formatting options
 */
export interface ResponseFormattingOptions {
  format?: ResponseFormatType;
  includeRawResults?: boolean;
  includeSimilarityScores?: boolean;
  includeMetadata?: boolean;
  maxResultsToInclude?: number;
  highlightKeywords?: string[];
}

/**
 * Interface for a formatted response
 */
export interface FormattedResponse {
  message: string;
  results?: any[];
  metadata?: Record<string, any>;
}

/**
 * Service for formatting chatbot responses consistently
 */
export class ResponseFormattingService {
  /**
   * Format a text response from the LLM
   */
  formatTextResponse(
    response: string,
    options: ResponseFormattingOptions = {}
  ): FormattedResponse {
    const format = options.format || ResponseFormatType.MARKDOWN;
    
    // Basic text cleaning
    let cleanedResponse = response.trim();
    
    // If markdown, ensure proper formatting
    if (format === ResponseFormatType.MARKDOWN) {
      // Ensure headings have space after #
      cleanedResponse = cleanedResponse.replace(/^(#{1,6})([^ #])/gm, '$1 $2');
      
      // Ensure lists have proper spacing
      cleanedResponse = cleanedResponse.replace(/^([*-])([^ ])/gm, '$1 $2');
      
      // Add emphasis to keywords if specified
      if (options.highlightKeywords && options.highlightKeywords.length > 0) {
        const keywordsPattern = new RegExp(`\\b(${options.highlightKeywords.join('|')})\\b`, 'gi');
        cleanedResponse = cleanedResponse.replace(keywordsPattern, '**$1**');
      }
    }
    
    // For HTML format, convert markdown to HTML
    if (format === ResponseFormatType.HTML) {
      // This is just a placeholder - in a real implementation we would use a markdown-to-html converter
      cleanedResponse = `<div class="chatbot-response">${cleanedResponse.replace(/\n/g, '<br/>')}</div>`;
    }
    
    return {
      message: cleanedResponse
    };
  }
  
  /**
   * Format funding search results
   */
  formatSearchResults(
    textResponse: string,
    fundingCalls: FundingCall[],
    similarities?: number[],
    options: ResponseFormattingOptions = {}
  ): FormattedResponse {
    const format = options.format || ResponseFormatType.MARKDOWN;
    const maxResults = options.maxResultsToInclude || fundingCalls.length;
    const limitedCalls = fundingCalls.slice(0, maxResults);
    
    // Format the main response
    const formattedResponse = this.formatTextResponse(textResponse, options);
    
    // Include raw results if requested
    if (options.includeRawResults) {
      // Format funding calls based on the requested format
      const formattedResults = limitedCalls.map((call, index) => {
        const result: any = {
          id: call.id,
          title: call.schemeTitle,
          agency: call.agencyName,
          description: call.description,
          deadline: call.deadline ? new Date(call.deadline).toISOString() : null,
          fundingAmount: call.fundingAmount,
          url: call.urls[0] || null,
          callUrl: call.callUrl || null,
          attachmentFile: call.attachmentFile || null
        };
        
        // Include similarity scores if requested
        if (options.includeSimilarityScores && similarities && similarities[index] !== undefined) {
          result.similarity = similarities[index];
        }
        
        // Include metadata if requested
        if (options.includeMetadata) {
          result.applicantTypes = call.applicantTypes;
          result.grantTypes = call.grantTypes;
          result.researchAreas = call.researchAreas;
          result.countries = call.countryAvailability;
          result.eligibleCountries = call.eligibleApplicantCountries;
        }
        
        return result;
      });
      
      formattedResponse.results = formattedResults;
    }
    
    // Add metadata about the search
    formattedResponse.metadata = {
      totalResults: fundingCalls.length,
      displayedResults: limitedCalls.length,
      timestamp: new Date().toISOString()
    };
    
    return formattedResponse;
  }
  
  /**
   * Format detailed analysis of a funding opportunity
   */
  formatDetailedAnalysis(
    analysisText: string,
    fundingCall: FundingCall,
    options: ResponseFormattingOptions = {}
  ): FormattedResponse {
    const format = options.format || ResponseFormatType.MARKDOWN;
    
    // Format the main response
    const formattedResponse = this.formatTextResponse(analysisText, options);
    
    // Include raw results if requested
    if (options.includeRawResults) {
      formattedResponse.results = [{
        id: fundingCall.id,
        title: fundingCall.schemeTitle,
        agency: fundingCall.agencyName,
        description: fundingCall.description,
        deadline: fundingCall.deadline ? new Date(fundingCall.deadline).toISOString() : null,
        fundingAmount: fundingCall.fundingAmount,
        url: fundingCall.urls[0] || null,
        callUrl: fundingCall.callUrl || null,
        attachmentFile: fundingCall.attachmentFile || null,
        
        // Include more details for detailed analysis
        eligibility: fundingCall.eligibility,
        researchAreas: fundingCall.researchAreas,
        applicantTypes: fundingCall.applicantTypes,
        grantTypes: fundingCall.grantTypes,
        countries: fundingCall.countryAvailability,
        eligibleCountries: fundingCall.eligibleApplicantCountries
      }];
    }
    
    return formattedResponse;
  }
  
  /**
   * Format an error response
   */
  formatErrorResponse(error: string | Error): FormattedResponse {
    const errorMessage = typeof error === 'string' ? error : error.message;
    
    return {
      message: `I'm sorry, but I encountered an issue while processing your request. ${errorMessage}`,
      metadata: {
        error: true,
        timestamp: new Date().toISOString()
      }
    };
  }
  
  /**
   * Format a fallback response when no results are found
   */
  formatFallbackResponse(query: string): FormattedResponse {
    return {
      message: `I couldn't find any specific funding opportunities matching "${query}". Here are some general suggestions:\n\n` +
        "1. Try broadening your search terms\n" +
        "2. Check if there are alternative terms for your research area\n" +
        "3. Consider looking for more general funding programs that might include your area of interest\n\n" +
        "Would you like me to suggest some general funding resources instead?",
      metadata: {
        noResults: true,
        timestamp: new Date().toISOString()
      }
    };
  }
} 