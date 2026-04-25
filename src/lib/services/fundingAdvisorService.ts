import { generateFromGemini } from '../geminiService';
import { fillPromptTemplate, parseResponse } from '../promptTemplates';
import type { RecommendationAccessScope } from '../recommendations/types';
import { formatFundingAmount } from '../recommendations/utils';
import { recommendationSearchService } from './recommendationSearchService';

/**
 * Interface for funding search parameters
 */
export interface FundingSearchParams {
  query: string;
  subjects?: string[];
  country?: string;
  orgType?: string;
  grantType?: string[];
  includeExpired?: boolean;
}

/**
 * Interface for eligibility assessment parameters
 */
export interface EligibilityAssessmentParams {
  opportunityDetails: string;
  userCountry: string;
  userOrgType: string;
  userCareerStage: string;
  userResearchField: string;
}

/**
 * Interface for application advice parameters
 */
export interface ApplicationAdviceParams {
  opportunityDetails: string;
}

/**
 * Interface for conversation parameters
 */
export interface ConversationParams {
  query: string;
  conversationHistory?: string;
  access?: RecommendationAccessScope;
}

/**
 * Types of user intent
 */
export type UserIntent = 
  | 'funding_search' 
  | 'eligibility_question' 
  | 'application_advice'
  | 'general_conversation'
  | 'funding_general_question';

/**
 * Service for the funding advisor chatbot
 */
export class FundingAdvisorService {
  /**
   * Get introduction message from the funding advisor
   */
  async getIntroduction(): Promise<string> {
    try {
      const { systemPrompt, userPrompt } = fillPromptTemplate('fundingAdvisorIntro');
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return response;
    } catch (error) {
      console.error('Error getting funding advisor introduction:', error);
      return 'Hello! I\'m your AI funding advisor. I can help you find suitable grants and funding opportunities based on your research interests, background, and goals. How can I assist you today?';
    }
  }
  
  /**
   * Classify the intent of a user query
   */
  async classifyIntent(query: string): Promise<UserIntent> {
    try {
      // First try our local intent detection for faster response
      const localIntent = this.detectIntent(query);
      if (localIntent) {
        console.log(`Using local intent detection: ${localIntent}`);
        return localIntent as UserIntent;
      }
      
      // Fall back to LLM-based classification for more complex queries
      const { systemPrompt, userPrompt } = fillPromptTemplate('intentClassification', { query });
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return parseResponse('intentClassification', response) as UserIntent;
    } catch (error) {
      console.error('Error classifying intent:', error);
      // Default to general conversation if classification fails
      return 'general_conversation';
    }
  }
  
  /**
   * Local intent detection based on keywords and patterns
   */
  private detectIntent(query: string): UserIntent | null {
    const lowerQuery = query.toLowerCase();
    
    // Check for greetings and farewells
    const greetingKeywords = ['hello', 'hi', 'hey', 'greetings'];
    const farewellKeywords = ['bye', 'goodbye', 'farewell', 'see you'];
    const thanksKeywords = ['thanks', 'thank you', 'appreciate'];
    
    const isGreeting = greetingKeywords.some(kw => lowerQuery.match(new RegExp(`\\b${kw}\\b`)));
    const isFarewell = farewellKeywords.some(kw => lowerQuery.match(new RegExp(`\\b${kw}\\b`)));
    const isThanks = thanksKeywords.some(kw => lowerQuery.match(new RegExp(`\\b${kw}\\b`)));
    
    if (isGreeting) return 'general_conversation';
    if (isFarewell) return 'general_conversation';
    if (isThanks) return 'general_conversation';
    
    // Check for eligibility questions - these should be prioritized over funding searches
    const eligibilityKeywords = ['eligible', 'eligibility', 'qualify', 'who can apply', 'requirements', 'criteria', 'qualified', 'qualify for'];
    const eligibilityPatterns = [
      /\bwho (is|are) eligible\b/i,
      /\beligibility (requirement|criteria)\b/i,
      /\bqualify for\b/i,
      /\brequirements for\b/i,
      /\bwho can apply\b/i,
      /\btypical eligibility\b/i,
      /\bam i eligible\b/i
    ];
    
    const isEligibilityQuestion = 
      eligibilityKeywords.some(kw => lowerQuery.includes(kw)) ||
      eligibilityPatterns.some(pattern => lowerQuery.match(pattern));
    
    if (isEligibilityQuestion) return 'eligibility_question';
    
    // Check for application advice questions
    const applicationKeywords = ['how to apply', 'application', 'proposal', 'submit', 'tips', 'advice', 'improve', 'write', 'writing', 'prepare'];
    const applicationPatterns = [
      /\bhow (to|do I|can I|should I) (write|prepare|create|make|submit|apply)\b/i,
      /\b(tips|advice|guidance) (for|on) (writing|preparing|creating|making|submitting)\b/i,
      /\bimprove my (application|proposal|grant|submission)\b/i,
      /\bsuccessful (application|proposal|grant|submission)\b/i,
      /\bapplication (process|procedure|steps)\b/i
    ];
    
    const isApplicationQuestion = 
      applicationKeywords.some(kw => lowerQuery.includes(kw)) ||
      applicationPatterns.some(pattern => lowerQuery.match(pattern));
    
    if (isApplicationQuestion) return 'application_advice';
    
    // Check for follow-up questions about previous results
    const followUpKeywords = [
      'more details', 'tell me more', 'about number', 'about the', 
      'first one', 'second one', 'third one', 'fourth one', 'fifth one',
      'first grant', 'second grant', 'third grant', 'fourth grant', 'fifth grant'
    ];
    const isFollowUp = followUpKeywords.some(kw => lowerQuery.includes(kw)) || 
                      lowerQuery.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/i) ||
                      lowerQuery.match(/\b([1-5])\b/);
    
    if (isFollowUp && query.length < 50) return 'funding_search';
    
    // Check for funding-related keywords
    const fundingKeywords = ['grant', 'funding', 'money', 'financial', 'support', 'scholarship', 'fund', 'agriculture', 'agri', 'farm'];
    const isFundingQuery = fundingKeywords.some(kw => lowerQuery.includes(kw));
    
    // Check for general funding questions
    const generalFundingKeywords = ['how does funding work', 'what is a grant', 'types of funding'];
    const isGeneralFundingQuestion = generalFundingKeywords.some(kw => lowerQuery.includes(kw));
    
    // Determine the intent based on keywords
    if (isFundingQuery) {
      return 'funding_search';
    } else if (isGeneralFundingQuestion) {
      return 'funding_general_question';
    }
    
    // Return null if we can't determine the intent locally
    return null;
  }
  
  /**
   * Process a user query based on detected intent
   */
  async processQuery(params: ConversationParams): Promise<string> {
    try {
      const { query, conversationHistory = '' } = params;
      
      // First, classify the intent of the query
      const intent = await this.classifyIntent(query);
      console.log(`Classified intent: ${intent}`);
      
      // Process based on intent
      switch (intent) {
        case 'funding_search':
          try {
            const searchResult = await recommendationSearchService.search({
              inputMode: 'research_area',
              query: { researchArea: query },
              filters: { limit: 10, includeExpired: false },
              access: params.access,
            });

            if (searchResult.rawResults.length > 0) {
              const formattedResults = searchResult.rawResults.map((call, index) => {
                const description = call.fullDescription || call.shortDescription || call.description || '';
                const fundingAmount = formatFundingAmount(call.amountMin, call.amountMax, call.currency) || 'Not specified';

                return `${index + 1}. **${call.schemeTitle}** by ${call.agencyName} (${(call.score * 100).toFixed(1)}% match)\n` +
                  `   - Deadline: ${call.closeDate ? new Date(call.closeDate).toLocaleDateString() : 'Not specified'}\n` +
                  `   - Funding: ${fundingAmount}\n` +
                  `   - Research Areas: ${call.disciplines.join(', ') || 'Not specified'}\n` +
                  `   - Description: ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}`;
              }).join('\n\n');

              return `Based on your query about "${query}", I've found ${searchResult.rawResults.length} funding opportunities that might interest you:\n\n${formattedResults}\n\n[Results from: **Database - Grounded Search**]\n\nWould you like more details about any of these opportunities? You can ask about a specific one by number (e.g., "Tell me more about #2") or ask for more details about all of them.`;
            } else {
              return `I searched our database for funding opportunities related to "${query}", but couldn't find any exact matches. Here are some suggestions:\n\n` +
                `1. Try using different keywords or more general terms\n` +
                `2. Check if there are alternative terms for your research area\n` +
                `3. Broaden your search to include related fields\n\n` +
                `[Results from: **Database - No Matches Found**]\n\n` +
                `Would you like to search for something else?`;
            }
          } catch (dbError) {
            console.error('Error using database search:', dbError);
            return `I apologize, but I encountered an issue accessing the funding database. This might be due to a connection problem or database maintenance.\n\n` +
              `Please try again later or contact support if the problem persists.`;
          }
          break;
          
        case 'eligibility_question':
          // For eligibility questions, use the QA functionality
          return this.answerQuestion(query);
          break;
          
        case 'application_advice':
          // For application advice, use the QA functionality
          return this.answerQuestion(query);
          break;
          
        case 'funding_general_question':
          // For general funding questions, use the QA functionality
          return this.answerQuestion(query);
          break;
          
        case 'general_conversation':
        default:
          // For general conversation, use the conversational mode
          return this.handleGeneralConversation({
            query,
            conversationHistory
          });
      }
    } catch (error) {
      console.error('Error processing query:', error);
      return 'I apologize, but I encountered an issue processing your request. Could you please try rephrasing your question?';
    }
  }
  
  /**
   * Handle general conversation with the user
   */
  async handleGeneralConversation(params: ConversationParams): Promise<string> {
    try {
      const { query, conversationHistory = '' } = params;
      const { systemPrompt, userPrompt } = fillPromptTemplate('generalConversation', { 
        query, 
        conversationHistory 
      });
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return response;
    } catch (error) {
      console.error('Error handling general conversation:', error);
      return 'I apologize, but I encountered an issue with our conversation. Let\'s get back to discussing funding opportunities. How can I help you with that?';
    }
  }
  
  /**
   * Search for funding opportunities based on user query
   */
  async searchFundingOpportunities(params: FundingSearchParams): Promise<any> {
    try {
      const { query, subjects = [], country = '', orgType = '', grantType = [] } = params;
      
      // Format parameters for the template
      const templateValues = {
        query,
        subjects: subjects.join(', '),
        country,
        orgType,
        grantType: grantType.join(', ')
      };
      
      const { systemPrompt, userPrompt } = fillPromptTemplate('fundingSearch', templateValues);
      
      // TODO: In the future, we'll add logic to actually search the database for funding opportunities
      // and incorporate those results into the prompt
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return parseResponse('fundingSearch', response);
    } catch (error) {
      console.error('Error searching funding opportunities:', error);
      throw new Error('Failed to search for funding opportunities');
    }
  }
  
  /**
   * Assess eligibility for a specific funding opportunity
   */
  async assessEligibility(params: EligibilityAssessmentParams): Promise<string> {
    try {
      const { systemPrompt, userPrompt } = fillPromptTemplate('eligibilityAssessment', params as unknown as Record<string, string>);
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return response;
    } catch (error) {
      console.error('Error assessing eligibility:', error);
      throw new Error('Failed to assess eligibility for the funding opportunity');
    }
  }
  
  /**
   * Provide advice on preparing a funding application
   */
  async getApplicationAdvice(params: ApplicationAdviceParams): Promise<string> {
    try {
      const { systemPrompt, userPrompt } = fillPromptTemplate('applicationAdvice', params as unknown as Record<string, string>);
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return response;
    } catch (error) {
      console.error('Error getting application advice:', error);
      throw new Error('Failed to get application advice');
    }
  }
  
  /**
   * Answer a general funding-related question
   */
  async answerQuestion(question: string): Promise<string> {
    try {
      const { systemPrompt, userPrompt } = fillPromptTemplate('fundingQA', { question });
      
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await generateFromGemini(combinedPrompt, 'gemini-2.0-flash');
      
      return response;
    } catch (error) {
      console.error('Error answering funding question:', error);
      throw new Error('Failed to answer the question');
    }
  }
} 
